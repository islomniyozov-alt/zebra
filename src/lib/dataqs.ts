import type {
  DataQsOutcome,
  DataQsStatus,
  Prisma,
} from '@/generated/prisma/client'
import type { CompanyScopeFilter, TxClient } from './tenancy'

// ---------------------------------------------------------------------------
// DATAQS CHALLENGES (Phase 4 §3 step 5).
//
// §1: "A DataQs challenge is its own record tied to a roadside
// inspection/violation, with a status and an outcome — not a note on a claim."
//
// §4's acceptance box asks for one trace:
//
//     inspection → violation → challenge → outcome
//
// Every link in it is a column, and the middle one is checked at write time: a
// challenge that names a violation must name one belonging to the inspection it
// names, or the trace leads to a different truck. The service refuses that in
// words and a trigger refuses it in Postgres.
//
// STATUS AND OUTCOME ARE SEPARATE, and kept in step by a CHECK constraint: a
// challenge is CLOSED exactly when it has an outcome. Collapsing them into one
// enum would make "closed" mean won and lost at the same time, which is the one
// thing a carrier reading its own CSA history cannot afford.
// ---------------------------------------------------------------------------

export const DATAQS_STATUSES: readonly DataQsStatus[] = [
  'DRAFT',
  'SUBMITTED',
  'UNDER_REVIEW',
  'CLOSED',
]

export const DATAQS_OUTCOMES: readonly DataQsOutcome[] = [
  'ACCEPTED',
  'PARTIALLY_ACCEPTED',
  'REJECTED',
  'WITHDRAWN',
]

/**
 * Where a challenge in each status may go next.
 *
 * A short ladder and a strictly forward one, unlike a claim's: FMCSA does not
 * un-submit a filing. Withdrawing is not a step backwards either — it is a
 * CLOSED with an outcome of WITHDRAWN, which is why it is not in this table.
 */
export const DATAQS_LADDER: Record<DataQsStatus, readonly DataQsStatus[]> = {
  DRAFT: ['SUBMITTED', 'CLOSED'],
  SUBMITTED: ['UNDER_REVIEW', 'CLOSED'],
  UNDER_REVIEW: ['CLOSED'],
  CLOSED: [],
}

export function mayTransition(from: DataQsStatus, to: DataQsStatus): boolean {
  return DATAQS_LADDER[from].includes(to)
}

export interface ChallengeRow {
  id: string
  companyId: string
  inspectionId: string
  inspectionDate: Date
  inspectionState: string
  /** The violation being challenged, or null when the inspection itself is. */
  violation: { id: string; code: string; outOfService: boolean } | null
  status: DataQsStatus
  outcome: DataQsOutcome | null
  basis: string
  outcomeNote: string | null
  referenceNumber: string | null
  submittedAt: Date | null
  decidedAt: Date | null
  documentCount: number
  createdAt: Date
}

const SELECT = {
  id: true,
  companyId: true,
  inspectionId: true,
  status: true,
  outcome: true,
  basis: true,
  outcomeNote: true,
  referenceNumber: true,
  submittedAt: true,
  decidedAt: true,
  createdAt: true,
  inspection: { select: { inspectedAt: true, state: true } },
  violation: { select: { id: true, code: true, outOfService: true } },
  _count: { select: { documents: true } },
} satisfies Prisma.DataQsChallengeSelect

type Stored = Prisma.DataQsChallengeGetPayload<{ select: typeof SELECT }>

export function shapeChallenges(rows: readonly Stored[]): ChallengeRow[] {
  return rows.map((row) => ({
    id: row.id,
    companyId: row.companyId,
    inspectionId: row.inspectionId,
    inspectionDate: row.inspection.inspectedAt,
    inspectionState: row.inspection.state,
    violation: row.violation,
    status: row.status,
    outcome: row.outcome,
    basis: row.basis,
    outcomeNote: row.outcomeNote,
    referenceNumber: row.referenceNumber,
    submittedAt: row.submittedAt,
    decidedAt: row.decidedAt,
    documentCount: row._count.documents,
    createdAt: row.createdAt,
  }))
}

/** Every challenge written against one inspection, newest first. */
export async function challengesForInspection(
  tx: TxClient,
  inspectionId: string,
): Promise<ChallengeRow[]> {
  const rows = await tx.dataQsChallenge.findMany({
    where: { inspectionId, deletedAt: null },
    orderBy: { createdAt: 'desc' },
    select: SELECT,
  })
  return shapeChallenges(rows)
}

/** Every challenge in scope. For the safety screens and the dashboard. */
export async function challengeList(
  tx: TxClient,
  scope: CompanyScopeFilter = {},
  status?: DataQsStatus,
): Promise<ChallengeRow[]> {
  const rows = await tx.dataQsChallenge.findMany({
    where: { ...scope, deletedAt: null, ...(status ? { status } : {}) },
    orderBy: { createdAt: 'desc' },
    take: 300,
    select: SELECT,
  })
  return shapeChallenges(rows)
}

// --- filing one --------------------------------------------------------------

export type ChallengeFailure =
  | 'inspection_not_found'
  | 'violation_not_on_inspection'
  | 'no_basis'

export type ChallengeResult =
  | { ok: true; challengeId: string }
  | { ok: false; reason: ChallengeFailure }

export interface ChallengeInput {
  inspectionId: string
  /** Null when the carrier is challenging the inspection itself. */
  violationId?: string | null
  basis: string
  referenceNumber?: string
}

