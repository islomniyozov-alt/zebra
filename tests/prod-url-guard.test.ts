import { describe, expect, it } from 'vitest'
import { execFileSync } from 'node:child_process'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

// ---------------------------------------------------------------------------
// A PRODUCTION CONNECTION STRING LIVES ON THIS MACHINE NOW. THIS IS THE FENCE.
//
// `PROD_DIRECT_DATABASE_URL` in `.env` lets the migration check VERIFY against
// production rather than trusting a marker a human wrote. That is strictly
// better evidence, and it costs something real: a production URL moves from
// "one variable, one terminal, one command" to sitting in the ambient
// environment of every process that loads dotenv here.
//
// THAT IS NOT THEORETICAL. On 2026-08-15 a `neondb_owner` string reached
// production's `DATABASE_URL` by clipboard, and only `src/lib/db.ts` refusing
// any string without `zebra_app` in it turned a silent row-level-security
// bypass into a loud outage (flag 77). The same clipboard, the same evening,
// also put an unfilled placeholder into a migrate command twice.
//
// SO THE VARIABLE IS SAFE BY CONSTRUCTION RATHER THAN BY INTENT:
//
//   it is read by an ALLOWLIST of files, by name, and a new reader fails here
//   it is never assigned into DATABASE_URL or DIRECT_DATABASE_URL
//   the readers only ever SELECT
//
// SEVEN READERS, NOT ONE. The ruling that produced this file said the
// variable was read by `check-migration-gap.mjs` and nothing else. It was
// already read by six: five walkthrough scripts choose it over
// `DIRECT_DATABASE_URL` when their target is production, and `verify-users`
// REFUSES TO RUN against production without it. The name was an established
// convention before this fence was proposed, and the fence is written around
// what is actually there rather than around what was believed.
//
// THE LIST IS THE MECHANISM. A new reader fails here by name, so adding one
// is a decision somebody makes on purpose rather than a habit that spreads.
// The two `check:` readers are held to a stricter rule than the walkthroughs:
// they run inside `npm run check`, unattended, constantly, so they may only
// SELECT.
// ---------------------------------------------------------------------------

const VARIABLE = 'PROD_DIRECT_DATABASE_URL'

/**
 * Everything permitted to read it.
 *
 * `check:` scripts run unattended inside `npm run check`. The walkthroughs are
 * run deliberately by a human, at a named target, and predate this fence.
 */
const CHECK_READERS = [
  'check-migration-gap.mjs',
  'check-unrouted.mjs',
  // ADDED 2026-08-20, deliberately, which is what this fence is for.
  //
  // Flag 81: the schema is version-controlled and the GRANTS ARE NOT, so two
  // databases could disagree about who may read what and nothing would say so.
  // `src/lib/grant-rule.ts` derives the expected grants from the migration and
  // `tests/structure.test.ts` asserts them against dev — but the test suite
  // may not read this variable, so production needs its own caller. One rule,
  // two callers, and the second one is this.
  //
  // Held to the stricter half of the rule below: it runs unattended in
  // `npm run check` and only ever SELECTs.
  'check-grants.mjs',
  // ADDED 2026-09-06. `Load.billingStatus` is a cached column and changing
  // `billingStatusFor` silently drifts every untouched row — which reached
  // production once already. This asks the REAL function whether the stored
  // values still agree, rather than a SQL lookalike that would be a second
  // derivation of the rule. TypeScript for that reason, and read-only: the
  // repair path writes a status event and is run by a human.
  'check-billing-drift.ts',
]

/**
 * The deploy reads it to PASS IT ON, and queries nothing itself.
 *
 * It was added on 2026-08-16 because it was the one command whose decision
 * the variable existed to inform and the only one that could not see it: the
 * `check:` scripts run under `node -r dotenv/config` and `deploy:prod` does
 * not, so a deploy accepted a human-written marker while a live answer sat in
 * `.env`. It parses the single key rather than loading dotenv, because
 * loading it would put the dev connection strings into the process the
 * integration gate is spawned from.
 */
const DEPLOY_READERS = ['deploy.mjs']

