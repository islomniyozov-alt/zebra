import { readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

// ---------------------------------------------------------------------------
// ONLY A COMPONENT CROSSES FROM A 'use client' MODULE INTO A SERVER FILE.
//
// On 2026-11-10 the trucks page imported `TRUCK_FILTER_PARAMS`, a plain array,
// from `TruckFilters.tsx` — a 'use client' module — and spread it. Next.js
// hands a server component every export of a client module as a client
// REFERENCE, so the array was an object and the spread threw: `TypeError:
// TRUCK_FILTER_PARAMS is not iterable`, 500 on every /trucks request on dev,
// found by the chain's own probe after CI was green. The unit tests read the
// page's source and the integration tests never render it, so nothing before
// the deploy could see it. This reads the artefact: every server file under
// src/app, every name it imports from a client module, and requires each to
// be a component — a capitalised name — or a type.
// ---------------------------------------------------------------------------

const ROOT = join(process.cwd(), 'src', 'app')

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) return walk(path)
    return /\.(tsx?|mjs|js)$/.test(name) ? [path] : []
  })
}

const isClientModule = (source: string) =>
  /^\s*(['"])use client\1/m.test(source.slice(0, 400))

/** Each relative import's specifier list and the module it names. */
function relativeImports(source: string): { names: string[]; from: string }[] {
  const found: { names: string[]; from: string }[] = []
  const pattern = /import\s+(type\s+)?\{([^}]*)\}\s+from\s+'(\.[^']+)'/g
  for (const hit of source.matchAll(pattern)) {
    if (hit[1]) continue // `import type` never reaches the runtime.
    const names = hit[2]!
      .split(',')
      .map((part) => part.trim())
      .filter((part) => part !== '' && !part.startsWith('type '))
      .map((part) => part.split(/\s+as\s+/)[0]!.trim())
    found.push({ names, from: hit[3]! })
  }
  return found
}

function resolveModule(fromFile: string, spec: string): string | null {
  const base = resolve(dirname(fromFile), spec)
  for (const candidate of [
    base,
    `${base}.tsx`,
    `${base}.ts`,
    join(base, 'index.tsx'),
    join(base, 'index.ts'),
  ]) {
    try {
      if (statSync(candidate).isFile()) return candidate
    } catch {
      // not this one
    }
  }
  return null
}

describe("a server file imports only components from a 'use client' module", () => {
  const files = walk(ROOT)
  const sources = new Map(
    files.map((file) => [file, readFileSync(file, 'utf8')]),
  )
  const offenders: string[] = []
  let crossings = 0

  for (const [file, source] of sources) {
    if (isClientModule(source)) continue
    for (const { names, from } of relativeImports(source)) {
      const target = resolveModule(file, from)
      if (!target) continue
      const targetSource = sources.get(target) ?? readFileSync(target, 'utf8')
      if (!isClientModule(targetSource)) continue
      for (const name of names) {
        crossings++
        if (!/^[A-Z]/.test(name)) {
          offenders.push(
            `${file.slice(ROOT.length)} imports ${name} from ${from}`,
          )
        }
      }
    }
  }

  it('finds the crossings at all, so an empty offender list is not vacuous', () => {
    expect(crossings).toBeGreaterThan(20)
  })

  it('and every crossing is a component', () => {
    expect(offenders).toEqual([])
  })

  it('the trucks page takes TRUCK_FILTER_PARAMS from the lib, where the value is a value', () => {
    const page = readFileSync(join(ROOT, '(app)', 'trucks', 'page.tsx'), 'utf8')
    expect(page).toMatch(
      /TRUCK_FILTER_PARAMS,[\s\S]*?\} from '@\/lib\/truck-list'/,
    )
    expect(page).not.toMatch(/TRUCK_FILTER_PARAMS[^\n]*from '\.\/TruckFilters'/)
  })
})
