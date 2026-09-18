import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { load } from 'js-yaml'
import { describe, expect, it } from 'vitest'

// ---------------------------------------------------------------------------
// WHERE THE PRODUCTION CREDENTIAL MAY GO, WRITTEN DOWN SO IT CANNOT DRIFT.
//
// ── THE RULING THIS ENCODES ──────────────────────────────────────────────
//
// `PROD_DIRECT_DATABASE_URL` is "read only by allowlisted scripts, never
// assigned into DATABASE_URL/DIRECT_DATABASE_URL, check-time readers may only
// SELECT". Two of those three are properties of a YAML file, so they are
// checked here rather than remembered.
//
// ── WHY THE ALLOWLIST IS A LIST AND NOT A RULE ───────────────────────────
//
// A pattern like "any step whose name mentions production" would grow to fit
// whatever gets added next, which is the opposite of an allowlist. Naming the
// three steps means a fourth one FAILS THIS TEST until somebody writes it
// down — the point being that widening the blast radius of a production
// credential should cost a deliberate edit and a line in a diff.
//
// ── AND WHY THE BILLING STEP IS NAMED HERE ───────────────────────────────
//
// Run 35310541290 deployed production having printed `billing drift  no
// PROD_DIRECT_DATABASE_URL — not checked` inside the gate. The check existed,
// ran, and proved nothing, because the credential is scoped to the steps that
// need it and the gate is not one of them. The step that fixes that is listed
// below, so it cannot quietly disappear the way its coverage quietly did.
// ---------------------------------------------------------------------------

/** The secret that carries it, and the only spelling any workflow may use. */
const SECRET = 'secrets.PROD_DIRECT_DATABASE_URL_RO'

/** Steps allowed to hold the production credential. Add deliberately. */
const ALLOWED = [
  'production schema is not behind',
  'production billing statuses agree with the rule',
  'deploy production',
]

interface Step {
  name?: string
  env?: Record<string, string>
  run?: unknown
}

function steps(): { file: string; step: Step }[] {
  const dir = '.github/workflows'
  const found: { file: string; step: Step }[] = []
  for (const file of readdirSync(dir)) {
    if (!/\.ya?ml$/.test(file)) continue
    const parsed = load(readFileSync(join(dir, file), 'utf8')) as {
      jobs?: Record<string, { steps?: Step[] }>
    }
    for (const job of Object.values(parsed.jobs ?? {}))
      for (const step of job.steps ?? []) found.push({ file, step })
  }
  return found
}

describe('the production database credential in CI', () => {
  const all = steps()

  it('is read from a file that actually has steps in it', () => {
    // FLAG 88 again: a reader that finds nothing proves nothing.
    expect(all.length).toBeGreaterThan(20)
  })

  it('reaches only the steps on the allowlist', () => {
    const carriers = all
      .filter(({ step }) =>
        Object.keys(step.env ?? {}).includes('PROD_DIRECT_DATABASE_URL'),
      )
      .map(({ step }) => step.name ?? '(unnamed)')

    expect(
      [...carriers].sort(),
      'a step not on the allowlist carries the production credential',
    ).toEqual([...ALLOWED].sort())
  })

  it('includes the billing check that run 35310541290 shipped without', () => {
    const billing = all.find(
      ({ step }) =>
        step.name === 'production billing statuses agree with the rule',
    )
    expect(billing, 'the billing drift step is gone').toBeDefined()
    expect(billing!.file).toBe('deploy-production.yml')
    expect(billing!.step.env?.PROD_DIRECT_DATABASE_URL).toContain(SECRET)
  })

  // ── NEVER INTO THE VARIABLES THE APPLICATION AND THE SUITE READ ─────
  //
  // This is the incident `tests/db-target.ts` was written after: a ritual
  // terminal where DIRECT_DATABASE_URL pointed at production while
  // DATABASE_URL still pointed at dev, and the fixtures wrote to one database
  // while the app read the other. In a workflow it would be one careless line.
  it('is never assigned into DATABASE_URL or DIRECT_DATABASE_URL', () => {
    const offenders: string[] = []
    for (const { file, step } of all) {
      for (const [key, value] of Object.entries(step.env ?? {})) {
        if (key !== 'DATABASE_URL' && key !== 'DIRECT_DATABASE_URL') continue
        if (/PROD_DIRECT_DATABASE_URL|PROD_DATABASE_URL/.test(String(value)))
          offenders.push(`${file} / ${step.name ?? '(unnamed)'} / ${key}`)
      }
    }
    expect(offenders).toEqual([])
  })

  it('never reaches the .env the suite reads, by any spelling', () => {
    // The `.env` writer is the one place a variable becomes ambient for every
    // command after it, which is precisely the shape of the original incident.
    const writers = all.filter(({ step }) =>
      typeof step.run === 'string' ? /> \.env/.test(step.run) : false,
    )
    expect(writers.length).toBeGreaterThan(0)
    for (const { file, step } of writers) {
      expect(
        String(step.run),
        `${file} writes a production URL into .env`,
      ).not.toMatch(/PROD_DIRECT_DATABASE_URL|PROD_DATABASE_URL/)
    }
  })

  it('always comes from the read-only secret, never the full one', () => {
    for (const { file, step } of all) {
      const value = step.env?.PROD_DIRECT_DATABASE_URL
      if (!value) continue
      expect(
        value,
        `${file} / ${step.name} uses a production secret that is not the read-only one`,
      ).toContain(SECRET)
    }
  })
})
