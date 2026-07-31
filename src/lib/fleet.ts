import type { TxClient } from './tenancy'
import type {
  DriverStatus,
  OwnershipType,
  TruckStatus,
} from '@/generated/prisma/client'
import {
  ReferenceError,
  dateOnly,
  isUniqueViolation,
  modelYear,
  optionalText,
  requiredText,
  stateCode,
} from './reference'

// ---------------------------------------------------------------------------
// FLEET — trucks, trailers and drivers.
//
// Three entities, one shape: each belongs to a Company (an operating
// authority), each carries a soft delete, and each can move between
// authorities. Grouped rather than split into three files precisely because
// the transfer rule below has to be identical for all three, and two copies of
// a rule are one copy of a rule and one bug waiting.
//
// THE SOFT DELETE AND THE UNIQUE INDEX DISAGREE, and the schema is right.
// `@@unique([companyId, unitNumber])` has no `WHERE "deletedAt" IS NULL`
// predicate, so a soft-deleted truck 101 keeps holding the number 101 against
// a new one. Rather than change the schema, the collision is detected BEFORE
// the insert and turned into an answer a person can act on — "unit 101 exists
// but was removed; restore it or choose another number" — with the offending
// id attached so the interface can offer the restore.
//
// Before, not after, and that is not a style choice: see `assertUnitAvailable`.
// Flagged in the Step 2 report.
// ---------------------------------------------------------------------------

export type FleetKind = 'truck' | 'trailer' | 'driver'

export interface TruckInput {
  companyId: string
  unitNumber: string
  vin?: unknown
  make?: unknown
  model?: unknown
  year?: unknown
  plate?: unknown
  plateState?: unknown
  status?: TruckStatus
  ownershipType?: OwnershipType
  currentOdometer?: unknown
  notes?: unknown
}

export interface TrailerInput {
  companyId: string
  unitNumber: string
  vin?: unknown
  type?: unknown
  year?: unknown
  plate?: unknown
  plateState?: unknown
  status?: TruckStatus
  ownershipType?: OwnershipType
  notes?: unknown
}

export interface DriverInput {
  companyId: string
  firstName: string
  lastName: string
  phone?: unknown
  email?: unknown
  cdlNumber?: unknown
  cdlState?: unknown
  cdlClass?: unknown
  hireDate?: unknown
  status?: DriverStatus
  employmentType?: OwnershipType
  notes?: unknown
}

function odometer(value: unknown): number | null {
  const text = optionalText(value)
  if (text === null) return null
  const miles = Number(text.replace(/[,\s]/g, ''))
  if (!Number.isInteger(miles) || miles < 0 || miles > 5_000_000) {
    throw new ReferenceError('invalid_year', { field: 'currentOdometer' })
  }
  return miles
}

/**
 * Refuse a colliding unit number BEFORE inserting it.
 *
 * The obvious shape — insert, catch `P2002`, then look up what collided — does
 * not work, and the reason is the same one that put a SAVEPOINT in the audit
 * extension in Phase 1: **a failed statement poisons a Postgres transaction.**
 * Every query after it, including the one that would explain the failure,
 * fails with `25P02` instead. The explanation query has to happen first.
 *
 * The lookup is deliberately unfiltered by `deletedAt`. That is the whole
 * point: the row holding the number may be one the user cannot see, and
 * "that unit number is taken" pointing at nothing visible is a dead end.
 *
 * `excludeId` is for updates, where the row already holding the number is the
 * row being edited.
 */
async function assertUnitAvailable(
  tx: TxClient,
  kind: 'truck' | 'trailer',
  companyId: string,
  unitNumber: string,
  excludeId?: string,
): Promise<void> {
  const where = {
    companyId,
    unitNumber,
    ...(excludeId ? { id: { not: excludeId } } : {}),
  }
  const existing =
    kind === 'truck'
      ? await tx.truck.findFirst({
          where,
          select: { id: true, deletedAt: true },
        })
      : await tx.trailer.findFirst({
          where,
          select: { id: true, deletedAt: true },
        })

  if (!existing) return

  throw new ReferenceError(
    existing.deletedAt ? 'duplicate_deleted' : 'duplicate',
    { field: 'unitNumber', conflictId: existing.id },
  )
}

