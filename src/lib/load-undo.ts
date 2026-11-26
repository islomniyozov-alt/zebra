import { Prisma } from '@/generated/prisma/client'
import type { LoadOperationalStatus } from '@/generated/prisma/client'
import { normalize, recordAuditEvent } from './audit'
import { refreshBillingStatus } from './billing-status'
import { cancelLoad, recomputeTotals, uncancelLoad } from './loads'
import { transitionOperational } from './load-status'
import type { TxClient } from './tenancy'
import { UNDO_EVENT } from './load-activity'

// ---------------------------------------------------------------------------
// UNDO — ONE STEP BACK ON A LOAD (TMS §7.14 part 7, v11.60; owner's ruling
// 2026-11-26).
//
// WHAT "A CHANGE" IS. One save: every audit row one transaction wrote. The
// audit flush stamps them with one instant (`writeEntries` in audit.ts), so
// the rows group exactly on `(userId, createdAt)`, with no guessing by time.
// The newest such group that touched this load or its stops and accessorial
// lines is "the most recent change".
//
// ONE PREDICATE. `undoVerdict` decides whether that change may be undone, and
// both the ⋮ menu (to enable the item and say why not) and `applyUndo` (to
// refuse) ask it. A rule that lived in two places would disagree in the one
// case nobody tested; `tests/integration/load-undo.test.ts` drives each kind
// of change through its real writer and checks the two agree.
//
// AN ALLOWLIST, NOT A BLOCKLIST. A change is undoable only when EVERY row in
// it is something Undo knows how to put back — a field on this list, a stop,
// an accessorial line, a status event this load wrote. Anything else in the
// same save (an invoice, a payment, a document, a send's stamp, a settlement,
// factoring, another load) makes the whole change "never". A new table that
// starts riding along with a load save is therefore never undone until
// somebody adds it here on purpose; a blocklist would undo it by default.
// ---------------------------------------------------------------------------

/** How far back Undo reaches. Older than this, nothing is offered. */
export const UNDO_WINDOW_MS = 24 * 60 * 60 * 1000

export { UNDO_EVENT }

/** More rows than this in one save is not a load edit; it is never undone. */
const GROUP_LIMIT = 200

/**
 * Load fields Undo puts back by writing the old value.
 *
 * Operational and assignment facts, references, the rate's own parts. NOT
 * here, so a change carrying them is never undone: `billingStatus` written by
 * hand, invoicing and payment stamps (`filedAt`, `paidAt`), factoring,
 * settled gross, driver pay, the load number, the authority, deletion.
 */
const RESTORED_FIELDS = new Set([
  'customerId',
  'referenceNumber',
  'bolNumber',
  'poNumber',
  'truckId',
  'driverId',
  'coDriverId',
  'trailerId',
  'equipmentType',
  'commodity',
  'weightLbs',
  'tempF',
  'isHazmat',
  'isTeam',
  'dispatchedMiles',
  'actualMiles',
  'emptyMiles',
  'linehaulCents',
  'fuelSurchargeCents',
  'paymentType',
  'dispatcherNotes',
  'driverNotes',
  'internalNotes',
  'tags',
])

/** The status facts, put back through their own writers, never by hand. */
const STATUS_FIELDS = new Set([
  'operationalStatus',
  'isCancelled',
  'cancelledAt',
  'cancelReason',
])

/**
 * Computed from other facts, so recomputed after an Undo, never restored.
 * Allowed in a change (every rate and accessorial save writes them) and
 * never compared: their value follows from the fields that are.
 */
const DERIVED_FIELDS = new Set([
  'accessorialsCents',
  'totalRevenueCents',
  'billingStatus',
])

const ASSIGNMENT_FIELDS = new Set([
  'truckId',
  'driverId',
  'coDriverId',
  'trailerId',
])

/** Child rows Undo removes, restores or reverts. */
const CHILD_MODELS = ['LoadStop', 'LoadAccessorial'] as const
type ChildModel = (typeof CHILD_MODELS)[number]
const isChild = (type: string): type is ChildModel =>
  (CHILD_MODELS as readonly string[]).includes(type)

/**
 * Book entries an edit may create on the way (Add load's create-on-miss),
 * allowed in a change as CREATE only and never removed by Undo. Found by the
 * agreement test: moving a stop to a new place creates its Location in the
 * same save, and without this every such edit read "never".
 */
const BOOK_ENTRIES = new Set(['Location', 'Customer'])

