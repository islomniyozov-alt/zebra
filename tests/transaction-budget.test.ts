import { describe, expect, it } from 'vitest'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { LOAD_WRITE_TIMEOUT_MS } from '@/lib/loads'

// ---------------------------------------------------------------------------
// EVERY INTEGRATION SUITE STATES ITS TRANSACTION BUDGET, AND STATES IT ONCE.
//
// PRISMA'S DEFAULT IS FIVE SECONDS AND THIS LINK CANNOT MEET IT. One audited
// write costs four round trips — SAVEPOINT, the write, the audit insert,
// RELEASE (Phase 1 §8) — and at roughly 200ms to us-east-2 a handful of them
// is past five seconds with nothing whatsoever wrong. `LOAD_WRITE_TIMEOUT_MS`
// carries that arithmetic already: 5s is about 24 statements from here.
//
// A WHOLE GATE RUN DIED ON IT. `claims.test.ts` had `maxWaitMs` and no
// `timeoutMs`, so its transactions ran on the 5s default:
//
//   Transaction API error: A commit cannot be executed on an expired
//   transaction. The timeout for this transaction was 5000 ms, however
//   17923 ms passed since the start of the transaction.
//
// Twelve suites were in that state and seven were not, because the seven had
// each hit it and been fixed one at a time — which is the shape of a rule that
// lives in nobody's head. This is the rule, written down and watched.
//
// IT CHECKS FOR A NAME, NOT FOR A NUMBER. Nineteen files holding `20_000`
// would be nineteen places to change when the link or the audit cost moves;
// the point is one dial. A file that hardcodes even the right value fails
// here.
//
// BUT IT NO LONGER DEMANDS ONE PARTICULAR NAME. The first version required
// exactly `LOAD_WRITE_TIMEOUT_MS`, which forbade a justified override — and a
// guard with no room in it gets cut open under deadline by whoever needs the
// exception at 2am, with whatever reasoning fits in the moment.
// `relay-import.test.ts` had a 30s budget before this rule was written, and a
// suite that genuinely needs a longer one will exist again.
//
// THE HATCH IS "AN IMPORTED IDENTIFIER", AND THE IMPORT IS THE POINT. A local
// `const RELAY_TIMEOUT = 30_000` satisfies "use a named constant" while being
// a bare literal wearing a name — it moves nothing out of the file and puts
// the number back in nineteen possible places. Requiring the name to be
// IMPORTED forces an override to live in a shared module, where its reason is
// written down once and can be grepped, reviewed and changed in one edit.
// ---------------------------------------------------------------------------

const DIR = join(process.cwd(), 'tests', 'integration')

/** The integration suites that open transactions through a local helper. */
function suitesWithHelper(): { name: string; source: string }[] {
  return readdirSync(DIR)
    .filter((name) => name.endsWith('.test.ts'))
    .map((name) => ({
      name,
      source: readFileSync(join(DIR, name), 'utf8'),
    }))
    .filter((file) => file.source.includes('const inOrg'))
}

describe('every integration suite states its transaction budget', () => {
  const suites = suitesWithHelper()

  it('found the suites at all', () => {
    // Without this the loop below passes vacuously the day somebody renames
    // the helper — a guard-shaped silence, which is the failure mode this
    // whole file exists because of.
    expect(suites.length).toBeGreaterThan(15)
  })

  it.each(suitesWithHelper().map((file) => file.name))(
    '%s sets an explicit timeoutMs',
    (name) => {
      const source = suites.find((file) => file.name === name)!.source
      // The helper's own option block: from `const inOrg` to the close of the
      // options object. Reading the whole file would let a `timeoutMs` on some
      // unrelated call satisfy this.
      const helper = source.slice(
        source.indexOf('const inOrg'),
        source.indexOf('const inOrg') + 900,
      )
      expect(helper, `${name} relies on Prisma's 5s default`).toContain(
        'timeoutMs:',
      )
    },
  )

  it.each(suitesWithHelper().map((file) => file.name))(
    '%s names its budget rather than spelling it as a number',
    (name) => {
      const source = suites.find((file) => file.name === name)!.source
      const helper = source.slice(
        source.indexOf('const inOrg'),
        source.indexOf('const inOrg') + 900,
      )

      const written = /timeoutMs:\s*([^,\n]+)/.exec(helper)?.[1]?.trim()
      expect(written, `${name} sets no timeoutMs`).toBeDefined()

      // A bare literal — `20_000`, `30000`, `60 * 1000` — is the thing this
      // forbids, whatever arithmetic it is dressed in.
      expect(
        /^[\d_]+$/.test(written!) || /^[\d_\s*+/-]+$/.test(written!),
        `${name} hardcodes ${written}; point it at an imported constant`,
      ).toBe(false)

      // ...and the name has to come from somewhere else. A file-local const
      // is a literal with a hat on: it moves the number nowhere.
      const identifier = /^[A-Za-z_$][\w$]*$/.test(written!) ? written! : null
      expect(
        identifier,
        `${name} sets timeoutMs to an expression (${written}); use a plain imported identifier`,
      ).not.toBeNull()

      const imported = new RegExp(
        `import\\s*\\{[^}]*\\b${identifier}\\b[^}]*\\}\\s*from`,
      ).test(source)
      const declaredLocally = new RegExp(
        `^\\s*(const|let|var)\\s+${identifier}\\b`,
        'm',
      ).test(source)

      expect(
        declaredLocally,
        `${name} declares ${identifier} in the file; a budget lives in a shared module or it is nineteen budgets`,
      ).toBe(false)
      expect(imported, `${name} uses ${identifier} without importing it`).toBe(
        true,
      )
    },
  )

  // The dial itself has to be worth pointing at.
  it('and the constant is still bigger than the default it replaces', () => {
    expect(LOAD_WRITE_TIMEOUT_MS).toBeGreaterThan(5_000)
  })
})
