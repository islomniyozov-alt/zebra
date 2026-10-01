import { neonConfig } from '@neondatabase/serverless'
import { createPrismaClient } from '@/lib/db'
import { runInOrg } from '@/lib/tenancy'
import { unattributed } from '@/lib/audit'
import { invoiceCandidates, recordPayment } from '@/lib/payments'
import { assertTenancy } from './datatruck-tenancy'

// ---------------------------------------------------------------------------
// ONE UNAPPLIED PAYMENT FROM WERNER, SO THE INVOICE HALF OF APPLY IS REAL.
//
//   npx tsx -r dotenv/config scripts/seed-werner-payment.ts
//   npx tsx -r dotenv/config scripts/seed-werner-payment.ts --apply
//
// DEV ONLY. Owner's ruling, 2026-09-30. The apply surface verified on the
// worker with two LOAD rows and zero invoice rows, because dev had no
// unapplied payment belonging to a payer with open invoices — so half the
// combined list had never been rendered against real data.
//
// ── IT MUST MATCH WHAT `invoiceCandidates` ASKS FOR, OR IT PROVES NOTHING ─
//
// That reader filters on four things at once: the payment's companyId, its
// customerId, a balance above zero, and `isFactored` EQUAL TO whether the
// method is a factoring one. A payment recorded against the wrong authority,
// or with a factoring method, would sit on the Unapplied tab looking like
// data while the invoice list stayed empty — which is exactly the failure
// the Werner invoice seed already walked into once with DRAFT status.
//
// So the company comes FROM the invoices rather than being chosen, the
// method is a plain ACH, and the run asserts the candidates come back
// non-empty before it commits. A seed that cannot see its own subject is a
// seed that has not worked.
//
// THE AMOUNT DELIBERATELY DOES NOT CLEAR THEM. Two of the three invoices'
// balances, so applying leaves a real remainder — the thing §6.2.5 says must
// stay unapplied rather than being forced onto the oldest item.
// ---------------------------------------------------------------------------

neonConfig.webSocketConstructor ??= WebSocket

const APPLY = process.argv.includes('--apply')
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

      // THE AUTHORITY COMES FROM THE INVOICES. Choosing one and hoping it
      // matches is how the payment lands beside its invoices instead of
      // against them.
      const open = await tx.invoice.findMany({
        where: {
          deletedAt: null,
          customerId: customer.id,
          balanceCents: { gt: 0 },
          isFactored: false,
          status: { notIn: ['DRAFT', 'VOID', 'WRITTEN_OFF'] },
        },
        orderBy: { invoiceNumber: 'asc' },
        select: {
          id: true,
          invoiceNumber: true,
          balanceCents: true,
          companyId: true,
        },
      })
      if (open.length === 0) {
        throw new Error(`No open non-factored invoices for ${CUSTOMER}.`)
      }

      const companyIds = [...new Set(open.map((row) => row.companyId))]
      if (companyIds.length !== 1) {
        throw new Error(
          `Open invoices span ${companyIds.length} authorities; a single ` +
            'payment cannot settle across them. Narrow this by hand.',
        )
      }
      const companyId = companyIds[0]!

      console.log(`\nCustomer: ${customer.name}`)
      for (const invoice of open) {
        console.log(
          `  open  ${invoice.invoiceNumber.padEnd(10)} ` +
            `${(invoice.balanceCents / 100).toFixed(2)}`,
        )
      }

      // TWO OF THE THREE, so a remainder survives the apply.
      const amountCents = open
        .slice(0, 2)
        .reduce((sum, row) => sum + row.balanceCents, 0)

      const recorded = await recordPayment(tx, tenancy.organizationId, {
        companyId,
        customerId: customer.id,
        method: 'ACH',
        referenceNumber: 'DEV-WERNER-APPLY',
        receivedAt: new Date(),
        amountCents,
      })
      if (!recorded.ok) {
        throw new Error(`recordPayment refused: ${recorded.reason}`)
      }

      const payment = await tx.payment.findUniqueOrThrow({
        where: { id: recorded.paymentId },
        select: { amountCents: true, unappliedCents: true, method: true },
      })
      console.log(
        `\n  payment ${(payment.amountCents / 100).toFixed(2)} ${payment.method}  ` +
          `unapplied ${(payment.unappliedCents / 100).toFixed(2)}  ` +
          `id ${recorded.paymentId}`,
      )

      // THE PROOF, THROUGH THE READER THE SCREEN USES. Not a count of
      // invoices that look right — the actual function the apply surface
      // calls, asked whether it can see them.
      const candidates = await invoiceCandidates(
        tx,
        companyId,
        customer.id,
        'ACH',
      )
      console.log(`  invoiceCandidates sees ${candidates.length}:`)
      for (const candidate of candidates) {
        console.log(
          `    ${candidate.invoiceNumber.padEnd(10)} ` +
            `${(candidate.balanceCents / 100).toFixed(2)}`,
        )
      }
      if (candidates.length === 0) {
        throw new Error(
          'The apply surface would show no invoices. Refusing to commit a ' +
            'seed that cannot see its own subject.',
        )
      }
      if (payment.unappliedCents <= 0) {
        throw new Error('The payment is already fully applied. Refusing.')
      }

      if (!APPLY) throw new Rehearsal()
    },
    {
      timeoutMs: 60_000,
      attribution: unattributed(
        'scripts/seed-werner-payment.ts — owner ruling 2026-09-30, dev data ' +
          'so the invoice half of the apply surface can be verified',
      ),
    },
  )
  console.log('\nCOMMITTED.')
} catch (error) {
  if (!(error instanceof Rehearsal)) throw error
  console.log('\nROLLED BACK — dry run. Re-run with --apply to write.')
}

await db.$disconnect()