const WALKTHROUGH_READERS = [
  'verify-factoring.mjs',
  'verify-money-roles.mjs',
  'verify-payments.mjs',
  'verify-settlements.mjs',
  'verify-users.mjs',
]

/**
 * Run by a human, deliberately, and permitted to SELECT and nothing else.
 *
 * A category between the two that existed. The `check:` scripts are unattended
 * and read-only; the walkthroughs are human-run and write fixtures by design.
 * An INSPECTION is human-run like a walkthrough and read-only like a check —
 * somebody asking production a question whose answer governs a decision.
 *
 * Held to the STRICTER rule below, because the whole value of an inspection is
 * that reading it cannot change the thing being read. A question that edits its
 * subject is not a question.
 */
const INSPECTION_READERS = [
  'inspect-relay-customer.mjs',
  // Counts loads that are finished, billable and attached to nobody, before
  // `isReady` learns to check assignment. SELECT only.
  'inspect-unassigned-pod.mjs',
  // Why the topbar's authority filter renders three of five: inactive rows or
  // a scoped membership are different findings and only one is a defect.
  'inspect-authorities.mjs',
  // ADDED 2026-09-07, read-only. The Datatruck seed left production with two
  // trucks numbered 1024 — the real one and a hand-made row carrying `WW2020`
  // where a VIN belongs. Whether that row is deleted or corrected depends on
  // what points at it, and the honest order is to ask before touching it, not
  // after. Enumerates every referencing table by hand, the way `companies.ts`
  // counts what a cascade would destroy.
  'inspect-asset-refs.mjs',
]

/**
 * Run by a human, deliberately, and permitted to write.
 *
 * A one-off repair of rows the application cannot reach on its own. It is NOT
 * held to the read-only rule — writing is the point — so the safety lives in
 * the script instead: it is dry-run unless told otherwise, it names every row
 * it would touch and why, and running it twice changes nothing the second time.
 *
 * A script in this list is a claim that somebody read its dry-run output before
 * it ever wrote anything.
 */
const MAINTENANCE_READERS = [
  'backfill-direct-pod.mjs',
  // Written 2026-09-06 and NOT RUN. `billingStatusFor` is a rule over a cached
  // column, so changing it drifts every untouched row; this repairs them
  // through `refreshBillingStatus`, which writes the status event. Listed here
  // rather than among the read-only scripts because --apply writes, and being
  // on this list is the claim that a human read its dry run first.
  'repair-billing-drift.ts',
]

/**
 * ── THE FIRST SCRIPTS ON THIS FENCE THAT WRITE ────────────────────────────
 *
 * Everything above either only SELECTs, passes the URL on, or is a walkthrough
 * a human drives. These two INSERT — the Datatruck migration seeds, ~100 rows
 * of real fleet including 54 money-bearing pay rules — and that difference is
 * why they are listed apart rather than folded in beside the readers.
 *
 * WHAT STANDS IN FOR ROW-LEVEL SECURITY. They connect as the database owner,
 * because they write for an organization they are not a member of, and the
 * owner carries BYPASSRLS. The mechanism that makes a wrong-tenant write
 * impossible everywhere else in this system is absent here, so its replacement
 * is explicit and lives in `scripts/datatruck-tenancy.ts`:
 *
 *   * `--production` is required; the default target is dev
 *   * the organization is resolved, NAMED, and its id checked against one
 *     stated by the owner — a slug resolves on either database and proves
 *     nothing about which was reached
 *   * pre-existing counts are printed, so "46 created" against a table that
 *     already held 46 is a distinguishable event
 *   * preview is the default and `--write` is a second, separate decision
 *
 * Being on this list is the claim that somebody read the preview — the same
 * claim MAINTENANCE_READERS makes, one step further, because these create
 * rows rather than repairing them.
 */
const SEED_WRITERS = ['seed-datatruck-trucks.ts', 'seed-datatruck-drivers.ts']

const ALLOWED = [
  ...CHECK_READERS,
  ...DEPLOY_READERS,
  ...INSPECTION_READERS,
  ...MAINTENANCE_READERS,
  ...SEED_WRITERS,
  ...WALKTHROUGH_READERS,
]

