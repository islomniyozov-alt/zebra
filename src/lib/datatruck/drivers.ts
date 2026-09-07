import { MoneyFormatError, parsePercentToBps } from '../money'
import { resolveState } from './states'

// ---------------------------------------------------------------------------
// THE TWO READINGS IN THE DRIVER EXPORT THAT ARE WORTH GETTING WRONG OVER:
// WHAT A DRIVER IS PAID, AND WHEN THEIR LICENCE STOPS BEING VALID.
//
// Both are here rather than in the seed script because both are rules, both
// are testable without a database, and both have a failure mode that is
// invisible in the output. A tariff read as 9% instead of 90% is a settlement
// that looks like a settlement. An expiry read a day early is an alarm that
// fires on the wrong day, every time, forever.
//
// NEITHER EVER DEFAULTS. `Driver tariff` that will not parse refuses by name
// and the driver is reported, not seeded at 0% and not seeded at null — the
// ruling on this was explicit, and it is the same posture as everywhere else
// money is read: a refusal is a task, a default is a wrong number nobody will
// ever look at again.
// ---------------------------------------------------------------------------

/**
 * A driver's percentage, in basis points.
 *
 * IT DELEGATES TO `parsePercentToBps` RATHER THAN PARSING A NUMBER ITSELF.
 * That function is the audited one — it refuses `3%4` on purpose, having
 * measured that a stray keystroke otherwise becomes a plausible 34% — and a
 * second percent parser in this file would be a second answer to the question
 * of what a driver is paid. All this does is strip the words around the
 * number and hand over the rest.
 *
 * THE EXPORT'S SHAPES, MEASURED: `90% from gross`, `58 From Gross` (no percent
 * sign), `33 % from gross` (a space before it), `52% FROM GROSS`. Case and
 * spacing vary because 54 rows were typed by hand over several years.
 *
 * `from gross` IS DISCARDED, NOT INTERPRETED. Every one of the 54 rows says
 * it, so it distinguishes nothing, and this seed writes `PERCENT_LINEHAUL`
 * because that is what the ruling said the rule is. If a row ever arrives
 * saying something else, it lands in the leftover text and refuses here rather
 * than being silently paid as though it matched.
 */
export type TariffResult =
  | { ok: true; bps: number }
  | { ok: false; raw: string; why: string }

/** The trailing words the export puts after every percentage. */
const TARIFF_SUFFIX = /\s*(from|of)\s+gross\s*$/i

export function parseTariff(raw: string | null | undefined): TariffResult {
  const value = (raw ?? '').trim()
  if (value === '') return { ok: false, raw: value, why: 'empty' }

  const suffix = TARIFF_SUFFIX.exec(value)
  if (!suffix) {
    return {
      ok: false,
      raw: value,
      why: 'does not end in "from gross", so it is not a percentage of anything this system knows how to pay',
    }
  }

  const number = value.slice(0, suffix.index).trim()
  if (number === '')
    return { ok: false, raw: value, why: 'no number before "from gross"' }

  try {
    const bps = parsePercentToBps(number)
    // 0% is a driver who is paid nothing and 100%+ is a driver paid more than
    // the load earns. Both are almost certainly a typo, and neither is a
    // number to discover later in a settlement.
    if (bps <= 0 || bps > 10_000) {
      return { ok: false, raw: value, why: `${bps / 100}% is outside 0–100%` }
    }
    return { ok: true, bps }
  } catch (error) {
    if (error instanceof MoneyFormatError) {
      return {
        ok: false,
        raw: value,
        why: `${JSON.stringify(number)} is not a number`,
      }
    }
    throw error
  }
}

/**
 * A licence expiry as an ISO day, from the one format the export prints.
 *
 * `new Date('Apr 11, 2031')` IS THE BUG THIS EXISTS TO NOT HAVE. It parses,
 * which is the problem: it yields midnight in whatever zone the process runs
 * in, so the same export seeded from Chicago and from UTC produces two
 * different days, and a licence expiring on the 11th becomes the 10th for
 * anyone west of Greenwich. Rule 9-money's date half, and the same reasoning
 * `cdl-refusal.ts` records for comparing two ISO strings as text.
 *
 * SO THE FORMAT IS STATED AND MATCHED. Three letters, a day, a comma, a year —
 * nothing else is accepted, and a row in any other shape refuses by name
 * rather than being handed to a parser that will always return something.
 */
const MONTHS: Readonly<Record<string, string>> = {
  JAN: '01',
  FEB: '02',
  MAR: '03',
  APR: '04',
  MAY: '05',
  JUN: '06',
  JUL: '07',
  AUG: '08',
  SEP: '09',
  OCT: '10',
  NOV: '11',
  DEC: '12',
}

/** `Apr 11, 2031` and nothing else. */
const STATED_FORMAT = /^([A-Za-z]{3})\s+(\d{1,2}),\s*(\d{4})$/

