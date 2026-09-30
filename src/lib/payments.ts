import type { Prisma, PaymentMethod } from '@/generated/prisma/client'
import type { TxClient } from './tenancy'
import { refreshBillingStatus } from './billing-status'

// ---------------------------------------------------------------------------
// PAYMENTS (Phase 3 §5 step 5).
//
// Money arrives as a LUMP. A broker's check pays four invoices; Amazon's weekly
// ACH covers eleven loads with no invoice anywhere in it; a factor sends an
// advance today and the reserve six weeks later. So a payment is recorded ONCE,
// as the amount that actually landed in the bank, and applied afterwards.
//
// UNAPPLIED MONEY IS A REAL STATE, not an error and not a temporary condition
// to be cleared before the screen will let you leave. A $10,000 ACH with no
// remittance advice sits unapplied until somebody works out what it paid, and
// that is the honest representation of what the carrier knows. Recording it as
// applied-to-something-plausible is how a receivable ledger stops meaning
// anything.
//
// TWO APPLICATION PATHS, because there are two kinds of debt (§2):
//
//   PAYMENT -> INVOICE   a broker pays a document we sent them
//   PAYMENT -> LOADS     a shipper settles freight directly, by statement
//
// The second exists because Amazon Relay pays RAM weekly by ACH against many
// loads and never sees an invoice. Those loads carry `directSettled`, copied
// at booking, and they never enter the invoice path at all.
//
// THE REMAINDER IS NEVER FORCED. If the statement paid $9,840 and the loads it
// names are worth $9,900, the $60 stays visible as an unpaid balance on the
// loads. If it paid $60 too much, the $60 stays as unapplied money on the
// payment. Zebra does not invent a line to make the two agree — a statement
// that disagrees with the freight is a question for Amazon, and balancing it
// silently destroys the only evidence that the question exists.
// ---------------------------------------------------------------------------

/** Methods that settle a FACTORED invoice. Anything else on one is a mistake. */
export const FACTORING_METHODS: readonly PaymentMethod[] = [
  'FACTORING_ADVANCE',
  'FACTORING_RESERVE',
]

// --- recording --------------------------------------------------------------

export interface RecordPaymentInput {
  companyId: string
  customerId?: string | null
  method: PaymentMethod
  referenceNumber?: string | null
  receivedAt: Date
  amountCents: number
  notes?: string | null
  recordedByUserId?: string | null
}

export type RecordFailure =
  | 'no_company'
  | 'bad_amount'
  | 'no_date'
  | 'customer_not_found'

export type RecordPaymentResult =
  | { ok: true; paymentId: string }
  | { ok: false; reason: RecordFailure }

export async function recordPayment(
  tx: TxClient,
  organizationId: string,
  input: RecordPaymentInput,
): Promise<RecordPaymentResult> {
  if (!input.companyId) return { ok: false, reason: 'no_company' }
  if (!Number.isInteger(input.amountCents) || input.amountCents <= 0) {
    // A zero payment is a typo and a negative one is a refund — which is a
    // different transaction with a different meaning, and it will get its own
    // path rather than riding in as a payment with a minus sign.
    return { ok: false, reason: 'bad_amount' }
  }
  if (Number.isNaN(input.receivedAt.getTime())) {
    return { ok: false, reason: 'no_date' }
  }

  const company = await tx.company.findFirst({
    where: { id: input.companyId },
    select: { id: true },
  })
  if (!company) return { ok: false, reason: 'no_company' }

  if (input.customerId) {
    const customer = await tx.customer.findFirst({
      where: { id: input.customerId, deletedAt: null },
      select: { id: true },
    })
    if (!customer) return { ok: false, reason: 'customer_not_found' }
  }

  const payment = await tx.payment.create({
    data: {
      organizationId,
      companyId: company.id,
      customerId: input.customerId || null,
      method: input.method,
      referenceNumber: input.referenceNumber?.trim() || null,
      receivedAt: input.receivedAt,
      amountCents: input.amountCents,
      // Everything is unapplied until somebody says what it paid. This is the
      // starting state, not a placeholder.
      unappliedCents: input.amountCents,
      notes: input.notes?.trim() || null,
      recordedByUserId: input.recordedByUserId || null,
    },
    select: { id: true },
  })

  return { ok: true, paymentId: payment.id }
}

