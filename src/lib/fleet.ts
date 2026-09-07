import { parsePercentToBps } from './money'
import type { TxClient } from './tenancy'
import {
  closeOpenPeriod,
  openFirstPeriod,
  type FleetKind,
} from './asset-transfer'
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
// authorities. Grouped rather than split into three files because every rule
// below has to be identical for all three, and two copies of a rule are one
// copy of a rule and one bug waiting.
//
// THE AUTHORITY IS NOT SETTABLE HERE. Moving an asset between authorities is
// `transferAsset` in ./asset-transfer, the one file ESLint permits to write
// `companyId` on an asset — because doing it without also writing the period
// rows leaves two representations of one fact disagreeing, silently.
//
// UNIQUENESS IS PARTIAL AND LIVES IN POSTGRES. `truck_unit_per_company` and
// `trailer_unit_per_company` carry `WHERE "deletedAt" IS NULL`, so a removed
// truck 101 does not hold the number against a new one. `assertUnitAvailable`
// matches that predicate exactly; the index is the guarantee and the check is
// only the message.
// ---------------------------------------------------------------------------

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
  /**
   * The address, usually transcribed from field 8 of the licence.
   *
   * STALE MORE OFTEN THAN NOT — a driver who moves has no reason to reissue
   * the card. A starting point somebody confirms, never a payroll or tax
   * address. `addressState` is the STORED state and is unrelated to
   * `ExtractedCdl.addressStateCode`, which exists only to cross-check the
   * issuing state and is discarded.
   */
  addressLine1?: unknown
  addressCity?: unknown
  addressState?: unknown
  addressPostalCode?: unknown
  /** Set by the confirm step when a licence was read. See assertCodesConfirmed. */
  codesPresented?: unknown
  codesConfirmed?: unknown
  cdlNumber?: unknown
  cdlState?: unknown
  cdlClass?: unknown
  hireDate?: unknown
  status?: DriverStatus
  employmentType?: OwnershipType
  notes?: unknown
  /** The truck this driver runs. Must be under the same authority. */
  assignedTruckId?: unknown
  /**
   * When the licence lapses. Becomes a `ComplianceItem`, never a Driver column.
   *
   * ONE HOME FOR A DATE THAT RAISES AN ALARM. `ComplianceItem` is what the
   * Phase 4 alerting reads, and it already carries `type: CDL`, `identifier`
   * (its own comment says "policy number, permit number, CDL number"),
   * `issuer` and `expiresAt`. A `Driver.cdlExpiresAt` beside it would be a
   * second copy of the same date, free to drift from the one that warns.
   */
  cdlExpiresAt?: unknown
  /**
   * What the driver is paid, as a percentage string — "28", "28.5".
   *
   * CREATE ONLY, and it is the field whose absence was the loudest complaint
   * about this form: a driver with no `DriverPayRule` produces an empty
   * settlement, so the person exists and cannot be paid. After creation the
   * driver screen owns pay, because rules are dated, supersede one another and
   * are frozen onto settlements — a plain field on an edit form would rewrite
   * history silently.
   */
  payPercent?: unknown
}

/**
 * Resolve the truck a driver is paired with, refusing a cross-authority one.
 *
 * WHY THIS IS A REFUSAL AND NOT A CORRECTION. `Driver.companyId` and
 * `Truck.companyId` are each an authority of record — the MC number the asset
 * runs under, the insurance that covers it, the settlement it is paid from. A
 * driver in one authority sitting in a truck from another is not a data-entry
 * detail; it is a load running under paperwork that does not describe it. So
 * the pairing is refused in words rather than silently moving either row, and
 * the words say what to do about it: transfer the truck, which is what
 * `transferAsset` is for, and which closes one period and opens the next.
 *
 * Blank clears the pairing, and clearing is always allowed.
 */