/**
 * The race the check above cannot close.
 *
 * Two concurrent creates both pass `assertUnitAvailable` and one loses at the
 * index. There is nothing useful to say beyond "taken", and — critically —
 * nothing may be QUERIED to find out, because by now the transaction is
 * already poisoned. Fail with what is known and let the rollback happen.
 */
function duplicateFromRace(error: unknown): never {
  if (isUniqueViolation(error)) {
    throw new ReferenceError('duplicate', { field: 'unitNumber' })
  }
  throw error
}

/**
 * Open the first assignment period, at the moment the asset is created.
 *
 * Found by the Step 2 walkthrough: without this, a truck added through the
 * interface has a `companyId` and NO period, so `currentAuthority` returns
 * null and the detail screen says "no open period recorded" for a truck that
 * plainly works for somebody. §8 makes the open `AssetAssignment` the
 * authority of record for dispatch conflicts, and an asset that has never been
 * transferred would have no authority at all by that reading.
 *
 * The history has to start where the asset does.
 */
async function openFirstPeriod(
  tx: TxClient,
  organizationId: string,
  companyId: string,
  link: { truckId: string } | { trailerId: string } | { driverId: string },
  byUserId?: string | null,
): Promise<void> {
  await tx.assetAssignment.create({
    data: {
      organizationId,
      companyId,
      ...link,
      createdByUserId: byUserId ?? null,
    },
  })
}

async function assertCompanyInScope(
  tx: TxClient,
  companyId: string,
): Promise<void> {
  // Row-level security already makes another tenant's company invisible, so
  // this is not the tenant wall — it is the difference between a written
  // error and a foreign-key exception.
  const company = await tx.company.findFirst({
    where: { id: companyId, isActive: true },
    select: { id: true },
  })
  if (!company) {
    throw new ReferenceError('invalid_authority', { field: 'companyId' })
  }
}

// --- trucks -----------------------------------------------------------------

export async function createTruck(
  tx: TxClient,
  organizationId: string,
  input: TruckInput,
  options: { byUserId?: string | null } = {},
) {
  const companyId = requiredText(input.companyId, 'companyId')
  await assertCompanyInScope(tx, companyId)
  const unitNumber = requiredText(input.unitNumber, 'unitNumber')
  await assertUnitAvailable(tx, 'truck', companyId, unitNumber)

  let created
  try {
    created = await tx.truck.create({
      data: {
        organizationId,
        companyId,
        unitNumber,
        vin: optionalText(input.vin),
        make: optionalText(input.make),
        model: optionalText(input.model),
        year: modelYear(input.year),
        plate: optionalText(input.plate),
        plateState: stateCode(input.plateState),
        currentOdometer: odometer(input.currentOdometer),
        status: input.status ?? 'AVAILABLE',
        ownershipType: input.ownershipType ?? 'OWNED',
        notes: optionalText(input.notes),
      },
    })
  } catch (error) {
    duplicateFromRace(error)
  }

  await openFirstPeriod(
    tx,
    organizationId,
    companyId,
    { truckId: created.id },
    options.byUserId,
  )
  return created
}

