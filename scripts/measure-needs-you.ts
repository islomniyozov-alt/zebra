import { neonConfig } from '@neondatabase/serverless'
import { createPrismaClient } from '@/lib/db'
import { runInOrg } from '@/lib/tenancy'
import { unattributed } from '@/lib/audit'
import { readyToInvoiceWhere } from '@/lib/invoices'
import { unassignedFinishedWhere } from '@/lib/load-views'
import { NOT_CLOSED_HISTORY } from '@/lib/billing-status'
import { assertTenancy } from './datatruck-tenancy'

// ---------------------------------------------------------------------------
// THE THREE "NEEDS YOU" COUNTS, MEASURED BEFORE ANYTHING IS CHANGED.
//
//   npx tsx -r dotenv/config scripts/measure-needs-you.ts
//
// READ ONLY. DEV.
//
// ── WHY MEASURE FIRST ────────────────────────────────────────────────────
//
// The brief asks for three counts to be corrected. Two of the three predicates
// ALREADY carry the exclusion, so "correcting" them would be a diff that
// changes nothing and a report that claims it did. AGENTS.md: count the thing
// you are claiming, and build the instrument from the artefact.
//
// So each count is asked twice — as the screen asks it today, and as the brief
// says it should be asked — and the difference is the answer. A difference of
// zero is a real finding and is printed as one.
// ---------------------------------------------------------------------------

neonConfig.webSocketConstructor ??= WebSocket

const url = process.env.DIRECT_DATABASE_URL
if (!url) throw new Error('No DIRECT_DATABASE_URL.')
if (/prod/i.test(url)) throw new Error('That looks like production. Dev only.')

const db = createPrismaClient(url)
const tenancy = await assertTenancy(db, {
  label: 'DEV',
  host: new URL(url).hostname,
  slug: 'zebra',
  expectOrganizationId: null,
})

const pad = (label: string) => label.padEnd(46)
const show = (label: string, n: number) =>
  console.log(`  ${pad(label)} ${String(n).padStart(7)}`)

await runInOrg(
  db,
  tenancy.organizationId,
  async (tx) => {
    console.log('\n── 1. READY TO INVOICE ──────────────────────────────────')
    const ready = await tx.load.count({ where: readyToInvoiceWhere() })
    show('as the screen asks it today', ready)

    // WITHOUT the closed-history clause, to show what it is holding back.
    const { billingStatus: _drop, ...readyNoHistory } = {
      ...readyToInvoiceWhere(),
    }
    show(
      'if closed history were NOT excluded',
      await tx.load.count({ where: readyNoHistory }),
    )

    // The brief's extra clause: the LIVE customer flag rather than the load's
    // frozen copy.
    show(
      'also excluding live customer.settlesDirectly',
      await tx.load.count({
        where: {
          ...readyToInvoiceWhere(),
          customer: { settlesDirectly: false },
        },
      }),
    )

    // THE GAP BETWEEN THE TWO AXES, which is the number that decides whether the
    // brief is describing a real defect or a predicate that is already right.
    show(
      'loads: directSettled=false, customer settles',
      await tx.load.count({
        where: {
          deletedAt: null,
          directSettled: false,
          customer: { settlesDirectly: true },
        },
      }),
    )

    console.log('\n── 2. FINISHED WITH NO DRIVER OR TRUCK ──────────────────')
    const finished = await tx.load.count({ where: unassignedFinishedWhere() })
    show('as the screen asks it today', finished)
    const { billingStatus: _drop2, ...finishedNoHistory } = {
      ...unassignedFinishedWhere(),
    }
    show(
      'if closed history were NOT excluded',
      await tx.load.count({ where: finishedNoHistory }),
    )

    console.log('\n── 3. BOOKED WITH NO TRUCK OR DRIVER ────────────────────')
    const bookedWhere = {
      deletedAt: null,
      isCancelled: false,
      operationalStatus: { in: ['AVAILABLE' as const, 'BOOKED' as const] },
      OR: [{ driverId: null }, { truckId: null }],
    }
    show(
      'as the screen asks it today',
      await tx.load.count({ where: bookedWhere }),
    )
    show(
      'with closed history excluded',
      await tx.load.count({
        where: { ...bookedWhere, ...NOT_CLOSED_HISTORY },
      }),
    )

    console.log('\n── THE ARCHIVE, FOR SCALE ───────────────────────────────')
    show(
      'loads with billingStatus CLOSED_IN_DATATRUCK',
      await tx.load.count({
        where: { billingStatus: 'CLOSED_IN_DATATRUCK' },
      }),
    )
    show(
      'of those, AVAILABLE or BOOKED',
      await tx.load.count({
        where: {
          billingStatus: 'CLOSED_IN_DATATRUCK',
          operationalStatus: { in: ['AVAILABLE', 'BOOKED'] },
        },
      }),
    )
    show(
      'of those, POD_RECEIVED',
      await tx.load.count({
        where: {
          billingStatus: 'CLOSED_IN_DATATRUCK',
          operationalStatus: 'POD_RECEIVED',
        },
      }),
    )
  },
  {
    timeoutMs: 120_000,
    // READ ONLY, so the attribution records why a transaction opened at all
    // rather than what it changed. Nothing in this script writes.
    attribution: unattributed(
      'scripts/measure-needs-you.ts — read-only measurement of the three ' +
        'dashboard counts before the part-1 redesign',
    ),
  },
)

await db.$disconnect()
console.log('')
