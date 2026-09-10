import { MoneyFormatError, parseMoneyToCents } from '../money'
import { resolveState } from './states'
import type {
  EquipmentType,
  LoadBillingStatus,
  LoadOperationalStatus,
} from '@/generated/prisma/client'

// ---------------------------------------------------------------------------
// A YEAR OF DATATRUCK FREIGHT, AS ROWS THIS SCHEMA CAN HOLD.
//
// The rules live here rather than in the seed script because they are rules:
// what a status means, how a location string decomposes, which money column is
// revenue, when a row must be refused. All of it is testable without a
// database, and all of it has a failure mode that looks like success — a load
// filed under the wrong authority, a rate off by a cent, a stop with no state.
//
// ── WHAT THE EXPORT CANNOT SAY, STATED ONCE ──────────────────────────────
//
// ONE PICKUP AND ONE DELIVERY. The file has exactly two location columns and a
// `Stops count` that disagrees with them on 3,697 rows (25.6%), hiding 4,747
// intermediate stops it never names. So the chain is first pickup and last
// delivery, the declared count is recorded beside it, and the gap is visible
// rather than invented.
//
// NO DRIVER PAY. `Driver gross` is not the driver's cut — it equals `Total
// pay` on 14,372 of 14,451 rows and totals MORE than `Load pay`, which no
// percentage can do. It is the load's gross under another name, and storing it
// as driver pay would put a year of invented wages into a settlement table.
// ---------------------------------------------------------------------------

/**
 * A decimal string from the export as integer cents, rounded HALF UP.
 *
 * ── WHY NOT `parseMoneyToCents` ALONE ────────────────────────────────────
 *
 * That function TRUNCATES the third decimal, deliberately: for an amount a
 * dispatcher typed, a third decimal is a typo and inventing a cent from it
 * would be the money module deciding something the person did not.
 *
 * These are not typed amounts. 854 of them are IEEE-754 artefacts of
 * Datatruck's own arithmetic — `597.5599999999999`, `844.3200000000001` — and
 * the true value is plainly 597.56 and 844.32. Truncating would lose a cent on
 * each and the reconciliation against the export's own total would fail by
 * roughly eight dollars, correctly, having been broken here.
 *
 * SO THE ROUNDING IS DONE ON THE DIGITS, NOT IN FLOATING POINT. The string is
 * split into whole and fraction, the first two fraction digits are the cents,
 * and the third decides whether they carry. No `Number` multiplication, which
 * is the arithmetic that produced these values in the first place.
 */
export function datatruckCents(raw: string): number {
  const text = raw.trim()
  const match = /^(-?)(\d*)(?:\.(\d*))?$/.exec(text.replace(/[$\s,]/g, ''))
  if (!match) throw new MoneyFormatError(raw)

  const [, sign, whole = '', fraction = ''] = match
  if (fraction.length <= 2) return parseMoneyToCents(text)

  const cents = fraction.slice(0, 2).padEnd(2, '0')
  const carry = Number(fraction[2]) >= 5 ? 1 : 0
  const amount = Number.parseInt(`${whole || '0'}${cents}`, 10) + carry
  if (!Number.isSafeInteger(amount)) throw new MoneyFormatError(raw)
  return sign === '-' ? -amount : amount
}

/** `Sep 09, 2026` and `Sep 08, 2026, 18:13` — the export's only two shapes. */
const MONTHS: Readonly<Record<string, number>> = {
  Jan: 1,
  Feb: 2,
  Mar: 3,
  Apr: 4,
  May: 5,
  Jun: 6,
  Jul: 7,
  Aug: 8,
  Sep: 9,
  Oct: 10,
  Nov: 11,
  Dec: 12,
}

