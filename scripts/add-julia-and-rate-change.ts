import { neonConfig } from '@neondatabase/serverless'
import { createPrismaClient } from '@/lib/db'
import { createDriver } from '@/lib/fleet'
import { closePayRule, saveDriverPayRule } from '@/lib/driver-pay'
import { assertTenancy } from './datatruck-tenancy'

// ---------------------------------------------------------------------------
// ONE DRIVER AND ONE RATE CHANGE, BY RULING, ON PRODUCTION.
//
//   npx tsx -r dotenv/config scripts/add-julia-and-rate-change.ts --production
//   npx tsx -r dotenv/config scripts/add-julia-and-rate-change.ts --production --apply
//
// Owner's ruling, 2026-09-24. Four writes:
//
//   1. Driver JULIA ROSE HALL, RAM Haulage, hireDate 2026-09-04.
//   2. Her pay rule: PERCENT_LINEHAUL, 2000 bps, from 2026-09-04.
//   3. JERRY ROBERT MCKANE's open 30% rule closed at 2026-09-03.
//   4. A 20% rule for him from 2026-09-04.
//
// ── THE DRY RUN IS THE REAL PATH, ROLLED BACK ─────────────────────────────
//
// Not a simulation that prints what it would do. It opens a transaction, makes
// every write through the same domain functions `--apply` uses, reads the rows
// back, and then THROWS to roll the transaction back. So a dry run that prints
// clean is evidence the actual statements succeed — including the overlap
// refusal in `saveDriverPayRule`, which a printed plan could not exercise.
//
// A simulated dry run tells you what somebody believed would happen. Every
// instrument rule in AGENTS.md exists because of that gap.
//
// ── WHY THE DOMAIN FUNCTIONS AND NOT RAW WRITES ───────────────────────────
//
// `createDriver` holds the roster gate and the company-scope check;
// `saveDriverPayRule` REFUSES OVERLAPPING RULES, which is the whole hazard in
// a rate change — two rules in force on one day means the pay for that day
// depends on which row is read first, and the driver finds out on Friday. So
// the close comes before the new rule, in that order, and the refusal is left
// in place to catch it if it does not.
//
// ── IDEMPOTENT ────────────────────────────────────────────────────────────
//
// Every step asks whether it has already happened and says so. Running this
// twice writes nothing the second time, because a half-finished money change
// re-run must not double anything.
// ---------------------------------------------------------------------------

neonConfig.webSocketConstructor ??= WebSocket
neonConfig.poolQueryViaFetch = false

const APPLY = process.argv.includes('--apply')
const PRODUCTION = process.argv.includes('--production')

const RAM_HAULAGE = 'RAM Haulage'

/** `JERRY ROBERT` + `MCKANE`, so `JULIA ROSE` + `HALL` — the fleet's own split. */
const JULIA = { firstName: 'JULIA ROSE', lastName: 'HALL' }
const MCKANE = { firstName: 'JERRY ROBERT', lastName: 'MCKANE' }

/**
 * A STRING, NOT A DATE. `createDriver` runs `hireDate` through `dateOnly`,
 * which calls `optionalText` first — so a Date object becomes null and the
 * column is silently left empty. The first rehearsal of this script read back
 * `hired=open` for exactly that reason. It THROWS on a malformed string and
 * shrugs at the wrong type, which is the worse way round.
 */
const HIRE_DATE = '2026-09-04'
const NEW_RATE_FROM = new Date('2026-09-04T00:00:00.000Z')
/**
 * The day the old rate stops.
 *
 * `closePayRule`'s own contract — "close the open rule the day before a new one
 * starts" — and `ruleInForce` treats `effectiveTo` as INCLUSIVE
 * (`effectiveTo >= at`). Midnight is what the driver screen's date input sends,
 * so this matches every other rule in the system rather than inventing a
 * second convention for one row. See the report for the boundary that leaves.
 */
const OLD_RATE_TO = new Date('2026-09-03T00:00:00.000Z')

const PERCENT_BPS = 2000

const ORGANIZATION_SLUG = 'zebra'

/** Stated by the owner who ran the migration ritual, not discovered here. */
const PRODUCTION_ORGANIZATION_ID = 'cmsbsc82y0000nsvsa6yffuyh'

/** Thrown to roll the transaction back on a dry run. Not an error. */
class Rehearsal extends Error {}

