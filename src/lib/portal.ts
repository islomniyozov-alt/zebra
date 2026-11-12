import type {
  DocumentType,
  LoadOperationalStatus,
  Prisma,
} from '@/generated/prisma/client'
import type { TxClient } from './tenancy'
import { OPEN_LOAD } from './truck-list'
import { FINISHED } from './dispatch-fields'

// ---------------------------------------------------------------------------
// THE DRIVER PORTAL'S PREDICATES — one per surface, and nowhere else
// (PHASE-7-BRIEF.md §3.3; TMS-DESIGN-SYSTEM.md §9).
//
// Every portal read starts from THE DRIVER'S OWN ROSTER ROW, resolved once per
// request by `ownDriver`, and every predicate below takes that row's id. No
// page spells its own `where`: the two-driver integration test
// (tests/integration/portal.test.ts) holds these to "never the other
// driver's, and at least one of their own" — the count above zero is what
// keeps "sees no rows" from passing on an empty table.
//
// THE MONEY RULES (owner's rulings 2026-11-12, §4.2 and §4.3):
//   - a settlement is visible only once FINALISED — APPROVED or PAID — and a
//     DRAFT is absent, not shown with a word on it;
//   - pay per load appears only through a finalised settlement's line, never
//     from `Load.driverPayCents` on its own, never the broker's rate.
// ---------------------------------------------------------------------------

/** APPROVED or PAID. "Finalised", in the owner's word, confirmed 2026-11-12. */
export const FINALISED_SETTLEMENT = ['APPROVED', 'PAID'] as const

/** How far back My loads reaches for finished freight (§1.2 of the brief). */
export const FINISHED_LOADS_DAYS = 30

/**
 * Load's budget: statements inside the tenant transaction (§9). The own row,
 * then the open load with its stops, locations and document types in one
 * relation read. Measured by the integration test against this number.
 */
export const HOME_STATEMENTS = 2

export interface OwnDriver {
  id: string
  firstName: string
  lastName: string
  companyId: string
  /** The authority's zone — the fallback when a stop names none. */
  timezone: string
  terminationDate: Date | null
}

/**
 * The driver's own roster row: `Driver.userId = session.userId`, live. Null
 * means no row is linked to this sign-in — no row, no portal, one sentence.
 */
export async function ownDriver(
  tx: TxClient,
  session: { userId: string },
): Promise<OwnDriver | null> {
  const row = await tx.driver.findFirst({
    where: { userId: session.userId, deletedAt: null },
    select: {
      id: true,
      firstName: true,
      lastName: true,
      companyId: true,
      terminationDate: true,
      company: { select: { timezone: true } },
    },
  })
  if (!row) return null
  return {
    id: row.id,
    firstName: row.firstName,
    lastName: row.lastName,
    companyId: row.companyId,
    timezone: row.company.timezone,
    terminationDate: row.terminationDate,
  }
}

/** Either seat (§4.5: a co-driver sees the load). */
export function ownLoadsWhere(driverId: string): Prisma.LoadWhereInput {
  return { deletedAt: null, OR: [{ driverId }, { coDriverId: driverId }] }
}

/** On the driver's own loads, or filed under the driver (CDL, medical card). */
export function ownDocumentsWhere(driverId: string): Prisma.DocumentWhereInput {
  return {
    deletedAt: null,
    OR: [{ driverId }, { load: ownLoadsWhere(driverId) }],
  }
}

/** The driver's own, finalised only (§4.2). */
export function ownSettlementsWhere(
  driverId: string,
): Prisma.SettlementWhereInput {
  return {
    driverId,
    deletedAt: null,
    status: { in: [...FINALISED_SETTLEMENT] },
  }
}

// ── HOME: THE CURRENT LOAD ─────────────────────────────────────────────────

const STOP_SELECT = {
  id: true,
  sequence: true,
  type: true,
  name: true,
  addressLine1: true,
  city: true,
  state: true,
  postalCode: true,
  appointmentType: true,
  scheduledAt: true,
  windowStart: true,
  windowEnd: true,
  arrivedAt: true,
  departedAt: true,
  referenceNumber: true,
  instructions: true,
  location: {
    select: {
      timezone: true,
      gateCode: true,
      dockNotes: true,
      addressLine1: true,
      city: true,
      state: true,
      postalCode: true,
    },
  },
} as const

