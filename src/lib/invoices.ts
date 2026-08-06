import type { Prisma } from '@/generated/prisma/client'
import type { TxClient } from './tenancy'
import { refreshBillingStatus } from './billing-status'
import { allocateNumber } from './counters'
import { loadRevenueCents } from './money'

// ---------------------------------------------------------------------------
// INVOICE GENERATION (Phase 3 §5 step 2).
//
// READY TO INVOICE is a DERIVATION, not a flag somebody sets:
//
//   POD received  ∧  total revenue > 0  ∧  not direct-settled  ∧  not yet invoiced
//
// Each clause earns its place. Without the POD there is nothing to attach and
// most brokers will not pay. Without a rate the invoice is for nothing. A
// direct-settled load — Amazon Relay, paid by weekly ACH statement — has no
// invoice in its life at all, and putting one in a queue that says "ready"
// would have somebody send it. And a load already on an invoice must not turn
// up on a second one, which is the failure that gets a carrier accused of
// double-billing.
//
// THE SNAPSHOT. Lines are copies, not references. `InvoiceLine.amountCents` is
// what the load was worth on the day it was invoiced; changing the load's rate
// afterwards does not silently reprice an invoice a broker already has. §3.4.
//
// THE NUMBER IS ALLOCATED AS LATE AS IT CAN BE. Everything is read and
// computed first, and the counter row is touched immediately before the insert
// that needs it. `Invoice.invoiceNumber` is non-null and uniquely indexed per
// company, so nothing can precede it — the same constraint as `Load`, and the
// reason the ≤2-statement form of §7's criterion was restated rather than met.
// ---------------------------------------------------------------------------

/** Every clause of the derivation, as a Prisma filter. */
export function readyToInvoiceWhere(): Prisma.LoadWhereInput {
  return {
    deletedAt: null,
    isCancelled: false,
    operationalStatus: 'POD_RECEIVED',
    totalRevenueCents: { gt: 0 },
    directSettled: false,
    // Not already on an invoice. `invoiceLines` is the relation InvoiceLine
    // holds to Load, so "none" is the honest test — billingStatus is a cache
    // of it and caches drift.
    invoiceLines: { none: {} },
  }
}

export interface ReadyLoad {
  id: string
  loadNumber: string
  customerId: string
  customerName: string
  companyId: string
  linehaulCents: number
  fuelSurchargeCents: number
  accessorialsCents: number
  totalRevenueCents: number
}

export async function readyToInvoice(
  tx: TxClient,
  where: Prisma.LoadWhereInput = {},
): Promise<ReadyLoad[]> {
  const loads = await tx.load.findMany({
    where: { ...readyToInvoiceWhere(), ...where },
    orderBy: [{ customer: { name: 'asc' } }, { loadNumber: 'asc' }],
    take: 500,
    select: {
      id: true,
      loadNumber: true,
      companyId: true,
      customerId: true,
      customer: { select: { name: true } },
      linehaulCents: true,
      fuelSurchargeCents: true,
      accessorialsCents: true,
      totalRevenueCents: true,
    },
  })

  return loads.map((load) => ({
    id: load.id,
    loadNumber: load.loadNumber,
    companyId: load.companyId,
    customerId: load.customerId,
    customerName: load.customer.name,
    linehaulCents: load.linehaulCents,
    fuelSurchargeCents: load.fuelSurchargeCents,
    accessorialsCents: load.accessorialsCents,
    totalRevenueCents: load.totalRevenueCents,
  }))
}

export type GenerateFailure =
  | 'no_loads'
  | 'not_ready'
  | 'mixed_customers'
  | 'mixed_companies'

export type GenerateOutcome =
  | { ok: true; invoiceId: string; invoiceNumber: string; totalCents: number }
  | { ok: false; reason: GenerateFailure; loadNumbers?: string[] }

export interface DraftLine {
  loadId: string
  description: string
  quantity: string
  unitCents: number
  amountCents: number
  sortOrder: number
}

/**
 * The lines one load contributes, in the order a broker reads them.
 *
 * Linehaul and fuel surcharge are separate lines because brokers audit them
 * separately — a fuel surcharge folded into linehaul is the first thing a
 * claims department queries. Accessorials follow, each named.
 */
