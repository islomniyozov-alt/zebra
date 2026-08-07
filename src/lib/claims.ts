import type {
  ClaimPartyRole,
  ClaimStatus,
  ClaimType,
  Prisma,
} from '@/generated/prisma/client'
import type { CompanyScopeFilter, TxClient } from './tenancy'

// ---------------------------------------------------------------------------
// CLAIMS (Phase 4 §3 step 5).
//
// A cargo claim, an accident, a shortage: something went wrong and somebody
// wants money. `Claim` has existed since the init migration with the type, the
// status, the amounts and an optional load link. What step 5 adds is the three
// things that make it workable — the parties, the timeline, and a status
// LADDER rather than a free-for-all.
//
// THE LADDER IS THE POINT. `ClaimStatus` has six members and Phase 2's engine
// pattern applies: one function moves the status, it refuses a move the ladder
// does not allow, and every move it makes writes a row on the timeline. A
// status set by six different screens is six stories about what happened.
//
// Unlike the load ladder this one is NOT a rank. A claim genuinely goes
// backwards — denied, appealed, disputed again — so "would move backwards" is
// not the test. The test is the explicit table below, which is the shape of an
// actual claims process rather than a number line.
//
// Money is integer cents (rule 9-money). Nothing here divides by 100, and the
// two amounts are `amountClaimedCents` (what they asked for) and
// `amountPaidCents` (what was actually paid) — deliberately separate, because
// the difference between them is the number an owner wants at the end.
// ---------------------------------------------------------------------------

export const CLAIM_TYPES: readonly ClaimType[] = [
  'CARGO_DAMAGE',
  'CARGO_SHORTAGE',
  'ACCIDENT',
  'EQUIPMENT_DAMAGE',
  'FACILITY_INCIDENT',
  'OTHER',
]

export const CLAIM_STATUSES: readonly ClaimStatus[] = [
  'OPEN',
  'UNDER_REVIEW',
  'DISPUTED',
  'RESOLVED',
  'DENIED',
  'CLOSED',
]

export const CLAIM_PARTY_ROLES: readonly ClaimPartyRole[] = [
  'CLAIMANT',
  'INSURER',
  'ADJUSTER',
  'ATTORNEY',
  'CARRIER',
  'WITNESS',
  'OTHER',
]

/**
 * Where a claim in each status may go next.
 *
 * Written as a table rather than derived from a rank, because a claim is not a
 * ladder: DENIED → DISPUTED is an appeal and happens constantly, and
 * RESOLVED → CLOSED is bookkeeping while RESOLVED → DISPUTED is the claimant
 * coming back. The one rule with real teeth is that **CLOSED is terminal**: a
 * claim that comes back after closing is a new claim with a reference to the
 * old one, not a resurrection, because reopening destroys the meaning of the
 * closing date on every report that has already been run.
 */
export const CLAIM_LADDER: Record<ClaimStatus, readonly ClaimStatus[]> = {
  OPEN: ['UNDER_REVIEW', 'DISPUTED', 'RESOLVED', 'DENIED', 'CLOSED'],
  UNDER_REVIEW: ['DISPUTED', 'RESOLVED', 'DENIED', 'CLOSED'],
  DISPUTED: ['UNDER_REVIEW', 'RESOLVED', 'DENIED', 'CLOSED'],
  // Resolved means settled. It can be closed, or reopened into a dispute if
  // the claimant is not finished.
  RESOLVED: ['DISPUTED', 'CLOSED'],
  // Denied is where an appeal starts.
  DENIED: ['DISPUTED', 'CLOSED'],
  CLOSED: [],
}

export function mayTransition(from: ClaimStatus, to: ClaimStatus): boolean {
  return CLAIM_LADDER[from].includes(to)
}

export interface ClaimPartyRow {
  id: string
  role: ClaimPartyRole
  name: string
  phone: string | null
  email: string | null
  reference: string | null
  notes: string | null
}

export interface ClaimTimelineRow {
  id: string
  body: string | null
  fromStatus: ClaimStatus | null
  toStatus: ClaimStatus | null
  authorName: string | null
  createdAt: Date
}

export interface ClaimRow {
  id: string
  companyId: string
  companyName: string
  type: ClaimType
  status: ClaimStatus
  claimNumber: string | null
  claimantName: string | null
  incidentAt: Date | null
  amountClaimedCents: number | null
  amountPaidCents: number | null
  description: string | null
  resolution: string | null
  load: { id: string; loadNumber: string } | null
  truck: { id: string; unitNumber: string } | null
  driver: { id: string; name: string } | null
  customer: { id: string; name: string } | null
  parties: ClaimPartyRow[]
  timeline: ClaimTimelineRow[]
  documentCount: number
  createdAt: Date
}