const CURRENT_LOAD_SELECT = {
  id: true,
  loadNumber: true,
  referenceNumber: true,
  operationalStatus: true,
  commodity: true,
  weightLbs: true,
  dispatcherNotes: true,
  driverId: true,
  coDriverId: true,
  stops: { orderBy: { sequence: 'asc' }, select: STOP_SELECT },
  documents: { where: { deletedAt: null }, select: { type: true } },
} as const satisfies Prisma.LoadSelect

export type CurrentLoad = Prisma.LoadGetPayload<{
  select: typeof CURRENT_LOAD_SELECT
}>

/** The earliest stop not yet departed, or the last stop when every one is. */
export function nextStop(
  load: CurrentLoad,
): CurrentLoad['stops'][number] | null {
  return (
    load.stops.find((stop) => stop.departedAt === null) ??
    load.stops[load.stops.length - 1] ??
    null
  )
}

/**
 * The one open load the driver is on — soonest stop first when there are
 * two. ONE relation read under `relationJoins`: the load, its stops in
 * sequence, each stop's facility memory, and the document types it already
 * carries. The order is decided here, in code, because "soonest unfinished
 * stop" is not an ORDER BY Prisma can express across the relation.
 */
export async function currentLoad(
  tx: TxClient,
  driverId: string,
): Promise<CurrentLoad | null> {
  // AND, NEVER A SPREAD: `ownLoadsWhere` carries an `OR` of the two seats,
  // and a second `OR` spread beside it would silently replace the first —
  // §6.7's lesson, met again here on the first run of the test.
  const open = await tx.load.findMany({
    where: { AND: [OPEN_LOAD, ownLoadsWhere(driverId)] },
    select: CURRENT_LOAD_SELECT,
    take: 5,
  })
  if (open.length === 0) return null
  const soonest = (load: CurrentLoad): number => {
    const stop = nextStop(load)
    const at = stop?.scheduledAt ?? stop?.windowStart ?? null
    return at ? at.getTime() : Number.MAX_SAFE_INTEGER
  }
  return [...open].sort((a, b) => soonest(a) - soonest(b))[0] ?? null
}

/**
 * What the current load still needs from the driver, as the upload
 * invitation Home shows (§1.1 of the brief): a BOL once a pickup has been
 * left without one on file, a POD once the load is delivered without one.
 */
export function documentsNeeded(load: CurrentLoad): DocumentType[] {
  const has = new Set(load.documents.map((document) => document.type))
  const needed: DocumentType[] = []
  const leftPickup = load.stops.some(
    (stop) => stop.type === 'PICKUP' && stop.departedAt !== null,
  )
  if (leftPickup && !has.has('BOL')) needed.push('BOL')
  const delivered = (FINISHED as readonly LoadOperationalStatus[]).includes(
    load.operationalStatus,
  )
  if (delivered && !has.has('POD')) needed.push('POD')
  return needed
}

// ── MY LOADS ───────────────────────────────────────────────────────────────

export interface OwnLoadRow {
  id: string
  loadNumber: string
  referenceNumber: string | null
  operationalStatus: LoadOperationalStatus
  isCancelled: boolean
  isOpen: boolean
  from: string | null
  to: string | null
  /** The first pickup's appointment, for the row's date. */
  pickupAt: Date | null
  /** Through a FINALISED settlement's line only (§4.3); null until then. */
  payCents: number | null
}

/**
 * Open loads first, then the last thirty days of finished ones, newest
 * first. One statement: the loads, their first and last stop, and their
 * settlement lines under finalised settlements.
 */
