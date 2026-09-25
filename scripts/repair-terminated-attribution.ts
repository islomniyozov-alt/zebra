import { neonConfig } from '@neondatabase/serverless'
import { createPrismaClient } from '@/lib/db'
import { terminatedYieldsToTruck } from '@/lib/datatruck/loads'
import { assertTenancy } from './datatruck-tenancy'

// ---------------------------------------------------------------------------
// FREIGHT ATTRIBUTED TO SOMEBODY WHO HAD ALREADY LEFT, MOVED TO THE DRIVER OF
// THE TRUCK — WITH THE ORIGINAL NAME RECORDED.
//
//   npx tsx -r dotenv/config scripts/repair-terminated-attribution.ts --production
//   npx tsx -r dotenv/config scripts/repair-terminated-attribution.ts --production --apply
//
// Owner's ruling, 2026-09-25: "an export naming a terminated driver on a truck
// with an active one yields to the truck's driver, recorded."
//
// ── WHAT IT REPAIRS ───────────────────────────────────────────────────────
//
// The 2026-09-13..19 export put six loads on unit 0006 against `CANER GUNAL`
// (Datatruck 470, terminated 2026-06-25) and four on unit 216 against
// `ROSARIO SANTOS RODOLFO` (163, terminated 2026-04-24). Both trucks are linked
// to a different active driver — `GUNAL BENER` (569, 90% rule, and the 9/6..12
// statement for unit 0006 is his) and `Jesus Juan Castro Rentas` (161).
//
// $10,549.89 would have been held under two drivers with no pay rule while the
// two who hauled it got nothing.
//
// ── THE DECISION IS `terminatedYieldsToTruck`, NOT THIS FILE ──────────────
//
// The rule is a pure function in `src/lib/datatruck/loads.ts` with its own
// tests, so the importer and this repair cannot disagree about who a load
// belongs to. Notably it requires the DELIVERY TO FALL AFTER THE TERMINATION:
// freight a departed driver delivered before they left is still theirs, and a
// rule without that clause would reassign their whole history to whoever holds
// the truck now.
//
// ── THE NOTE EVENT, AND WHY ITS STATUSES ARE EQUAL ────────────────────────
//
// A reattribution moves no status, so the event records the status the load is
// AT on both sides and carries the reason in `note`. That is deliberate rather
// than convenient: the alternative is writing it nowhere, and then the load
// names a driver the source system never named with nothing to compare against.
// `source: INTEGRATION` marks it as not a human's doing.
//
// ── THE DRY RUN IS THE REAL PATH, ROLLED BACK ─────────────────────────────
//
// Same shape as the other reviewed writes in this directory.
// ---------------------------------------------------------------------------

neonConfig.webSocketConstructor ??= WebSocket
neonConfig.poolQueryViaFetch = false

const APPLY = process.argv.includes('--apply')
const PRODUCTION = process.argv.includes('--production')

const ORGANIZATION_SLUG = 'zebra'
const PRODUCTION_ORGANIZATION_ID = 'cmsbsc82y0000nsvsa6yffuyh'

/** The note the events carry, so a later reader can grep for the whole batch. */
const REPAIR_NOTE = 'datatruck-import reattribution'

class Rehearsal extends Error {}