const SELECT = {
  id: true,
  companyId: true,
  type: true,
  status: true,
  claimNumber: true,
  claimantName: true,
  incidentAt: true,
  amountClaimedCents: true,
  amountPaidCents: true,
  description: true,
  resolution: true,
  createdAt: true,
  company: { select: { name: true } },
  load: { select: { id: true, loadNumber: true } },
  truck: { select: { id: true, unitNumber: true } },
  driver: { select: { id: true, firstName: true, lastName: true } },
  customer: { select: { id: true, name: true } },
  parties: {
    where: { deletedAt: null },
    orderBy: { createdAt: 'asc' },
    select: {
      id: true,
      role: true,
      name: true,
      phone: true,
      email: true,
      reference: true,
      notes: true,
    },
  },
  notes_: {
    // NEWEST FIRST. The timeline is read from the top by somebody who wants to
    // know what happened last, not from the bottom by somebody reading a
    // history from the beginning.
    orderBy: { createdAt: 'desc' },
    take: 200,
    select: {
      id: true,
      body: true,
      fromStatus: true,
      toStatus: true,
      createdAt: true,
      author: { select: { name: true } },
    },
  },
  _count: { select: { documents: true } },
} satisfies Prisma.ClaimSelect

type Stored = Prisma.ClaimGetPayload<{ select: typeof SELECT }>

export function shapeClaims(rows: readonly Stored[]): ClaimRow[] {
  return rows.map((row) => ({
    id: row.id,
    companyId: row.companyId,
    companyName: row.company.name,
    type: row.type,
    status: row.status,
    claimNumber: row.claimNumber,
    claimantName: row.claimantName,
    incidentAt: row.incidentAt,
    amountClaimedCents: row.amountClaimedCents,
    amountPaidCents: row.amountPaidCents,
    description: row.description,
    resolution: row.resolution,
    load: row.load,
    truck: row.truck,
    driver: row.driver
      ? {
          id: row.driver.id,
          name: `${row.driver.firstName} ${row.driver.lastName}`.trim(),
        }
      : null,
    customer: row.customer,
    parties: row.parties,
    timeline: row.notes_.map((note) => ({
      id: note.id,
      body: note.body,
      fromStatus: note.fromStatus,
      toStatus: note.toStatus,
      authorName: note.author?.name ?? null,
      createdAt: note.createdAt,
    })),
    documentCount: row._count.documents,
    createdAt: row.createdAt,
  }))
}

export interface ClaimQuery {
  type?: ClaimType
  status?: ClaimStatus
  /** Everything that is not CLOSED — the working set. */
  openOnly?: boolean
}

export async function claimList(
  tx: TxClient,
  scope: CompanyScopeFilter = {},
  query: ClaimQuery = {},
): Promise<ClaimRow[]> {
  const rows = await tx.claim.findMany({
    where: {
      ...scope,
      deletedAt: null,
      ...(query.type ? { type: query.type } : {}),
      ...(query.status ? { status: query.status } : {}),
      ...(query.openOnly ? { status: { not: 'CLOSED' } } : {}),
    },
    // Newest incident first, falling back to when the claim was opened — an
    // accident with no date recorded yet must not sink to the bottom.
    orderBy: [{ incidentAt: 'desc' }, { createdAt: 'desc' }],
    take: 300,
    select: SELECT,
  })

  return shapeClaims(rows)
}

export async function claimById(
  tx: TxClient,
  id: string,
): Promise<ClaimRow | null> {
  const row = await tx.claim.findFirst({
    where: { id, deletedAt: null },
    select: SELECT,
  })
  return row ? (shapeClaims([row])[0] ?? null) : null
}

// --- opening one -------------------------------------------------------------

export type ClaimFailure =
  | 'no_authority'
  | 'load_not_found'
  | 'asset_not_found'
  | 'bad_amount'
  | 'no_description'

export type ClaimResult =
  | { ok: true; claimId: string }
  | { ok: false; reason: ClaimFailure }