/**
 * A Datatruck timestamp as a UTC instant.
 *
 * NEVER `new Date(text)`. It parses, which is the problem: the result depends
 * on the running process's zone, so the same export seeded from Chicago and
 * from UTC files a load on two different days. The same rule `med-dates.ts`
 * and `parseLicenceExpiry` state, for the same reason.
 *
 * THE CLOCK IS TAKEN AS UTC AND THAT IS A STATED APPROXIMATION. The export
 * carries no zone, and the fleet runs across four of them; guessing a zone per
 * stop from its state would be inventing precision the file does not have. A
 * delivery appointment is therefore accurate to the day and to the hour AS
 * DATATRUCK PRINTED IT, which is what a historical record needs.
 */
export function parseDatatruckMoment(raw: string): Date | null {
  const match =
    /^([A-Z][a-z]{2}) (\d{1,2}), (\d{4})(?:,\s*(\d{1,2}):(\d{2}))?$/.exec(
      raw.trim(),
    )
  if (!match) return null
  const month = MONTHS[match[1]!]
  if (!month) return null
  return new Date(
    Date.UTC(
      Number(match[3]),
      month - 1,
      Number(match[2]),
      Number(match[4] ?? 0),
      Number(match[5] ?? 0),
    ),
  )
}

/**
 * The two axes, from the export's one `Load status` column.
 *
 * ── CLOSED IS A BILLING FACT, NOT AN OPERATIONAL ONE ─────────────────────
 *
 * `delivered`, `invoiced` and `paid` all describe freight that RAN and
 * finished; they differ only in how far the money got, and none of that money
 * moved through Zebra. So all three land on the same operational status and
 * the same `CLOSED_IN_DATATRUCK` billing status — see 20260909120000 for why a
 * computed status could not express it.
 *
 * THE LIVE ONES KEEP A COMPUTED BILLING STATUS. 88 rows are still moving, and
 * for those the ordinary rule owns the column: no POD means not ready, so
 * `UNINVOICED` is what `billingStatusFor` will agree with. Writing anything
 * else would make them drift the moment anything touched them.
 */
export interface StatusReading {
  operational: LoadOperationalStatus
  billing: LoadBillingStatus
  cancelled: boolean
  /** True when this row is finished history rather than freight in flight. */
  closed: boolean
}

export function readStatus(raw: string): StatusReading | null {
  switch (raw.trim().toLowerCase()) {
    case 'delivered':
    case 'invoiced':
    case 'paid':
      return {
        operational: 'DELIVERED',
        billing: 'CLOSED_IN_DATATRUCK',
        cancelled: false,
        closed: true,
      }
    case 'canceled':
      // A cancelled load is closed too — nothing will ever be billed for it —
      // and `isCancelled` is the field that says why it stopped.
      return {
        operational: 'BOOKED',
        billing: 'CLOSED_IN_DATATRUCK',
        cancelled: true,
        closed: true,
      }
    case 'in_transit':
      return {
        operational: 'IN_TRANSIT',
        billing: 'UNINVOICED',
        cancelled: false,
        closed: false,
      }
    case 'dispatched':
      return {
        operational: 'DISPATCHED',
        billing: 'UNINVOICED',
        cancelled: false,
        closed: false,
      }
    // `assigned` HAS NO COUNTERPART AND IS NOT INVENTED ONE. Zebra's axis goes
    // BOOKED -> DISPATCHED; Datatruck's "assigned" means a driver is attached
    // and the load has not left, which is what BOOKED means here.
    case 'assigned':
    case 'booked':
      return {
        operational: 'BOOKED',
        billing: 'UNINVOICED',
        cancelled: false,
        closed: false,
      }
    case 'offer':
      return {
        operational: 'AVAILABLE',
        billing: 'UNINVOICED',
        cancelled: false,
        closed: false,
      }
    default:
      return null
  }
}