export async function openChallenge(
  tx: TxClient,
  input: ChallengeInput,
): Promise<ChallengeResult> {
  if (input.basis.trim() === '') {
    // A challenge with no stated basis is a filing FMCSA will reject and a row
    // nobody can defend in six months.
    return { ok: false, reason: 'no_basis' }
  }

  // The authority comes from the inspection, read through the scoped
  // transaction — so another tenant's inspection is simply not there.
  const inspection = await tx.roadsideInspection.findFirst({
    where: { id: input.inspectionId, deletedAt: null },
    select: { id: true, organizationId: true, companyId: true },
  })
  if (!inspection) return { ok: false, reason: 'inspection_not_found' }

  if (input.violationId) {
    // THE MIDDLE LINK OF THE TRACE. Refused here in words; the trigger refuses
    // it in Postgres, so a future caller that forgets this check still cannot
    // write a challenge pointing at another inspection's violation.
    const violation = await tx.inspectionViolation.findFirst({
      where: {
        id: input.violationId,
        inspectionId: inspection.id,
        deletedAt: null,
      },
      select: { id: true },
    })
    if (!violation) {
      return { ok: false, reason: 'violation_not_on_inspection' }
    }
  }

  const created = await tx.dataQsChallenge.create({
    data: {
      organizationId: inspection.organizationId,
      companyId: inspection.companyId,
      inspectionId: inspection.id,
      violationId: input.violationId || null,
      basis: input.basis.trim(),
      referenceNumber: input.referenceNumber?.trim() || null,
      // DRAFT, and no outcome. The CHECK constraint requires exactly that.
      status: 'DRAFT',
    },
    select: { id: true },
  })

  return { ok: true, challengeId: created.id }
}

export type ChallengeMoveOutcome =
  | { result: 'moved'; from: DataQsStatus; to: DataQsStatus }
  | { result: 'unchanged'; at: DataQsStatus }
  | { result: 'refused'; at: DataQsStatus; attempted: DataQsStatus }
  | { result: 'needs_outcome' }
  | { result: 'not_found' }

export interface MoveChallengeInput {
  challengeId: string
  to: DataQsStatus
  /** Required to close, refused otherwise. */
  outcome?: DataQsOutcome | null
  outcomeNote?: string
  referenceNumber?: string
  /** "Now", passed in so a test is not at the mercy of the clock. */
  now?: Date
}

/**
 * The one function that moves a challenge.
 *
 * It also stamps the two dates, because they are facts ABOUT the move rather
 * than fields somebody types: `submittedAt` when it is filed, `decidedAt` when
 * FMCSA answers. A date typed by hand on the screen that also sets the status
 * is two chances to disagree.
 */
export async function moveChallenge(
  tx: TxClient,
  input: MoveChallengeInput,
): Promise<ChallengeMoveOutcome> {
  const challenge = await tx.dataQsChallenge.findFirst({
    where: { id: input.challengeId, deletedAt: null },
    select: { id: true, status: true, submittedAt: true },
  })
  if (!challenge) return { result: 'not_found' }

  if (challenge.status === input.to) {
    return { result: 'unchanged', at: challenge.status }
  }
  if (!mayTransition(challenge.status, input.to)) {
    return { result: 'refused', at: challenge.status, attempted: input.to }
  }

  // CLOSED means FMCSA answered, and the answer is the outcome. Without one,
  // "closed" would not say whether the violation came off the record.
  if (input.to === 'CLOSED' && !input.outcome) {
    return { result: 'needs_outcome' }
  }
  if (input.to !== 'CLOSED' && input.outcome) {
    return { result: 'refused', at: challenge.status, attempted: input.to }
  }

  const now = input.now ?? new Date()

  await tx.dataQsChallenge.update({
    where: { id: challenge.id },
    data: {
      status: input.to,
      ...(input.to === 'CLOSED'
        ? {
            outcome: input.outcome!,
            outcomeNote: input.outcomeNote?.trim() || null,
            decidedAt: now,
          }
        : {}),
      // Stamped on the way through SUBMITTED, and never overwritten — a
      // challenge that goes DRAFT → CLOSED (withdrawn before filing) keeps a
      // null submittedAt, which is the truth.
      ...(input.to === 'SUBMITTED' && challenge.submittedAt === null
        ? { submittedAt: now }
        : {}),
      ...(input.referenceNumber?.trim()
        ? { referenceNumber: input.referenceNumber.trim() }
        : {}),
    },
  })

  return { result: 'moved', from: challenge.status, to: input.to }
}

/** The documents filed against a set of challenges, for their rows. */
export async function documentsForChallenges(
  tx: TxClient,
  challengeIds: readonly string[],
): Promise<Map<string, { id: string; filename: string }[]>> {
  if (challengeIds.length === 0) return new Map()

  const documents = await tx.document.findMany({
    where: { dataQsId: { in: [...challengeIds] }, deletedAt: null },
    orderBy: { uploadedAt: 'desc' },
    select: { id: true, filename: true, dataQsId: true },
  })

  const byChallenge = new Map<string, { id: string; filename: string }[]>()
  for (const document of documents) {
    const key = document.dataQsId
    if (!key) continue
    const list = byChallenge.get(key) ?? []
    list.push({ id: document.id, filename: document.filename })
    byChallenge.set(key, list)
  }
  return byChallenge
}