export async function updateTruck(
  tx: TxClient,
  id: string,
  input: Omit<TruckInput, 'companyId'>,
) {
  const current = await tx.truck.findUnique({
    where: { id },
    select: { companyId: true },
  })
  if (!current) throw new ReferenceError('not_found')
  const unitNumber = requiredText(input.unitNumber, 'unitNumber')
  await assertUnitAvailable(tx, 'truck', current.companyId, unitNumber, id)

  try {
    // The authority is NOT settable here. Moving an asset between authorities
    // is `transferAsset`, which writes the history; a bare companyId update
    // would move it with no record that it moved.
    return await tx.truck.update({
      where: { id },
      data: {
        unitNumber,
        vin: optionalText(input.vin),
        make: optionalText(input.make),
        model: optionalText(input.model),
        year: modelYear(input.year),
        plate: optionalText(input.plate),
        plateState: stateCode(input.plateState),
        currentOdometer: odometer(input.currentOdometer),
        ...(input.status ? { status: input.status } : {}),
        ...(input.ownershipType ? { ownershipType: input.ownershipType } : {}),
        notes: optionalText(input.notes),
      },
    })
  } catch (error) {
    duplicateFromRace(error)
  }
}

// --- trailers ---------------------------------------------------------------

export async function createTrailer(
  tx: TxClient,
  organizationId: string,
  input: TrailerInput,
  options: { byUserId?: string | null } = {},
) {
  const companyId = requiredText(input.companyId, 'companyId')
  await assertCompanyInScope(tx, companyId)
  const unitNumber = requiredText(input.unitNumber, 'unitNumber')
  await assertUnitAvailable(tx, 'trailer', companyId, unitNumber)

  let created
  try {
    created = await tx.trailer.create({
      data: {
        organizationId,
        companyId,
        unitNumber,
        vin: optionalText(input.vin),
        type: optionalText(input.type),
        year: modelYear(input.year),
        plate: optionalText(input.plate),
        plateState: stateCode(input.plateState),
        status: input.status ?? 'AVAILABLE',
        ownershipType: input.ownershipType ?? 'OWNED',
        notes: optionalText(input.notes),
      },
    })
  } catch (error) {
    duplicateFromRace(error)
  }

  await openFirstPeriod(
    tx,
    organizationId,
    companyId,
    { trailerId: created.id },
    options.byUserId,
  )
  return created
}

export async function updateTrailer(
  tx: TxClient,
  id: string,
  input: Omit<TrailerInput, 'companyId'>,
) {
  const current = await tx.trailer.findUnique({
    where: { id },
    select: { companyId: true },
  })
  if (!current) throw new ReferenceError('not_found')
  const unitNumber = requiredText(input.unitNumber, 'unitNumber')
  await assertUnitAvailable(tx, 'trailer', current.companyId, unitNumber, id)

  try {
    return await tx.trailer.update({
      where: { id },
      data: {
        unitNumber,
        vin: optionalText(input.vin),
        type: optionalText(input.type),
        year: modelYear(input.year),
        plate: optionalText(input.plate),
        plateState: stateCode(input.plateState),
        ...(input.status ? { status: input.status } : {}),
        ...(input.ownershipType ? { ownershipType: input.ownershipType } : {}),
        notes: optionalText(input.notes),
      },
    })
  } catch (error) {
    duplicateFromRace(error)
  }
}

// --- drivers ----------------------------------------------------------------
//
// No unique index on a driver: two people genuinely can share a name, and a
// CDL number is not always known at hire. The uniqueness that matters is the
// open AssetAssignment, which the database enforces.

export async function createDriver(
  tx: TxClient,
  organizationId: string,
  input: DriverInput,
  options: { byUserId?: string | null } = {},
) {
  const companyId = requiredText(input.companyId, 'companyId')
  await assertCompanyInScope(tx, companyId)

  const created = await tx.driver.create({
    data: {
      organizationId,
      companyId,
      firstName: requiredText(input.firstName, 'firstName'),
      lastName: requiredText(input.lastName, 'lastName'),
      phone: optionalText(input.phone),
      email: optionalText(input.email),
      cdlNumber: optionalText(input.cdlNumber),
      cdlState: stateCode(input.cdlState),
      cdlClass: optionalText(input.cdlClass),
      hireDate: dateOnly(input.hireDate, 'hireDate'),
      status: input.status ?? 'AVAILABLE',
      employmentType: input.employmentType ?? 'OWNED',
      notes: optionalText(input.notes),
    },
  })

  await openFirstPeriod(
    tx,
    organizationId,
    companyId,
    { driverId: created.id },
    options.byUserId,
  )
  return created
}

