import { renderInvoicePdf, remitToFor } from './invoice-pdf'
import {
  buildFactoringPacket,
  packetReadiness,
  type PacketPart,
  type PacketReadiness,
  type PacketRefusal,
} from './factoring-packet'
import { NOT_CLOSED_HISTORY } from './billing-status'
import type { DocumentType, Prisma } from '@/generated/prisma/client'

// ---------------------------------------------------------------------------
// A LOAD BECOMES A PACKET, AND THEN IT IS FILED.
//
// The wiring `factoring-packet.ts` deliberately did without: that file is
// arithmetic over bytes and knows nothing about rows. This one reads the rows
// and renders the invoice from them.
//
// ── THE INVOICE IS RENDERED, NEVER FETCHED ───────────────────────────────
//
// The P3 rule, and the reason "the invoice exists" is a question about an
// `Invoice` ROW rather than about a stored PDF. Every figure comes from
// immutable rows at the moment the packet is asked for; a stored invoice PDF
// is a document that silently disagrees with its own invoice the first time
// anything is corrected.
//
// So the four pieces are not four documents. Three are documents — POD, BOL,
// rate confirmation — and the fourth is an invoice covering this load.
//
// ── FOUR PHASES, BECAUSE R2 REFUSES TO BE IN A TRANSACTION ───────────────
//
// `objectBytes` calls `assertOutsideTransaction`, and it is right to: a packet
// fetches several objects over the network, and holding a transaction open
// across that is how a 5-second budget becomes a lock nobody can explain.
//
// The first version of this file passed `tx` all the way down and would have
// thrown on the first document. So:
//
//   READ      `packetPlanFor(tx, loadId)`      inside a transaction
//   FETCH     the caller, from R2              outside one
//   ASSEMBLE  `assemblePacket(plan, bytes)`    pure
//   WRITE     `fileWithFactor(tx, loadId)`     a second, short transaction
//
// The caller sequences them, which is also why the ORDER is the action's
// responsibility: a load marked filed whose packet never assembled is a load
// nobody will look at again, because the status is what takes it off screen.
//
// ── FACTORING MONEY STAYS OUT ────────────────────────────────────────────
//
// Filing writes `FILED_WITH_FACTOR` and nothing else. No funded amount, no
// fee, no reserve, no payment. It ends when a person clicks PAID.
// ---------------------------------------------------------------------------

type TxClient = Prisma.TransactionClient

/** The three pieces that are documents. The fourth is an invoice row. */
const PACKET_DOCUMENT_TYPES = ['POD', 'BOL', 'RATE_CONFIRMATION'] as const

const FACTOR_FIELDS = {
  name: true,
  contactName: true,
  phone: true,
  email: true,
  remitAddressLine1: true,
  remitAddressLine2: true,
  remitCity: true,
  remitState: true,
  remitPostalCode: true,
  noticeOfAssignment: true,
} as const

export type FilingRefusal =
  | { kind: 'load_not_found' }
  | { kind: 'not_factored'; detail: string }
  | { kind: 'already_filed'; billingStatus: string }
  | { kind: 'not_ready'; readiness: PacketReadiness }
  | { kind: 'packet'; reason: PacketRefusal }

export type PacketOutcomeForLoad =
  | { ok: true; pdf: Uint8Array; pageCount: number; filename: string }
  | { ok: false; reason: FilingRefusal }

/** Everything the packet needs from the database, read in one go. */
async function readLoadForPacket(tx: TxClient, loadId: string) {
  return tx.load.findFirst({
    where: { id: loadId, deletedAt: null },
    select: {
      id: true,
      loadNumber: true,
      referenceNumber: true,
      billingStatus: true,
      totalRevenueCents: true,
      linehaulCents: true,
      accessorialsCents: true,
      company: {
        select: {
          name: true,
          dotNumber: true,
          mcNumber: true,
          addressLine1: true,
          addressLine2: true,
          city: true,
          state: true,
          postalCode: true,
          phone: true,
          factoringCompanies: {
            where: { deletedAt: null },
            take: 1,
            select: FACTOR_FIELDS,
          },
        },
      },
      customer: {
        select: {
          name: true,
          addressLine1: true,
          addressLine2: true,
          city: true,
          state: true,
          postalCode: true,
          settlesDirectly: true,
        },
      },
      documents: {
        where: { deletedAt: null },
        select: {
          id: true,
          type: true,
          filename: true,
          mimeType: true,
          r2Key: true,
        },
      },
      accessorials: {
        where: { isBillable: true },
        select: { type: true, amountCents: true, notes: true },
      },
      invoiceLines: {
        where: { invoice: { deletedAt: null, status: { not: 'VOID' } } },
        select: {
          invoice: {
            select: {
              invoiceNumber: true,
              issueDate: true,
              dueDate: true,
              termsDays: true,
              factoringCompany: { select: FACTOR_FIELDS },
            },
          },
        },
      },
    },
  })
}