/** Never reverted on a child row: identity, not content. */
const CHILD_FIXED_FIELDS = new Set(['id', 'loadId', 'organizationId'])

export interface AuditRowLite {
  id: string
  entityType: string
  entityId: string
  action: string
  changes: unknown
}

/** The newest save that touched a load: who, when, and every row it wrote. */
export interface LastChange {
  userId: string | null
  at: Date
  rows: AuditRowLite[]
  /** More rows than `GROUP_LIMIT` — never a load edit, never undone. */
  truncated: boolean
}

export type UndoKind = 'status' | 'assignment' | 'accessorial' | 'edit'

export type UndoRefusal =
  /** No change of anyone's on this load in the last 24 hours. */
  | 'nothing'
  /** The most recent change was somebody else's. */
  | 'notYours'
  /** The most recent change is older than 24 hours. */
  | 'tooOld'
  /** The most recent change is an Undo: one step back, not a history. */
  | 'undo'
  /** It touched something Undo never takes back. */
  | 'never'

export type UndoVerdict =
  | { ok: true; kind: UndoKind }
  | { ok: false; reason: UndoRefusal }

type Pair = { from: unknown; to: unknown }

function changesOf(row: AuditRowLite): Record<string, Pair> {
  const changes = row.changes
  if (changes === null || typeof changes !== 'object') return {}
  const out: Record<string, Pair> = {}
  for (const [field, value] of Object.entries(changes)) {
    if (value === null || typeof value !== 'object') continue
    const pair = value as { from?: unknown; to?: unknown }
    out[field] = { from: pair.from ?? null, to: pair.to ?? null }
  }
  return out
}

/** The load a child's CREATE or DELETE row names. */
function loadIdOf(row: AuditRowLite): unknown {
  const pair = changesOf(row)['loadId']
  if (!pair) return null
  return row.action === 'DELETE' ? pair.from : pair.to
}

/** Does this row belong to the load, and is it a kind Undo can put back? */
function reversible(
  row: AuditRowLite,
  load: { id: string; childIds: ReadonlySet<string> },
): boolean {
  if (row.entityType === 'Load') {
    if (row.entityId !== load.id || row.action !== 'UPDATE') return false
    return Object.keys(changesOf(row)).every(
      (field) =>
        RESTORED_FIELDS.has(field) ||
        STATUS_FIELDS.has(field) ||
        DERIVED_FIELDS.has(field),
    )
  }
  if (isChild(row.entityType)) {
    if (row.action === 'UPDATE') {
      return (
        load.childIds.has(row.entityId) &&
        Object.keys(changesOf(row)).every(
          (field) => !CHILD_FIXED_FIELDS.has(field),
        )
      )
    }
    if (row.action === 'CREATE' || row.action === 'DELETE') {
      return loadIdOf(row) === load.id
    }
    return false
  }
  if (BOOK_ENTRIES.has(row.entityType)) {
    // Create-on-miss: an edit that typed a new dock or broker added it to
    // the book in the same save. Undo leaves it there — the book is shared,
    // a dock nobody points at harms nothing — and puts the load back.
    return row.action === 'CREATE'
  }
  if (row.entityType === 'LoadStatusEvent') {
    // History. The status itself is reverted from the Load row's own diff,
    // and the Undo writes a timeline entry of its own; the event stays.
    return row.action === 'CREATE' && loadIdOf(row) === load.id
  }
  return false
}

/**
 * MAY THIS CHANGE BE UNDONE — the one predicate (TMS §7.14 part 7).
 *
 * Pure: the caller reads the change (`lastChange`) and the load's child ids,
 * and supplies the clock.
 */