export async function updateDriver(
  tx: TxClient,
  id: string,
  input: Omit<DriverInput, 'companyId'>,
) {
  const current = await tx.driver.findUnique({
    where: { id },
    select: { id: true },
  })
  if (!current) throw new ReferenceError('not_found')

  return tx.driver.update({
    where: { id },
    data: {
      firstName: requiredText(input.firstName, 'firstName'),
      lastName: requiredText(input.lastName, 'lastName'),
      phone: optionalText(input.phone),
      email: optionalText(input.email),
      cdlNumber: optionalText(input.cdlNumber),
      cdlState: stateCode(input.cdlState),
      cdlClass: optionalText(input.cdlClass),
      hireDate: dateOnly(input.hireDate, 'hireDate'),
      ...(input.status ? { status: input.status } : {}),
      ...(input.employmentType ? { employmentType: input.employmentType } : {}),
      notes: optionalText(input.notes),
    },
  })
}

// --- soft delete and restore ------------------------------------------------

/**
 * Retire an asset without erasing it.
 *
 * Never a hard delete. A truck that ran forty loads is referenced by forty
 * rows of history, and a settlement that cannot name the truck it paid for is
 * a settlement nobody can audit. The row stays; the lists stop showing it.
 *
 * The open AssetAssignment is closed at the same time, because an asset that
 * is gone is not still assigned to an authority — and leaving the period open
 * would block the number being reused by a genuinely new asset.
 */
export async function retireAsset(
  tx: TxClient,
  kind: FleetKind,
  id: string,
): Promise<void> {
  const deletedAt = new Date()

  if (kind === 'truck') {
    await tx.truck.update({ where: { id }, data: { deletedAt } })
    await tx.assetAssignment.updateMany({
      where: { truckId: id, effectiveTo: null },
      data: { effectiveTo: deletedAt },
    })
    return
  }
  if (kind === 'trailer') {
    await tx.trailer.update({ where: { id }, data: { deletedAt } })
    await tx.assetAssignment.updateMany({
      where: { trailerId: id, effectiveTo: null },
      data: { effectiveTo: deletedAt },
    })
    return
  }
  await tx.driver.update({ where: { id }, data: { deletedAt } })
  await tx.assetAssignment.updateMany({
    where: { driverId: id, effectiveTo: null },
    data: { effectiveTo: deletedAt },
  })
}

export async function restoreAsset(
  tx: TxClient,
  kind: FleetKind,
  id: string,
): Promise<void> {
  // Restoring does NOT reopen an assignment period. Where the asset works now
  // is a decision someone has to make, not one to infer from where it worked
  // before it was retired.
  if (kind === 'truck') {
    await tx.truck.update({ where: { id }, data: { deletedAt: null } })
    return
  }
  if (kind === 'trailer') {
    await tx.trailer.update({ where: { id }, data: { deletedAt: null } })
    return
  }
  await tx.driver.update({ where: { id }, data: { deletedAt: null } })
}

// --- transfer between authorities -------------------------------------------

export type TransferFailure = 'not_found' | 'same_authority' | 'double_open'

export class TransferError extends Error {
  readonly code: TransferFailure
  constructor(code: TransferFailure) {
    super(code)
    this.name = 'TransferError'
    this.code = code
  }
}

export interface TransferResult {
  closedAssignmentId: string | null
  openedAssignmentId: string
  fromCompanyId: string
  toCompanyId: string
}