/**
 * `2026-09-07` plus thirty days, as an ISO day.
 *
 * ISO-SLICED, NOT LOCALISED. A due date is a date, not a moment, and rendering
 * it through a locale would move it across a timezone boundary for whoever
 * opened the PDF — which on a 30-day term is the difference between paid and
 * late.
 */
export function dueDateFrom(issued: Date, termsDays: number): string {
  const due = new Date(issued.getTime())
  due.setUTCDate(due.getUTCDate() + termsDays)
  return due.toISOString().slice(0, 10)
}

/**
 * NEVER AN EMPTY LINE, and never a placeholder standing in for one.
 *
 * Werner's own invoice prints `PO BOX 45308, 0, OMAHA, NE 68145-0308` — an
 * empty address line 2 rendered as a literal zero. `Boolean(line)` does not
 * catch it, because `"0"` is a non-empty string.
 */
export function addressOf(customer: {
  addressLine1: string | null
  addressLine2: string | null
  city: string | null
  state: string | null
  postalCode: string | null
}): string | null {
  const printable = (value: string | null): string | null => {
    const trimmed = (value ?? '').trim()
    return trimmed !== '' && trimmed !== '0' ? trimmed : null
  }
  const city = [customer.city, customer.state, customer.postalCode]
    .map(printable)
    .filter((part): part is string => part !== null)
    .join(', ')
  const parts = [
    printable(customer.addressLine1),
    printable(customer.addressLine2),
    city === '' ? null : city,
  ].filter((part): part is string => part !== null)
  return parts.length > 0 ? parts.join(', ') : null
}

export interface PacketFetch {
  type: DocumentType
  mimeType: string
  filename: string
  key: string
}

export interface PacketPlan {
  loadId: string
  loadNumber: string
  billingStatus: string
  readiness: PacketReadiness
  /** Set when this load must not be filed at all. */
  refusal: FilingRefusal | null
  /** The invoice page, already rendered from rows. Null when refused. */
  invoicePdf: Uint8Array | null
  /** What the caller must fetch, in packet order. */
  fetch: PacketFetch[]
}

/** Phase one: read the rows and render the invoice. Inside a transaction. */
export async function packetPlanFor(
  tx: TxClient,
  loadId: string,
): Promise<PacketPlan | null> {
  const load = await readLoadForPacket(tx, loadId)
  if (!load) return null

  const readiness = packetReadiness({
    documents: load.documents,
    hasInvoice: load.invoiceLines.length > 0,
  })

  const base = {
    loadId: load.id,
    loadNumber: load.loadNumber,
    billingStatus: load.billingStatus,
    readiness,
    invoicePdf: null,
    fetch: [] as PacketFetch[],
  }

  // AMAZON FREIGHT IS NEVER FACTORED. It settles directly and carries no
  // invoice at all (§1), so a packet for it would be a document with nothing
  // to send anywhere.
  if (load.customer.settlesDirectly) {
    return {
      ...base,
      refusal: {
        kind: 'not_factored',
        detail: `${load.customer.name} settles directly; its freight is never invoiced or factored.`,
      },
    }
  }

  if (!readiness.ready) {
    return { ...base, refusal: { kind: 'not_ready', readiness } }
  }

  const invoice = load.invoiceLines[0]!.invoice
  const issued = invoice.issueDate ?? new Date()

  // THE FACTOR: the invoice's own, then the authority's. `remitToFor` states
  // the precedence — an invoice already sold to one factor must never print
  // another.
  const remitTo = remitToFor({
    company: {
      name: load.company.name,
      addressLine1: load.company.addressLine1,
      addressLine2: load.company.addressLine2,
      city: load.company.city,
      state: load.company.state,
      postalCode: load.company.postalCode,
      phone: load.company.phone,
    },
    invoiceFactor: invoice.factoringCompany,
    authorityFactor: load.company.factoringCompanies[0] ?? null,
  })

  const lines = [
    { description: 'Linehaul - FLAT', amountCents: load.linehaulCents },
    // ACCESSORIALS AS FURTHER ROWS ONLY WHEN PRESENT. Each prints as itself
    // rather than as a lump, and a zero row would claim somebody looked.
    ...load.accessorials.map((row) => ({
      description: row.notes?.trim() ?? row.type,
      amountCents: row.amountCents,
    })),
  ]

  const invoicePdf = renderInvoicePdf({
    invoiceNumber: invoice.invoiceNumber,
    issueDate: issued.toISOString().slice(0, 10),
    dueDate: invoice.dueDate
      ? invoice.dueDate.toISOString().slice(0, 10)
      : dueDateFrom(issued, invoice.termsDays),
    termsDays: invoice.termsDays,
    carrier: {
      name: load.company.name,
      dotNumber: load.company.dotNumber,
      mcNumber: load.company.mcNumber,
    },
    billTo: { name: load.customer.name, address: addressOf(load.customer) },
    remitTo,
    lines,
    subtotalCents: load.linehaulCents,
    accessorialsCents: load.accessorialsCents,
    totalCents: load.totalRevenueCents,
    // THE LOAD NUMBER IS THE BROKER'S, not ours. Werner pays against its own
    // Route #, and an invoice carrying only Zebra's number is one their system
    // cannot match.
    notes: load.referenceNumber ? `Load Number ${load.referenceNumber}` : null,
  })

  const fetch: PacketFetch[] = []
  for (const type of PACKET_DOCUMENT_TYPES) {
    for (const document of load.documents.filter((row) => row.type === type)) {
      fetch.push({
        type: document.type,
        mimeType: document.mimeType,
        filename: document.filename,
        key: document.r2Key,
      })
    }
  }

  return { ...base, refusal: null, invoicePdf, fetch }
}