/**
 * THE DAY THIS FLEET'S RECORDED HISTORY STARTS.
 *
 * Datatruck ran the freight before this; Zebra owns it after. Two rules turn
 * on the same day and they have to be the same day or they fight:
 *
 *   Every `DriverPayRule` this system seeds begins here, so no settlement can
 *   reach back past a rule and find nothing.
 *
 *   An open Datatruck row that picked up before here is ABANDONED, not live —
 *   see `closeIfStale` below — so the importer stops creating the freight the
 *   first rule would refuse.
 *
 * `seed-datatruck-drivers.ts` asserts its own `EFFECTIVE_FROM` against this
 * rather than importing it, because the pay date is a stated fact that belongs
 * where somebody ruled on it. The assertion is what makes a drift between the
 * two impossible: were the importer's cutover to move on its own, it would go
 * on creating loads the seed's guard refuses, and each would look correct.
 */
export const DATATRUCK_CUTOVER = new Date('2026-08-01T00:00:00.000Z')

/**
 * An open row too old to be live is finished history, whatever it still says.
 *
 * ── THE MEASUREMENT THAT FORCED THIS, 2026-09-10 ─────────────────────────
 *
 * Production carried 54 imported loads sitting in BOOKED, DISPATCHED or
 * IN_TRANSIT with pickups going back to 2024-12-01. The 2026-09-08 export
 * still calls all 54 `booked`, `dispatched`, `assigned` or `in_transit` —
 * NONE of them delivered — so the forward-only sync will never advance them
 * and they would have sat open forever.
 *
 * They are not harmless. A load that is not closed is a load this system may
 * be asked to settle, so all 54 counted against the drivers seed's date guard
 * and blocked it — and clearing them by hand without this rule would simply
 * mean finding sixty more after the next export.
 *
 * ── CLOSED, NOT CANCELLED, AND THE DIFFERENCE IS THE WHOLE POINT ─────────
 *
 * The owner's ruling: `CLOSED_IN_DATATRUCK`, because "not ours to settle" is
 * what is actually true and it already has a rule and a test behind it.
 * Cancelling would assert the freight did not happen, which is a claim about
 * the world rather than about this system's responsibility — and several of
 * these carry a driver, a truck and real revenue.
 *
 * SO THE OPERATIONAL STATUS IS LEFT EXACTLY AS READ. A load that was
 * DISPATCHED and never delivered stays DISPATCHED; that is the honest record
 * of what happened to it. Only the billing axis moves, and only in the
 * direction that says nobody here will be paid for it.
 *
 * A ROW WITH NO PICKUP DATE IS LEFT ALONE. This cannot judge the age of
 * something undated, and guessing would close live freight over a blank cell.
 */
export function closeIfStale(
  reading: StatusReading,
  pickupAt: Date | null,
  cutover: Date = DATATRUCK_CUTOVER,
): StatusReading {
  if (reading.closed) return reading
  if (!pickupAt || Number.isNaN(pickupAt.getTime())) return reading
  if (pickupAt.getTime() >= cutover.getTime()) return reading

  return {
    ...reading,
    billing: 'CLOSED_IN_DATATRUCK',
    closed: true,
  }
}

/** `dry_van` and `power_only` are the only two the export carries. */
export function readEquipment(raw: string): EquipmentType | null {
  switch (raw.trim().toLowerCase()) {
    case 'dry_van':
      return 'DRY_VAN'
    case 'power_only':
      return 'POWER_ONLY'
    case '':
      // 266 rows say nothing. Null rather than DRY_VAN: the schema default
      // applies on write, and a row that never stated its equipment is
      // distinguishable in the report from one that did.
      return null
    default:
      return null
  }
}

export interface PlannedStopPlace {
  city: string | null
  state: string | null
  postalCode: string | null
  addressLine1: string | null
  name: string | null
}