/**
 * Move a truck, trailer or driver to another operating authority.
 *
 * The whole reason `AssetAssignment` exists. An authority is not a property of
 * an asset that can simply be overwritten — it is a period with a beginning
 * and an end, because six months from now somebody has to answer "under whose
 * MC number was this truck running on the day of the accident", and the answer
 * has to be a row rather than a memory.
 *
 * So one transaction does three things, and none of them is optional:
 *
 *   1. closes the open period (`effectiveTo` = now);
 *   2. opens a new one under the target authority;
 *   3. moves the asset's own `companyId` to match.
 *
 * Step 3 is what keeps `Truck.companyId` and the open `AssetAssignment` in
 * agreement. They are two representations of one fact and the schema does not
 * enforce that they match — see the Step 2 report.
 *
 * A double-open is refused by a partial unique index in Postgres, not by the
 * check above it. The check is for the message; the index is for the truth.
 */
export async function transferAsset(
  tx: TxClient,
  organizationId: string,
  kind: FleetKind,
  id: string,
  toCompanyId: string,
  options: { reason?: string | null; byUserId?: string | null } = {},
): Promise<TransferResult> {
  await assertCompanyInScope(tx, toCompanyId)

  const asset =
    kind === 'truck'
      ? await tx.truck.findUnique({
          where: { id },
          select: { id: true, companyId: true, deletedAt: true },
        })
      : kind === 'trailer'
        ? await tx.trailer.findUnique({
            where: { id },
            select: { id: true, companyId: true, deletedAt: true },
          })
        : await tx.driver.findUnique({
            where: { id },
            select: { id: true, companyId: true, deletedAt: true },
          })

  if (!asset || asset.deletedAt) throw new TransferError('not_found')
  if (asset.companyId === toCompanyId) {
    // Not an error the database would catch, and worth refusing: a no-op
    // transfer that reported success would leave a closed period and an
    // identical open one, which reads as a real move to anyone auditing it.
    throw new TransferError('same_authority')
  }

  const at = new Date()
  const link =
    kind === 'truck'
      ? { truckId: id }
      : kind === 'trailer'
        ? { trailerId: id }
        : { driverId: id }

  const open = await tx.assetAssignment.findFirst({
    where: { ...link, effectiveTo: null },
    select: { id: true },
  })

  if (open) {
    await tx.assetAssignment.update({
      where: { id: open.id },
      data: { effectiveTo: at },
    })
  }

  let opened
  try {
    opened = await tx.assetAssignment.create({
      data: {
        organizationId,
        companyId: toCompanyId,
        ...link,
        effectiveFrom: at,
        reason: options.reason ?? null,
        createdByUserId: options.byUserId ?? null,
      },
    })
  } catch (error) {
    if (isUniqueViolation(error)) throw new TransferError('double_open')
    throw error
  }

  if (kind === 'truck') {
    await tx.truck.update({
      where: { id },
      data: { companyId: toCompanyId },
    })
  } else if (kind === 'trailer') {
    await tx.trailer.update({
      where: { id },
      data: { companyId: toCompanyId },
    })
  } else {
    await tx.driver.update({
      where: { id },
      data: { companyId: toCompanyId },
    })
  }

  return {
    closedAssignmentId: open?.id ?? null,
    openedAssignmentId: opened.id,
    fromCompanyId: asset.companyId,
    toCompanyId,
  }
}

/** The authority an asset is currently working under, from the period log. */
export async function currentAuthority(
  tx: TxClient,
  kind: FleetKind,
  id: string,
): Promise<{ companyId: string; since: Date } | null> {
  const link =
    kind === 'truck'
      ? { truckId: id }
      : kind === 'trailer'
        ? { trailerId: id }
        : { driverId: id }

  const open = await tx.assetAssignment.findFirst({
    where: { ...link, effectiveTo: null },
    select: { companyId: true, effectiveFrom: true },
  })
  return open ? { companyId: open.companyId, since: open.effectiveFrom } : null
}
