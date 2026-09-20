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

/**
 * The tariff's `name`, when the column holds Datatruck's whole tariff object.
 *
 * ── TWO EXPORTS, TWO SHAPES, ONE RULE ─────────────────────────────────────
 *
 * The active-driver export writes this column as the plain label — `88% from
 * gross`. The terminated-driver export of 2026-09-09 writes the entire tariff
 * record instead, a Python `repr` of a dict, with the same label inside it as
 * `'name': '88% from gross'`. Every one of its 69 rows was held for "does not
 * end in from gross" until this existed.
 *
 * IT UNWRAPS AND HANDS THE SAME STRING TO THE SAME RULE. The alternative was
 * reading `'percent': 88.0` straight out of the blob, which is a SECOND
 * derivation of what a driver is paid — and the whole reason `parseTariff`
 * delegates to `parsePercentToBps` is that this file must not grow a second
 * answer to that question.
 *
 * A DISAGREEMENT INSIDE THE BLOB IS A REFUSAL, not a preference. Both numbers
 * are right there, so they can be compared, and a record whose label says 88%
 * while its percent says 90 is not a row to resolve by picking the one this
 * code happens to read. It is held and named.
 */
const TARIFF_NAME = /'name':\s*'([^']*)'/
const TARIFF_PERCENT = /'percent':\s*([\d.]+)/

/** Datatruck's own word for what KIND of rate this is. */
const TARIFF_KIND = /'tariff':\s*'([^']*)'/

function tariffLabel(value: string): { label: string; why: string | null } {
  if (!value.startsWith('{')) return { label: value, why: null }

  const name = TARIFF_NAME.exec(value)?.[1]?.trim()
  if (!name) {
    return { label: value, why: 'a tariff object with no readable name' }
  }

  // ── A PER-MILE TARIFF IS NOT A PERCENTAGE THAT DISAGREES WITH ITSELF ────
  //
  // Checked BEFORE the cross-check below, because without it a `per_mile`
  // record reports as "the object says 0.0% and its name says 0.7%" — the row
  // is refused either way and the sentence is a wrong diagnosis. It has no
  // percent because it is not a percentage at all: `0.7$ per mil` is 70 cents
  // a mile, and `PERCENT_LINEHAUL` cannot express it.
  //
  // Two of the applicant rows are this. Naming it properly is what tells
  // somebody the answer is a new pay-rule type rather than a typo to correct.
  const kind = TARIFF_KIND.exec(value)?.[1]
  if (kind && kind !== 'percentage_from_gross') {
    return {
      label: name,
      why:
        `a ${JSON.stringify(kind)} tariff (${JSON.stringify(name)}), which is not a ` +
        `percentage of gross — this system has no pay rule type for it`,
    }
  }

  // The cross-check. `percent` is Datatruck's own number for the same rate.
  const percent = TARIFF_PERCENT.exec(value)?.[1]
  if (percent !== undefined) {
    const fromName = /^\s*([\d.]+)\s*%?/.exec(name)?.[1]
    if (fromName !== undefined && Number(fromName) !== Number(percent)) {
      return {
        label: name,
        why: `the object says ${percent}% and its name says ${fromName}% — they disagree`,
      }
    }
  }
  return { label: name, why: null }
}