/** Phase three: assemble, purely, from the plan and the bytes fetched. */
export function assemblePacket(
  plan: PacketPlan,
  bytesByKey: ReadonlyMap<string, Uint8Array>,
): PacketOutcomeForLoad {
  if (plan.refusal) return { ok: false, reason: plan.refusal }
  if (!plan.invoicePdf) {
    return {
      ok: false,
      reason: { kind: 'not_ready', readiness: plan.readiness },
    }
  }

  const parts: PacketPart[] = []
  for (const want of plan.fetch) {
    const bytes = bytesByKey.get(want.key)
    // A DOCUMENT ROW WHOSE OBJECT IS GONE IS A MISSING PIECE, not an empty
    // page. The row and the bucket disagreeing must never produce a packet
    // that looks complete.
    if (!bytes) {
      return {
        ok: false,
        reason: {
          kind: 'packet',
          reason: {
            kind: 'no_pages_from',
            type: want.type,
            filename: want.filename,
          },
        },
      }
    }
    parts.push({
      type: want.type,
      mimeType: want.mimeType,
      bytes,
      filename: want.filename,
    })
  }

  const built = buildFactoringPacket({ invoicePdf: plan.invoicePdf, parts })
  if (!built.ok) {
    return { ok: false, reason: { kind: 'packet', reason: built.reason } }
  }

  return {
    ok: true,
    pdf: built.pdf,
    pageCount: built.pageCount,
    filename: `packet-${plan.loadNumber}.pdf`,
  }
}

/**
 * Phase four: the load goes to FILED_WITH_FACTOR and stays there.
 *
 * CALLED ONLY AFTER A PACKET ASSEMBLED. That ordering is the action's job
 * because the fetch cannot happen in here — see the header.
 */
export async function fileWithFactor(
  tx: TxClient,
  loadId: string,
): Promise<{ ok: true } | { ok: false; reason: FilingRefusal }> {
  const load = await tx.load.findFirst({
    where: { id: loadId, deletedAt: null },
    select: { id: true, billingStatus: true },
  })
  if (!load) return { ok: false, reason: { kind: 'load_not_found' } }
  if (load.billingStatus === 'FILED_WITH_FACTOR') {
    return {
      ok: false,
      reason: { kind: 'already_filed', billingStatus: load.billingStatus },
    }
  }

  // THE TIMESTAMP GOES ON WITH THE STATUS, in the same write. The money screen
  // asks how old the oldest unpaid filing is, and before this column existed it
  // had to ask `updatedAt` — which is right today and drifts every time
  // anything else touches the row.
  await tx.load.update({
    where: { id: loadId },
    data: { billingStatus: 'FILED_WITH_FACTOR', filedAt: new Date() },
  })
  return { ok: true }
}

// ---------------------------------------------------------------------------
// WHAT THE SCREEN NEEDS, WHICH IS NOT WHAT THE PACKET NEEDS.
//
// `packetPlanFor` renders the invoice. A load page that called it to decide
// whether a button is grey would render a PDF on every page view, for the
// ninety-nine loads out of a hundred whose button stays grey. So the screen's
// read is its own, and it reads ONLY what the four-piece question needs.
// ---------------------------------------------------------------------------