export interface OpenClaimInput {
  companyId: string
  type: ClaimType
  /** Optional (§3 step 5). An accident on a bobtail has no load. */
  loadId?: string | null
  // PHASE-4-BRIEF.md §6 flag 15, resolved at Step 6. An accident names a
  // tractor and a person; a cargo claim names neither. Both optional, both
  // checked against the same authority as the claim.
  truckId?: string | null
  driverId?: string | null
  customerId?: string | null
  claimNumber?: string
  claimantName?: string
  incidentAt?: Date | null
  amountClaimedCents?: number | null
  description: string
  userId?: string | null
}

export async function openClaim(
  tx: TxClient,
  input: OpenClaimInput,
): Promise<ClaimResult> {
  if (input.description.trim() === '') {
    // A claim with no description is a row nobody can act on three weeks later.
    return { ok: false, reason: 'no_description' }
  }
  if (
    input.amountClaimedCents !== null &&
    input.amountClaimedCents !== undefined &&
    (!Number.isInteger(input.amountClaimedCents) ||
      input.amountClaimedCents < 0)
  ) {
    return { ok: false, reason: 'bad_amount' }
  }

  // The authority is read through the scoped transaction, so an id from
  // another tenant — or outside the caller's own scopes — is simply not there.
  const company = await tx.company.findFirst({
    where: { id: input.companyId },
    select: { id: true, organizationId: true },
  })
  if (!company) return { ok: false, reason: 'no_authority' }

  // THE LOAD MUST BELONG TO THE SAME AUTHORITY. A cargo claim filed against
  // RAM's load under Dolphins' authority would put the loss on the wrong
  // carrier's record, which is the same mistake the inspection service refuses.
  let loadId: string | null = null
  if (input.loadId) {
    const load = await tx.load.findFirst({
      where: { id: input.loadId, companyId: company.id },
      select: { id: true },
    })
    if (!load) return { ok: false, reason: 'load_not_found' }
    loadId = load.id
  }

  // THE SAME RULE FOR THE UNITS. A tractor from the other carrier on this
  // carrier's claim would put the accident on the wrong DOT number, which is
  // the mistake the inspection service refuses one table over.
  let truckId: string | null = null
  if (input.truckId) {
    const truck = await tx.truck.findFirst({
      where: { id: input.truckId, companyId: company.id },
      select: { id: true },
    })
    if (!truck) return { ok: false, reason: 'asset_not_found' }
    truckId = truck.id
  }

  let driverId: string | null = null
  if (input.driverId) {
    const driver = await tx.driver.findFirst({
      where: { id: input.driverId, companyId: company.id },
      select: { id: true },
    })
    if (!driver) return { ok: false, reason: 'asset_not_found' }
    driverId = driver.id
  }

  const created = await tx.claim.create({
    data: {
      organizationId: company.organizationId,
      companyId: company.id,
      type: input.type,
      loadId,
      truckId,
      driverId,
      customerId: input.customerId || null,
      claimNumber: input.claimNumber?.trim() || null,
      claimantName: input.claimantName?.trim() || null,
      incidentAt: input.incidentAt ?? null,
      amountClaimedCents: input.amountClaimedCents ?? null,
      description: input.description.trim(),
      // OPEN by default, and the first timeline row says so — a claim whose
      // history begins at its first status CHANGE has a silent first chapter.
      notes_: {
        create: {
          organizationId: company.organizationId,
          toStatus: 'OPEN',
          body: input.description.trim(),
          authorUserId: input.userId ?? null,
        },
      },
    },
    select: { id: true },
  })

  return { ok: true, claimId: created.id }
}

// --- moving it ---------------------------------------------------------------

export type ClaimMoveOutcome =
  | { result: 'moved'; from: ClaimStatus; to: ClaimStatus }
  /** Already there. Nothing written — the caller fired twice. */
  | { result: 'unchanged'; at: ClaimStatus }
  /** The ladder does not allow it. Nothing written. */
  | { result: 'refused'; at: ClaimStatus; attempted: ClaimStatus }
  | { result: 'not_found' }

export interface MoveClaimInput {
  claimId: string
  to: ClaimStatus
  note?: string
  userId?: string | null
  /** Set when the move is a settlement or a payment. Integer cents. */
  amountPaidCents?: number | null
  resolution?: string
}

/**
 * The one function that moves a claim's status.
 *
 * Phase 2's engine rule, one table over: no screen sets `Claim.status`
 * directly, every move writes its timeline row in the same transaction, and a
 * move the ladder refuses writes nothing at all rather than half of it.
 */