export function parseTariff(raw: string | null | undefined): TariffResult {
  const outer = (raw ?? '').trim()
  if (outer === '') return { ok: false, raw: outer, why: 'empty' }

  const unwrapped = tariffLabel(outer)
  if (unwrapped.why) {
    return { ok: false, raw: outer, why: unwrapped.why }
  }
  const value = unwrapped.label

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

/**
 * The authority a row files under, by the exact text of its `MC number`.
 *
 * ── THE RETIRED THREE ARE HERE, AND THEY MAP TO THEMSELVES ────────────────
 *
 * Added 2026-09-09, when the terminated-driver export arrived: 11 of its 69
 * rows file under `Midwest Global Logistics LLC` and one under `AG FREIGHT
 * INC`. Both are `Company` rows now — created retired by
 * `seed-datatruck-authorities.ts`, which is why that seed was a prerequisite
 * and not a convenience — so a driver who last drove for one of them has
 * somewhere to be filed instead of being held.
 *
 * IDENTITY MAPPINGS, WHERE THE FIRST TWO ARE NOT. `RAM Haulage LLC` and
 * `Dolphin Transport inc` are Datatruck's spellings of carriers this system
 * names differently, matched by hand for the reason `trucks.ts` writes out.
 * The retired three were CREATED from the export's own spelling, so there is
 * nothing to translate — and writing them out anyway keeps every authority
 * this file accepts in one readable list, rather than half a list plus a rule.
 *
 * A NAME NOT ON THIS TABLE IS STILL A REFUSAL. That is the point: a new
 * carrier appearing in a future export is a held row somebody reads, never a
 * driver quietly filed under the wrong company.
 */
const AUTHORITY_BY_MC: Readonly<Record<string, string>> = {
  'RAM Haulage LLC': 'RAM Haulage',
  'Dolphin Transport inc': 'Dolphins Transport',
  'Midwest Global Logistics LLC': 'Midwest Global Logistics LLC',
  'American Soldier Transport LLC': 'American Soldier Transport LLC',
  'AG FREIGHT INC': 'AG FREIGHT INC',
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
  /** Datatruck Pay to. Present as a column, empty in every row today. */
  payToName: string | null
  cdlNumber: string | null
  cdlState: string | null
  /** ISO day, or null. Drives the CDL ComplianceItem. */
  cdlExpiresAt: string | null
  /** The unit number this driver drives, as the export spells it. */
  truckUnit: string | null
  /**
   * Basis points of linehaul, or null when the tariff would not read AND the
   * caller asked for that to be survivable — see `unreadableTariff`.
   *
   * NULL IS NOT ZERO. A driver paid 0% and a driver whose rate nobody could
   * read are different facts, and only one of them may ever reach a pay rule.
   * Every writer of `DriverPayRule` must therefore check this; the compiler
   * makes that unavoidable, which is why the field is nullable rather than
   * carrying a sentinel.
   */
  payBps: number | null
  /**
   * Derived from `payBps`, never from the export's `Driver Type`.
   *
   * Falls back to the SCHEMA DEFAULT when there is no readable rate, because
   * this is a label and a label is not worth holding a row over.
   */
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

/**
 * What to do with a row whose tariff will not read.
 *
 * `hold` — the default, and what the active and terminated seeds use. A rate
 * nobody can read is a rate nobody should be paid on, and those seeds write
 * money.
 *
 * `default` — plan the row anyway with no rate and the schema's default
 * employment type. For an import where NO pay rule is written, the tariff
 * decides only a label, and holding a row over a label would strip a driver
 * out of the import and leave their loads with nobody to attach to. The
 * owner's ruling of 2026-09-09, for the applicant rows.
 */
export type UnreadableTariff = 'hold' | 'default'

export interface PlanDriversOptions {
  unreadableTariff?: UnreadableTariff
}

/**
 * Rows in the export that are Datatruck's own test data, not people.
 *
 * ── STATED BY NAME, LIKE EVERY OTHER TABLE IN THIS FILE ───────────────────
 *
 * `Sample Driver` (Driver ID 1, AG FREIGHT INC, CDL number "1") arrived with
 * the all-drivers export and reached production before anybody looked at the
 * list. It has no loads, no settlements, no pay rules and no compliance —
 * checked across all eleven tables that point at a driver — because it never
 * drove anything.
 *
 * BY NAME AND BY ID, BOTH. Either alone would be a weaker guard: an id of `1`
 * is exactly the sort of value a future export could reuse for a real person,
 * and a name alone would refuse a real driver who happens to be called Sample.
 * A row must match both to be skipped, and the pair is written out so it can
 * be read and disagreed with.
 *
 * IT IS A REFUSAL, NOT A SILENT DROP. The row lands in `held` with a reason,
 * so a re-run says "this was skipped and here is why" rather than quietly
 * producing one fewer driver than the file contains.
 */
const TEST_DATA: readonly { externalId: string; who: string }[] = [
  { externalId: '1', who: 'sample driver' },
]

export function planDrivers(
  records: readonly Record<string, string>[],
  options: PlanDriversOptions = {},
): DriverPlan {
  const unreadableTariff = options.unreadableTariff ?? 'hold'
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

    // ── DATATRUCK'S OWN TEST DATA, SKIPPED BY NAME AND ID ───────────────
    if (
      TEST_DATA.some(
        (row) =>
          row.externalId === externalId &&
          row.who === who.toLowerCase().replace(/\s+/g, ' '),
      )
    ) {
      held.push({
        externalId,
        who,
        reason:
          'Datatruck test data, not a person — see TEST_DATA in drivers.ts',
      })
      continue
    }

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
    if (!tariff.ok && unreadableTariff === 'hold') {
      held.push({
        externalId,
        who,
        reason: `tariff ${JSON.stringify(tariff.raw)} — ${tariff.why}`,
      })
      continue
    }

    const corrections: string[] = []
    if (!tariff.ok) {
      // NAMED IN THE PREVIEW, NOT SWALLOWED. The row survives because no pay
      // rule depends on it, and the report still says the rate was unreadable
      // — otherwise "seeded with the default" and "seeded from the export"
      // look identical afterwards.
      corrections.push(
        `tariff ${JSON.stringify(tariff.raw)} would not read (${tariff.why}); ` +
          `no rate recorded and employment left at the schema default`,
      )
    }
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
      // WHO THE CHEQUE IS MADE OUT TO, when it is not the driver.
      //
      // The column exists in drivers_2026_09_07 and is EMPTY in all 54
      // rows, so this brings nothing across today. It is read anyway
      // because the ruling says where present, and because a column that
      // fills up later should not need a code change to be noticed.
      payToName: text(record, 'Pay to') || null,
      cdlNumber: text(record, 'Driver license') || null,
      cdlState,
      cdlExpiresAt,
      truckUnit: text(record, 'Truck') || null,
      // NO RATE MEANS NO RATE. `null` reaches every writer of a pay rule as a
      // value it has to handle, rather than a 0 that reads like a decision
      // somebody made.
      payBps: tariff.ok ? tariff.bps : null,
      // SCHEMA DEFAULT WHEN THERE IS NOTHING TO DERIVE FROM. `OWNED` is what
      // `Driver.employmentType` defaults to in the schema, so a row planned
      // this way is indistinguishable from one created through the interface
      // without anybody stating a class — which is the honest outcome, since
      // nobody has.
      employmentType: tariff.ok ? employmentFromTariff(tariff.bps) : 'OWNED',
      declaredType: text(record, 'Driver Type') || null,
      corrections,
    })
  }

  return { planned, held, read: records.length }
}