export interface FilingState {
  loadId: string
  /** When the packet was filed with the factor. Null before that, or if it
   * was filed before the column existed. */
  filedAt?: Date | null
  billingStatus: string
  readiness: PacketReadiness
  /** Set when this load is not a factoring load at all. */
  notFactored: string | null
  /** The button is live. */
  canFile: boolean
  /** The PAID button is live — and it never is before filing. */
  canMarkPaid: boolean
}

/** The load page's read: is the button live, and if not, which piece is out. */
export async function filingStateFor(
  tx: TxClient,
  loadId: string,
): Promise<FilingState | null> {
  const load = await tx.load.findFirst({
    where: { id: loadId, deletedAt: null },
    select: {
      id: true,
      billingStatus: true,
      customer: { select: { name: true, settlesDirectly: true } },
      documents: {
        where: { deletedAt: null },
        select: { id: true, type: true, filename: true, mimeType: true },
      },
      invoiceLines: {
        where: { invoice: { deletedAt: null, status: { not: 'VOID' } } },
        select: { id: true },
        take: 1,
      },
    },
  })
  if (!load) return null

  const readiness = packetReadiness({
    documents: load.documents,
    hasInvoice: load.invoiceLines.length > 0,
  })
  const notFactored = load.customer.settlesDirectly
    ? `${load.customer.name} settles directly; its freight is never invoiced or factored.`
    : null
  const filed = load.billingStatus === 'FILED_WITH_FACTOR'

  return {
    loadId: load.id,
    billingStatus: load.billingStatus,
    readiness,
    notFactored,
    canFile: notFactored === null && readiness.ready && !filed,
    canMarkPaid: filed,
  }
}

/**
 * The same answer as `filingStateFor`, for every broker load of several
 * companies — keyed by company.
 *
 * ── WHY A SECOND FUNCTION AND NOT A LOOP ─────────────────────────────────
 *
 * `filingStateFor` is one query per load. The money screen summarises every
 * authority's filing position — filed-unpaid, ready, not-ready and why — and
 * calling it per load is N+1 inside a five-second transaction budget, on a page
 * somebody opens every Tuesday morning. Per COMPANY was not enough either: a
 * loop over five authorities cost 4.7 seconds of the 16.2 that page's first
 * version took.
 *
 * THE DEFINITION IS NOT DUPLICATED, WHICH IS THE POINT. Readiness still comes
 * from `packetReadiness` and from nothing else; only the READ is batched. A
 * screen that counted documents itself would be a second definition of ready,
 * and the two would disagree the first time a fifth required piece was added.
 *
 * DIRECT-SETTLED FREIGHT IS EXCLUDED AT THE QUERY. Amazon loads are never
 * invoiced and never factored, so counting them as "not ready" would report a
 * problem that cannot be fixed.
 */
export async function filingStatesForCompanies(
  tx: TxClient,
  companyIds: readonly string[],
): Promise<Map<string, FilingState[]>> {
  const byCompany = new Map<string, FilingState[]>()
  for (const companyId of companyIds) byCompany.set(companyId, [])
  if (companyIds.length === 0) return byCompany

  const loads = await tx.load.findMany({
    where: {
      companyId: { in: [...companyIds] },
      deletedAt: null,
      isCancelled: false,
      customer: { settlesDirectly: false },
      ...NOT_CLOSED_HISTORY,
    },
    select: {
      id: true,
      companyId: true,
      billingStatus: true,
      // THE REAL ONE NOW. This was `updatedAt` — a proxy that was right on the
      // day a load was filed and drifted every time anything else touched the
      // row. `filedAt` is written by `fileWithFactor` and by nothing else.
      //
      // NULL ON EVERY LOAD FILED BEFORE THE COLUMN EXISTED, and left null
      // rather than backfilled: `updatedAt` would have manufactured a history
      // that reads like a record.
      filedAt: true,
      documents: {
        where: { deletedAt: null },
        select: { id: true, type: true, filename: true, mimeType: true },
      },
      invoiceLines: {
        where: { invoice: { deletedAt: null, status: { not: 'VOID' } } },
        select: { id: true },
        take: 1,
      },
    },
  })

  for (const load of loads) {
    const readiness = packetReadiness({
      documents: load.documents,
      hasInvoice: load.invoiceLines.length > 0,
    })
    const filed = load.billingStatus === 'FILED_WITH_FACTOR'
    byCompany.get(load.companyId)?.push({
      loadId: load.id,
      filedAt: load.filedAt,
      billingStatus: load.billingStatus,
      readiness,
      notFactored: null,
      canFile: readiness.ready && !filed,
      canMarkPaid: filed,
    })
  }

  return byCompany
}

