import type { Prisma } from '@/generated/prisma/client'
import type { TxClient } from './tenancy'
import { apportionCents, factoringSplit } from './money'

// ---------------------------------------------------------------------------
// FACTORING (Phase 3 §5 step 4).
//
// §3.3: A FACTORED INVOICE IS SOLD. The factor collects it. It leaves normal
// AR aging the moment it is marked, because an aging report that mixes "money
// a broker owes us" with "money a factor already advanced us" answers neither
// question. The reserve is a separate receivable with a different debtor and a
// different timeline, and it lives in the factored view.
//
// WHERE FACTORING LIVES, which was flagged at the start of this phase. The
// schema had `factoringCompanyId` and `factoringFeeCents` on BOTH Load and
// Invoice — two homes for one truth, the shape that produced the authority
// drift check in Phase 2. The ruling here:
//
//   INVOICE is the source. It is what is sold, at a rate, on a date.
//   LOAD carries its APPORTIONED SHARE of the fee, and nothing else — because
//   per-load profitability is a number the owner steers by, and a fee charged
//   once on five loads has to land on all five.
//
// The load's share is derived, so it can drift, so `findFactoringDrift` exists
// and `npm run check` fails on it. Same discipline as findAuthorityDrift: a
// derived column gets a check that asks the database whether it still agrees.
// ---------------------------------------------------------------------------

// --- setup: who each authority factors with, and on what terms --------------

export interface FactorRow {
  id: string
  companyId: string | null
  companyName: string
  name: string
  contactName: string | null
  phone: string | null
  email: string | null
  advanceRateBps: number | null
  feeBps: number | null
  notes: string | null
}

/**
 * Every factor on file, grouped by authority, with the authority it belongs to.
 *
 * Unassigned factors (companyId null) are included deliberately: a row nobody
 * has attached to an authority is unusable by `markFactored`, and hiding it
 * from the setup screen is how it stays that way forever.
 */
export async function factorsForCompanies(
  tx: TxClient,
  where: Prisma.FactoringCompanyWhereInput = {},
): Promise<FactorRow[]> {
  const factors = await tx.factoringCompany.findMany({
    where: { deletedAt: null, ...where },
    orderBy: [{ company: { name: 'asc' } }, { name: 'asc' }],
    select: {
      id: true,
      companyId: true,
      name: true,
      contactName: true,
      phone: true,
      email: true,
      advanceRateBps: true,
      feeBps: true,
      notes: true,
      company: { select: { name: true } },
    },
  })

  return factors.map((factor) => ({
    id: factor.id,
    companyId: factor.companyId,
    companyName: factor.company?.name ?? '—',
    name: factor.name,
    contactName: factor.contactName,
    phone: factor.phone,
    email: factor.email,
    advanceRateBps: factor.advanceRateBps,
    feeBps: factor.feeBps,
    notes: factor.notes,
  }))
}

export interface SaveFactorInput {
  id?: string | null
  companyId: string
  name: string
  contactName?: string | null
  phone?: string | null
  email?: string | null
  advanceRateBps: number
  feeBps: number
  notes?: string | null
}

export type SaveFactorFailure =
  | 'no_name'
  | 'no_company'
  | 'bad_rate'
  | 'over_hundred'
  | 'not_found'

export type SaveFactorResult =
  | { ok: true; id: string }
  | { ok: false; reason: SaveFactorFailure }

