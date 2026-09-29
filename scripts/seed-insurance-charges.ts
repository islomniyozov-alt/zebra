import { neonConfig } from '@neondatabase/serverless'
import { createPrismaClient } from '@/lib/db'
import { saveRecurringDeduction } from '@/lib/driver-deductions'
import { openFirstPeriod } from '@/lib/asset-transfer'
import { SETTLEMENT_BATCH_TIMEOUT_MS } from '@/lib/settlement-batch'
import { assertTenancy } from './datatruck-tenancy'

// ---------------------------------------------------------------------------
// TWO INSURANCE CHARGES ON DEV, AND THE DRIVER ONE OF THEM BELONGS TO.
//
//   npx tsx -r dotenv/config scripts/seed-insurance-charges.ts
//   ... --apply
//
// Owner's ruling, 2026-09-29. Dev held NO recurring charges at all — which is
// why every replayed week's deductions came out against Datatruck's real
// figures as $0.00, and why the Charges grid photographs as an empty state.
//
// ── DEV ONLY, BY CONSTRUCTION ─────────────────────────────────────────────
//
// This file does not name the production connection variable, so production is
// not reachable by forgetting a flag. JULIA ROSE HALL EXISTS ON PRODUCTION and
// is being created HERE — this script does not read production to find that
// out, it is told, and the figures come from ST-005477.
//
// ── WHAT IS SEEDED ────────────────────────────────────────────────────────
//
//   JERRY ROBERT MCKANE  RAM Haulage, already on dev.
//     Insurance, MONTHLY_SPLIT_WEEKLY, $1,800/month at $450/week.
//
//     THE FIGURE IS MONEY-DESIGN §5's WORKED EXAMPLE, not a number from
//     MCKANE's own statement, because the owner named the driver and not the
//     amount. §5 takes it off the real statements — "Insurance $1,800/month
//     charged weekly at $450 → MONTHLY_SPLIT_WEEKLY, prints $1800/$450" — so it
//     is the right SHAPE and a stated assumption about the amount. Flagged
//     rather than presented as read off a packet.
//
//   JULIA ROSE HALL      RAM Haulage, created here as she is on production.
//     Hired 2026-09-04. PERCENT_LINEHAUL at 20% from 2026-09-04.
//     Insurance, WEEKLY, $1,250/week, $4,000 target. Both from ST-005477.
//
// ── THE TARGET ON AN INSURANCE RULE DOES NOTHING YET ──────────────────────
//
// `targetCents` is stored and printed, and `deductions.ts` stops only ESCROW at
// a target — it is the one type that carries a running balance. So Julia's
// $4,000 ceiling is recorded and will NOT stop the charge at $4,000; after
// four weeks the engine keeps taking $1,250.
//
// That is a real gap between what the statement means and what the engine does,
// and it is not this script's to close: capping a non-escrow deduction needs a
// balance to count against, which is a decision about the money. Seeded as
// instructed, and said out loud here and in the report.
// ---------------------------------------------------------------------------

neonConfig.webSocketConstructor ??= WebSocket
neonConfig.poolQueryViaFetch = false

const APPLY = process.argv.includes('--apply')
const ORGANIZATION_SLUG = 'zebra'

class Rehearsal extends Error {}

const day = (text: string) => new Date(`${text}T00:00:00.000Z`)