// --- the arithmetic every application shares --------------------------------

/**
 * Recompute a payment's unapplied amount from its applications.
 *
 * Derived on every write rather than adjusted incrementally: an increment is
 * correct until one path forgets it, and then the number is wrong with no way
 * to tell when it happened.
 */
async function refreshUnapplied(
  tx: TxClient,
  paymentId: string,
): Promise<number> {
  const payment = await tx.payment.findUnique({
    where: { id: paymentId },
    select: {
      amountCents: true,
      applications: { select: { amountCents: true } },
      loadApplications: { select: { amountCents: true } },
    },
  })
  if (!payment) return 0

  const applied =
    payment.applications.reduce((sum, row) => sum + row.amountCents, 0) +
    payment.loadApplications.reduce((sum, row) => sum + row.amountCents, 0)

  const unappliedCents = payment.amountCents - applied
  await tx.payment.update({
    where: { id: paymentId },
    data: { unappliedCents },
  })
  return unappliedCents
}

/** Recompute an invoice's paid/balance/status from its applications. */
async function refreshInvoice(tx: TxClient, invoiceId: string): Promise<void> {
  const invoice = await tx.invoice.findUnique({
    where: { id: invoiceId },
    select: {
      totalCents: true,
      status: true,
      applications: { select: { amountCents: true } },
    },
  })
  if (!invoice) return

  const amountPaidCents = invoice.applications.reduce(
    (sum, row) => sum + row.amountCents,
    0,
  )
  const balanceCents = invoice.totalCents - amountPaidCents

  // DISPUTED, VOID and WRITTEN_OFF are decisions somebody made about this
  // invoice. Arithmetic does not get to overrule them — the same rule as
  // billing-status.ts, and for the same reason.
  const decided =
    invoice.status === 'DISPUTED' ||
    invoice.status === 'VOID' ||
    invoice.status === 'WRITTEN_OFF'

  const status = decided
    ? invoice.status
    : balanceCents <= 0
      ? 'PAID'
      : amountPaidCents > 0
        ? 'PARTIALLY_PAID'
        : 'SENT'

  await tx.invoice.update({
    where: { id: invoiceId },
    data: { amountPaidCents, balanceCents, status },
  })
}

// --- payment -> invoice ------------------------------------------------------

export type ApplyFailure =
  | 'payment_not_found'
  | 'invoice_not_found'
  | 'bad_amount'
  | 'exceeds_unapplied'
  | 'exceeds_balance'
  | 'wrong_carrier'
  | 'factored_invoice'
  | 'not_factored'

export interface ApplyResult {
  ok: true
  appliedCents: number
  /** What is left on the payment afterwards. Often, correctly, not zero. */
  unappliedCents: number
  invoiceBalanceCents: number
}

export type ApplyToInvoiceResult =
  | ApplyResult
  | { ok: false; reason: ApplyFailure }

