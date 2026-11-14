import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

// ---------------------------------------------------------------------------
// NO SCRIPT PRINTS AN ENVIRONMENT VALUE (owner's ruling 2026-11-14).
//
// On 2026-11-14 a shell `source` of `.env` failed on one line and the error
// quoted that line — the production read-only connection string, password
// and all — into a session transcript. The shell is not a script, but the
// scripts are where the same leak would be WRITTEN: a `console.log` of a
// connection string, an error that interpolates a key, a dump of
// `process.env`. Their output lands in CI logs, run-status files and
// transcripts, none of which is a secret store.
//
// A SOURCE CHECK, because a leak is a line nobody runs until it fires. Every
// line under `scripts/` that writes output or builds an error — console.*,
// process.stdout/stderr.write, `throw new Error`, `new Error(` — may carry
// `process.env.NAME` only for a NAME on the list below, which holds labels
// and paths, never credentials. A variable assigned from any other
// `process.env.NAME` may not appear on such a line either, and nothing may
// print `process.env` whole.
// ---------------------------------------------------------------------------

/** Environment names that are labels or paths, safe to print. Never a credential. */
const PRINTABLE = new Set([
  'NEON_BRANCH',
  'TEMP',
  'APPDATA',
  'NODE_ENV',
  'CI',
  // Names of things, not keys to them. R2_ENDPOINT is a `vars` entry by the
  // GAPS 41 ruling: a value that is read back is not a secret.
  'AUDIT_DATASET',
  'R2_BUCKET',
  'R2_ENDPOINT',
  'SEED_ORGANIZATION_ID',
])

const OUTPUT =
  /console\.(log|error|warn|info|debug|table)|process\.std(out|err)\.write|new Error\(|throw new /

function scriptFiles(dir: string): { name: string; text: string }[] {
  const found: { name: string; text: string }[] = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) found.push(...scriptFiles(path))
    else if (/\.(m?js|cjs|ts|mts|sh|ps1)$/.test(entry.name))
      found.push({ name: path, text: readFileSync(path, 'utf8') })
  }
  return found
}

/** The offending lines in one file's text, as `line: text`. */
export function envPrints(text: string): string[] {
  const lines = text.split('\n')
  // Identifiers holding a non-printable environment value.
  const tainted = new Set<string>()
  for (const line of lines) {
    for (const hit of line.matchAll(
      /(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*process\.env\.([A-Z0-9_]+)/g,
    )) {
      if (!PRINTABLE.has(hit[2]!)) tainted.add(hit[1]!)
    }
  }
  const bad: string[] = []
  lines.forEach((line, index) => {
    if (!OUTPUT.test(line)) return
    const names = [...line.matchAll(/process\.env\.([A-Z0-9_]+)/g)].map(
      (hit) => hit[1]!,
    )
    const whole = /process\.env(?![.\w[])/.test(line)
    // A tainted variable LEAKS when it is printed whole — interpolated as
    // `${id}` or `${id ?? …}`, or passed bare to the print call. A condition
    // (`if (!url)`) or a derived label (`new URL(url).hostname`) is not its value.
    const leaked =
      whole ||
      names.some((name) => !PRINTABLE.has(name)) ||
      [...tainted].some((id) => {
        const name = id.replace(/\$/g, '\\$')
        return new RegExp(
          String.raw`\$\{\s*` +
            name +
            String.raw`\s*(\}|\?\?|\|\|)|(?:(?:log|error|warn|info|debug|table|write|Error)\(|,)\s*` +
            name +
            String.raw`\s*[,)]`,
        ).test(line.slice(line.search(OUTPUT)))
      })
    if (leaked) bad.push(`${index + 1}: ${line.trim()}`)
  })
  return bad
}

describe('no script prints an environment value', () => {
  it('reads the scripts, so the check cannot pass by finding nothing', () => {
    const files = scriptFiles('scripts')
    expect(files.length).toBeGreaterThan(100)
    expect(files.some((file) => /process\.env\./.test(file.text))).toBe(true)
  })

  it('finds no output line carrying a credential from the environment', () => {
    const offenders = scriptFiles('scripts').flatMap((file) =>
      envPrints(file.text).map((line) => `${file.name}:${line}`),
    )
    expect(offenders, 'print the variable name, never its value').toEqual([])
  })

  it('catches the three shapes it exists for', () => {
    expect(envPrints('console.log(process.env.DATABASE_URL)')).toHaveLength(1)
    expect(
      envPrints(
        'const url = process.env.DIRECT_DATABASE_URL\nthrow new Error(`refused: ${url}`)',
      ),
    ).toHaveLength(1)
    expect(envPrints('console.log(JSON.stringify(process.env))')).toHaveLength(
      1,
    )
    // And leaves a label and a name alone.
    expect(
      envPrints('console.log(`branch ${process.env.NEON_BRANCH}`)'),
    ).toEqual([])
    expect(envPrints("console.log('DATABASE_URL is not set')")).toEqual([])
  })
})
