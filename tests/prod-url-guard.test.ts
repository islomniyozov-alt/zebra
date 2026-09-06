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
const MAINTENANCE_READERS = ['backfill-direct-pod.mjs']

const ALLOWED = [
  ...CHECK_READERS,
  ...DEPLOY_READERS,
  ...INSPECTION_READERS,
  ...MAINTENANCE_READERS,
  ...WALKTHROUGH_READERS,
]

/** Every script, since scripts are where a production URL would be used. */
function sources(): { name: string; text: string }[] {
  const dir = join(process.cwd(), 'scripts')
  return readdirSync(dir)
    .filter((name) => name.endsWith('.mjs'))
    .map((name) => ({ name, text: readFileSync(join(dir, name), 'utf8') }))
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