/**
 * `Oklahoma City, OK, 73179`, `Tallahassee, , 32303`, or a street address.
 *
 * THE STATE IS RECOVERED FROM THE OTHER COLUMN WHERE THE STRING OMITS IT. On
 * 2,178 pickups and 2,030 deliveries the location reads `City, , ZIP` and the
 * separate `Pickup state` / `Delivery state` column carries the name in full —
 * `Oklahoma`, not `OK` — on every single one of them. Nothing is lost, which
 * is why this takes both and why `resolveState` exists: `stateCode` truncates
 * `TEXAS` to `TE`.
 */
/**
 * A two-letter code, or null.
 *
 * `resolveState` answers with a RESULT rather than a string — it distinguishes
 * "not stated" from "stated and unrecognised", which the driver seed needs. A
 * stop needs neither distinction: both mean there is no state to file, and the
 * caller has a second column to fall back to.
 */
function stateCodeOf(raw: string): string | null {
  const outcome = resolveState(raw)
  return outcome.ok ? outcome.code : null
}

export function readPlace(
  location: string,
  stateColumn: string,
  company: string,
): PlannedStopPlace {
  const text = location.trim()
  const parts = text.split(',').map((part) => part.trim())
  const stateFromColumn = stateCodeOf(stateColumn)

  // ── THE SEVEN SHAPES THE CORPUS ACTUALLY CONTAINS ──────────────────────
  //
  // Measured by `profile-datatruck-loads.ts` over all 14,451 rows, most
  // frequent first, so the cascade below is ordered by what is really there
  // rather than by what a format ought to look like:
  //
  //   City, ST, ZIP                      11,721 pickups / 11,919 deliveries
  //   City, , ZIP     (no state)          2,178 / 2,030
  //   City, ST,       (empty tail)          part of 372 / 366
  //   12200 Telegraph Rd, Redford, MI 48239   113 / 28
  //   City, ST                                1 / 1
  //   HHO9            (a facility code)       seen once
  //   (blank)                                66 / 107
  //
  // NOTHING IS GUESSED FROM A ZIP. Deriving a city or a state from the postal
  // code would be inventing a value the row does not carry, and the state
  // column already answers it on every row where the string does not.
  let city: string | null = null
  let state: string | null = null
  let postalCode: string | null = null
  let addressLine1: string | null = null
  let facilityCode: string | null = null

  const last = parts.at(-1) ?? ''
  const trailing = /^([A-Z]{2})\s+(\d{5})$/.exec(last)

  if (trailing) {
    // `… , Redford, MI 48239` — a street address, where the final part holds
    // the state and the zip together and the city is the one before it.
    addressLine1 = parts.slice(0, -2).join(', ') || null
    city = parts.at(-2) || null
    state = trailing[1] ?? null
    postalCode = trailing[2] ?? null
  } else if (/^\d{5}$/.test(last) && parts.length >= 3) {
    // `City, ST, ZIP` and `City, , ZIP`. The middle is the state when it says
    // anything; when it is empty the column carries it, on all 4,208 such rows.
    city = parts[0] || null
    state = stateCodeOf(parts[1] ?? '') ?? stateFromColumn
    postalCode = last
  } else if (parts.length >= 2) {
    // `City, ST` and `City, ST,` — the trailing comma leaves an empty tail.
    city = parts[0] || null
    state = stateCodeOf(parts[1] ?? '') ?? stateFromColumn
  } else if (text !== '') {
    // `HHO9`. A facility code, kept AS a facility code rather than filed as a
    // city nobody can find — the same refusal to guess the rest of this module
    // makes about everything else.
    facilityCode = text
    state = stateFromColumn
  } else {
    state = stateFromColumn
  }

  return {
    city,
    state: state ?? stateFromColumn,
    postalCode,
    addressLine1,
    // The stop's name is the facility the export named; where it named none
    // and the location was a bare code, that code is the best name there is.
    name: company.trim() || facilityCode,
  }
}

export interface PlannedLoad {
  /** `Shipment ID` — the import key, and the load number. */
  externalId: string
  /** `Load ID` — the customer's own text, and the bridge to a live Zebra load. */
  referenceNumber: string | null
  /** `Trip ID` — answerable, not searchable. */
  tripId: string | null
  authority: string
  customerName: string
  driverName: string | null
  truckUnit: string | null

