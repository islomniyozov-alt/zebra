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
/**
 * Datatruck's `Tags` column, as a list.
 *
 * Comma-separated in every row that has one. Trimmed, empties dropped, and
 * duplicates collapsed — a tag written twice on one row is one tag.
 */
export function tagsFrom(value: string | null | undefined): string[] {
  if (!value) return []
  return [
    ...new Set(
      value
        .split(',')
        .map((tag) => tag.trim())
        .filter((tag) => tag !== ''),
    ),
  ]
}

export interface StatusReading {
  operational: LoadOperationalStatus
  billing: LoadBillingStatus
  cancelled: boolean
  /** True when this row is finished history rather than freight in flight. */
  closed: boolean
  /**
   * ZEBRA'S BOOKS OWN THIS LOAD.
   *
   * True only for a finished row whose delivery date is on or after
   * `BOOKS_CUTOVER`. It is the ONE thing that may reopen a load closed by the
   * old rule, and it is a field of its own rather than `closed === false`
   * because those are different claims: an OPEN row is also not closed, and
   * an open row must not reopen finished history. Deriving one from the
   * other would have widened the narrowing to every export row.
   *
   * `closeIfStale` respects it too. Otherwise a load delivered after the
   * cutover but picked up before `DATATRUCK_CUTOVER` would be closed as
   * stale, which is guard (b) — post-cutover never closed — failing by a
   * different door.
   */
  booksOwn: boolean
}

/**
 * A Datatruck status word on both of Zebra's axes.
 *
 * TAKES THE DELIVERY DATE, because `BOOKS_CUTOVER` splits the finished rows
 * on it. Required rather than optional: an optional date would default the
 * whole fleet to one side of the cutover and the omission would look like a
 * reading rather than a mistake.
 */
