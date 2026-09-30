import { neonConfig } from '@neondatabase/serverless'
import { createPrismaClient } from '@/lib/db'
import { runInOrg } from '@/lib/tenancy'
import { unattributed } from '@/lib/audit'
import {
  generateInvoice,
  markInvoiceSent,
  readyToInvoiceWhere,
} from '@/lib/invoices'
import { assertTenancy } from './datatruck-tenancy'

// ---------------------------------------------------------------------------
// A FEW REAL INVOICES ON DEV, SO THE APPLY PATH HAS SOMETHING TO APPLY TO.
//
//   npx tsx -r dotenv/config scripts/seed-werner-invoices.ts
//   npx tsx -r dotenv/config scripts/seed-werner-invoices.ts --apply
//
// DEV ONLY. Owner's ruling, 2026-09-30, part two of the accounting
// finish-week: dev held ONE invoice and it was factored, so nothing on the
// Payments screen had an open item to settle against.
//
// ── THROUGH `generateInvoice`, NOT THROUGH `invoice.create` ──────────────
//
// The point of this data is to exercise the apply path, and an invoice
// assembled by hand would have whatever balance and status I typed rather
// than the ones the engine produces. It allocates from the real counter,
// builds lines from the loads' own rates, and sets the terms — so what lands
// is an invoice the application could have made, which is the only kind
// worth testing against.
//
// THREE, FROM THE OLDEST READY LOADS, one load each. One invoice per load
// rather than one invoice of three loads, because the apply surface is about
// a payer with SEVERAL open items and a single batched invoice would give it
// one.
// ---------------------------------------------------------------------------

neonConfig.webSocketConstructor ??= WebSocket

const APPLY = process.argv.includes('--apply')
const WANTED = 3
const CUSTOMER = 'WERNER ENTERPRISES INC'

class Rehearsal extends Error {}

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

console.log('Target: DEV')
console.log(
  `Mode:   ${APPLY ? 'APPLY — writes commit' : 'dry run — rolls back'}`,
)

try {
  await runInOrg(
    db,
    tenancy.organizationId,
    async (tx) => {
      const customer = await tx.customer.findFirstOrThrow({
        where: { name: CUSTOMER },
        select: { id: true, name: true },
      })

      const ready = await tx.load.findMany({
        where: { ...readyToInvoiceWhere(), customerId: customer.id },
        orderBy: { bookedAt: 'asc' },
        take: WANTED,
        select: { id: true, loadNumber: true, totalRevenueCents: true },
      })
      console.log(`\nCustomer: ${customer.name}`)
      console.log(`Ready loads taken: ${ready.length} of ${WANTED} wanted\n`)
      if (ready.length === 0) throw new Error('No ready loads. Nothing to do.')

      for (const load of ready) {
        const outcome = await generateInvoice(tx, tenancy.organizationId, {
          loadIds: [load.id],
          // THE ENGINE'S OWN LABELS, in English — this is a seed, and the
          // statement PDF is English-only for the same base-14 font reason.
          labels: {
            linehaul: 'Linehaul',
            fuelSurcharge: 'Fuel surcharge',
            accessorial: (type: string) => type,
          },
        })
        if (!outcome.ok) {
          throw new Error(
            `generateInvoice refused for ${load.loadNumber}: ${outcome.reason}`,
          )
        }
        // OUT OF DRAFT FIRST, OR THE SEED PROVES NOTHING.
        // `invoiceCandidates` excludes DRAFT, VOID and WRITTEN_OFF — so
        // three draft invoices would sit on the Invoices grid looking like
        // data while the apply surface stayed empty, which is the shape of a
        // seed that passes and verifies nothing. Recorded through the real
        // function, so the status and the channel are what the application
        // writes.
        const sent = await markInvoiceSent(tx, outcome.invoiceId, {
          channel: 'email',
        })
        if (!sent.ok) {
          throw new Error(
            `markInvoiceSent refused for ${load.loadNumber}: ${sent.reason}`,
          )
        }

        // READ AFTER THE SEND, so the line printed is the state that commits
        // rather than the one that existed halfway through.
        const invoice = await tx.invoice.findUniqueOrThrow({
          where: { id: outcome.invoiceId },
          select: {
            invoiceNumber: true,
            totalCents: true,
            balanceCents: true,
            status: true,
            isFactored: true,
          },
        })
        console.log(
          `  ${load.loadNumber.padEnd(12)} -> ${invoice.invoiceNumber.padEnd(10)} ` +
            `${(invoice.totalCents / 100).toFixed(2).padStart(10)}  ` +
            `balance ${(invoice.balanceCents / 100).toFixed(2)}  ` +
            `${invoice.status}${invoice.isFactored ? '  FACTORED' : ''}`,
        )

        if (invoice.balanceCents <= 0) {
          throw new Error(`${invoice.invoiceNumber} has no balance. Refusing.`)
        }
      }

      if (!APPLY) throw new Rehearsal()
    },
    {
      timeoutMs: 60_000,
      attribution: unattributed(
        'scripts/seed-werner-invoices.ts — owner ruling 2026-09-30, dev data ' +
          'so the payment apply path has open items',
      ),
    },
  )
  console.log('\nCOMMITTED.')
} catch (error) {
  if (!(error instanceof Rehearsal)) throw error
  console.log('\nROLLED BACK — dry run. Re-run with --apply to write.')
}

await db.$disconnect()