export async function applyToInvoice(
  tx: TxClient,
  paymentId: string,
  invoiceId: string,
  amountCents: number,
): Promise<ApplyToInvoiceResult> {
  if (!Number.isInteger(amountCents) || amountCents <= 0) {
    return { ok: false, reason: 'bad_amount' }
  }

  const payment = await tx.payment.findFirst({
    where: { id: paymentId, deletedAt: null },
    select: { id: true, organizationId: true, companyId: true, method: true },
  })
  if (!payment) return { ok: false, reason: 'payment_not_found' }

  const invoice = await tx.invoice.findFirst({
    where: { id: invoiceId, deletedAt: null },
    select: {
      id: true,
      companyId: true,
      balanceCents: true,
      isFactored: true,
      lines: { select: { loadId: true } },
    },
  })
  if (!invoice) return { ok: false, reason: 'invoice_not_found' }

  // An invoice belongs to one operating authority and so does the bank account
  // the money landed in. Crossing them makes both carriers' books wrong at once.
  if (payment.companyId !== invoice.companyId) {
    return { ok: false, reason: 'wrong_carrier' }
  }

  // A FACTORED INVOICE HAS A DIFFERENT DEBTOR. The factor collects it, so a
  // broker's check against it means somebody has been paid twice — most likely
  // us, and the factor will want it back. Only an advance or a reserve release
  // settles a sold invoice.
  const isFactoringMethod = FACTORING_METHODS.includes(payment.method)
  if (invoice.isFactored && !isFactoringMethod) {
    return { ok: false, reason: 'factored_invoice' }
  }
  if (!invoice.isFactored && isFactoringMethod) {
    return { ok: false, reason: 'not_factored' }
  }

  const unapplied = await refreshUnapplied(tx, payment.id)
  if (amountCents > unapplied) return { ok: false, reason: 'exceeds_unapplied' }

  // Over-applying an invoice creates a credit balance, which reads as money the
  // broker is owed and is almost always a keying error. Refused with the
  // number, so the person can see what is actually left.
  const existing = await tx.paymentApplication.findUnique({
    where: { paymentId_invoiceId: { paymentId: payment.id, invoiceId } },
    select: { id: true, amountCents: true },
  })
  if (amountCents > invoice.balanceCents + (existing?.amountCents ?? 0)) {
    return { ok: false, reason: 'exceeds_balance' }
  }

  // One row per (payment, invoice) pair — the unique index says so, and adding
  // to the existing row keeps two part-applications of one check readable as
  // one fact rather than two.
  if (existing) {
    await tx.paymentApplication.update({
      where: { id: existing.id },
      data: { amountCents: existing.amountCents + amountCents },
    })
  } else {
    await tx.paymentApplication.create({
      data: {
        paymentId: payment.id,
        invoiceId,
        // Sent honestly rather than left to the trigger to fill in. The
        // trigger still re-derives it and refuses a payment and an invoice
        // from different tenants — belt and braces on the one table where a
        // cross-tenant write would look valid from either end.
        organizationId: payment.organizationId,
        amountCents,
      },
    })
  }

  await refreshInvoice(tx, invoiceId)
  const unappliedCents = await refreshUnapplied(tx, payment.id)

  // The loads on the invoice follow it: a broker pays a document, and the five
  // loads it covers all become paid at the same moment.
  await refreshBillingStatus(
    tx,
    invoice.lines
      .map((line) => line.loadId)
      .filter((id): id is string => id !== null),
  )

  // A released reserve is the last money a factored invoice will ever see; the
  // date is what the factored view reads to stop counting it as outstanding.
  if (payment.method === 'FACTORING_RESERVE') {
    await tx.invoice.update({
      where: { id: invoiceId },
      data: { reserveReleasedAt: new Date() },
    })
  }

  const after = await tx.invoice.findUnique({
    where: { id: invoiceId },
    select: { balanceCents: true },
  })

  return {
    ok: true,
    appliedCents: amountCents,
    unappliedCents,
    invoiceBalanceCents: after?.balanceCents ?? 0,
  }
}

// --- payment -> loads (the Relay path) ---------------------------------------

export interface LoadShare {
  loadId: string
  amountCents: number
}

export type LoadApplyFailure =
  | 'payment_not_found'
  | 'no_loads'
  | 'bad_amount'
  | 'exceeds_unapplied'
  | 'load_not_found'
  | 'not_direct_settled'
  | 'wrong_carrier'
  | 'exceeds_load_balance'

export interface StatementResult {
  ok: true
  appliedCents: number
  /** Statement money with no load to sit against. Left alone, not forced. */
  unappliedCents: number
  /** Load revenue the statement did not cover. Left alone, not forced. */
  shortfallCents: number
  perLoad: LoadShare[]
}

export type ApplyToLoadsResult =
  | StatementResult
  | { ok: false; reason: LoadApplyFailure; loadNumbers?: string[] }

/**
 * Apply a statement payment across direct-settled loads.
 *
 * Explicit per-load amounts, because a weekly Relay statement lists what it
 * paid for each load and those figures are the ones worth keeping. Where the
 * statement does not itemise, `spreadOverLoads` proposes the obvious split and
 * a person confirms it — a proposal a human approves is a different thing from
 * an allocation the system invented.
 */