  operational: LoadOperationalStatus
  billing: LoadBillingStatus
  cancelled: boolean
  closed: boolean
  equipment: EquipmentType | null

  linehaulCents: number
  accessorialCents: number
  totalRevenueCents: number

  declaredStops: number | null
  pickup: PlannedStopPlace
  pickupAt: Date | null
  delivery: PlannedStopPlace
  deliveryAt: Date | null

  dispatchedMiles: number | null
  actualMiles: number | null
  emptyMiles: number | null

  bookedAt: Date
  corrections: string[]
}

export interface HeldLoad {
  externalId: string
  reason: string
}

export interface LoadPlan {
  planned: PlannedLoad[]
  held: HeldLoad[]
  read: number
}

/** The authority a row files under, by the exact text of its `MC Number`. */
const AUTHORITY_BY_MC: Readonly<Record<string, string>> = {
  'RAM Haulage LLC': 'RAM Haulage',
  'Dolphin Transport inc': 'Dolphins Transport',
  'Midwest Global Logistics LLC': 'Midwest Global Logistics LLC',
  'American Soldier Transport LLC': 'American Soldier Transport LLC',
  'AG FREIGHT INC': 'AG FREIGHT INC',
}

const wholeMiles = (raw: string): number | null => {
  const value = Number(raw.trim())
  return Number.isFinite(value) && value > 0 ? Math.round(value) : null
}

