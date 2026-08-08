import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { Pool } from '@neondatabase/serverless'

// ---------------------------------------------------------------------------
// THE FIXTURE FORGOT — AS A NAMED FAILURE, IN `npm run check`.
//
// `tests/integration/isolation.test.ts` already asserts that its fixture
// populates every table carrying a tenant, and that assertion is what caught
// five Phase 4 tables with policies but no proof. It caught them TWO PHASES
// LATE, because it only runs inside the integration suite — fifty minutes, not
// part of `check`, and easy to skip in favour of the one test file you are
// working on. Which is exactly what happened: steps 4 and 5 added
// `roadsideInspection`, `inspectionViolation`, `dataQsChallenge`, `claimParty`
// and `claimNote`, and nobody ran the suite until the phase was closed.
//
// So the same question is asked here, cheaply, from three sources that must
// agree:
//
//   SCHEMA    prisma/schema.prisma — every model with an `organizationId`
//   DATABASE  pg_class — the same list structure.test.ts counts policies over
//   FIXTURE   tests/integration/fixtures.ts — every `record('model', …)` call
//
// WHAT THIS CANNOT SEE, stated plainly: it reads the fixture's SOURCE, so a
// `record()` call that exists and never executes counts as covered here. The
// integration suite is what proves rows really landed. The division is
// deliberate — this catches "nobody wrote the line", which is the failure that
// actually happened, in seconds instead of an hour.
// ---------------------------------------------------------------------------

const pool = new Pool({ connectionString: process.env.DIRECT_DATABASE_URL })

afterAll(async () => {
  await pool.end()
})

const schema = readFileSync(
  join(process.cwd(), 'prisma', 'schema.prisma'),
  'utf8',
)

/** `Truck` → `truck`, the way a Prisma delegate and the fixture spell it. */
const delegate = (model: string) => model[0]!.toLowerCase() + model.slice(1)

/**
 * Every model in the schema that carries a tenant.
 *
 * `Organization` is included because it IS the tenant — the same special case
 * the pg_class query makes, and the reason it is written out in both places
 * rather than inferred.
 */
function tenantModelsFromSchema(): string[] {
  const models = [...schema.matchAll(/^model\s+(\w+)\s*\{([\s\S]*?)^\}/gm)]
  return models
    .filter(
      ([, name, body]) =>
        name === 'Organization' || /^\s+organizationId\s+String/m.test(body!),
    )
    .map(([, name]) => delegate(name!))
    .sort()
}

/** Every model the fixture writes a row for. */
function modelsSeededByFixture(): string[] {
  const source = readFileSync(
    join(process.cwd(), 'tests', 'integration', 'fixtures.ts'),
    'utf8',
  )
  // `record('truck', await db.truck.create(…))` — prettier may put the name on
  // its own line, so the newline is optional rather than assumed.
  return [...source.matchAll(/record\(\s*\n?\s*'([A-Za-z]+)'/g)]
    .map((match) => match[1]!)
    .sort()
}

describe('every table that carries a tenant is in the isolation fixture', () => {
  const fromSchema = tenantModelsFromSchema()
  const seeded = new Set(modelsSeededByFixture())

  it('found the models at all', () => {
    // Without this the comparison below passes vacuously the day somebody
    // reformats the schema and the regex stops matching — which would turn the
    // guard into a guard-shaped silence.
    expect(fromSchema.length).toBeGreaterThan(30)
    expect(seeded.size).toBeGreaterThan(30)
  })

  it('names any model the fixture seeds no rows in', () => {
    // THE FAILURE THAT ACTUALLY HAPPENED. Five tables had an org_isolation
    // policy and no proof it did anything, because "A cannot see B" is true of
    // a table with nothing in it. The names are printed because "expected 5 to
    // be 0" would send somebody hunting through twenty files.
    const uncovered = fromSchema.filter((model) => !seeded.has(model))

    expect(
      uncovered,
      uncovered.length === 0
        ? ''
        : `\n\n    Add a row for each of these to tests/integration/fixtures.ts:\n` +
            uncovered.map((model) => `      ${model}`).join('\n') +
            `\n\n    A table with no rows makes "sees nothing from the other\n` +
            `    organization" true for the boring reason.\n`,
    ).toEqual([])
  })

  it('and any name in the fixture that is not a model at all', () => {
    // The other direction: `record('trailor', …)` would record ids under a key
    // nothing ever reads, so the trailer would silently go unproven while the
    // count still looked right.
    const everyModel = new Set(
      [...schema.matchAll(/^model\s+(\w+)\s*\{/gm)].map((match) =>
        delegate(match[1]!),
      ),
    )
    const unknown = [...seeded].filter((model) => !everyModel.has(model))
    expect(unknown, unknown.join(', ')).toEqual([])
  })
})

describe('the schema and the database agree about which tables carry a tenant', () => {
  it('so the fixture check above is asking about the real list', () => {
    // structure.test.ts counts policies over the DATABASE's list; the check
    // above reads the SCHEMA's. If the two ever disagree — a migration that
    // added a column the schema does not have, or the reverse — then one of
    // the two guards is asking about a set of tables that does not exist, and
    // neither would say so on its own.
    return pool
      .query<{ relname: string }>(
        `SELECT c.relname
           FROM pg_class c
           JOIN pg_namespace n ON n.oid = c.relnamespace
          WHERE n.nspname = 'public'
            AND c.relkind = 'r'
            AND (
              c.relname = 'Organization'
              OR EXISTS (
                SELECT 1 FROM pg_attribute a
                 WHERE a.attrelid = c.oid
                   AND a.attname = 'organizationId'
                   AND a.attnum > 0
                   AND NOT a.attisdropped
              )
            )
          ORDER BY c.relname`,
      )
      .then(({ rows }) => {
        const fromDatabase = rows.map((row) => delegate(row.relname)).sort()
        expect(fromDatabase.length).toBeGreaterThan(30)
        expect(tenantModelsFromSchema()).toEqual(fromDatabase)
      })
  })
})