export async function ownLoads(
  tx: TxClient,
  driverId: string,
  now: Date,
): Promise<OwnLoadRow[]> {
  const since = new Date(now.getTime() - FINISHED_LOADS_DAYS * 86_400_000)
  // AND of two ORs — the seats, and open-or-recent. Spread, the second OR
  // overwrote the first and every driver read every load (first run of the
  // two-driver test, 2026-11-12).
  const rows = await tx.load.findMany({
    where: {
      AND: [
        ownLoadsWhere(driverId),
        { OR: [OPEN_LOAD, { updatedAt: { gte: since } }] },
      ],
    },
    orderBy: { updatedAt: 'desc' },
    take: 100,
    select: {
      id: true,
      loadNumber: true,
      referenceNumber: true,
      operationalStatus: true,
      isCancelled: true,
      billingStatus: true,
      deletedAt: true,
      stops: {
        orderBy: { sequence: 'asc' },
        select: { type: true, city: true, state: true, scheduledAt: true },
      },
      settlementLoadLines: {
        where: { settlement: { status: { in: [...FINALISED_SETTLEMENT] } } },
        select: { amountCents: true },
      },
    },
  })
  const place = (
    stop: { city: string | null; state: string | null } | undefined,
  ) =>
    stop ? [stop.city, stop.state].filter(Boolean).join(', ') || null : null
  const openIds = new Set(
    rows
      .filter(
        (row) =>
          !row.isCancelled &&
          row.deletedAt === null &&
          !(FINISHED as readonly LoadOperationalStatus[]).includes(
            row.operationalStatus,
          ) &&
          row.billingStatus !== 'CLOSED_IN_DATATRUCK',
      )
      .map((row) => row.id),
  )
  const view = rows.map((row) => ({
    id: row.id,
    loadNumber: row.loadNumber,
    referenceNumber: row.referenceNumber,
    operationalStatus: row.operationalStatus,
    isCancelled: row.isCancelled,
    isOpen: openIds.has(row.id),
    from: place(row.stops[0]),
    to: place(row.stops[row.stops.length - 1]),
    pickupAt:
      row.stops.find((stop) => stop.type === 'PICKUP')?.scheduledAt ?? null,
    payCents:
      row.settlementLoadLines.length === 0
        ? null
        : row.settlementLoadLines.reduce(
            (total, line) => total + line.amountCents,
            0,
          ),
  }))
  // Open ones first; inside each half the newest first, as read.
  return [
    ...view.filter((row) => row.isOpen),
    ...view.filter((row) => !row.isOpen),
  ]
}

// ── DOCUMENTS ──────────────────────────────────────────────────────────────

export interface OwnDocumentRow {
  id: string
  filename: string
  type: DocumentType
  uploadedAt: Date
  loadNumber: string | null
}

export async function ownDocuments(
  tx: TxClient,
  driverId: string,
): Promise<OwnDocumentRow[]> {
  const rows = await tx.document.findMany({
    where: ownDocumentsWhere(driverId),
    orderBy: { uploadedAt: 'desc' },
    take: 100,
    select: {
      id: true,
      filename: true,
      type: true,
      uploadedAt: true,
      load: { select: { loadNumber: true } },
    },
  })
  return rows.map((row) => ({
    id: row.id,
    filename: row.filename,
    type: row.type,
    uploadedAt: row.uploadedAt,
    loadNumber: row.load?.loadNumber ?? null,
  }))
}

/** True when this document is the driver's own — the download route's gate. */
export async function isOwnDocument(
  tx: TxClient,
  driverId: string,
  documentId: string,
): Promise<boolean> {
  const row = await tx.document.findFirst({
    where: { id: documentId, ...ownDocumentsWhere(driverId) },
    select: { id: true },
  })
  return row !== null
}

// ── SETTLEMENTS ────────────────────────────────────────────────────────────

export interface OwnSettlementRow {
  id: string
  settlementNumber: string
  periodStart: Date
  periodEnd: Date
  status: 'APPROVED' | 'PAID'
  grossCents: number
  deductionsCents: number
  netCents: number
  paidAt: Date | null
}

export async function ownSettlements(
  tx: TxClient,
  driverId: string,
): Promise<OwnSettlementRow[]> {
  const rows = await tx.settlement.findMany({
    where: ownSettlementsWhere(driverId),
    orderBy: { periodEnd: 'desc' },
    take: 52,
    select: {
      id: true,
      settlementNumber: true,
      periodStart: true,
      periodEnd: true,
      status: true,
      grossCents: true,
      deductionsCents: true,
      netCents: true,
      paidAt: true,
    },
  })
  return rows.map((row) => ({
    ...row,
    status: row.status === 'PAID' ? 'PAID' : 'APPROVED',
  }))
}

/** True when this settlement is the driver's own and finalised — the PDF route's gate. */
export async function isOwnSettlement(
  tx: TxClient,
  driverId: string,
  settlementId: string,
): Promise<boolean> {
  const row = await tx.settlement.findFirst({
    where: { id: settlementId, ...ownSettlementsWhere(driverId) },
    select: { id: true },
  })
  return row !== null
}