export function planLoads(
  records: readonly Record<string, string>[],
): LoadPlan {
  const planned: PlannedLoad[] = []
  const held: HeldLoad[] = []
  const seen = new Set<string>()

  const text = (record: Record<string, string>, key: string) =>
    (record[key] ?? '').trim()

  for (const record of records) {
    const externalId = text(record, 'Shipment ID')
    if (externalId === '') {
      held.push({
        externalId: '(blank)',
        reason: 'no Shipment ID, which is the import key',
      })
      continue
    }
    if (seen.has(externalId)) {
      held.push({
        externalId,
        reason: 'Shipment ID appears twice in this export',
      })
      continue
    }
    seen.add(externalId)

    const authority = AUTHORITY_BY_MC[text(record, 'MC Number')]
    if (!authority) {
      held.push({
        externalId,
        reason: `authority ${JSON.stringify(text(record, 'MC Number'))} is not one this system operates under`,
      })
      continue
    }

    const customerName = text(record, 'Customer')
    if (customerName === '') {
      // `Load.customerId` is NOT NULL. A load with no counterparty has nobody
      // to bill and no row shape to be written as.
      held.push({ externalId, reason: 'no customer named' })
      continue
    }

    const read = readStatus(text(record, 'Load status'))
    if (!read) {
      held.push({
        externalId,
        reason: `load status ${JSON.stringify(text(record, 'Load status'))} has no counterpart on either Zebra axis`,
      })
      continue
    }

    // THE PICKUP DATE IS READ BEFORE THE STATUS IS SETTLED, because an open
    // row older than the cutover is finished history whatever it still says.
    // See `closeIfStale` for the 54 production loads that forced it.
    const pickupAt = parseDatatruckMoment(text(record, 'PU date'))
    const status = closeIfStale(read, pickupAt)

    const corrections: string[] = []

    let linehaulCents: number
    let accessorialCents: number
    try {
      linehaulCents = datatruckCents(text(record, 'Load pay'))
      accessorialCents = datatruckCents(text(record, 'Total other pay'))
    } catch {
      held.push({
        externalId,
        reason: `money will not read: pay ${JSON.stringify(text(record, 'Load pay'))}, other ${JSON.stringify(text(record, 'Total other pay'))}`,
      })
      continue
    }

    // THE EXPORT'S OWN ARITHMETIC IS CHECKED, NOT TRUSTED. It held on all
    // 14,451 rows when measured; a row where it stops holding is a row whose
    // money nobody should assume, so it is named rather than silently summed.
    let stated: number | null = null
    try {
      stated = datatruckCents(text(record, 'Total pay'))
    } catch {
      stated = null
    }
    if (stated !== null && stated !== linehaulCents + accessorialCents) {
      held.push({
        externalId,
        reason: `Load pay + Total other pay is ${linehaulCents + accessorialCents} and Total pay says ${stated}`,
      })
      continue
    }

    const equipment = readEquipment(text(record, 'Equipment types'))
    if (equipment === null && text(record, 'Equipment types') !== '') {
      corrections.push(
        `equipment ${JSON.stringify(text(record, 'Equipment types'))} is not one this system knows; left at the default`,
      )
    }

    const bookedAt =
      parseDatatruckMoment(text(record, 'Created date')) ??
      parseDatatruckMoment(text(record, 'PU date'))
    if (!bookedAt) {
      held.push({
        externalId,
        reason: `neither Created date nor PU date will read (${JSON.stringify(text(record, 'Created date'))})`,
      })
      continue
    }

    const declared = Number(text(record, 'Stops count'))
    const declaredStops = Number.isFinite(declared) ? declared : null
    if (declaredStops !== null && declaredStops > 2) {
      corrections.push(
        `${declaredStops} stops declared, ${declaredStops - 2} of them not in the export`,
      )
    }

    planned.push({
      externalId,
      // NULLABLE AND NOT A CONSTRAINT. `Load ID` repeats and is sometimes
      // blank; it is the bridge to a live Zebra load and never a key.
      referenceNumber: text(record, 'Load ID') || null,
      tripId: text(record, 'Trip ID') || null,
      authority,
      customerName,
      driverName: text(record, 'Driver/Carrier') || null,
      truckUnit: text(record, 'Truck') || null,
      operational: status.operational,
      billing: status.billing,
      cancelled: status.cancelled,
      closed: status.closed,
      equipment,
      linehaulCents,
      accessorialCents,
      totalRevenueCents: linehaulCents + accessorialCents,
      declaredStops,
      pickup: readPlace(
        text(record, 'Pickup location'),
        text(record, 'Pickup state'),
        text(record, 'Pickup company'),
      ),
      pickupAt,
      delivery: readPlace(
        text(record, 'Delivery location'),
        text(record, 'Delivery state'),
        text(record, 'Delivery company'),
      ),
      deliveryAt:
        parseDatatruckMoment(text(record, 'Delivery Appointment Time')) ??
        parseDatatruckMoment(text(record, 'DEL date')),
      dispatchedMiles: wholeMiles(text(record, 'Total miles')),
      actualMiles: wholeMiles(text(record, 'Mile')),
      emptyMiles: wholeMiles(text(record, 'Empty mile')),
      bookedAt,
      corrections,
    })
  }

  return { planned, held, read: records.length }
}

// ---------------------------------------------------------------------------
// THE RECURRING SYNC.
//
// Dispatchers stay on Datatruck until Zebra is finished, so this import is not
// a one-off: the same export arrives again with the same `Shipment ID`s and
// some of them have moved on. A load booked last week is delivered this week,
// and the row that carried it must follow.
//
// ── FORWARD ONLY, AND THE ASYMMETRY IS THE WHOLE RULE ────────────────────
//
// A later export may ADVANCE a load and may CLOSE it. It may never walk one
// backwards. Two reasons, and the second is the one that matters:
//
//   A BACKWARD MOVE IS ALMOST ALWAYS THE EXPORT BEING STALE — somebody
//   re-running last Tuesday's file — and a sync that obeyed it would undeliver
//   freight that has arrived.
//
//   AND ZEBRA MAY HAVE MOVED IT. Once a dispatcher touches a load here, this
//   system knows something the export does not. Advancing is additive: it can
//   only agree with a change Datatruck saw first. Reversing overwrites a fact
//   somebody in this building established.
//
// ── ONLY FOR ROWS THIS IMPORT CREATED, AND ONLY WHILE THEY ARE OPEN ──────
//
// A load with no `externalId` was booked in Zebra and is none of the sync's
// business — those stay add-missing, as they were. A load already
// CLOSED_IN_DATATRUCK is finished history; nothing in a later export can
// reopen it, because "closed" is the one state this system will not let an
// import take back.
// ---------------------------------------------------------------------------