export type ExpiryResult =
  | { ok: true; iso: string }
  | { ok: false; raw: string; why: string }

export function parseLicenceExpiry(
  raw: string | null | undefined,
): ExpiryResult {
  const value = (raw ?? '').trim()
  if (value === '') return { ok: false, raw: value, why: 'empty' }

  const match = STATED_FORMAT.exec(value)
  if (!match) {
    return {
      ok: false,
      raw: value,
      why: 'not in the stated "Apr 11, 2031" format',
    }
  }

  const [, monthName, day, year] = match
  const month = MONTHS[monthName!.toUpperCase()]
  if (!month) {
    return {
      ok: false,
      raw: value,
      why: `${JSON.stringify(monthName)} is not a month`,
    }
  }

  const dayNumber = Number(day)
  // A CALENDAR CHECK, NOT A DATE OBJECT. 31 passes here and February's 31st is
  // caught below by the only authority worth asking — but asking it costs a
  // Date, so it is asked in UTC explicitly and read back the same way, never
  // through a local-time accessor.
  if (dayNumber < 1 || dayNumber > 31) {
    return { ok: false, raw: value, why: `day ${day} is not a day` }
  }

  const iso = `${year}-${month}-${String(dayNumber).padStart(2, '0')}`

  // `Date.UTC` + `toISOString` round-trips with no zone anywhere in it. A
  // February 30th comes back as March 2nd and therefore does not match.
  const roundTrip = new Date(
    Date.UTC(Number(year), Number(month) - 1, dayNumber),
  )
    .toISOString()
    .slice(0, 10)
  if (roundTrip !== iso) {
    return { ok: false, raw: value, why: `${iso} is not a real date` }
  }

  return { ok: true, iso }
}

// ---------------------------------------------------------------------------
// THE EXPORT'S 54 ROWS, TURNED INTO DRIVERS.
//
// SAME POSTURE AS THE TRUCKS PLANNER, and one addition that matters more here:
// a truck with a wrong field is a truck somebody corrects. A driver with a
// wrong PERCENTAGE is a cheque, every week, until somebody notices.
//
// SO A TARIFF THAT WILL NOT PARSE HOLDS THE WHOLE DRIVER. Not seeded at 0%,
// not seeded with a null rule to be filled in later — a driver row with no pay
// rule is a driver who looks set up and settles to nothing, which is a worse
// failure than an absent driver somebody has to add. The refusal is named in
// the report with the raw text.
// ---------------------------------------------------------------------------

/** The authority a row files under, by the exact text of its `MC number`. */
const AUTHORITY_BY_MC: Readonly<Record<string, string>> = {
  'RAM Haulage LLC': 'RAM Haulage',
  'Dolphin Transport inc': 'Dolphins Transport',
}

// ---------------------------------------------------------------------------
// WHAT A DRIVER IS PAID DECIDES WHAT THEY ARE, NOT WHAT THE COLUMN CALLS THEM.
//
// `Driver Type` splits 39 company_driver / 15 company_owner, and 21 of those
// company_driver rows sit at 88-90% of gross. The owner confirms the real
// split: company drivers run 28-35%, owner-operators 88-90%. So that column is
// a PAYROLL LABEL, not the pay class — and the percentage, which is the number
// that actually settles, is the honest signal.
//
// THE THRESHOLD IS STATED AND IT IS A RULING, not a cluster found in the data.
// 85% sits in the empty space between the two populations rather than being
// derived from them, so a new driver at 80% or 92% lands somewhere predictable
// instead of moving the boundary.
//
// EVERY DISAGREEMENT IS NAMED IN THE REPORT. Deriving quietly would be this
// system overruling a human-entered column without telling anybody; the point
// is that the list exists and somebody can look down it. And the value is
// editable per driver afterwards, because a rule about two populations will be
// wrong about somebody.
const OWNER_OPERATOR_FLOOR_BPS = 8500

export type DriverEmployment = 'OWNED' | 'OWNER_OPERATOR'

/** The pay class the percentage implies. `OWNED` is a company driver. */
export function employmentFromTariff(payBps: number): DriverEmployment {
  return payBps >= OWNER_OPERATOR_FLOOR_BPS ? 'OWNER_OPERATOR' : 'OWNED'
}

/** What the export's `Driver Type` column claims, mapped onto the same axis. */
export function employmentFromColumn(
  raw: string | null | undefined,
): DriverEmployment | null {
  const value = (raw ?? '').trim().toLowerCase()
  if (value === 'company_owner') return 'OWNER_OPERATOR'
  if (value === 'company_driver') return 'OWNED'
  return null
}

/** A phone with fewer real digits than a phone number has. */
const MIN_PHONE_DIGITS = 10