export function linesForLoad(
  load: {
    id: string
    loadNumber: string
    linehaulCents: number
    fuelSurchargeCents: number
  },
  accessorials: readonly {
    type: string
    amountCents: number
    isBillable: boolean
    status: string
  }[],
  labels: {
    linehaul: string
    fuelSurcharge: string
    accessorial: (type: string) => string
  },
  startingSort = 0,
): DraftLine[] {
  const lines: DraftLine[] = []
  let sortOrder = startingSort

  if (load.linehaulCents !== 0) {
    lines.push({
      loadId: load.id,
      description: `${labels.linehaul} — ${load.loadNumber}`,
      quantity: '1',
      unitCents: load.linehaulCents,
      amountCents: load.linehaulCents,
      sortOrder: sortOrder++,
    })
  }

  if (load.fuelSurchargeCents !== 0) {
    lines.push({
      loadId: load.id,
      description: `${labels.fuelSurcharge} — ${load.loadNumber}`,
      quantity: '1',
      unitCents: load.fuelSurchargeCents,
      amountCents: load.fuelSurchargeCents,
      sortOrder: sortOrder++,
    })
  }

  for (const accessorial of accessorials) {
    // A denied accessorial is not billed, and a non-billable one is a cost the
    // carrier ate — neither belongs on a broker's invoice.
    if (!accessorial.isBillable || accessorial.status === 'DENIED') continue
    lines.push({
      loadId: load.id,
      description: `${labels.accessorial(accessorial.type)} — ${load.loadNumber}`,
      quantity: '1',
      unitCents: accessorial.amountCents,
      amountCents: accessorial.amountCents,
      sortOrder: sortOrder++,
    })
  }

  return lines
}

export interface GenerateInput {
  loadIds: readonly string[]
  labels: {
    linehaul: string
    fuelSurcharge: string
    accessorial: (type: string) => string
  }
  termsDays?: number
  issueDate?: Date
}

/**
 * One invoice from one or many loads.
 *
 * Many, because brokers batch-pay and a broker who receives six invoices for
 * six loads in a week will pay them as one and reconcile none of them.
 */
export async function generateInvoice(
  tx: TxClient,
  organizationId: string,
  input: GenerateInput,
): Promise<GenerateOutcome> {
  if (input.loadIds.length === 0) return { ok: false, reason: 'no_loads' }

  // READ AND COMPUTE FIRST. Nothing below touches the counter until every
  // reason to refuse has been checked.
  const loads = await tx.load.findMany({
    where: { id: { in: [...input.loadIds] }, ...readyToInvoiceWhere() },
    select: {
      id: true,
      loadNumber: true,
      companyId: true,
      customerId: true,
      linehaulCents: true,
      fuelSurchargeCents: true,
      accessorialsCents: true,
      totalRevenueCents: true,
      accessorials: {
        orderBy: { createdAt: 'asc' },
        select: {
          type: true,
          amountCents: true,
          isBillable: true,
          status: true,
        },
      },
    },
  })

  // Anything that did not come back failed a clause of the derivation. Naming
  // the load numbers rather than saying "not ready" — §10's rule about errors
  // that say what actually happened.
  if (loads.length !== input.loadIds.length) {
    const found = new Set(loads.map((load) => load.id))
    const missing = input.loadIds.filter((id) => !found.has(id))
    const numbers = await tx.load.findMany({
      where: { id: { in: missing } },
      select: { loadNumber: true },
    })
    return {
      ok: false,
      reason: 'not_ready',
      loadNumbers: numbers.map((load) => load.loadNumber),
    }
  }

  const customers = new Set(loads.map((load) => load.customerId))
  if (customers.size > 1) return { ok: false, reason: 'mixed_customers' }
  const companies = new Set(loads.map((load) => load.companyId))
  if (companies.size > 1) return { ok: false, reason: 'mixed_companies' }

  const companyId = loads[0]!.companyId
  const customerId = loads[0]!.customerId

  const lines: DraftLine[] = []
  for (const load of loads) {
    lines.push(
      ...linesForLoad(load, load.accessorials, input.labels, lines.length),
    )
  }

  // The totals are the lines added, and the lines are the loads' own stored
  // integers — so a reader can check the invoice against the loads (rule
  // 9-money). `subtotal` is linehaul + fuel; `accessorials` is the rest.
  const subtotalCents = loads.reduce(
    (total, load) => total + load.linehaulCents + load.fuelSurchargeCents,
    0,
  )
  const accessorialsCents =
    lines.reduce((total, line) => total + line.amountCents, 0) - subtotalCents
  const totalCents = subtotalCents + accessorialsCents

  const settings = await tx.companySettings.findFirst({
    where: { companyId },
    select: { invoiceTermsDays: true, invoiceNumberPrefix: true },
  })
  const termsDays = input.termsDays ?? settings?.invoiceTermsDays ?? 30
  const issueDate = input.issueDate ?? new Date()
  const dueDate = new Date(issueDate)
  dueDate.setUTCDate(dueDate.getUTCDate() + termsDays)

  // --- from here to commit, the counter row is held --------------------
  const number = await allocateNumber(tx, companyId, 'INVOICE_NUMBER')
  const invoiceNumber = `${settings?.invoiceNumberPrefix ?? 'INV-'}${number}`

  const invoice = await tx.invoice.create({
    data: {
      organizationId,
      companyId,
      invoiceNumber,
      customerId,
      status: 'DRAFT',
      issueDate,
      dueDate,
      termsDays,
      subtotalCents,
      accessorialsCents,
      totalCents,
      balanceCents: totalCents,
      lines: {
        create: lines.map((line) => ({
          organizationId,
          loadId: line.loadId,
          description: line.description,
          quantity: line.quantity,
          unitCents: line.unitCents,
          amountCents: line.amountCents,
          sortOrder: line.sortOrder,
        })),
      },
    },
    select: { id: true, invoiceNumber: true },
  })

  // Recomputed, not assigned. `INVOICED` was hard-coded here until step 5 gave
  // the billing axis a single owner; the value is the same on this path and
  // the point is that it can no longer differ from what the drift check
  // computes. See billing-status.ts.
  await refreshBillingStatus(
    tx,
    loads.map((load) => load.id),
  )

  return {
    ok: true,
    invoiceId: invoice.id,
    invoiceNumber: invoice.invoiceNumber,
    totalCents,
  }
}