export function undoVerdict(
  change: LastChange | null,
  load: { id: string; childIds: ReadonlySet<string> },
  viewer: { userId: string },
  now: Date,
): UndoVerdict {
  if (!change || change.rows.length === 0) {
    return { ok: false, reason: 'nothing' }
  }
  if (change.userId !== viewer.userId) {
    return { ok: false, reason: 'notYours' }
  }
  if (now.getTime() - change.at.getTime() > UNDO_WINDOW_MS) {
    return { ok: false, reason: 'tooOld' }
  }
  if (change.rows.some((row) => row.entityType === UNDO_EVENT)) {
    return { ok: false, reason: 'undo' }
  }
  if (change.truncated) return { ok: false, reason: 'never' }
  if (!change.rows.every((row) => reversible(row, load))) {
    return { ok: false, reason: 'never' }
  }

  const loadFields = new Set(
    change.rows
      .filter((row) => row.entityType === 'Load')
      .flatMap((row) => Object.keys(changesOf(row)))
      .filter((field) => !DERIVED_FIELDS.has(field)),
  )
  const stops = change.rows.some((row) => row.entityType === 'LoadStop')
  const lines = change.rows.some((row) => row.entityType === 'LoadAccessorial')

  // A save that changed nothing Undo would write back — a refused status
  // click, a recompute that landed on the same figures — offers nothing.
  if (loadFields.size === 0 && !stops && !lines) {
    return { ok: false, reason: 'nothing' }
  }

  const only = (allowed: ReadonlySet<string>[]) =>
    [...loadFields].every((field) => allowed.some((set) => set.has(field)))

  if (lines && !stops && loadFields.size === 0) {
    return { ok: true, kind: 'accessorial' }
  }
  if (
    !stops &&
    !lines &&
    [...loadFields].some((field) => ASSIGNMENT_FIELDS.has(field)) &&
    only([ASSIGNMENT_FIELDS, STATUS_FIELDS])
  ) {
    return { ok: true, kind: 'assignment' }
  }
  if (!stops && !lines && only([STATUS_FIELDS])) {
    return { ok: true, kind: 'status' }
  }
  return { ok: true, kind: 'edit' }
}

/**
 * THE NEWEST SAVE THAT TOUCHED THIS LOAD, in one statement.
 *
 * The inner query finds the newest audit row on the load, its stops or its
 * accessorial lines (a removed child is found by the `loadId` its DELETE row
 * recorded), within the Undo window; the outer one returns every row that
 * save wrote, whatever it was about, because a save that also touched an
 * invoice is exactly what the predicate must see. Row-level security applies
 * as it does to every read here.
 *
 * Bounded by the window, so the inner scan is a day of this tenant's audit
 * rows on `(organizationId, createdAt)`, not its whole history.
 */
export async function lastChange(
  tx: TxClient,
  loadId: string,
  childIds: readonly string[],
  now: Date,
): Promise<LastChange | null> {
  const since = new Date(now.getTime() - UNDO_WINDOW_MS)
  const rows = await tx.$queryRaw<
    {
      id: string
      entityType: string
      entityId: string
      action: string
      changes: unknown
      userId: string | null
      createdAt: Date
    }[]
  >(Prisma.sql`
    WITH last AS (
      SELECT a."userId", a."createdAt"
      FROM "AuditLog" a
      WHERE a."createdAt" >= ${since}
        AND (
          (a."entityType" IN ('Load', ${UNDO_EVENT}) AND a."entityId" = ${loadId})
          OR (
            a."entityType" IN ('LoadStop', 'LoadAccessorial')
            AND (
              a."entityId" = ANY(${[...childIds]}::text[])
              OR a."changes" -> 'loadId' ->> 'to' = ${loadId}
              OR a."changes" -> 'loadId' ->> 'from' = ${loadId}
            )
          )
        )
      ORDER BY a."createdAt" DESC
      LIMIT 1
    )
    SELECT a.id, a."entityType", a."entityId", a.action::text AS action,
           a.changes, a."userId", a."createdAt"
    FROM "AuditLog" a
    JOIN last l
      ON a."createdAt" = l."createdAt"
     AND a."userId" IS NOT DISTINCT FROM l."userId"
    LIMIT ${GROUP_LIMIT + 1}
  `)
  const first = rows[0]
  if (!first) return null
  return {
    userId: first.userId,
    at: first.createdAt,
    rows: rows.slice(0, GROUP_LIMIT).map((row) => ({
      id: row.id,
      entityType: row.entityType,
      entityId: row.entityId,
      action: row.action,
      changes: row.changes,
    })),
    truncated: rows.length > GROUP_LIMIT,
  }
}

/** The menu's question, asked once per page render: what would Undo do? */
export async function undoStateFor(
  tx: TxClient,
  load: { id: string; childIds: readonly string[] },
  userId: string,
  now: Date = new Date(),
): Promise<UndoVerdict> {
  const change = await lastChange(tx, load.id, load.childIds, now)
  return undoVerdict(
    change,
    { id: load.id, childIds: new Set(load.childIds) },
    { userId },
    now,
  )
}

/**
 * One field's net change across a save's rows.
 *
 * A save can move one field twice — Delivered then POD received on a
 * direct-settled load — and the rows share an instant, so their order is not
 * stored. The chain is: the `from` no other row produced, and the `to` no
 * other row consumed. A chain that closes on itself changed nothing.
 */