/**
 * The operational axis, in the order freight actually moves.
 *
 * Taken from the enum's own declaration order, which is already the
 * progression — booked, dispatched, at the shipper, loaded, rolling, at the
 * consignee, delivered, paperwork in.
 */
const OPERATIONAL_RANK: Readonly<Record<LoadOperationalStatus, number>> = {
  AVAILABLE: 0,
  BOOKED: 1,
  DISPATCHED: 2,
  AT_PICKUP: 3,
  LOADED: 4,
  IN_TRANSIT: 5,
  AT_DELIVERY: 6,
  DELIVERED: 7,
  POD_RECEIVED: 8,
}

/**
 * The billing axis, ranked — with the three DECIDED states left out.
 *
 * DISPUTED, WRITTEN_OFF and CLOSED_IN_DATATRUCK are not points on a line; they
 * are decisions somebody made, and `billingStatusFor` does not own them. A
 * sync must never move a load OFF one of them, so they have no rank and the
 * comparison below refuses rather than guessing where they sit.
 *
 * In practice the planner only ever produces UNINVOICED for a live row and
 * CLOSED_IN_DATATRUCK for a finished one, so the ladder is short by
 * construction. It is written out in full anyway: the day this system starts
 * invoicing imported freight, the ranks are what stop a stale export
 * un-invoicing it.
 */
const BILLING_RANK: Readonly<Partial<Record<LoadBillingStatus, number>>> = {
  UNINVOICED: 0,
  READY_TO_INVOICE: 1,
  INVOICED: 2,
  PARTIALLY_PAID: 3,
  PAID: 4,
}

export interface SyncDecision {
  operational: LoadOperationalStatus | null
  billing: LoadBillingStatus | null
  /** Why, in words, for the report. Empty when nothing moves. */
  notes: string[]
}

/**
 * What a fresh export may change about a load this import already created.
 *
 * Returns nulls for "leave it alone". The caller writes only the fields that
 * come back non-null, so a row that has not moved costs no update.
 */
export function syncDecisionFor(
  current: { operational: LoadOperationalStatus; billing: LoadBillingStatus },
  incoming: { operational: LoadOperationalStatus; billing: LoadBillingStatus },
): SyncDecision {
  const notes: string[] = []

  // CLOSED IS FINAL. Checked first, so no later clause can reopen it.
  if (current.billing === 'CLOSED_IN_DATATRUCK') {
    return { operational: null, billing: null, notes: [] }
  }

  let operational: LoadOperationalStatus | null = null
  if (
    OPERATIONAL_RANK[incoming.operational] >
    OPERATIONAL_RANK[current.operational]
  ) {
    operational = incoming.operational
    notes.push(`${current.operational} -> ${incoming.operational}`)
  } else if (incoming.operational !== current.operational) {
    notes.push(
      `held: export says ${incoming.operational}, which is behind ${current.operational}`,
    )
  }

  let billing: LoadBillingStatus | null = null
  if (incoming.billing === 'CLOSED_IN_DATATRUCK') {
    // CLOSING IS ALWAYS ALLOWED, whatever the ranks say. It is the export
    // telling us the freight finished its life over there, which is the one
    // thing this system cannot learn on its own while dispatch runs elsewhere.
    billing = 'CLOSED_IN_DATATRUCK'
    notes.push(`${current.billing} -> CLOSED_IN_DATATRUCK`)
  } else {
    const from = BILLING_RANK[current.billing]
    const to = BILLING_RANK[incoming.billing]
    if (from === undefined || to === undefined) {
      // One of them is a DECIDED state with no rank. Refused rather than
      // ordered — a dispute is not a point on this ladder.
      if (incoming.billing !== current.billing) {
        notes.push(
          `held: ${current.billing} and ${incoming.billing} are not comparable`,
        )
      }
    } else if (to > from) {
      billing = incoming.billing
      notes.push(`${current.billing} -> ${incoming.billing}`)
    } else if (to < from) {
      notes.push(
        `held: export says ${incoming.billing}, which is behind ${current.billing}`,
      )
    }
  }

  return { operational, billing, notes }
}

