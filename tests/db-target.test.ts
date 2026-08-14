import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { assertSafeDbTarget, checkDbTarget, endpointOf } from './db-target'

// ---------------------------------------------------------------------------
// THE GUARD THAT DID NOT FIRE, NOW WATCHED FAILING.
//
// `tests/setup.ts` refused on `NEON_BRANCH === 'production'` and said nothing
// on the day `deploy:prod` ran against production, because the terminal
// carried a production `DIRECT_DATABASE_URL` while `DATABASE_URL` still came
// from `.env`. The label was never the thing that decided where writes went.
//
// Every case below is the incident or a neighbour of it.
// ---------------------------------------------------------------------------

const DEV_POOLED =
  'postgresql://u:p@ep-little-lake-aydu7faj-pooler.c-5.us-east-2.aws.neon.tech/neondb'
const DEV_DIRECT =
  'postgresql://u:p@ep-little-lake-aydu7faj.c-5.us-east-2.aws.neon.tech/neondb'
const PROD_DIRECT =
  'postgresql://u:p@ep-quiet-forest-9zzzzzzz.c-5.us-east-2.aws.neon.tech/neondb'

describe('folding the pooler door onto its endpoint', () => {
  it('treats the pooled and direct hosts as one endpoint', () => {
    expect(endpointOf(DEV_POOLED)).toBe(endpointOf(DEV_DIRECT))
  })

  it('and does not fold two genuinely different endpoints together', () => {
    expect(endpointOf(DEV_DIRECT)).not.toBe(endpointOf(PROD_DIRECT))
  })

  // `-pooler` is a SUFFIX of the first label, not a substring anywhere.
  it('only strips the suffix, not the word wherever it appears', () => {
    expect(
      endpointOf('postgresql://u:p@ep-pooler-town.c-5.neon.tech/db'),
    ).toContain('ep-pooler-town')
  })
})

describe('the incident, as a unit test', () => {
  // THE EXACT SHAPE: a ritual terminal's `DIRECT_DATABASE_URL` pointing at
  // production while `DATABASE_URL` came from `.env` and pointed at dev. The
  // fixtures wrote to one database and the application read the other — which
  // is why the failures looked like organizations missing their own rows.
  it('REFUSES when the two URLs name different endpoints', () => {
    const outcome = checkDbTarget({
      DATABASE_URL: DEV_POOLED,
      DIRECT_DATABASE_URL: PROD_DIRECT,
      NEON_BRANCH: 'dev',
    })

    expect(outcome.ok).toBe(false)
    if (outcome.ok) return
    expect(outcome.reason).toBe('split_brain')
    // The message names BOTH, because the whole incident was not knowing
    // which database a terminal was pointing at.
    expect(outcome.message).toContain('ep-little-lake-aydu7faj')
    expect(outcome.message).toContain('ep-quiet-forest-9zzzzzzz')
  })

  // AND IT REFUSES WITH THE LABEL SAYING dev, which is the point: the old
  // guard read `NEON_BRANCH` and would have waved this through.
  it('refuses even when NEON_BRANCH is reassuring', () => {
    for (const label of ['dev', undefined, '', 'staging']) {
      const outcome = checkDbTarget({
        DATABASE_URL: DEV_POOLED,
        DIRECT_DATABASE_URL: PROD_DIRECT,
        ...(label === undefined ? {} : { NEON_BRANCH: label }),
      })
      expect(outcome.ok, `label ${String(label)}`).toBe(false)
    }
  })

  // The reverse split is just as fatal and just as invisible.
  it('refuses when it is DATABASE_URL that wandered', () => {
    const outcome = checkDbTarget({
      DATABASE_URL: PROD_DIRECT,
      DIRECT_DATABASE_URL: DEV_DIRECT,
    })
    expect(outcome).toMatchObject({ ok: false, reason: 'split_brain' })
  })
})

describe('what it still allows and still refuses', () => {
  it('allows the ordinary configuration', () => {
    const outcome = checkDbTarget({
      DATABASE_URL: DEV_POOLED,
      DIRECT_DATABASE_URL: DEV_DIRECT,
      NEON_BRANCH: 'dev',
    })
    expect(outcome).toMatchObject({ ok: true })
  })

  // Kept as well, not instead: the label is worthless alone and still worth
  // honouring when somebody has set it honestly.
  it('still refuses an honest production label', () => {
    for (const label of ['production', 'PRODUCTION', ' production ']) {
      expect(
        checkDbTarget({
          DATABASE_URL: DEV_POOLED,
          DIRECT_DATABASE_URL: DEV_DIRECT,
          NEON_BRANCH: label,
        }),
      ).toMatchObject({ ok: false, reason: 'production_label' })
    }
  })

  it('refuses a missing or unparseable target rather than guessing', () => {
    expect(checkDbTarget({ DATABASE_URL: DEV_POOLED })).toMatchObject({
      ok: false,
      reason: 'missing',
    })
    expect(
      checkDbTarget({ DATABASE_URL: 'not-a-url', DIRECT_DATABASE_URL: 'x' }),
    ).toMatchObject({ ok: false, reason: 'unparseable' })
  })

  it('throws for the setup file, naming what to do', () => {
    expect(() =>
      assertSafeDbTarget({
        DATABASE_URL: DEV_POOLED,
        DIRECT_DATABASE_URL: PROD_DIRECT,
      }),
    ).toThrow(/different endpoints/i)
  })
})

describe('the deploy gate refuses to inherit a terminal', () => {
  const deployScript = readFileSync('scripts/deploy.mjs', 'utf8')

  // SCRUBBED, NOT WARNED ABOUT. The three variables that decide where the
  // suite writes are deleted from the child's environment, so `.env` is the
  // only possible source and a terminal's leftovers cannot aim the gate.
  it('deletes the three variables from the child environment', () => {
    expect(deployScript).toMatch(
      /SCRUBBED\s*=\s*\[\s*'DATABASE_URL',\s*'DIRECT_DATABASE_URL',\s*'NEON_BRANCH'/,
    )
    expect(deployScript).toContain('delete child[name]')
    // And the scrubbed environment is what the suite actually gets.
    expect(deployScript).toContain('env: integrationEnv()')
  })

  it('and checks .env itself, since scrubbing says nothing about that', () => {
    expect(deployScript).toContain(
      'Refusing: .env names two different database endpoints.',
    )
    expect(deployScript).toContain(
      'Refusing: .env says NEON_BRANCH=production.',
    )
  })

  // The gate must know before it runs, not after it has written.
  it('decides before the suite starts', () => {
    expect(deployScript.indexOf('integrationEnv()')).toBeLessThan(
      deployScript.indexOf("run(['opennextjs-cloudflare', 'build'])"),
    )
  })
})