/** Every script, since scripts are where a production URL would be used. */
function sources(): { name: string; text: string }[] {
  const dir = join(process.cwd(), 'scripts')
  return (
    readdirSync(dir)
      // EVERY SCRIPT, NOT EVERY .mjs SCRIPT. This filtered on '.mjs' alone
      // until 2026-09-06, so a TypeScript script in this directory could read
      // the production URL and the fence would never have seen it. Nobody had
      // written one — the gap was found while writing the first, which is the
      // only reason it was found at all.
      .filter((name) => /\.(mjs|ts|mts|cts|js)$/.test(name))
      .map((name) => ({ name, text: readFileSync(join(dir, name), 'utf8') }))
  )
}

describe('the production URL has exactly the readers it was given', () => {
  const readers = sources()
    .filter((file) => file.text.includes(VARIABLE))
    // This test names it constantly; it is not a reader of it.
    .map((file) => file.name)

  it('is read by the allowlist and by nothing else', () => {
    expect([...readers].sort()).toEqual([...ALLOWED].sort())
  })

  it('is never assigned into the variables the app connects with', () => {
    for (const file of sources()) {
      expect(
        file.text,
        `${file.name} assigns ${VARIABLE} into a connecting variable`,
      ).not.toMatch(
        new RegExp(
          `(DATABASE_URL|DIRECT_DATABASE_URL)\\s*=\\s*[^\\n]*${VARIABLE}`,
        ),
      )
      expect(file.text).not.toMatch(
        new RegExp(
          `process\\.env\\.(DIRECT_)?DATABASE_URL\\s*=\\s*[^\\n]*${VARIABLE}`,
        ),
      )
    }
  })

  // The stricter half of the rule. A walkthrough writes fixtures by design;
  // a script that runs unattended in `check` must never be able to.
  it('is only ever read by the scripts that run unattended or pass it on', () => {
    for (const name of [
      ...CHECK_READERS,
      ...DEPLOY_READERS,
      ...INSPECTION_READERS,
    ]) {
      const text = readFileSync(join(process.cwd(), 'scripts', name), 'utf8')
      // Anything that mutates. A count and a migration list need none of it.
      expect(
        text,
        `${name} writes through the production connection`,
      ).not.toMatch(/\b(INSERT|UPDATE|DELETE|DROP|ALTER|TRUNCATE|CREATE)\b/i)
    }
  })
})

describe('the unrouted count, which only speaks when it should', () => {
  const script = join(process.cwd(), 'scripts', 'check-unrouted.mjs')

  const run = (env: Record<string, string | undefined>) =>
    execFileSync('node', [script], {
      encoding: 'utf8',
      env: { ...process.env, PROD_DIRECT_DATABASE_URL: undefined, ...env },
    })

  it('says nothing and exits 0 when no production URL is configured', () => {
    // `npm run check` must work on a plane.
    expect(run({}).trim()).toBe('')
  })

  it('says nothing and exits 0 when the database cannot be reached', () => {
    // An unreachable database is not this script's business to fail on.
    expect(
      run({
        PROD_DIRECT_DATABASE_URL:
          'postgresql://nobody:nothing@127.0.0.1:1/nowhere',
      }).trim(),
    ).toBe('')
  })

  it('is wired into check, and check still ends green when it shouts', () => {
    const pkg = JSON.parse(readFileSync('package.json', 'utf8'))
    expect(pkg.scripts.check).toContain('check:unrouted')
    // Informational: the script exits 0 on every path, including the loud one.
    const text = readFileSync(script, 'utf8')
    expect(text).not.toMatch(/process\.exit\([^0]/)
  })

  it('is silent at zero by construction, not by luck', () => {
    const text = readFileSync(script, 'utf8')
    // The printing lives inside a positive-count branch. A line that printed
    // "0 unrouted" every run would teach the eye to skip the week it said 3.
    const printed = text.indexOf('UNROUTED MESSAGE')
    const guard = text.indexOf('if (count > 0)')
    expect(guard).toBeGreaterThan(-1)
    expect(printed).toBeGreaterThan(guard)
  })
})