export function readStatus(
  raw: string,
  deliveryAt: Date | null,
): StatusReading | null {
  switch (raw.trim().toLowerCase()) {
    case 'delivered':
    case 'invoiced':
    case 'paid': {
      // ── THE BOOKS CUTOVER ───────────────────────────────────────────
      //
      // AN UNDATED FINISHED ROW IS HISTORY. Not a guess in the other
      // direction: `importEventAt` refuses to stamp a POD without a date,
      // so calling such a row live would produce a live load that can
      // never settle and never says why. Closed is what the data supports.
      const live =
        deliveryAt !== null && deliveryAt.getTime() >= BOOKS_CUTOVER.getTime()

      return live
        ? {
            // POD_RECEIVED, not DELIVERED: `settleableWhere` selects on
            // that status AND an event of it, and the ruling says the POD
            // event is stamped at delivery.
            operational: 'POD_RECEIVED',
            billing: 'UNINVOICED',
            cancelled: false,
            closed: false,
            booksOwn: true,
          }
        : {
            operational: 'DELIVERED',
            billing: 'CLOSED_IN_DATATRUCK',
            cancelled: false,
            closed: true,
            booksOwn: false,
          }
    }
    case 'canceled':
      // A cancelled load is closed too — nothing will ever be billed for it —
      // and `isCancelled` is the field that says why it stopped.
      return {
        operational: 'BOOKED',
        billing: 'CLOSED_IN_DATATRUCK',
        cancelled: true,
        closed: true,
        booksOwn: false,
      }
    case 'in_transit':
      return {
        operational: 'IN_TRANSIT',
        billing: 'UNINVOICED',
        cancelled: false,
        closed: false,
        booksOwn: false,
      }
    case 'dispatched':
      return {
        operational: 'DISPATCHED',
        billing: 'UNINVOICED',
        cancelled: false,
        closed: false,
        booksOwn: false,
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
        booksOwn: false,
      }
    case 'offer':
      return {
        operational: 'AVAILABLE',
        billing: 'UNINVOICED',
        cancelled: false,
        closed: false,
        booksOwn: false,
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
 * WHEN ZEBRA STARTED KEEPING THE BOOKS.
 *
 * Owner's ruling, 2026-09-24. `DATATRUCK_CUTOVER` above answers a different
 * question — how old an OPEN row has to be before it is really finished
 * history — and the two are deliberately separate dates for separate rules.
 *
 * ── WHAT THIS CHANGES ───────────────────────────────────────────────────
 *
 * Until this constant existed, `readStatus` mapped every finished Datatruck
 * row — delivered, invoiced, paid — to CLOSED_IN_DATATRUCK, and
 * `SETTLEABLE_LOAD` excludes that outright. That was right: the import was a
 * HISTORY import, and its founding ruling was "no historical driver pay, no
 * historical settlements". 14,345 of production's 14,346 eventless finished
 * loads are that freight.
 *
 * It is wrong from the first week Zebra settles. Freight delivered on or
 * after this date is Zebra's to invoice and to pay a driver for, so it
 * arrives LIVE and carries its POD event at the delivery date.
 *
 * THE SPLIT IS ON THE DELIVERY DATE, not the pickup and not the import.
 * Which week a load belongs to is decided by when it finished, and that is
 * the same date the POD event carries — one date, two uses, no way for them
 * to disagree.
 */
export const BOOKS_CUTOVER = new Date('2026-09-13T00:00:00.000Z')

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
  // GUARD (b), HELD HERE TOO. A row delivered on or after `BOOKS_CUTOVER`
  // is Zebra's whatever its pickup date says — otherwise freight picked up
  // in July and delivered in the settled week would be closed as stale, and
  // "post-cutover never closed" would fail by a different door.
  if (reading.booksOwn) return reading
  if (!pickupAt || Number.isNaN(pickupAt.getTime())) return reading
  if (pickupAt.getTime() >= cutover.getTime()) return reading

  return {
    ...reading,
    billing: 'CLOSED_IN_DATATRUCK',
    closed: true,
    booksOwn: false,
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
  /** `Co-Driver`, verbatim. Often a carrier name rather than a person. */
  coDriverName: string | null
  /** `Tags`, split on commas. Empty when the column is blank or absent. */
  tags: string[]
  truckUnit: string | null

  operational: LoadOperationalStatus
  billing: LoadBillingStatus
  cancelled: boolean
  closed: boolean
  /** Zebra owns it: finished, delivered on or after `BOOKS_CUTOVER`. */
  booksOwn: boolean
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

    // THE DELIVERY DATE IS READ BEFORE THE STATUS, because `BOOKS_CUTOVER`
    // splits the finished rows on it. Read once here and carried into the
    // planned load below, so the date that decides the side of the cutover
    // and the date the POD event carries are the same value.
    const deliveryAt =
      parseDatatruckMoment(text(record, 'Delivery Appointment Time')) ??
      parseDatatruckMoment(text(record, 'DEL date'))

    const read = readStatus(text(record, 'Load status'), deliveryAt)
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
      // THE SECOND SEAT. 1,136 of the 14,451 exported rows carry one, and
      // many of them name a CARRIER rather than a person — '7 Star',
      // 'Said truck 3609' — which is why it is resolved the same forgiving
      // way as the primary and left null when it does not land on one driver.
      coDriverName: text(record, 'Co-Driver') || null,
      // FREE TEXT, SPLIT ON COMMAS AND TRIMMED. Datatruck writes the column
      // as a comma-separated list; anything else it writes stays one tag,
      // because guessing a second separator would silently split a tag that
      // legitimately contains one.
      tags: tagsFrom(text(record, 'Tags')),
      truckUnit: text(record, 'Truck') || null,
      operational: status.operational,
      billing: status.billing,
      cancelled: status.cancelled,
      closed: status.closed,
      booksOwn: status.booksOwn,
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
      deliveryAt,
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
  incoming: {
    operational: LoadOperationalStatus
    billing: LoadBillingStatus
    /**
     * Whether Zebra's books own this row — `StatusReading.booksOwn`.
     *
     * The ONLY thing that may reopen a closed load. Not `!closed`: an open
     * row is also not closed, and an open row must not reopen finished
     * history. The first version of this narrowing used `closed` and would
     * have reopened a closed load from any live export row.
     */
    booksOwn: boolean
  },
): SyncDecision {
  const notes: string[] = []

  // ── CLOSED IS FINAL, WITH ONE NARROWING ─────────────────────────────
  //
  // THIS USED TO BE ABSOLUTE, and the comment said so: "no later clause can
  // reopen it". The reason was good — the freight finished its life in the
  // other system and this one will not take it back.
  //
  // Owner's ruling of 2026-09-24 narrows it, and guard (c) of that ruling is
  // the reason: a re-run must reclassify idempotently. Production holds
  // loads closed by the PRE-CUTOVER rule — every finished row was closed,
  // because that is all the old `readStatus` could say — and some of those
  // may be delivered on or after `BOOKS_CUTOVER`. They were closed by a
  // rule that does not apply to their date, and a re-import has to be able
  // to correct that or the first settled week is missing freight nobody can
  // find.
  //
  // THE NARROWING IS EXACTLY AS WIDE AS THE RULING. Only the export saying
  // "this is not history" reopens a load, and that is only ever said for a
  // delivery date on or after the cutover. Everything before it is as final
  // as it ever was.
  if (current.billing === 'CLOSED_IN_DATATRUCK') {
    if (!incoming.booksOwn) {
      return { operational: null, billing: null, notes: [] }
    }

    return {
      operational: incoming.operational,
      billing: incoming.billing,
      notes: [
        `reopened: CLOSED_IN_DATATRUCK -> ${incoming.billing}, ` +
          `delivered on or after the books cutover`,
      ],
    }
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

/**
 * WHICH SEATS A RE-IMPORT MAY FILL ON A LOAD THAT ALREADY EXISTS.
 *
 * Owner's ruling, 2026-09-24, closing the gap MONEY-DESIGN §6 recorded as
 * "the import's enrichment path writes five fields and driver is not one of
 * them". It wrote six by then. Driver was still not one, so a load that
 * existed before its driver did kept a null `driverId` for ever — and
 * `settleableWhere` selects on `OR: [{ driverId }, { coDriverId: driverId }]`,
 * which makes such a load invisible to every settlement. The draft balances
 * and is short.
 *
 * ── THREE RULES, THE SAME THREE THE TRUCK FILL USES ─────────────────────
 *
 *   1. ONLY A NULL SEAT. A load that names somebody keeps them: that is
 *      either what the first import resolved or what a dispatcher has since
 *      corrected, and both are newer truths than this file.
 *   2. ONLY AN UNAMBIGUOUS NAME. Exactly one driver, or nobody — a guess
 *      here is a wage paid to the wrong person.
 *   3. NOBODY CREWS A LOAD TWICE. A database CHECK refuses it outright, so
 *      an export naming one person in both columns would fail the whole
 *      batch rather than one row.
 *
 * RULE 3 IS WHY THIS IS A FUNCTION AND NOT TWO IF-STATEMENTS. The second
 * seat must be compared against what the row WILL hold after this fill, not
 * against what it holds now: filling both seats from one export that names
 * the same person twice is the case a pair of independent checks lets
 * through, and no source grep would ever catch it.
 *
 * A name that does not resolve comes back NAMED rather than dropped. It is
 * the reason a load stays driverless, and a run that reported only what it
 * fixed would read as "done" while the freight was still missing.
 */
export interface CrewFill {
  driverId?: string
  coDriverId?: string
  /** Set when the primary name still lands on nobody, or on two people. */
  unresolvedDriverName?: string
}

export function crewFillFor(
  current: { driverId: string | null; coDriverId: string | null },
  names: { driverName: string | null; coDriverName: string | null },
  /** Name → every driver id it matches. Ambiguity is the caller's map. */
  resolve: (name: string) => readonly string[],
): CrewFill {
  const fill: CrewFill = {}

  if (current.driverId === null && names.driverName) {
    const hits = resolve(names.driverName)
    if (hits.length === 1 && hits[0] !== current.coDriverId) {
      fill.driverId = hits[0]
    } else if (hits.length !== 1) {
      fill.unresolvedDriverName = names.driverName
    }
    // A single hit that is ALREADY the co-driver is neither filled nor
    // unresolved: the person is on the load, in the other seat, and the
    // export is describing the same crew a different way round.
  }

  if (current.coDriverId === null && names.coDriverName) {
    const hits = resolve(names.coDriverName)
    // RULE 3, against the POST-FILL state.
    const willBeDriver = fill.driverId ?? current.driverId
    if (hits.length === 1 && hits[0] !== willBeDriver) {
      fill.coDriverId = hits[0]
    }
  }

  return fill
}

// ── WHEN AN IMPORTED LOAD MOVED, AND WHO SAYS SO ─────────────────────────
//
// Owner's ruling, 2026-09-24. Before it, this importer wrote
// `operationalStatus` as a plain column value and no operational event at
// all — and `settleableWhere` selects on an APPLIED POD_RECEIVED event
// INSIDE the period. So an imported load read "POD Received" on every
// screen and was in no driver's settleable set, in any week, for ever. The
// draft came out EMPTY and balanced.
//
// `backfill-direct-pod.mjs` had already written that failure down for
// Amazon freight: "a silent condition — the load reads Delivered on every
// screen and simply never appears in a pay week".

/**
 * The note on every operational event this importer writes.
 *
 * `StatusSource` is a four-member enum — MANUAL, AUTOMATIC, DRIVER_PORTAL,
 * INTEGRATION — and INTEGRATION is the truthful member: another system is
 * telling us. WHICH other system is the note, because a fifth enum member
 * would be a migration and a production ritual before this week could ship,
 * and the ruling's substance is the DATE rather than the spelling.
 *
 * Shared with the repair script so one query finds events from either.
 */
export const DATATRUCK_EVENT_NOTE = 'datatruck-import'

/** The same, from the script that repairs loads imported before the fix. */
export const DATATRUCK_REPAIR_NOTE = 'datatruck-import repair'

/**
 * WHEN the event happened — and a caller that cannot know is made to say so.
 *
 * THE RULING: the export's delivery date, NEVER the import time. The date
 * decides which pay week the money falls in, so an event stamped `now()` on
 * a load delivered nine days ago puts a driver's freight in the wrong week —
 * or in no week, once the statement for the real one has gone out.
 *
 * ── WHY THIS IS A UNION AND NOT `Date | null` ───────────────────────────
 *
 * `TransitionOptions.occurredAt` is optional, and `LoadStatusEvent.
 * occurredAt` carries `@default(now())`. So a null threaded through as
 * `occurredAt: undefined` does not fail — it silently produces exactly the
 * event the ruling forbids, dated at the import. A discriminated union
 * cannot be passed anywhere by accident: the no-date branch has to be
 * handled, and the only correct handling is to leave the load alone and
 * report it.
 *
 * A load whose export carries no delivery date therefore stays at its floor
 * status — visibly Booked, which somebody can see and fix — rather than
 * reading Delivered while being invisible to every settlement. Visible and
 * wrong beats invisible and wrong.
 */
export type ImportEventDate = { kind: 'at'; at: Date } | { kind: 'no-date' }

export function importEventAt(load: {
  deliveryAt: Date | null
}): ImportEventDate {
  return load.deliveryAt === null
    ? { kind: 'no-date' }
    : { kind: 'at', at: load.deliveryAt }
}

/** Which workbook the loads importer will read, or why it will not run. */
export type ExportChoice =
  | { kind: 'read'; path: string }
  | { kind: 'refuse'; rejected: string[] }

/**
 * WHICH FILE THE LOADS IMPORTER READS, AND WHAT IT REFUSES BY NAME.
 *
 * ── THE SHRUG THIS REPLACES ───────────────────────────────────────────────
 *
 * The importer used to pick its input with
 * `process.argv.find((a) => a.endsWith('.xlsx')) ?? DEFAULT_EXPORT`. Name a
 * `.csv` and the predicate matched nothing, so the file was DROPPED and the
 * default export read in its place — then reported under the name you passed,
 * with a row count, a cutover split and a refusal list that all looked right
 * and described a different week.
 *
 * ON 2026-09-24 that was one command away. The file dropped in
 * `corpus/datatruck/` for the first settled week was an Amazon Relay Trips CSV
 * — Relay's columns, and the week AFTER the one being settled — and the
 * instruction was to run the loads importer on it. Previewing the 2026-09-08
 * export's numbers as that week's is the kind of wrong reading that gets
 * believed, because nothing in the output contradicts it.
 *
 * Same family as the `sed` trap, the `tail` trap and the break that did not
 * fire: a wrong input indistinguishable from a right one. The answer is the
 * same as it was those three times — a mechanism, not more care.
 *
 * ── WHY IT IS A RULE HERE AND NOT A CHECK IN THE SCRIPT ───────────────────
 *
 * Because a check inside the script can only be tested by running the script,
 * which means standing up a database connection to prove an argument was
 * rejected — so it would ship on a reading instead. Pure, here, it is four
 * cases in the node project.
 *
 * ── WHY NOT JUST ACCEPT A CSV ─────────────────────────────────────────────
 *
 * `readXlsx` reads a zip container, and `planLoads` reads Datatruck's columns:
 * `Load status`, `Load pay`, `Driver/Carrier`, `DEL date`. A Relay trips CSV
 * shares exactly two column names with it — `Load ID` and `Trip ID` — and
 * carries none of the facts `readStatus`, `crewFillFor` or the gross come
 * from. That file has its own importer, under its own rules.
 *
 * FLAGS ARE NOT FILES. Anything starting with `-` belongs to `--write`,
 * `--production` and their kin, so it is neither read nor rejected.
 */
export function chooseExport(
  argv: readonly string[],
  fallback: string,
): ExportChoice {
  const positional = argv.filter((argument) => !argument.startsWith('-'))
  const rejected = positional.filter(
    (argument) => !argument.toLowerCase().endsWith('.xlsx'),
  )

  if (rejected.length > 0) return { kind: 'refuse', rejected }
  return { kind: 'read', path: positional[0] ?? fallback }
}

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