/**
 * Whether a fresh export may restate an imported load's money.
 *
 * ── DATATRUCK IS THE SOURCE OF TRUTH UNTIL IT IS NOT ─────────────────────
 *
 * While dispatchers work over there, a live load's rate is theirs to change
 * and Zebra should follow. The moment Zebra has money of its own against the
 * load, that stops: a settlement line means a driver has been paid on this
 * figure and a payment application means a customer's money has been matched
 * to it. Changing the rate underneath either would silently make a settled
 * cheque or a reconciled payment disagree with the load it settled.
 *
 * SO THE GATE IS "HAS ZEBRA TOUCHED THE MONEY", NOT "IS IT OLD". Age is not
 * the risk; commitment is. A load from January with nothing against it is
 * safe to restate, and one from this morning that has already been settled is
 * not.
 *
 * CLOSED IS FROZEN TOO, for the same reason `syncDecisionFor` refuses it: the
 * freight finished its life in the other system and this one will not take it
 * back.
 */
export type RateFreeze =
  | { frozen: false }
  | { frozen: true; why: 'closed' | 'settled' | 'paid' }

export function rateFreezeFor(load: {
  billing: LoadBillingStatus
  settlementLines: number
  paymentApplications: number
}): RateFreeze {
  if (load.billing === 'CLOSED_IN_DATATRUCK')
    return { frozen: true, why: 'closed' }
  if (load.settlementLines > 0) return { frozen: true, why: 'settled' }
  if (load.paymentApplications > 0) return { frozen: true, why: 'paid' }
  return { frozen: false }
}

export interface RateChange {
  linehaulCents: number
  accessorialCents: number
  totalRevenueCents: number
  /** The sentence the BILLING event carries, old and new, in money. */
  note: string
}

/**
 * What changed about the money, or null when nothing did.
 *
 * THE WHOLE PICTURE MOVES TOGETHER. `Load.accessorialsCents` is documented as
 * the sum of its billable `LoadAccessorial` rows, so restating the linehaul
 * without the accessorial would leave the two disagreeing — and the
 * reconciliation this import is measured by sums all three.
 */
export function rateChangeFor(
  current: { linehaulCents: number; accessorialCents: number },
  incoming: { linehaulCents: number; accessorialCents: number },
): RateChange | null {
  if (
    current.linehaulCents === incoming.linehaulCents &&
    current.accessorialCents === incoming.accessorialCents
  ) {
    return null
  }
  const money = (cents: number) => `$${(cents / 100).toFixed(2)}`
  return {
    linehaulCents: incoming.linehaulCents,
    accessorialCents: incoming.accessorialCents,
    totalRevenueCents: incoming.linehaulCents + incoming.accessorialCents,
    // OLD AND NEW, BOTH, IN THE EVENT. "The rate changed" is not an audit
    // answer; a dispute turns on what it changed FROM.
    note:
      `Datatruck export restated the rate: linehaul ${money(current.linehaulCents)} -> ` +
      `${money(incoming.linehaulCents)}, accessorial ${money(current.accessorialCents)} -> ${money(incoming.accessorialCents)}.`,
  }
}