function target() {
  const url = PRODUCTION
    ? process.env.PROD_DIRECT_DATABASE_URL
    : process.env.DIRECT_DATABASE_URL
  if (!url) throw new Error('No database url for that target.')
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

const money = (cents: number) => `$${(cents / 100).toFixed(2)}`

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

    const moved: string[] = []
    const kept: string[] = []

    await db
      .$transaction(
        async (tx) => {
          // EVERY LOAD WHOSE NAMED DRIVER HAS A TERMINATION DATE. Narrowed in
          // the query only by that, because the rest of the decision belongs to
          // `terminatedYieldsToTruck` — a second copy of its conditions here
          // would be a second definition of the rule.
          const candidates = await tx.load.findMany({
            where: {
              organizationId: tenancy.organizationId,
              deletedAt: null,
              isCancelled: false,
              driver: { terminationDate: { not: null } },
            },
            select: {
              id: true,
              loadNumber: true,
              linehaulCents: true,
              operationalStatus: true,
              driverId: true,
              driver: {
                select: {
                  id: true,
                  firstName: true,
                  lastName: true,
                  terminationDate: true,
                },
              },
              truck: {
                select: {
                  unitNumber: true,
                  // `drivers` is Truck's reverse side of
                  // `Driver.assignedTruckId` — the pairing lives on the driver
                  // and only there, so this is the only direction the schema
                  // can answer.
                  drivers: {
                    where: { deletedAt: null },
                    select: {
                      id: true,
                      firstName: true,
                      lastName: true,
                      terminationDate: true,
                      status: true,
                      kind: true,
                    },
                  },
                },
              },
              statusEvents: {
                where: { axis: 'OPERATIONAL', toStatus: 'POD_RECEIVED' },
                select: { occurredAt: true },
                orderBy: { occurredAt: 'desc' },
                take: 1,
              },
            },
          })

          console.log(
            `\ncandidates (a terminated driver named): ${candidates.length}`,
          )

          for (const load of candidates) {
            const named = load.driver
              ? {
                  id: load.driver.id,
                  name: `${load.driver.firstName} ${load.driver.lastName}`.trim(),
                  terminationDate: load.driver.terminationDate,
                }
              : null
            const linked = load.truck?.drivers ?? []
            // MORE THAN ONE DRIVER ON THE TRUCK IS NOT A YIELD. Which of them
            // drove it is a guess, and this script does not guess about pay.
            const truckDriver =
              linked.length === 1
                ? {
                    id: linked[0]!.id,
                    name: `${linked[0]!.firstName} ${linked[0]!.lastName}`.trim(),
                    terminationDate: linked[0]!.terminationDate,
                    status: linked[0]!.status,
                    kind: linked[0]!.kind,
                  }
                : null

            const decision = terminatedYieldsToTruck({
              named,
              truckDriver,
              deliveredAt: load.statusEvents[0]?.occurredAt ?? null,
              unitNumber: load.truck?.unitNumber ?? null,
            })

            if (decision.kind === 'keep') {
              kept.push(
                `${load.loadNumber}  ${money(load.linehaulCents)}  ` +
                  `named ${named?.name ?? '(nobody)'}, unit ` +
                  `${load.truck?.unitNumber ?? '(none)'} linked to ` +
                  `${linked.length} driver(s)`,
              )
              continue
            }

            await tx.load.update({
              where: { id: load.id },
              data: { driverId: truckDriver!.id },
            })
            await tx.loadStatusEvent.create({
              data: {
                loadId: load.id,
                organizationId: tenancy.organizationId,
                axis: 'OPERATIONAL',
                // EQUAL ON PURPOSE: nothing moved. The note is the payload.
                fromStatus: load.operationalStatus,
                toStatus: load.operationalStatus,
                outcome: 'APPLIED',
                source: 'INTEGRATION',
                note: `${REPAIR_NOTE}: ${decision.note}`,
              },
            })
            moved.push(
              `${load.loadNumber}  ${money(load.linehaulCents)}  ` +
                `${named!.name} -> ${truckDriver!.name}  unit ${load.truck?.unitNumber ?? '(none)'}`,
            )
          }

          if (!APPLY) throw new Rehearsal('dry run')
        },
        { timeout: 120_000 },
      )
      .catch((error: unknown) => {
        if (error instanceof Rehearsal) return
        throw error
      })

    heading(APPLY ? 'REATTRIBUTED' : 'WOULD REATTRIBUTE — nothing committed')
    for (const line of moved) console.log(`  ${line}`)
    if (moved.length === 0) console.log('  (none)')

    if (kept.length > 0) {
      heading(`LEFT ALONE — ${kept.length}`)
      for (const line of kept) console.log(`  ${line}`)
      console.log(
        '\n  Each of these keeps the name the export gave it, so the preflight' +
          '\n  still reports them rather than the repair hiding them.',
      )
    }

    if (!APPLY) {
      console.log(
        '\nROLLED BACK. The statements above ran and were undone; re-run with --apply.',
      )
    }
  } finally {
    await db.$disconnect()
  }
}

await main()