export async function applyToLoads(
  tx: TxClient,
  paymentId: string,
  shares: readonly LoadShare[],
): Promise<ApplyToLoadsResult> {
  const wanted = shares.filter((share) => share.amountCents !== 0)
  if (wanted.length === 0) return { ok: false, reason: 'no_loads' }
  if (
    wanted.some(
      (share) => !Number.isInteger(share.amountCents) || share.amountCents < 0,
    )
  ) {
    return { ok: false, reason: 'bad_amount' }
  }

  const payment = await tx.payment.findFirst({
    where: { id: paymentId, deletedAt: null },
    select: { id: true, organizationId: true, companyId: true },
  })
  if (!payment) return { ok: false, reason: 'payment_not_found' }

  const loads = await tx.load.findMany({
    where: { id: { in: wanted.map((share) => share.loadId) }, deletedAt: null },
    select: {
      id: true,
      loadNumber: true,
      companyId: true,
      directSettled: true,
      totalRevenueCents: true,
      paymentApplications: {
        select: { paymentId: true, amountCents: true },
      },
    },
  })
  if (loads.length !== wanted.length) {
    return { ok: false, reason: 'load_not_found' }
  }

  const byId = new Map(loads.map((load) => [load.id, load]))

  // A load on an invoice is paid THROUGH that invoice. Applying a statement to
  // it directly would credit the money twice — once here and once when the
  // invoice is paid — and neither figure would look wrong on its own.
  const notDirect = loads.filter((load) => !load.directSettled)
  if (notDirect.length > 0) {
    return {
      ok: false,
      reason: 'not_direct_settled',
      loadNumbers: notDirect.map((load) => load.loadNumber),
    }
  }

  const foreign = loads.filter((load) => load.companyId !== payment.companyId)
  if (foreign.length > 0) {
    return {
      ok: false,
      reason: 'wrong_carrier',
      loadNumbers: foreign.map((load) => load.loadNumber),
    }
  }

  const unapplied = await refreshUnapplied(tx, payment.id)
  const total = wanted.reduce((sum, share) => sum + share.amountCents, 0)
  if (total > unapplied) return { ok: false, reason: 'exceeds_unapplied' }

  // Overpaying a single load is a keying error rather than a statement
  // disagreement — the disagreement lives at the statement level and surfaces
  // as the remainder below.
  const over = loads.filter((load) => {
    const share = wanted.find((row) => row.loadId === load.id)!
    const others = load.paymentApplications
      .filter((row) => row.paymentId !== payment.id)
      .reduce((sum, row) => sum + row.amountCents, 0)
    const mine =
      load.paymentApplications.find((row) => row.paymentId === payment.id)
        ?.amountCents ?? 0
    return others + mine + share.amountCents > load.totalRevenueCents
  })
  if (over.length > 0) {
    return {
      ok: false,
      reason: 'exceeds_load_balance',
      loadNumbers: over.map((load) => load.loadNumber),
    }
  }

  for (const share of wanted) {
    const load = byId.get(share.loadId)!
    const mine = load.paymentApplications.find(
      (row) => row.paymentId === payment.id,
    )
    if (mine) {
      await tx.paymentLoadApplication.update({
        where: {
          paymentId_loadId: { paymentId: payment.id, loadId: share.loadId },
        },
        data: { amountCents: mine.amountCents + share.amountCents },
      })
    } else {
      await tx.paymentLoadApplication.create({
        data: {
          paymentId: payment.id,
          loadId: share.loadId,
          organizationId: payment.organizationId,
          amountCents: share.amountCents,
        },
      })
    }
  }

  const unappliedCents = await refreshUnapplied(tx, payment.id)
  await refreshBillingStatus(
    tx,
    wanted.map((share) => share.loadId),
  )

  // THE UNRECONCILED REMAINDER, both ways round. Reported rather than resolved.
  const after = await tx.load.findMany({
    where: { id: { in: wanted.map((share) => share.loadId) } },
    select: {
      totalRevenueCents: true,
      paymentApplications: { select: { amountCents: true } },
    },
  })
  const shortfallCents = after.reduce((sum, load) => {
    const paid = load.paymentApplications.reduce(
      (inner, row) => inner + row.amountCents,
      0,
    )
    return sum + Math.max(0, load.totalRevenueCents - paid)
  }, 0)

  return {
    ok: true,
    appliedCents: total,
    unappliedCents,
    shortfallCents,
    perLoad: [...wanted],
  }
}