// ---------------------------------------------------------------------------
// THE SEQUENCER, AND WHY IT TAKES ITS I/O AS AN ARGUMENT.
//
// Three phases in three places: a transaction, the network, a second
// transaction. An action cannot hand those to a library function without
// handing it `withCurrentOrg` and R2 config, and a function holding those is
// one no test runs without standing up the whole auth context — which is the
// AGENTS.md rule about `'use server'` bodies, one layer down.
//
// So the caller supplies `read`, `fetchBytes` and `write`, and the ORDER lives
// here where it can be read and tested. The integration acceptance passes a
// real `withOrg` for the two transactions and a Map for the bucket.
// ---------------------------------------------------------------------------

export interface FilingIo {
  read: <T>(fn: (tx: TxClient) => Promise<T>) => Promise<T>
  fetchBytes: (key: string) => Promise<Uint8Array | null>
  write: <T>(fn: (tx: TxClient) => Promise<T>) => Promise<T>
}

/** Phases one to three: the packet, built and handed back, nothing written. */
export async function packetForLoad(
  io: Pick<FilingIo, 'read' | 'fetchBytes'>,
  loadId: string,
): Promise<PacketOutcomeForLoad> {
  const plan = await io.read((tx) => packetPlanFor(tx, loadId))
  if (!plan) return { ok: false, reason: { kind: 'load_not_found' } }
  if (plan.refusal) return { ok: false, reason: plan.refusal }

  // ONE FETCH PER KEY. A load carrying the same object twice — it happens,
  // the same scan attached as POD and as BOL — must not pay for it twice.
  const bytesByKey = new Map<string, Uint8Array>()
  for (const key of new Set(plan.fetch.map((want) => want.key))) {
    const bytes = await io.fetchBytes(key)
    if (bytes) bytesByKey.set(key, bytes)
  }

  return assemblePacket(plan, bytesByKey)
}

/**
 * The button. Build the packet, and only then say it was filed.
 *
 * THAT ORDER IS THE WHOLE POINT. `FILED_WITH_FACTOR` is a DECIDED status: it
 * takes the load off the ready-to-file list and off the drift check, so a load
 * marked filed whose packet never assembled is a load nobody looks at again.
 * A refusal here leaves the billing status exactly where it was.
 */
export async function filePacketForLoad(
  io: FilingIo,
  loadId: string,
): Promise<PacketOutcomeForLoad> {
  // CHECKED BEFORE THE NETWORK, and again inside the write transaction. This
  // one saves four R2 round trips on a double click; `fileWithFactor`'s is the
  // one that is actually authoritative, because only it is in a transaction.
  const already = await io.read((tx) =>
    tx.load.findFirst({
      where: { id: loadId, deletedAt: null },
      select: { billingStatus: true },
    }),
  )
  if (already?.billingStatus === 'FILED_WITH_FACTOR') {
    return {
      ok: false,
      reason: { kind: 'already_filed', billingStatus: already.billingStatus },
    }
  }

  const built = await packetForLoad(io, loadId)
  if (!built.ok) return built

  const filed = await io.write((tx) => fileWithFactor(tx, loadId))
  if (!filed.ok) return { ok: false, reason: filed.reason }

  return built
}

export type PaidRefusal =
  | { kind: 'load_not_found' }
  | { kind: 'not_filed'; billingStatus: string }

/**
 * A PERSON clicks PAID.
 *
 * Nothing else can produce this. Factoring money stays out of the software by
 * ruling, so no funding advice, no fee and no reserve ever arrives to move the
 * status on its own — which is exactly why the transition is a button, and why
 * it refuses a load that was never filed.
 */
export async function markFactoredPaid(
  tx: TxClient,
  loadId: string,
): Promise<{ ok: true } | { ok: false; reason: PaidRefusal }> {
  const load = await tx.load.findFirst({
    where: { id: loadId, deletedAt: null },
    select: { id: true, billingStatus: true },
  })
  if (!load) return { ok: false, reason: { kind: 'load_not_found' } }
  if (load.billingStatus !== 'FILED_WITH_FACTOR') {
    return {
      ok: false,
      reason: { kind: 'not_filed', billingStatus: load.billingStatus },
    }
  }

  await tx.load.update({
    where: { id: loadId },
    data: { billingStatus: 'PAID', paidAt: new Date() },
  })
  return { ok: true }
}