function target() {
  const url = PRODUCTION
    ? process.env.PROD_DIRECT_DATABASE_URL
    : process.env.DIRECT_DATABASE_URL
  if (!url) {
    throw new Error(
      PRODUCTION
        ? 'PROD_DIRECT_DATABASE_URL is not set.'
        : 'DIRECT_DATABASE_URL is not set.',
    )
  }
  return {
    url,
    label: PRODUCTION ? 'PRODUCTION' : 'DEV',
    host: new URL(url).hostname,
    expectOrganizationId: PRODUCTION ? PRODUCTION_ORGANIZATION_ID : null,
  }
}

const heading = (text: string) => {
  console.log(`\n${text}`)
  console.log('─'.repeat(Math.max(text.length, 70)))
}

const day = (value: Date | null) =>
  value === null ? 'open' : value.toISOString().slice(0, 10)

const rate = (r: {
  percentBps: number | null
  perMileCents: number | null
  flatCents: number | null
}) =>
  r.percentBps !== null
    ? `${r.percentBps / 100}%`
    : r.perMileCents !== null
      ? `${r.perMileCents}c/mi`
      : r.flatCents !== null
        ? `$${(r.flatCents / 100).toFixed(2)}`
        : '(none)'

async function main(): Promise<void> {
  const where = target()
  const db = createPrismaClient(where.url)
  console.log(`Target: ${where.label}`)
  console.log(
    `Mode:   ${APPLY ? 'APPLY — writes commit' : 'dry run — rolls back'}`,
  )

  try {
    const tenancy = await assertTenancy(db, {
      label: where.label,
      host: where.host,
      slug: ORGANIZATION_SLUG,
      expectOrganizationId: where.expectOrganizationId,
    })
    console.log(`Org:    ${tenancy.organizationId}`)

    const company = await db.company.findFirst({
      where: { organizationId: tenancy.organizationId, name: RAM_HAULAGE },
      select: { id: true, name: true },
    })
    if (!company) throw new Error(`No company named ${RAM_HAULAGE}.`)
    console.log(`Company: ${company.name}  ${company.id}`)

    const done: string[] = []
    const skipped: string[] = []

    await db
      .$transaction(
        async (tx) => {
          // ── 1. THE DRIVER ────────────────────────────────────────────────
          const existing = await tx.driver.findFirst({
            where: {
              organizationId: tenancy.organizationId,
              firstName: JULIA.firstName,
              lastName: JULIA.lastName,
              deletedAt: null,
            },
            select: { id: true },
          })

          let juliaId: string
          if (existing) {
            juliaId = existing.id
            skipped.push(
              `driver ${JULIA.firstName} ${JULIA.lastName} already present (${existing.id})`,
            )
          } else {
            const made = await createDriver(tx, tenancy.organizationId, {
              companyId: company.id,
              firstName: JULIA.firstName,
              lastName: JULIA.lastName,
              hireDate: HIRE_DATE,
              status: 'AVAILABLE',
            })
            juliaId = made.id
            done.push(
              `driver ${JULIA.firstName} ${JULIA.lastName} -> ${made.id}`,
            )
          }

          // ── 2. HER RULE ──────────────────────────────────────────────────
          const hasRule = await tx.driverPayRule.findFirst({
            where: {
              driverId: juliaId,
              percentBps: PERCENT_BPS,
              effectiveFrom: NEW_RATE_FROM,
            },
            select: { id: true },
          })
          if (hasRule) {
            skipped.push(`her ${PERCENT_BPS / 100}% rule already present`)
          } else {
            const saved = await saveDriverPayRule(tx, juliaId, {
              type: 'PERCENT_LINEHAUL',
              percentBps: PERCENT_BPS,
              effectiveFrom: NEW_RATE_FROM,
              notes: `Set by ruling 2026-09-24.`,
            })
            if (!saved.ok) {
              throw new Error(`her rule refused: ${saved.reason}`)
            }
            done.push(
              `her rule PERCENT_LINEHAUL ${PERCENT_BPS} bps from ${day(NEW_RATE_FROM)} -> ${saved.ruleId}`,
            )
          }

          // ── 3 AND 4. THE RATE CHANGE, CLOSE BEFORE OPEN ──────────────────
          const mckane = await tx.driver.findFirst({
            where: {
              organizationId: tenancy.organizationId,
              firstName: MCKANE.firstName,
              lastName: MCKANE.lastName,
              deletedAt: null,
            },
            select: { id: true },
          })
          if (!mckane) {
            throw new Error(
              `No driver ${MCKANE.firstName} ${MCKANE.lastName}: refusing to guess.`,
            )
          }

          const open = await tx.driverPayRule.findMany({
            where: { driverId: mckane.id, effectiveTo: null },
            select: { id: true, percentBps: true, effectiveFrom: true },
          })
          if (open.length > 1) {
            throw new Error(
              `${MCKANE.lastName} holds ${open.length} open rules: refusing to choose.`,
            )
          }
          if (open.length === 1) {
            const closed = await closePayRule(tx, open[0]!.id, OLD_RATE_TO)
            if (!closed.ok) throw new Error('closing the old rule was refused')
            done.push(
              `${MCKANE.lastName} ${(open[0]!.percentBps ?? 0) / 100}% closed at ${day(OLD_RATE_TO)}`,
            )
          } else {
            skipped.push(`${MCKANE.lastName} has no open rule to close`)
          }

          const hasNew = await tx.driverPayRule.findFirst({
            where: {
              driverId: mckane.id,
              percentBps: PERCENT_BPS,
              effectiveFrom: NEW_RATE_FROM,
            },
            select: { id: true },
          })
          if (hasNew) {
            skipped.push(
              `${MCKANE.lastName} ${PERCENT_BPS / 100}% rule already present`,
            )
          } else {
            const saved = await saveDriverPayRule(tx, mckane.id, {
              type: 'PERCENT_LINEHAUL',
              percentBps: PERCENT_BPS,
              effectiveFrom: NEW_RATE_FROM,
              notes: `Rate change by ruling 2026-09-24.`,
            })
            if (!saved.ok) {
              throw new Error(`his new rule refused: ${saved.reason}`)
            }
            done.push(
              `${MCKANE.lastName} rule PERCENT_LINEHAUL ${PERCENT_BPS} bps from ${day(NEW_RATE_FROM)} -> ${saved.ruleId}`,
            )
          }

          // ── READ THE ROWS BACK, INSIDE THE TRANSACTION ───────────────────
          heading('THE ROWS AFTER THE WRITES')
          for (const who of [JULIA, MCKANE]) {
            const d = await tx.driver.findFirst({
              where: {
                organizationId: tenancy.organizationId,
                firstName: who.firstName,
                lastName: who.lastName,
                deletedAt: null,
              },
              select: {
                id: true,
                firstName: true,
                lastName: true,
                status: true,
                hireDate: true,
                companyId: true,
                payRules: {
                  orderBy: { effectiveFrom: 'asc' },
                  select: {
                    type: true,
                    percentBps: true,
                    perMileCents: true,
                    flatCents: true,
                    effectiveFrom: true,
                    effectiveTo: true,
                    notes: true,
                  },
                },
              },
            })
            if (!d) {
              console.log(`  ${who.firstName} ${who.lastName}: NOT FOUND`)
              continue
            }
            console.log(
              `  ${d.firstName} ${d.lastName}  ${d.id}  roster=${d.status}  hired=${day(d.hireDate)}`,
            )
            for (const r of d.payRules) {
              console.log(
                `      ${r.type.padEnd(16)} ${rate(r).padEnd(8)} ${day(r.effectiveFrom)} -> ${day(r.effectiveTo)}${r.notes ? `  "${r.notes}"` : ''}`,
              )
            }
          }

          if (!APPLY) throw new Rehearsal('dry run')
        },
        { timeout: 60_000 },
      )
      .catch((error: unknown) => {
        if (error instanceof Rehearsal) return
        throw error
      })

    heading(APPLY ? 'WRITTEN' : 'WOULD WRITE — nothing committed')
    for (const line of done) console.log(`  ${line}`)
    if (done.length === 0) console.log('  (nothing — already done)')
    if (skipped.length > 0) {
      heading('ALREADY DONE, SKIPPED')
      for (const line of skipped) console.log(`  ${line}`)
    }
    if (!APPLY) {
      console.log(
        '\nROLLED BACK. The statements above ran and were undone; re-run with --apply to keep them.',
      )
    }
  } finally {
    await db.$disconnect()
  }
}

await main()