export interface PlannedDriver {
  /** `Driver ID` — the idempotency key, and why the column was added. */
  externalId: string
  firstName: string
  lastName: string
  authority: string
  phone: string | null
  email: string | null
  cdlNumber: string | null
  cdlState: string | null
  /** ISO day, or null. Drives the CDL ComplianceItem. */
  cdlExpiresAt: string | null
  /** The unit number this driver drives, as the export spells it. */
  truckUnit: string | null
  payBps: number
  /** Derived from `payBps`, never from the export's `Driver Type`. */
  employmentType: DriverEmployment
  /** What `Driver Type` said, so the report can name every disagreement. */
  declaredType: string | null
  corrections: string[]
}

export interface HeldDriver {
  externalId: string
  who: string
  reason: string
}

export interface DriverPlan {
  planned: PlannedDriver[]
  held: HeldDriver[]
  read: number
}

export function planDrivers(
  records: readonly Record<string, string>[],
): DriverPlan {
  const planned: PlannedDriver[] = []
  const held: HeldDriver[] = []
  const seen = new Set<string>()

  const text = (record: Record<string, string>, key: string): string =>
    (record[key] ?? '').trim()

  for (const record of records) {
    const externalId = text(record, 'Driver ID')
    const firstName = text(record, 'First name')
    const lastName = text(record, 'Last name')
    const who = `${firstName} ${lastName}`.trim() || '(unnamed)'

    if (externalId === '') {
      held.push({
        externalId: '(blank)',
        who,
        reason: 'no Driver ID, which is the key this seed files drivers under',
      })
      continue
    }
    if (seen.has(externalId)) {
      held.push({
        externalId,
        who,
        reason: 'Driver ID already used by an earlier row',
      })
      continue
    }
    if (firstName === '' || lastName === '') {
      // Both are NOT NULL on the model, and a driver filed under a blank
      // surname is a driver nobody can find again.
      held.push({ externalId, who, reason: 'missing a first or last name' })
      continue
    }

    const authority = AUTHORITY_BY_MC[text(record, 'MC number')]
    if (!authority) {
      held.push({
        externalId,
        who,
        reason: `authority ${JSON.stringify(text(record, 'MC number'))} is not one this system operates under`,
      })
      continue
    }

    // ── PAY, WHICH HOLDS THE ROW IF IT WILL NOT READ ────────────────────
    const tariff = parseTariff(text(record, 'Driver tariff'))
    if (!tariff.ok) {
      held.push({
        externalId,
        who,
        reason: `tariff ${JSON.stringify(tariff.raw)} — ${tariff.why}`,
      })
      continue
    }

    const corrections: string[] = []
    seen.add(externalId)

    // ── CDL STATE: NO INFERENCE, EVER ───────────────────────────────────
    //
    // 19 rows carry no licence state. It stays null on every one of them —
    // not guessed from the phone's area code, not from the authority's home
    // state, not from where the other drivers are licensed. A wrong cdlState
    // is an MVR pulled from a state that has never heard of this driver.
    const stateRaw = text(record, 'Driver license state')
    let cdlState: string | null = null
    if (stateRaw !== '') {
      const resolved = resolveState(stateRaw)
      if (resolved.ok) {
        cdlState = resolved.code
        if (resolved.rewritten)
          corrections.push(
            `licence state ${JSON.stringify(stateRaw)} -> ${resolved.code}`,
          )
      } else {
        corrections.push(
          `licence state ${JSON.stringify(stateRaw)} dropped — not in the stated name table`,
        )
      }
    }

    const expiryRaw = text(record, 'Driver license expiration')
    let cdlExpiresAt: string | null = null
    if (expiryRaw !== '') {
      const expiry = parseLicenceExpiry(expiryRaw)
      if (expiry.ok) cdlExpiresAt = expiry.iso
      else
        corrections.push(
          `licence expiry ${JSON.stringify(expiryRaw)} dropped — ${expiry.why}`,
        )
    }

    // A phone with three digits in it is not a phone. One row reads `111`.
    const phoneRaw = text(record, 'Contact number')
    let phone: string | null = phoneRaw === '' ? null : phoneRaw
    if (phone && phone.replace(/\D/g, '').length < MIN_PHONE_DIGITS) {
      corrections.push(
        `phone ${JSON.stringify(phone)} dropped — ${phone.replace(/\D/g, '').length} digits`,
      )
      phone = null
    }

    planned.push({
      externalId,
      firstName,
      lastName,
      authority,
      phone,
      email: text(record, 'Email') || null,
      cdlNumber: text(record, 'Driver license') || null,
      cdlState,
      cdlExpiresAt,
      truckUnit: text(record, 'Truck') || null,
      payBps: tariff.bps,
      employmentType: employmentFromTariff(tariff.bps),
      declaredType: text(record, 'Driver Type') || null,
      corrections,
    })
  }

  return { planned, held, read: records.length }
}