export async function saveFactor(
  tx: TxClient,
  organizationId: string,
  input: SaveFactorInput,
): Promise<SaveFactorResult> {
  const name = input.name.trim()
  if (name === '') return { ok: false, reason: 'no_name' }
  if (input.companyId === '') return { ok: false, reason: 'no_company' }

  const inRange = (bps: number) =>
    Number.isInteger(bps) && bps >= 0 && bps <= 10_000
  if (!inRange(input.advanceRateBps) || !inRange(input.feeBps)) {
    return { ok: false, reason: 'bad_rate' }
  }

  // 97% advance and a 3% fee is the whole invoice and a zero reserve, which is
  // a real agreement. 97 and 4 is not: it would make `factoringSplit` hand back
  // a NEGATIVE reserve, and a negative reserve is not a number anyone can act
  // on. Refused at entry rather than surfaced later as a strange row.
  if (input.advanceRateBps + input.feeBps > 10_000) {
    return { ok: false, reason: 'over_hundred' }
  }

  // A company is never soft-deleted — an operating authority with freight
  // under it does not go away — so this is an existence and tenancy check.
  const company = await tx.company.findFirst({
    where: { id: input.companyId },
    select: { id: true },
  })
  if (!company) return { ok: false, reason: 'no_company' }

  const data = {
    companyId: company.id,
    name,
    contactName: input.contactName?.trim() || null,
    phone: input.phone?.trim() || null,
    email: input.email?.trim() || null,
    advanceRateBps: input.advanceRateBps,
    feeBps: input.feeBps,
    notes: input.notes?.trim() || null,
  }

  if (input.id) {
    // findFirst then update, rather than update-by-id: RLS scopes the read, so
    // an id from another tenant finds nothing and is refused here instead of
    // becoming a write that fails somewhere less legible.
    const existing = await tx.factoringCompany.findFirst({
      where: { id: input.id, deletedAt: null },
      select: { id: true },
    })
    if (!existing) return { ok: false, reason: 'not_found' }

    // An invoice already sold is unaffected. `markFactored` stores the
    // resulting ADVANCE and FEE in cents on the invoice rather than joining
    // back to these rates (schema convention 5), so editing this row changes
    // what the NEXT invoice is sold at and nothing that already happened.
    await tx.factoringCompany.update({ where: { id: existing.id }, data })
    return { ok: true, id: existing.id }
  }

  const created = await tx.factoringCompany.create({
    data: { organizationId, ...data },
    select: { id: true },
  })
  return { ok: true, id: created.id }
}

// --- selling an invoice -----------------------------------------------------

export type FactorFailure =
  | 'invoice_not_found'
  | 'factor_not_found'
  | 'already_factored'
  | 'not_sent'
  | 'no_terms'
  | 'wrong_carrier'

export interface FactorOutcome {
  ok: true
  advanceCents: number
  feeCents: number
  reserveCents: number
  perLoad: { loadId: string; feeCents: number }[]
}

export type MarkFactoredResult =
  | FactorOutcome
  | { ok: false; reason: FactorFailure }

export interface MarkFactoredInput {
  factoringCompanyId: string
  /** Override the factor's standing terms for this invoice. Basis points. */
  advanceRateBps?: number
  feeBps?: number
  factoredAt?: Date
}