/**
 * A proposed split of a statement across loads, oldest freight first.
 *
 * NOT an application — this returns a suggestion for a person to look at and
 * confirm. Oldest first because that is how a carrier chases a statement: the
 * loads that have been waiting longest are the ones somebody is worried about.
 *
 * Each load takes what it is still owed until the money runs out. Whatever is
 * left over is returned as the remainder and stays UNAPPLIED — it is not spread
 * across the loads to make the arithmetic tidy.
 */
export function spreadOverLoads(
  availableCents: number,
  loads: readonly { loadId: string; outstandingCents: number }[],
): { shares: LoadShare[]; remainderCents: number } {
  let left = availableCents
  const shares: LoadShare[] = []

  for (const load of loads) {
    if (left <= 0) break
    const take = Math.min(left, Math.max(0, load.outstandingCents))
    if (take <= 0) continue
    shares.push({ loadId: load.loadId, amountCents: take })
    left -= take
  }

  return { shares, remainderCents: left }
}

// --- reading -----------------------------------------------------------------

export interface PaymentRow {
  id: string
  method: PaymentMethod
  referenceNumber: string | null
  receivedAt: Date
  amountCents: number
  unappliedCents: number
  customerName: string
  /** The authority's id, for §7.4.2's company chip. Named, not derived. */
  companyId: string
  companyName: string
  appliedToCount: number
}

export async function listPayments(
  tx: TxClient,
  where: Prisma.PaymentWhereInput = {},
): Promise<PaymentRow[]> {
  const payments = await tx.payment.findMany({
    where: { deletedAt: null, ...where },
    orderBy: { receivedAt: 'desc' },
    take: 300,
    select: {
      id: true,
      method: true,
      referenceNumber: true,
      receivedAt: true,
      amountCents: true,
      unappliedCents: true,
      companyId: true,
      customer: { select: { name: true } },
      company: { select: { name: true } },
      _count: { select: { applications: true, loadApplications: true } },
    },
  })

  return payments.map((payment) => ({
    id: payment.id,
    method: payment.method,
    referenceNumber: payment.referenceNumber,
    receivedAt: payment.receivedAt,
    amountCents: payment.amountCents,
    unappliedCents: payment.unappliedCents,
    customerName: payment.customer?.name ?? '—',
    companyId: payment.companyId,
    companyName: payment.company.name,
    appliedToCount:
      payment._count.applications + payment._count.loadApplications,
  }))
}

/** Direct-settled loads this payment could be applied to, oldest first. */
export async function statementCandidates(
  tx: TxClient,
  companyId: string,
  customerId: string | null,
): Promise<
  {
    loadId: string
    loadNumber: string
    bookedAt: Date
    totalRevenueCents: number
    paidCents: number
    outstandingCents: number
  }[]
> {
  const loads = await tx.load.findMany({
    where: {
      deletedAt: null,
      isCancelled: false,
      companyId,
      directSettled: true,
      totalRevenueCents: { gt: 0 },
      billingStatus: { notIn: ['PAID', 'WRITTEN_OFF'] },
      ...(customerId ? { customerId } : {}),
    },
    // Oldest freight first. `bookedAt` rather than a delivery timestamp
    // because Load has none — the delivery moment lives in LoadStatusEvent,
    // and joining it here to order a picklist would cost more than it says.
    orderBy: [{ bookedAt: 'asc' }, { loadNumber: 'asc' }],
    take: 200,
    select: {
      id: true,
      loadNumber: true,
      bookedAt: true,
      totalRevenueCents: true,
      paymentApplications: { select: { amountCents: true } },
    },
  })

  return loads.map((load) => {
    const paidCents = load.paymentApplications.reduce(
      (sum, row) => sum + row.amountCents,
      0,
    )
    return {
      loadId: load.id,
      loadNumber: load.loadNumber,
      bookedAt: load.bookedAt,
      totalRevenueCents: load.totalRevenueCents,
      paidCents,
      outstandingCents: load.totalRevenueCents - paidCents,
    }
  })
}

/** Open invoices this payment could be applied to, oldest due first. */
export async function invoiceCandidates(
  tx: TxClient,
  companyId: string,
  customerId: string | null,
  method: PaymentMethod,
): Promise<
  {
    invoiceId: string
    invoiceNumber: string
    dueDate: Date | null
    totalCents: number
    balanceCents: number
  }[]
