import type { TxClient } from './tenancy'
import type { MessageKey } from './i18n'
import { renderDateOnly } from './stop-time'

// ---------------------------------------------------------------------------
// WARN, DO NOT BLOCK (Phase 5 §3 step 5).
//
// The precedent is Phase 4's dispatch-time compliance warning, and the reason
// is the same: the office knows things the database does not. A broker really
// does send two confirmations for one BOL when a shipment splits; a lane really
// does run twice in a day. A system that refuses those is a system somebody
// works around, and the workaround is worse than the duplicate.
//
// So every one of these is a sentence, naming the record it conflicts with, in
// front of a button that says book it anyway. §5: "Duplicate BOL warns in
// words, names the load, and proceeds only on confirm."
//
// NAMING THE RECORD IS THE WHOLE VALUE. "Duplicate BOL" tells a dispatcher to
// go looking. "BOL 4471 is already on load 1042 for Cascade Freight, booked
// Aug 3" tells them whether this is the split they were expecting.
// ---------------------------------------------------------------------------

export type WarningKind =
  | 'duplicate_bol'
  | 'duplicate_po'
  // PHASE 6 §3a. The broker's own load number, which for a Relay import is
  // Amazon's `Load ID` column and the only exact key the export contains: it
  // has no BOL, no PO and no addresses, so broker+date+lane cannot fire and
  // this is what stands between one file uploaded twice and two of every load.
  //
  // A WARNING RATHER THAN A CONSTRAINT, like the other two and for the same
  // reason. A broker really does reissue a load number, and `referenceNumber`
  // has never been unique. The office is told which load it is already on.
  | 'duplicate_reference'
  | 'duplicate_load'
  | 'missing_pickup_date'
  | 'missing_delivery_date'
  | 'missing_rate'
  // PHASE 6 §3a, flag 14's cross-check. A Relay export ships a STATIC
  // standard-time offset per stop; the clocks beside it are the facility's
  // wall clock and are read in the facility's zone. In summer the real zone is
  // one hour ahead of the column and that is expected. Anything else means the
  // stop is being read in the WRONG ZONE, which is an appointment nobody can
  // meet — said out loud rather than silently trusted either way.
  | 'offset_disagrees'

export interface LoadWarning {
  kind: WarningKind
  /** The message key; the interface renders it in the user's language. */
  messageKey: MessageKey
  /** Substituted into the message. Load numbers are never translated (§12). */
  values: Record<string, string>
}

/**
 * Thrown INSIDE the write transaction so it rolls back.
 *
 * Returning the warnings normally would commit whatever create-on-miss had
 * already made — a Customer and two Locations for a load nobody booked, which
 * is exactly the litter the transaction exists to prevent. Same shape as
 * `DispatchConflictError`, for the same reason and handled the same way.
 */
export class LoadWarningsError extends Error {
  readonly warnings: LoadWarning[]
  constructor(warnings: LoadWarning[]) {
    super(warnings.map((warning) => warning.kind).join(', '))
    this.name = 'LoadWarningsError'
    this.warnings = warnings
  }
}

export interface WarningInput {
  customerId: string
  customerName: string
  bolNumber: string | null
  poNumber: string | null
  /**
   * The broker's own load number. Optional because the create form has never
   * had a field for it — omitting it is how a caller says "not applicable",
   * which is different from a caller that has one and left it empty.
   */
  referenceNumber?: string | null
  pickupAt: Date | null
  deliveryAt: Date | null
  pickup: { city: string | null; state: string | null }
  delivery: { city: string | null; state: string | null }
  /** Null for a role that may not enter one — §1.3 keeps money out entirely. */
  linehaulCents: number | null
}

/**
 * Everything worth saying before this load is booked.
 *
 * EVERY WARNING AT ONCE, not the first. A dispatcher who fixes one problem and
 * is then told about the next has been made to type twice, which is what §10
 * exists to prevent — the same ruling the dispatch conflicts already follow.
 */