export async function markFactored(
  tx: TxClient,
  invoiceId: string,
  input: MarkFactoredInput,
): Promise<MarkFactoredResult> {
  const invoice = await tx.invoice.findUnique({
    where: { id: invoiceId },
    select: {
      id: true,
      companyId: true,
      totalCents: true,
      isFactored: true,
      sentAt: true,
      lines: { select: { loadId: true, amountCents: true } },
    },
  })
  if (!invoice) return { ok: false, reason: 'invoice_not_found' }
  if (invoice.isFactored) return { ok: false, reason: 'already_factored' }

  // Selling an invoice nobody has been billed for is how a factor ends up
  // chasing a broker who has never seen the document.
  if (invoice.sentAt === null) return { ok: false, reason: 'not_sent' }

  const factor = await tx.factoringCompany.findFirst({
    where: { id: input.factoringCompanyId, deletedAt: null },
    select: { id: true, companyId: true, advanceRateBps: true, feeBps: true },
  })
  if (!factor) return { ok: false, reason: 'factor_not_found' }

  // A factor belongs to one carrier and its terms were negotiated for that
  // carrier. Selling RAM's invoice under Dolphins' agreement is a real-world
  // mistake with real-world consequences, so it is refused rather than warned.
  if (factor.companyId !== null && factor.companyId !== invoice.companyId) {
    return { ok: false, reason: 'wrong_carrier' }
  }

  const advanceRateBps = input.advanceRateBps ?? factor.advanceRateBps
  const feeBps = input.feeBps ?? factor.feeBps
  if (advanceRateBps === null || feeBps === null) {
    return { ok: false, reason: 'no_terms' }
  }

  const split = factoringSplit(invoice.totalCents, advanceRateBps, feeBps)

  // The fee lands on the loads in proportion to what each contributed to the
  // invoice. Lines without a load (there are none today, but the column is
  // nullable) are folded out of the weighting rather than silently weighted
  // as zero against a load that does not exist.
  const byLoad = new Map<string, number>()
  for (const line of invoice.lines) {
    if (!line.loadId) continue
    byLoad.set(line.loadId, (byLoad.get(line.loadId) ?? 0) + line.amountCents)
  }
  const loadIds = [...byLoad.keys()]
  const shares = apportionCents(split.feeCents, [...byLoad.values()])
  const perLoad = loadIds.map((loadId, index) => ({
    loadId,
    feeCents: shares[index] ?? 0,
  }))

  const factoredAt = input.factoredAt ?? new Date()

  await tx.invoice.update({
    where: { id: invoiceId },
    data: {
      isFactored: true,
      factoringCompanyId: factor.id,
      factoredAt,
      factoringFeeCents: split.feeCents,
      advanceCents: split.advanceCents,
    },
  })

  // One update per load. A batch would be one statement, but the shares
  // differ per row and Prisma has no multi-row update with distinct values —
  // and an invoice covers a handful of loads, not a thousand.
  for (const share of perLoad) {
    await tx.load.update({
      where: { id: share.loadId },
      data: {
        isFactored: true,
        factoringCompanyId: factor.id,
        factoringFeeCents: share.feeCents,
      },
    })
  }

  return { ok: true, ...split, perLoad }
}

export interface FactoringDrift {
  invoiceId: string
  invoiceNumber: string
  invoiceFeeCents: number
  loadFeeTotalCents: number
}

/**
 * Every factored invoice whose apportioned load fees do not sum to its own.
 *
 * Must return nothing. The load's share is derived from the invoice's fee, and
 * a derived column with no check is a column that drifts silently — this is
 * the same argument, and the same shape, as `findAuthorityDrift`.
 *
 * It catches the two ways it can go wrong: an apportionment bug, and a hand-
 * edited row. Both make per-load profitability quietly wrong forever, and
 * neither announces itself.
 */
export async function findFactoringDrift(
  tx: TxClient,
): Promise<FactoringDrift[]> {
  const invoices = await tx.invoice.findMany({
    where: { isFactored: true, deletedAt: null },
    select: {
      id: true,
      invoiceNumber: true,
      factoringFeeCents: true,
      lines: { select: { loadId: true } },
    },
  })

  const drift: FactoringDrift[] = []
  for (const invoice of invoices) {
    const loadIds = [
      ...new Set(
        invoice.lines
          .map((line) => line.loadId)
          .filter((id): id is string => id !== null),
      ),
    ]
    if (loadIds.length === 0) continue

    const loads = await tx.load.findMany({
      where: { id: { in: loadIds } },
      select: { factoringFeeCents: true },
    })
    const total = loads.reduce((sum, load) => sum + load.factoringFeeCents, 0)

    if (total !== invoice.factoringFeeCents) {
      drift.push({
        invoiceId: invoice.id,
        invoiceNumber: invoice.invoiceNumber,
        invoiceFeeCents: invoice.factoringFeeCents,
        loadFeeTotalCents: total,
      })
    }
  }

  return drift
}

export interface FactoredRow {
  id: string
  invoiceNumber: string
  customerName: string
  factorName: string
  factoredAt: Date | null
  totalCents: number
  advanceCents: number
  feeCents: number
  /** total − advance − fee. What the factor still holds. */
  reserveCents: number
  reserveReleasedAt: Date | null
}