/** The invoice total, from the loads it covers. For a reader checking by hand. */
export function invoiceTotalFromLoads(
  loads: readonly {
    linehaulCents: number
    fuelSurchargeCents: number
    accessorialsCents: number
  }[],
): number {
  return loads.reduce((total, load) => total + loadRevenueCents(load), 0)
}

export type MarkSentFailure = 'not_found' | 'already_sent' | 'no_channel'

export type MarkSentOutcome =
  | { ok: true; sentAt: Date }
  | { ok: false; reason: MarkSentFailure }

/**
 * Record that an invoice went out, and by what route.
 *
 * NOT a send. §6: the only working sender reaches the owner's inbox alone
 * until a sending domain is verified, so the honest flow is download → send it
 * yourself → tell the system you did. A button that claims to email a broker
 * and silently reaches nobody would be worse than no button, and this is the
 * shape that stays correct when the domain lands: a real send would set the
 * same fields.
 *
 * The channel is recorded because "did we send it?" and "where did it go?" are
 * different questions in a payment chase, and the second one is the one that
 * gets answered wrong from memory a month later.
 */
export async function markInvoiceSent(
  tx: TxClient,
  invoiceId: string,
  input: { channel: string; sentToEmail?: string | null; sentAt?: Date },
): Promise<MarkSentOutcome> {
  const channel = input.channel.trim()
  if (channel === '') return { ok: false, reason: 'no_channel' }

  const invoice = await tx.invoice.findUnique({
    where: { id: invoiceId },
    select: { id: true, sentAt: true, status: true },
  })
  if (!invoice) return { ok: false, reason: 'not_found' }
  if (invoice.sentAt !== null) return { ok: false, reason: 'already_sent' }

  const sentAt = input.sentAt ?? new Date()
  await tx.invoice.update({
    where: { id: invoiceId },
    data: {
      sentAt,
      // The channel rides in the notes field until Step 5 gives billing its
      // own event stream. Named here so the next reader knows it is deliberate
      // and where it is going, rather than finding a channel in `notes` and
      // wondering.
      notes: `sent: ${channel}${input.sentToEmail ? ` (${input.sentToEmail})` : ''}`,
      sentToEmail: input.sentToEmail ?? null,
      status: 'SENT',
    },
  })

  return { ok: true, sentAt }
}

/**
 * Direct-settled loads with no statement payment against them yet.
 *
 * They are NOT invoiceable and NOT in broker AR — but they are money owed, and
 * a screen that simply omits them teaches everybody that Zebra does not know
 * about Relay freight. Step 5 gives them a payment path; this makes them
 * visible in the meantime.
 */
export async function directSettledAwaiting(
  tx: TxClient,
  where: Prisma.LoadWhereInput = {},
): Promise<ReadyLoad[]> {
  const loads = await tx.load.findMany({
    where: {
      deletedAt: null,
      isCancelled: false,
      directSettled: true,
      operationalStatus: 'POD_RECEIVED',
      totalRevenueCents: { gt: 0 },
      ...where,
    },
    orderBy: [{ customer: { name: 'asc' } }, { loadNumber: 'asc' }],
    take: 500,
    select: {
      id: true,
      loadNumber: true,
      companyId: true,
      customerId: true,
      customer: { select: { name: true } },
      linehaulCents: true,
      fuelSurchargeCents: true,
      accessorialsCents: true,
      totalRevenueCents: true,
    },
  })

  return loads.map((load) => ({
    id: load.id,
    loadNumber: load.loadNumber,
    companyId: load.companyId,
    customerId: load.customerId,
    customerName: load.customer.name,
    linehaulCents: load.linehaulCents,
    fuelSurchargeCents: load.fuelSurchargeCents,
    accessorialsCents: load.accessorialsCents,
    totalRevenueCents: load.totalRevenueCents,
  }))
}