function netPair(pairs: Pair[]): Pair | null {
  if (pairs.length === 1) return pairs[0]!
  const key = (value: unknown) => JSON.stringify(value)
  const tos = new Set(pairs.map((pair) => key(pair.to)))
  const froms = new Set(pairs.map((pair) => key(pair.from)))
  const start = pairs.find((pair) => !tos.has(key(pair.from)))
  const end = pairs.find((pair) => !froms.has(key(pair.to)))
  if (!start || !end) return null
  if (key(start.from) === key(end.to)) return null
  return { from: start.from, to: end.to }
}

/** Per entity, per field, the net change a save made. */
function netChanges(rows: AuditRowLite[]): Map<string, Record<string, Pair>> {
  const byEntity = new Map<string, Record<string, Pair[]>>()
  for (const row of rows) {
    if (row.action !== 'UPDATE') continue
    const fields = byEntity.get(row.entityId) ?? {}
    for (const [field, pair] of Object.entries(changesOf(row))) {
      ;(fields[field] ??= []).push(pair)
    }
    byEntity.set(row.entityId, fields)
  }
  const out = new Map<string, Record<string, Pair>>()
  for (const [entityId, fields] of byEntity) {
    const net: Record<string, Pair> = {}
    for (const [field, pairs] of Object.entries(fields)) {
      const pair = netPair(pairs)
      if (pair) net[field] = pair
    }
    out.set(entityId, net)
  }
  return out
}

const same = (live: unknown, recorded: unknown) =>
  JSON.stringify(normalize(live)) === JSON.stringify(normalize(recorded))

/** A recreated row's data, from the full row its DELETE recorded. */
function rowFrom(pairs: Record<string, Pair>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(pairs).map(([field, pair]) => [field, pair.from]),
  )
}

export type UndoOutcome =
  | { ok: true; kind: UndoKind }
  | { ok: false; reason: UndoRefusal | 'stale' | 'notFound' }

/**
 * TAKE THE MOST RECENT CHANGE BACK — or refuse, and write nothing.
 *
 * Asks `undoVerdict` first, the same question the menu asked. Then every
 * guard runs before any write: each field must still hold the value the
 * change gave it, each line or stop it added must still be there, each one
 * it removed must still be gone. One that does not is "changed again since",
 * and the whole Undo is refused rather than half-applied.
 *
 * Writes go through the load's own writers wherever one exists: cancellation
 * through `cancelLoad` / `uncancelLoad`, the status through
 * `transitionOperational` (with a timeline entry), totals through
 * `recomputeTotals`, billing through `refreshBillingStatus`. The Undo is then
 * recorded as its own event, `LoadUndo`, in the same save.
 */