export async function factoredInvoices(
  tx: TxClient,
  where: Prisma.InvoiceWhereInput = {},
): Promise<FactoredRow[]> {
  const invoices = await tx.invoice.findMany({
    where: { isFactored: true, deletedAt: null, ...where },
    orderBy: { factoredAt: 'desc' },
    take: 300,
    select: {
      id: true,
      invoiceNumber: true,
      totalCents: true,
      advanceCents: true,
      factoringFeeCents: true,
      factoredAt: true,
      reserveReleasedAt: true,
      customer: { select: { name: true } },
      factoringCompany: { select: { name: true } },
    },
  })

  return invoices.map((invoice) => ({
    id: invoice.id,
    invoiceNumber: invoice.invoiceNumber,
    customerName: invoice.customer.name,
    factorName: invoice.factoringCompany?.name ?? '—',
    factoredAt: invoice.factoredAt,
    totalCents: invoice.totalCents,
    advanceCents: invoice.advanceCents,
    feeCents: invoice.factoringFeeCents,
    // Derived, never stored: three columns that must agree cannot disagree if
    // only two of them exist.
    reserveCents:
      invoice.totalCents - invoice.advanceCents - invoice.factoringFeeCents,
    reserveReleasedAt: invoice.reserveReleasedAt,
  }))
}

// --- direct AR aging -------------------------------------------------------

export const AGING_BUCKETS = [
  'current',
  'd31_60',
  'd61_90',
  'd90_plus',
] as const
export type AgingBucket = (typeof AGING_BUCKETS)[number]

/**
 * Which bucket an unpaid invoice falls in, by days since it was due.
 *
 * 0–30 is "current" and counts from the DUE date, not the issue date — an
 * invoice on net-30 terms is not overdue on day one, and a report that says it
 * is trains everybody to ignore the report.
 */
export function agingBucketFor(daysPastDue: number): AgingBucket {
  if (daysPastDue <= 30) return 'current'
  if (daysPastDue <= 60) return 'd31_60'
  if (daysPastDue <= 90) return 'd61_90'
  return 'd90_plus'
}

export interface AgingRow {
  id: string
  invoiceNumber: string
  customerName: string
  dueDate: Date | null
  balanceCents: number
  daysPastDue: number
  bucket: AgingBucket
}

export interface Aging {
  rows: AgingRow[]
  totals: Record<AgingBucket, number>
  totalCents: number
}

/**
 * Aging for invoices the carrier is still collecting itself.
 *
 * FACTORED INVOICES ARE EXCLUDED, which is the whole point (§3.3). They are
 * sold: the factor collects them, and mixing them into this number makes the
 * screen lie about how much the carrier is owed and by whom.
 */
export async function directAging(
  tx: TxClient,
  where: Prisma.InvoiceWhereInput = {},
  now: Date = new Date(),
): Promise<Aging> {
  const invoices = await tx.invoice.findMany({
    where: {
      deletedAt: null,
      isFactored: false,
      balanceCents: { gt: 0 },
      status: { notIn: ['DRAFT', 'VOID', 'WRITTEN_OFF'] },
      ...where,
    },
    orderBy: { dueDate: 'asc' },
    take: 500,
    select: {
      id: true,
      invoiceNumber: true,
      dueDate: true,
      balanceCents: true,
      customer: { select: { name: true } },
    },
  })

  const totals: Record<AgingBucket, number> = {
    current: 0,
    d31_60: 0,
    d61_90: 0,
    d90_plus: 0,
  }

  const rows: AgingRow[] = invoices.map((invoice) => {
    const daysPastDue = invoice.dueDate
      ? Math.floor(
          (now.getTime() - invoice.dueDate.getTime()) / (24 * 60 * 60 * 1000),
        )
      : 0
    const bucket = agingBucketFor(daysPastDue)
    totals[bucket] += invoice.balanceCents

    return {
      id: invoice.id,
      invoiceNumber: invoice.invoiceNumber,
      customerName: invoice.customer.name,
      dueDate: invoice.dueDate,
      balanceCents: invoice.balanceCents,
      daysPastDue,
      bucket,
    }
  })

  return {
    rows,
    totals,
    totalCents: rows.reduce((sum, row) => sum + row.balanceCents, 0),
  }
}