export async function moveClaim(
  tx: TxClient,
  input: MoveClaimInput,
): Promise<ClaimMoveOutcome> {
  const claim = await tx.claim.findFirst({
    where: { id: input.claimId, deletedAt: null },
    select: { id: true, organizationId: true, status: true },
  })
  if (!claim) return { result: 'not_found' }

  if (claim.status === input.to) {
    // Idempotent: a double-clicked button must not write two identical rows
    // onto a timeline somebody is going to read as a story.
    return { result: 'unchanged', at: claim.status }
  }

  if (!mayTransition(claim.status, input.to)) {
    return { result: 'refused', at: claim.status, attempted: input.to }
  }

  if (
    input.amountPaidCents !== null &&
    input.amountPaidCents !== undefined &&
    (!Number.isInteger(input.amountPaidCents) || input.amountPaidCents < 0)
  ) {
    return { result: 'refused', at: claim.status, attempted: input.to }
  }

  await tx.claim.update({
    where: { id: claim.id },
    data: {
      status: input.to,
      ...(input.amountPaidCents === null || input.amountPaidCents === undefined
        ? {}
        : { amountPaidCents: input.amountPaidCents }),
      ...(input.resolution?.trim()
        ? { resolution: input.resolution.trim() }
        : {}),
    },
  })

  await tx.claimNote.create({
    data: {
      organizationId: claim.organizationId,
      claimId: claim.id,
      fromStatus: claim.status,
      toStatus: input.to,
      body: input.note?.trim() || null,
      authorUserId: input.userId ?? null,
    },
  })

  return { result: 'moved', from: claim.status, to: input.to }
}

/** A typed note, with no status change attached. */
export async function addClaimNote(
  tx: TxClient,
  claimId: string,
  body: string,
  userId?: string | null,
): Promise<boolean> {
  if (body.trim() === '') return false

  const claim = await tx.claim.findFirst({
    where: { id: claimId, deletedAt: null },
    select: { id: true, organizationId: true },
  })
  if (!claim) return false

  await tx.claimNote.create({
    data: {
      organizationId: claim.organizationId,
      claimId: claim.id,
      body: body.trim(),
      authorUserId: userId ?? null,
    },
  })
  return true
}

// --- the parties -------------------------------------------------------------

export interface ClaimPartyInput {
  claimId: string
  role: ClaimPartyRole
  name: string
  phone?: string
  email?: string
  reference?: string
  notes?: string
}

export async function addClaimParty(
  tx: TxClient,
  input: ClaimPartyInput,
): Promise<{ ok: true; partyId: string } | { ok: false }> {
  if (input.name.trim() === '') return { ok: false }

  const claim = await tx.claim.findFirst({
    where: { id: input.claimId, deletedAt: null },
    select: { id: true },
  })
  if (!claim) return { ok: false }

  const created = await tx.claimParty.create({
    data: {
      // Written by the set_org trigger from the claim. Passed only because
      // Prisma requires the field; whatever arrives is overwritten.
      organizationId: '',
      claimId: claim.id,
      role: input.role,
      name: input.name.trim(),
      phone: input.phone?.trim() || null,
      email: input.email?.trim() || null,
      reference: input.reference?.trim() || null,
      notes: input.notes?.trim() || null,
    },
    select: { id: true },
  })

  return { ok: true, partyId: created.id }
}

/** Remove a party added in error. Soft, like everything else on a claim. */
export async function removeClaimParty(
  tx: TxClient,
  partyId: string,
): Promise<boolean> {
  const { count } = await tx.claimParty.updateMany({
    where: { id: partyId, deletedAt: null },
    data: { deletedAt: new Date() },
  })
  return count === 1
}

/** The documents filed against a set of claims, for their rows. */
export async function documentsForClaims(
  tx: TxClient,
  claimIds: readonly string[],
): Promise<Map<string, { id: string; filename: string }[]>> {
  if (claimIds.length === 0) return new Map()

  const documents = await tx.document.findMany({
    where: { claimId: { in: [...claimIds] }, deletedAt: null },
    orderBy: { uploadedAt: 'desc' },
    select: { id: true, filename: true, claimId: true },
  })

  const byClaim = new Map<string, { id: string; filename: string }[]>()
  for (const document of documents) {
    const key = document.claimId
    if (!key) continue
    const list = byClaim.get(key) ?? []
    list.push({ id: document.id, filename: document.filename })
    byClaim.set(key, list)
  }
  return byClaim
}