export async function applyUndo(
  tx: TxClient,
  loadId: string,
  userId: string,
  now: Date = new Date(),
): Promise<UndoOutcome> {
  const load = await tx.load.findUnique({
    where: { id: loadId },
    include: {
      stops: { select: { id: true } },
      accessorials: { select: { id: true } },
    },
  })
  if (!load) return { ok: false, reason: 'notFound' }
  const childIds = [
    ...load.stops.map((stop) => stop.id),
    ...load.accessorials.map((line) => line.id),
  ]

  const change = await lastChange(tx, loadId, childIds, now)
  const verdict = undoVerdict(
    change,
    { id: loadId, childIds: new Set(childIds) },
    { userId },
    now,
  )
  if (!verdict.ok) return verdict
  const rows = change!.rows

  // ── WHAT TO PUT BACK ────────────────────────────────────────────────
  const net = netChanges(rows)
  const loadNet = net.get(loadId) ?? {}
  const created = rows.filter(
    (row) => isChild(row.entityType) && row.action === 'CREATE',
  )
  const createdIds = new Set(created.map((row) => row.entityId))
  const deleted = rows.filter(
    (row) => isChild(row.entityType) && row.action === 'DELETE',
  )
  const updated = rows.filter(
    (row) =>
      isChild(row.entityType) &&
      row.action === 'UPDATE' &&
      !createdIds.has(row.entityId),
  )

  // ── THE GUARDS, ALL OF THEM, BEFORE ANY WRITE ───────────────────────
  for (const [field, pair] of Object.entries(loadNet)) {
    if (DERIVED_FIELDS.has(field)) continue
    if (!same((load as Record<string, unknown>)[field], pair.to)) {
      return { ok: false, reason: 'stale' }
    }
  }

  const childRows = async (model: ChildModel, ids: string[]) => {
    if (ids.length === 0) return new Map<string, Record<string, unknown>>()
    const found =
      model === 'LoadStop'
        ? await tx.loadStop.findMany({ where: { id: { in: ids } } })
        : await tx.loadAccessorial.findMany({ where: { id: { in: ids } } })
    return new Map(
      found.map((row) => [row.id, row as unknown as Record<string, unknown>]),
    )
  }
  const touched = (model: ChildModel) =>
    [...created, ...deleted, ...updated]
      .filter((row) => row.entityType === model)
      .map((row) => row.entityId)
  const live = {
    LoadStop: await childRows('LoadStop', touched('LoadStop')),
    LoadAccessorial: await childRows(
      'LoadAccessorial',
      touched('LoadAccessorial'),
    ),
  }

  for (const row of created) {
    if (!live[row.entityType as ChildModel].has(row.entityId)) {
      return { ok: false, reason: 'stale' }
    }
  }
  for (const row of deleted) {
    if (live[row.entityType as ChildModel].has(row.entityId)) {
      return { ok: false, reason: 'stale' }
    }
  }
  for (const row of updated) {
    const current = live[row.entityType as ChildModel].get(row.entityId)
    if (!current) return { ok: false, reason: 'stale' }
    for (const [field, pair] of Object.entries(net.get(row.entityId) ?? {})) {
      if (!same(current[field], pair.to)) return { ok: false, reason: 'stale' }
    }
  }

  // ── THE WRITES ──────────────────────────────────────────────────────
  //
  // Added rows go first and removed rows come back last, so a stop rewrite
  // (old sequence 1..n deleted, new 1..n created) never holds two stops on
  // one `(loadId, sequence)`.
  const removeIds = (model: ChildModel) =>
    created.filter((row) => row.entityType === model).map((row) => row.entityId)
  if (removeIds('LoadStop').length > 0) {
    await tx.loadStop.deleteMany({
      where: { id: { in: removeIds('LoadStop') }, loadId },
    })
  }
  if (removeIds('LoadAccessorial').length > 0) {
    await tx.loadAccessorial.deleteMany({
      where: { id: { in: removeIds('LoadAccessorial') }, loadId },
    })
  }

  for (const row of updated) {
    const data = Object.fromEntries(
      Object.entries(net.get(row.entityId) ?? {}).map(([field, pair]) => [
        field,
        pair.from,
      ]),
    )
    if (Object.keys(data).length === 0) continue
    if (row.entityType === 'LoadStop') {
      await tx.loadStop.update({
        where: { id: row.entityId },
        data: data as never,
      })
    } else {
      await tx.loadAccessorial.update({
        where: { id: row.entityId },
        data: data as never,
      })
    }
  }

  for (const row of deleted) {
    const data = rowFrom(changesOf(row))
    if (row.entityType === 'LoadStop') {
      await tx.loadStop.create({ data: data as never })
    } else {
      await tx.loadAccessorial.create({ data: data as never })
    }
  }

  const restore = Object.fromEntries(
    Object.entries(loadNet)
      .filter(([field]) => RESTORED_FIELDS.has(field))
      .map(([field, pair]) => [field, pair.from]),
  )
  if (Object.keys(restore).length > 0) {
    await tx.load.update({ where: { id: loadId }, data: restore as never })
  }

  // CANCELLATION through its own writers, so the timeline says so.
  const cancelled = loadNet['isCancelled']
  if (cancelled?.from === false) {
    await uncancelLoad(tx, loadId, { byUserId: userId })
  } else if (cancelled?.from === true) {
    const reason = loadNet['cancelReason']?.from
    await cancelLoad(
      tx,
      loadId,
      typeof reason === 'string' && reason.trim() !== '' ? reason : 'Undo',
      { byUserId: userId },
    )
  }

  // THE STATUS through the status writer, backwards allowed — the second of
  // the two callers `allowRewind` names.
  const status = loadNet['operationalStatus']
  if (status && typeof status.from === 'string') {
    await transitionOperational(
      tx,
      loadId,
      status.from as LoadOperationalStatus,
      {
        source: 'MANUAL',
        userId,
        note: 'loads.undo.note',
        allowRewind: true,
      },
    )
  }

  await recomputeTotals(tx, loadId)
  await refreshBillingStatus(tx, [loadId])

  recordAuditEvent({
    entityType: UNDO_EVENT,
    entityId: loadId,
    companyId: load.companyId,
    changes: {
      undo: { from: change!.at.toISOString(), to: verdict.kind },
    },
  })

  return { ok: true, kind: verdict.kind }
}
