import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, statSync } from 'node:fs'
import { parse } from 'dotenv'
import { describe, expect, it } from 'vitest'

// ---------------------------------------------------------------------------
// NO COMMITTED FILE NAMES WHAT ONLY .env KNOWS (owner's ruling, 2026-10-23).
//
// On 2026-10-13 `wrangler types` regenerated cloudflare-env.d.ts from the
// local .env and wrote every key name into it — PROD_CHECK_PASSWORD, the seed
// accounts, and two stray non-key lines that dotenv nonetheless reads as keys
// because it accepts the colon form. No values, but a committed file
// describing the shape of somebody's credentials file. It was caught by
// reading the diff; this is the check that does not depend on that.
//
// THE RULE: every key dotenv reads from .env that .env.example does not list
// must not be DECLARED — `NAME=`, `NAME:` or `NAME?:` — in any file git
// tracks. Parsed with dotenv itself, because that is what wrangler uses and
// the stray `Name:` lines are exactly what a stricter parser would miss.
// Without a .env (a fresh clone) there is nothing local to leak.
// ---------------------------------------------------------------------------

const keysOf = (path: string) => Object.keys(parse(readFileSync(path)))

/** Keys .env holds that .env.example does not list. */
export function localOnlyKeys(): string[] {
  if (!existsSync('.env')) return []
  const listed = new Set(keysOf('.env.example'))
  return keysOf('.env').filter((key) => !listed.has(key))
}

const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** Committed files that declare any of `keys`, as `file: KEY`. */
export function declarations(keys: string[]): string[] {
  if (keys.length === 0) return []
  const patterns = keys.map(
    (key) =>
      [
        key,
        new RegExp(`(^|[^\\w.-])${escape(key)}\\s*\\??\\s*[:=]`, 'm'),
      ] as const,
  )
  const files = execFileSync('git', ['ls-files'], { encoding: 'utf8' })
    .split('\n')
    .filter(Boolean)
  const found: string[] = []
  for (const file of files) {
    if (!existsSync(file) || statSync(file).size > 2_000_000) continue
    const text = readFileSync(file, 'utf8')
    if (text.includes('\u0000')) continue
    for (const [key, pattern] of patterns)
      if (pattern.test(text)) found.push(`${file}: ${key}`)
  }
  return found
}

describe('committed files and the local .env', () => {
  it('no committed file declares a key that only .env holds', () => {
    expect(declarations(localOnlyKeys())).toEqual([])
  })

  it('a declaration is found in every form the leak took', () => {
    const pattern = (key: string) =>
      new RegExp(`(^|[^\\w.-])${escape(key)}\\s*\\??\\s*[:=]`, 'm')
    // Synthetic names only: this file is tracked, and a real local key in a
    // declaration form here is exactly what the check above would report.
    expect(pattern('StrayKey').test('\tStrayKey: string;')).toBe(true)
    expect(pattern('SECRET_X').test('SECRET_X="1"')).toBe(true)
    expect(pattern('SECRET_X').test('  SECRET_X?: string')).toBe(true)
    // Prose that merely mentions a word is not a declaration.
    expect(pattern('Stamped').test('// Stamped in SQL')).toBe(false)
    expect(pattern('Stamped').test("'Stamped date',")).toBe(false)
  })
})
