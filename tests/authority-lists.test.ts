import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, sep } from 'node:path'
import { describe, expect, it } from 'vitest'

// ---------------------------------------------------------------------------
// EVERY AUTHORITY LIST READS ONE RULE (GAPS code gap 11, owner's ruling
// 2026-10-08).
//
// Eight screens wrote `isActive: true` inline and three wrote nothing, so a
// deactivated authority dropped off some lists and stayed on others. The rule
// now lives in `src/lib/companies.ts`: `listedAuthorities` and
// `LISTED_AUTHORITY` for lists, and `SELECTABLE_AUTHORITY` for creation
// pickers, which is built on top of it.
//
// This file reads source, so it cannot prove what the database returns. The
// integration test `tests/integration/authority-lists.test.ts` does that. What
// this file proves is that every reader of the Company table goes through the
// rule, so that one integration test speaks for every screen.
// ---------------------------------------------------------------------------

/**
 * Readers that must see a deactivated authority, each with its reason. These
 * match a document or a person to an authority, or administer authorities.
 * Showing a list to choose from is not one of their jobs.
 */
const MATCHERS: Record<string, string> = {
  'src/app/(app)/companies/page.tsx':
    'the admin screen lists every authority, including deactivated ones, so they can be reactivated',
  'src/app/api/_lib/coi-context.ts':
    'a certificate of insurance for a deactivated authority is still ours to file',
  'src/lib/inbound-email.ts':
    'an inbound rate con naming a deactivated authority is still our own name, not a broker',
  'src/app/(app)/payments/import/actions.ts':
    'a remittance paying a deactivated authority is still paying us',
}

/** The rule's own home. */
const HOME = 'src/lib/companies.ts'

const RULE = /\b(LISTED_AUTHORITY|SELECTABLE_AUTHORITY)\b/

function sourceFiles(dir: string): string[] {
  const out: string[] = []
  for (const name of readdirSync(dir)) {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) {
      if (name === 'generated') continue
      out.push(...sourceFiles(path))
    } else if (/\.(ts|tsx)$/.test(name)) {
      out.push(path)
    }
  }
  return out
}

const posix = (path: string) => relative('.', path).split(sep).join('/')

/** Each `company.findMany(` call, with the text of its argument object. */
function companyReads(): { file: string; line: number; call: string }[] {
  const reads: { file: string; line: number; call: string }[] = []
  for (const path of sourceFiles('src')) {
    const text = readFileSync(path, 'utf8')
    const pattern = /\bcompany\.findMany\(/g
    for (let match; (match = pattern.exec(text)); ) {
      // The call's text up to its balanced closing parenthesis.
      let depth = 0
      let end = match.index + match[0].length - 1
      for (; end < text.length; end++) {
        if (text[end] === '(') depth++
        else if (text[end] === ')' && --depth === 0) break
      }
      reads.push({
        file: posix(path),
        line: text.slice(0, match.index).split('\n').length,
        call: text.slice(match.index, end + 1),
      })
    }
  }
  return reads
}

describe('every authority list reads one rule', () => {
  const reads = companyReads()

  it('finds the readers it is checking', () => {
    // A walk that found nothing would pass every assertion below.
    expect(reads.length).toBeGreaterThan(10)
  })

  it('has no reader of Company that skips the rule, outside the matchers', () => {
    const offenders = reads
      .filter((read) => read.file !== HOME && !(read.file in MATCHERS))
      .filter((read) => !RULE.test(read.call))
      .map((read) => `${read.file}:${read.line}`)
    expect(offenders).toEqual([])
  })

  it('names only matchers that still read Company', () => {
    // A stale entry would silently exempt whatever reader lands in that file
    // next.
    const readingFiles = new Set(reads.map((read) => read.file))
    expect(Object.keys(MATCHERS).filter((f) => !readingFiles.has(f))).toEqual(
      [],
    )
  })

  it('lists the four screens from the ruling through the shared reader', () => {
    for (const file of [
      'src/app/(app)/payments/new/page.tsx',
      'src/app/(app)/receivables/factoring/page.tsx',
      'src/app/(app)/loads/page.tsx',
    ]) {
      expect(readFileSync(file, 'utf8'), file).toMatch(
        /listedAuthorities\(tx, session\.companyScopes\)/,
      )
    }
    expect(readFileSync('src/lib/dashboard.ts', 'utf8')).toMatch(
      /listedAuthorities\(tx, companyIds\)/,
    )
  })

  it('builds the creation rule on the list rule', () => {
    const home = readFileSync(HOME, 'utf8')
    expect(home).toMatch(
      /SELECTABLE_AUTHORITY = \{\s*\.\.\.LISTED_AUTHORITY,\s*retired: false,/,
    )
  })
})