export async function loadWarnings(
  tx: TxClient,
  input: WarningInput,
): Promise<LoadWarning[]> {
  const warnings: LoadWarning[] = []

  // --- what the office already has ------------------------------------------
  const named = (load: {
    loadNumber: string
    bookedAt: Date
    customer: { name: string }
  }) => ({
    load: load.loadNumber,
    customer: load.customer.name,
    date: renderDateOnly(load.bookedAt) ?? '',
  })

  if (input.bolNumber) {
    const existing = await findByNumber(tx, 'bolNumber', input.bolNumber)
    if (existing) {
      warnings.push({
        kind: 'duplicate_bol',
        messageKey: 'loads.warn.duplicateBol',
        values: { bol: input.bolNumber, ...named(existing) },
      })
    }
  }

  if (input.poNumber) {
    const existing = await findByNumber(tx, 'poNumber', input.poNumber)
    if (existing) {
      warnings.push({
        kind: 'duplicate_po',
        messageKey: 'loads.warn.duplicatePo',
        values: { po: input.poNumber, ...named(existing) },
      })
    }
  }

  if (input.referenceNumber) {
    const existing = await findByNumber(
      tx,
      'referenceNumber',
      input.referenceNumber,
    )
    if (existing) {
      warnings.push({
        kind: 'duplicate_reference',
        messageKey: 'loads.warn.duplicateReference',
        values: { reference: input.referenceNumber, ...named(existing) },
      })
    }
  }

  // --- the same freight, booked twice ---------------------------------------
  //
  // BROKER + DAY + LANE, which is the combination that is a mistake far more
  // often than it is a coincidence. Deliberately NOT the rate: two loads for
  // one broker down one lane on one day at different rates are still probably
  // one load booked twice, and a rate comparison would suppress the warning
  // exactly when the second booking has a typo in it.
  const duplicate = await probableDuplicate(tx, input)
  if (duplicate) {
    warnings.push({
      kind: 'duplicate_load',
      messageKey: 'loads.warn.duplicateLoad',
      values: {
        ...named(duplicate),
        lane: lane(input),
      },
    })
  }

  // --- what is missing ------------------------------------------------------
  //
  // Not enforced, because a load can be booked before its dates are known and
  // the freight still has to go on the board. Said out loud, because a load
  // with no pickup date is invisible on every screen that sorts by one.
  if (!input.pickupAt) {
    warnings.push({
      kind: 'missing_pickup_date',
      messageKey: 'loads.warn.missingPickupDate',
      values: {},
    })
  }
  if (!input.deliveryAt) {
    warnings.push({
      kind: 'missing_delivery_date',
      messageKey: 'loads.warn.missingDeliveryDate',
      values: {},
    })
  }

  // §1.3 — ONLY FOR A ROLE THAT HAS A RATE FIELD. A DISPATCHER's form carries
  // no money label at all, and "no rate" is a money label: it would tell them
  // the load has one and that it is empty. `null` is how the caller says this
  // role does not see money, which is different from a rate of zero.
  if (input.linehaulCents !== null && input.linehaulCents <= 0) {
    warnings.push({
      kind: 'missing_rate',
      messageKey: 'loads.warn.missingRate',
      values: {},
    })
  }

  return warnings
}

/** "Salem, OR → Sacramento, CA" — a lane, for a sentence. */
function lane(input: WarningInput): string {
  const place = (stop: { city: string | null; state: string | null }) =>
    [stop.city, stop.state].filter(Boolean).join(', ')
  return `${place(input.pickup)} → ${place(input.delivery)}`
}

const LOAD_SUMMARY = {
  loadNumber: true,
  bookedAt: true,
  customer: { select: { name: true } },
} as const

/**
 * Another load already carrying this number.
 *
 * Cancelled loads are excluded: a booking that was cancelled is not a conflict,
 * and warning about one would train the office to click through warnings — the
 * failure mode that makes every later warning worthless.
 */
async function findByNumber(
  tx: TxClient,
  field: 'bolNumber' | 'poNumber' | 'referenceNumber',
  value: string,
) {
  return tx.load.findFirst({
    where: {
      [field]: { equals: value, mode: 'insensitive' },
      isCancelled: false,
      deletedAt: null,
    },
    select: LOAD_SUMMARY,
    orderBy: { bookedAt: 'desc' },
  })
}

/** Same broker, same pickup day, same lane. */
async function probableDuplicate(tx: TxClient, input: WarningInput) {
  if (!input.pickupAt) return null
  const city = input.pickup.city
  const dropCity = input.delivery.city
  if (!city || !dropCity) return null

  // The whole day the pickup falls in, in UTC — which is the zone the stop's
  // midnight was already converted into by `zoneMidnight`, so comparing here
  // does not re-apply a timezone to a value that has one.
  const dayStart = new Date(
    Date.UTC(
      input.pickupAt.getUTCFullYear(),
      input.pickupAt.getUTCMonth(),
      input.pickupAt.getUTCDate(),
    ),
  )
  const dayEnd = new Date(dayStart.getTime() + 24 * 60 * 60 * 1000)

  return tx.load.findFirst({
    where: {
      customerId: input.customerId,
      isCancelled: false,
      deletedAt: null,
      stops: {
        some: {
          sequence: 1,
          city: { equals: city, mode: 'insensitive' },
          scheduledAt: { gte: dayStart, lt: dayEnd },
        },
      },
      AND: {
        stops: {
          some: {
            sequence: 2,
            city: { equals: dropCity, mode: 'insensitive' },
          },
        },
      },
    },
    select: LOAD_SUMMARY,
    orderBy: { bookedAt: 'desc' },
  })
}

/**
 * What the dispatcher was shown, as one string.
 *
 * Posted back with the confirmation and recomputed on arrival: a confirmation
 * only lets THESE warnings through. Change the BOL after being warned about it
 * and the set changes, the signature does not match, and the new warning is
 * shown rather than silently carried past by a tick from a moment ago.
 *
 * Not a security token. It is a "you saw exactly this" marker, and it is the
 * difference between a confirm gate and a confirm formality.
 */
export function warningSignature(warnings: readonly LoadWarning[]): string {
  return warnings
    .map(
      (warning) =>
        `${warning.kind}:${Object.entries(warning.values)
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([key, value]) => `${key}=${value}`)
          .join(',')}`,
    )
    .sort()
    .join('|')
}