async function pairedTruck(
  tx: TxClient,
  companyId: string,
  value: unknown,
): Promise<string | null> {
  const truckId = optionalText(value)
  if (truckId === null) return null

  const truck = await tx.truck.findFirst({
    where: { id: truckId, deletedAt: null },
    select: { id: true, companyId: true },
  })
  if (!truck) {
    throw new ReferenceError('not_found', { field: 'assignedTruckId' })
  }
  if (truck.companyId !== companyId) {
    throw new ReferenceError('truck_other_authority', {
      field: 'assignedTruckId',
    })
  }
  return truck.id
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
 * LIVE ROWS ONLY, matching `truck_unit_per_company` — the partial unique index
 * added in 20260731003653. A removed truck no longer holds its number against
 * a new one, so looking at removed rows here would refuse writes the database
 * is perfectly willing to accept.
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
  failure: 'duplicate' | 'number_taken_since' = 'duplicate',
): Promise<void> {
  const where = {
    companyId,
    unitNumber,
    deletedAt: null,
    ...(excludeId ? { id: { not: excludeId } } : {}),
  }
  const existing =
    kind === 'truck'
      ? await tx.truck.findFirst({ where, select: { id: true } })
      : await tx.trailer.findFirst({ where, select: { id: true } })

  if (!existing) return

  throw new ReferenceError(failure, {
    field: 'unitNumber',
    conflictId: existing.id,
  })
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

/**
 * A licence's codes are never accepted without a person saying they match.
 *
 * ── WHY THIS IS A HARD GATE AND NOT A WARNING ─────────────────────────────
 *
 * Twenty reads of one Georgia card produced SEVEN different letters for one
 * printed restriction glyph: A, B, C, E, O, S and 5. Seventeen of those reads
 * returned a letter at `high` confidence; one admitted it could not read the
 * character. Endorsements were stable on that card, which is not a reason to
 * trust them on the next one.
 *
 * AND RECOGNITION CANNOT BE THE GATE. `E` and `O` are both real restriction
 * codes and both were wrong, so a recognition check passes them. It flagged
 * nine of ten in one batch purely by which letters the model guessed — a check
 * whose success depends on the shape of the error is not a check. Recognition
 * stays as SIGNAL beside the values; the gate is a person.
 *
 * `codesPresented` IS WHY A HIDDEN FIELD EXISTS. Without it the server cannot
 * tell a manual entry, which has no codes to confirm, from a read whose
 * confirmation was never ticked — an absent checkbox looks identical either
 * way, and defaulting to "fine" would make the gate decorative.
 */
export function assertCodesConfirmed(input: {
  codesPresented?: unknown
  codesConfirmed?: unknown
}): void {
  const presented = String(input.codesPresented ?? '') === 'yes'
  if (!presented) return
  if (String(input.codesConfirmed ?? '') !== 'yes') {
    throw new ReferenceError('codes_unconfirmed', { field: 'codesConfirmed' })
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
  assertCodesConfirmed(input)

  const created = await tx.driver.create({
    data: {
      organizationId,
      companyId,
      firstName: requiredText(input.firstName, 'firstName'),
      lastName: requiredText(input.lastName, 'lastName'),
      phone: optionalText(input.phone),
      email: optionalText(input.email),
      addressLine1: optionalText(input.addressLine1),
      addressCity: optionalText(input.addressCity),
      // `stateCode` TRUNCATES TO TWO CHARACTERS, which is right here and wrong
      // in the Datatruck seeds — see `datatruck/states.ts`. The difference is
      // the source: this value came off a card that prints a two-letter code,
      // or from a person typing into a field labelled with one. The seeds read
      // spelled-out names, where truncating "TEXAS" gives "TE".
      addressState: stateCode(input.addressState),
      addressPostalCode: optionalText(input.addressPostalCode),
      cdlNumber: optionalText(input.cdlNumber),
      cdlState: stateCode(input.cdlState),
      cdlClass: optionalText(input.cdlClass),
      hireDate: dateOnly(input.hireDate, 'hireDate'),
      status: input.status ?? 'AVAILABLE',
      employmentType: input.employmentType ?? 'OWNED',
      notes: optionalText(input.notes),
      assignedTruckId: await pairedTruck(tx, companyId, input.assignedTruckId),
    },
  })

  // THE LICENCE'S EXPIRY, AS A COMPLIANCE ITEM. Written only when the form
  // supplied one — an absent date is a licence nobody has recorded yet, not a
  // reason to refuse the driver, and inventing an expiry would raise or
  // suppress an alarm about a fact nobody stated.
  const cdlExpiresAt = dateOnly(input.cdlExpiresAt, 'cdlExpiresAt')
  if (cdlExpiresAt) {
    await tx.complianceItem.create({
      data: {
        organizationId,
        companyId,
        type: 'CDL',
        driverId: created.id,
        // The same number the driver row carries. `identifier` exists for this.
        identifier: optionalText(input.cdlNumber),
        issuer: stateCode(input.cdlState),
        expiresAt: cdlExpiresAt,
      },
    })
  }

  // AND THE PAY RULE, WITHOUT WHICH THE DRIVER CANNOT BE PAID.
  //
  // `parsePercentToBps` rather than arithmetic here: rule 9-money says basis
  // points are computed in one place, and "28.5" becoming 2850 is exactly the
  // conversion that goes wrong when two files do it.
  const percent = optionalText(input.payPercent)
  if (percent) {
    await tx.driverPayRule.create({
      data: {
        organizationId,
        driverId: created.id,
        type: 'PERCENT_LINEHAUL',
        percentBps: parsePercentToBps(percent),
        effectiveFrom: dateOnly(input.hireDate, 'hireDate') ?? new Date(),
      },
    })
  }

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
  // companyId comes from the ROW, not the form: an edit does not move an
  // asset between authorities, and the constraint is about where this driver
  // actually is.
  const current = await tx.driver.findUnique({
    where: { id },
    select: { id: true, companyId: true },
  })
  if (!current) throw new ReferenceError('not_found')

  const assignedTruckId = await pairedTruck(
    tx,
    current.companyId,
    input.assignedTruckId,
  )

  return tx.driver.update({
    where: { id },
    data: {
      firstName: requiredText(input.firstName, 'firstName'),
      lastName: requiredText(input.lastName, 'lastName'),
      phone: optionalText(input.phone),
      email: optionalText(input.email),
      addressLine1: optionalText(input.addressLine1),
      addressCity: optionalText(input.addressCity),
      // `stateCode` TRUNCATES TO TWO CHARACTERS, which is right here and wrong
      // in the Datatruck seeds — see `datatruck/states.ts`. The difference is
      // the source: this value came off a card that prints a two-letter code,
      // or from a person typing into a field labelled with one. The seeds read
      // spelled-out names, where truncating "TEXAS" gives "TE".
      addressState: stateCode(input.addressState),
      addressPostalCode: optionalText(input.addressPostalCode),
      cdlNumber: optionalText(input.cdlNumber),
      cdlState: stateCode(input.cdlState),
      cdlClass: optionalText(input.cdlClass),
      hireDate: dateOnly(input.hireDate, 'hireDate'),
      ...(input.status ? { status: input.status } : {}),
      ...(input.employmentType ? { employmentType: input.employmentType } : {}),
      notes: optionalText(input.notes),
      assignedTruckId,
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
  } else if (kind === 'trailer') {
    await tx.trailer.update({ where: { id }, data: { deletedAt } })
  } else {
    await tx.driver.update({ where: { id }, data: { deletedAt } })
  }

  // An asset that is gone is not still assigned to an authority, and leaving
  // the period open would block a genuinely new asset from taking its place.
  await closeOpenPeriod(tx, kind, id, deletedAt)
}

export async function restoreAsset(
  tx: TxClient,
  kind: FleetKind,
  id: string,
  organizationId: string,
): Promise<void> {
  // Restoring REOPENS the period, under the authority the asset still names.
  //
  // Step 3 shipped this the other way for about an hour, on the reasoning that
  // "where it works now is a decision someone has to make". `findAuthorityDrift`
  // immediately disagreed, and it was right: a live asset with a `companyId`
  // and no open period is precisely the disagreement the drift check exists to
  // catch, and §8 would find it un-dispatchable because it has no authority of
  // record. Two rules, one of which had to give — and the one that produced an
  // inconsistent row is the one that gave.
  //
  // It CAN fail, though, and only since the partial unique index landed: a
  // removed truck no longer holds its number, so a new truck may have taken it
  // in the meantime. Refuse in words rather than surface a P2002 — and refuse
  // BEFORE the update, because a failed statement poisons the transaction and
  // there would be nothing left to explain it with.
  if (kind === 'truck') {
    const truck = await tx.truck.findUnique({
      where: { id },
      select: { companyId: true, unitNumber: true },
    })
    if (!truck) throw new ReferenceError('not_found')
    await assertUnitAvailable(
      tx,
      'truck',
      truck.companyId,
      truck.unitNumber,
      id,
      'number_taken_since',
    )
    await tx.truck.update({ where: { id }, data: { deletedAt: null } })
    await openFirstPeriod(tx, organizationId, truck.companyId, { truckId: id })
    return
  }
  if (kind === 'trailer') {
    const trailer = await tx.trailer.findUnique({
      where: { id },
      select: { companyId: true, unitNumber: true },
    })
    if (!trailer) throw new ReferenceError('not_found')
    await assertUnitAvailable(
      tx,
      'trailer',
      trailer.companyId,
      trailer.unitNumber,
      id,
      'number_taken_since',
    )
    await tx.trailer.update({ where: { id }, data: { deletedAt: null } })
    await openFirstPeriod(tx, organizationId, trailer.companyId, {
      trailerId: id,
    })
    return
  }
  // Drivers carry no unique number; two people may share a name.
  const driver = await tx.driver.findUnique({
    where: { id },
    select: { companyId: true },
  })
  if (!driver) throw new ReferenceError('not_found')
  await tx.driver.update({ where: { id }, data: { deletedAt: null } })
  await openFirstPeriod(tx, organizationId, driver.companyId, { driverId: id })
}

// The transfer, the period helpers and the drift check live in
// ./asset-transfer — the single file ESLint permits to write `companyId` on an
// asset. Re-exported here so callers still have one fleet import.
export {
  transferAsset,
  currentAuthority,
  findAuthorityDrift,
  TransferError,
  type TransferResult,
  type TransferFailure,
  type FleetKind,
} from './asset-transfer'