async function main(): Promise<void> {
  const url = process.env.DIRECT_DATABASE_URL
  if (!url) throw new Error('No dev database url.')
  const db = createPrismaClient(url)

  console.log('Target: DEV')
  console.log(
    `Mode:   ${APPLY ? 'APPLY — writes commit' : 'dry run — rolls back'}`,
  )

  try {
    const tenancy = await assertTenancy(db, {
      label: 'DEV',
      host: new URL(url).hostname,
      slug: ORGANIZATION_SLUG,
      expectOrganizationId: null,
    })

    await db
      .$transaction(
        async (tx) => {
          const ram = await tx.company.findFirstOrThrow({
            where: { name: { contains: 'RAM Haulage' }, isActive: true },
            select: { id: true, name: true },
          })

          // ── JERRY ROBERT MCKANE ────────────────────────────────────────
          const mckane = await tx.driver.findFirstOrThrow({
            where: {
              deletedAt: null,
              firstName: 'JERRY ROBERT',
              lastName: 'MCKANE',
            },
            select: { id: true, firstName: true, lastName: true },
          })

          const mckaneCharge = await saveRecurringDeduction(tx, mckane.id, {
            type: 'Insurance',
            description: 'Insurance (GL, AL, Cargo, TI) for {month} {split}',
            amountCents: 45_000,
            cadence: 'MONTHLY_SPLIT_WEEKLY',
            monthlyTotalCents: 180_000,
            effectiveFrom: day('2026-08-01'),
          })
          console.log(
            `\n${mckane.firstName} ${mckane.lastName} — ` +
              (mckaneCharge.ok
                ? `Insurance $450/wk of $1,800/mo: ${mckaneCharge.deductionId}`
                : `REFUSED: ${mckaneCharge.reason}`),
          )

          // ── JULIA ROSE HALL, CREATED AS SHE IS ON PRODUCTION ───────────
          //
          // `upsert` ON NOTHING USEFUL, so this is a find-then-create: the
          // unique key is (organizationId, firstName, lastName) per the schema's
          // own note, and re-running must not make a second Julia.
          let julia = await tx.driver.findFirst({
            where: {
              deletedAt: null,
              firstName: 'JULIA ROSE',
              lastName: 'HALL',
            },
            select: { id: true },
          })

          if (!julia) {
            julia = await tx.driver.create({
              data: {
                organizationId: tenancy.organizationId,
                companyId: ram.id,
                firstName: 'JULIA ROSE',
                lastName: 'HALL',
                hireDate: day('2026-09-04'),
                status: 'AVAILABLE',
              },
              select: { id: true },
            })
            // ── AND HER FIRST ASSET PERIOD ──────────────────────────────
            //
            // A driver's `companyId` is a CACHE of whichever assignment period
            // is open, and `findAuthorityDrift` checks the two agree. Creating
            // the row without one left her with a company and no open period —
            // which `tests/integrity.test.ts` caught on the next gate, by name
            // and by id, exactly as it is built to.
            //
            // `openFirstPeriod` is the one function that opens one. Inserting
            // an `assetAssignment` here instead would be a second place that
            // has to know the shape of a transfer.
            await openFirstPeriod(
              tx,
              tenancy.organizationId,
              ram.id,
              { driverId: julia.id },
              null,
              day('2026-09-04'),
            )
            console.log(`JULIA ROSE HALL created on ${ram.name}: ${julia.id}`)
            console.log('  asset period opened from 2026-09-04')
          } else {
            console.log(`JULIA ROSE HALL already on dev: ${julia.id}`)
          }

          const existingRule = await tx.driverPayRule.findFirst({
            where: { driverId: julia.id, effectiveTo: null },
            select: { id: true },
          })
          if (!existingRule) {
            await tx.driverPayRule.create({
              data: {
                driverId: julia.id,
                organizationId: tenancy.organizationId,
                type: 'PERCENT_LINEHAUL',
                // Integer basis points, never a float: 20% is 2000.
                percentBps: 2_000,
                effectiveFrom: day('2026-09-04'),
              },
            })
            console.log('  pay rule: PERCENT_LINEHAUL 20% from 2026-09-04')
          } else {
            console.log('  pay rule already present')
          }

          const juliaCharge = await saveRecurringDeduction(tx, julia.id, {
            type: 'Insurance',
            description: 'Insurance',
            amountCents: 125_000,
            cadence: 'WEEKLY',
            // STORED AND NOT ENFORCED — see the header. Only Escrow stops.
            targetCents: 400_000,
            effectiveFrom: day('2026-09-04'),
          })
          console.log(
            '  ' +
              (juliaCharge.ok
                ? `Insurance $1,250/wk, $4,000 target: ${juliaCharge.deductionId}`
                : `REFUSED: ${juliaCharge.reason}`),
          )

          if (!APPLY) throw new Rehearsal()
        },
        { timeout: SETTLEMENT_BATCH_TIMEOUT_MS },
      )
      .catch((error: unknown) => {
        if (!(error instanceof Rehearsal)) throw error
      })

    console.log(
      APPLY
        ? '\nAPPLIED.'
        : '\nROLLED BACK. Nothing was written; re-run with --apply.',
    )
  } finally {
    await db.$disconnect()
  }
}

await main()