> {
  const invoices = await tx.invoice.findMany({
    where: {
      deletedAt: null,
      companyId,
      balanceCents: { gt: 0 },
      status: { notIn: ['DRAFT', 'VOID', 'WRITTEN_OFF'] },
      // The dropdown offers only what `applyToInvoice` will accept: a factoring
      // method sees sold invoices, anything else sees the ones the carrier is
      // still collecting itself.
      isFactored: FACTORING_METHODS.includes(method),
      ...(customerId ? { customerId } : {}),
    },
    orderBy: [{ dueDate: 'asc' }, { invoiceNumber: 'asc' }],
    take: 200,
    select: {
      id: true,
      invoiceNumber: true,
      dueDate: true,
      totalCents: true,
      balanceCents: true,
    },
  })

  return invoices.map((invoice) => ({
    invoiceId: invoice.id,
    invoiceNumber: invoice.invoiceNumber,
    dueDate: invoice.dueDate,
    totalCents: invoice.totalCents,
    balanceCents: invoice.balanceCents,
  }))
}

export interface PaymentDrift {
  paymentId: string
  referenceNumber: string | null
  amountCents: number
  storedUnappliedCents: number
  computedUnappliedCents: number
}

/**
 * Every payment whose stored unapplied amount is not what its applications say.
 *
 * Must return nothing. `unappliedCents` is a cache of
 * `amountCents − sum(applications)`, and a cache that disagrees with its source
 * is money the carrier believes it can still allocate but cannot — or worse,
 * money it has allocated twice.
 */
export async function findPaymentDrift(tx: TxClient): Promise<PaymentDrift[]> {
  const payments = await tx.payment.findMany({
    where: { deletedAt: null },
    select: {
      id: true,
      referenceNumber: true,
      amountCents: true,
      unappliedCents: true,
      applications: { select: { amountCents: true } },
      loadApplications: { select: { amountCents: true } },
    },
  })

  const drift: PaymentDrift[] = []
  for (const payment of payments) {
    const applied =
      payment.applications.reduce((sum, row) => sum + row.amountCents, 0) +
      payment.loadApplications.reduce((sum, row) => sum + row.amountCents, 0)
    const computed = payment.amountCents - applied

    if (computed !== payment.unappliedCents) {
      drift.push({
        paymentId: payment.id,
        referenceNumber: payment.referenceNumber,
        amountCents: payment.amountCents,
        storedUnappliedCents: payment.unappliedCents,
        computedUnappliedCents: computed,
      })
    }
  }

  return drift
}

// ---------------------------------------------------------------------------
// APPLYING ONE PAYMENT ACROSS SEVERAL OPEN ITEMS (§6.2.5).
//
// Owner's ruling, 2026-09-30. Money arrives as one wire against several open
// items; until it is applied it sits unapplied and nothing it paid for looks
// paid.
//
// ── ALL OR NOTHING, AND THAT IS THE OPPOSITE OF THE BULK GRIDS ───────────
//
// Bulk Change status and bulk Mark sent apply per row and report refusals by
// name, because those are INDEPENDENT ACTS on independent rows — finalising
// four batches and failing the fifth is four real outcomes.
//
// This is one person DIVIDING ONE PAYMENT. Applying three of their five
// allocations and refusing two leaves a split nobody chose, against a wire
// whose remainder is now wrong in a way only they could untangle. So the
// whole allocation stands or falls together, and every refusal is named so
// they can fix the set and resubmit it.
//
// The caller owns the transaction, so this REPORTS rather than rolls back:
// `ok: false` with refusals, and the action throws to undo the writes. That
// keeps the rollback where the transaction is.
// ---------------------------------------------------------------------------

export type AllocationKind = 'invoice' | 'load'

export interface Allocation {
  kind: AllocationKind
  id: string
  amountCents: number
}

export interface AllocationRefusal {
  kind: AllocationKind
  /** What the reader calls it: `INV-1002`, `DT-015095`. */
  label: string
  reason: ApplyFailure | LoadApplyFailure
}

export type ApplyAllocationsResult =
  | {
      ok: true
      appliedCents: number
      /** What is left on the payment. Often, correctly, not zero. */
      unappliedCents: number
    }
  | { ok: false; refusals: AllocationRefusal[] }

/**
 * Apply a payment across a chosen set of invoices and direct-settled loads.
 *
 * EVERY ALLOCATION GOES THROUGH THE EXISTING RULE for its kind —
 * `applyToInvoice` and `applyToLoads` — so the carrier check, the factoring
 * check, the balance ceiling and the unapplied ceiling all still hold. This
 * orchestrates; it does not reimplement, and it has no fast path.
 */
export async function applyAllocations(
  tx: TxClient,
  paymentId: string,
  allocations: readonly Allocation[],
): Promise<ApplyAllocationsResult> {
  const refusals: AllocationRefusal[] = []
  if (allocations.length === 0) {
    return { ok: false, refusals }
  }

  // NAMES FIRST, so a refusal can say `INV-1002` even when the reason is
  // "not found" — an id in an error message is the thing the reader then has
  // to go and look up.
  const invoiceIds = allocations
    .filter((row) => row.kind === 'invoice')
    .map((row) => row.id)
  const loadIds = allocations
    .filter((row) => row.kind === 'load')
    .map((row) => row.id)

  const [invoices, loads] = await Promise.all([
    invoiceIds.length > 0
      ? tx.invoice.findMany({
          where: { id: { in: invoiceIds } },
          select: { id: true, invoiceNumber: true },
        })
      : Promise.resolve([]),
    loadIds.length > 0
      ? tx.load.findMany({
          where: { id: { in: loadIds } },
          select: { id: true, loadNumber: true },
        })
      : Promise.resolve([]),
  ])
  const nameOf = new Map<string, string>([
    ...invoices.map((row) => [row.id, row.invoiceNumber] as const),
    ...loads.map((row) => [row.id, row.loadNumber] as const),
  ])
  const label = (id: string) => nameOf.get(id) ?? id.slice(0, 8)

  let appliedCents = 0

  // ── INVOICES, ONE AT A TIME ────────────────────────────────────────────
  //
  // `applyToInvoice` writes one `PaymentApplication` per call. One at a time
  // rather than a `createMany` of its own, because the audit extension
  // reports `createMany` as an unfollowable operation — a bulk insert would
  // move money with no audit trail behind it.
  for (const allocation of allocations) {
    if (allocation.kind !== 'invoice') continue
    const outcome = await applyToInvoice(
      tx,
      paymentId,
      allocation.id,
      allocation.amountCents,
    )
    if (outcome.ok) appliedCents += outcome.appliedCents
    else {
      refusals.push({
        kind: 'invoice',
        label: label(allocation.id),
        reason: outcome.reason,
      })
    }
  }

  // ── AND THE DIRECT-SETTLED LOADS, IN ONE CALL ──────────────────────────
  //
  // `applyToLoads` takes the whole set because it checks the shares against
  // the payment's remaining unapplied TOGETHER — calling it per load would
  // let each one pass a ceiling the set as a whole breaks.
  const shares = allocations
    .filter((row) => row.kind === 'load')
    .map((row) => ({ loadId: row.id, amountCents: row.amountCents }))

  if (shares.length > 0) {
    const outcome = await applyToLoads(tx, paymentId, shares)
    if (outcome.ok) appliedCents += outcome.appliedCents
    else {
      // NAMED PER LOAD WHERE THE RULE NAMES THEM, and against the set where
      // it does not — `exceeds_unapplied` is a fact about the whole
      // allocation and pinning it on one load would be a guess.
      const named = outcome.loadNumbers ?? []
      if (named.length > 0) {
        for (const loadNumber of named) {
          refusals.push({
            kind: 'load',
            label: loadNumber,
            reason: outcome.reason,
          })
        }
      } else {
        refusals.push({
          kind: 'load',
          label: shares.map((share) => label(share.loadId)).join(', '),
          reason: outcome.reason,
        })
      }
    }
  }

  if (refusals.length > 0) return { ok: false, refusals }

  const payment = await tx.payment.findFirst({
    where: { id: paymentId },
    select: { unappliedCents: true },
  })
  return {
    ok: true,
    appliedCents,
    unappliedCents: payment?.unappliedCents ?? 0,
  }
}
