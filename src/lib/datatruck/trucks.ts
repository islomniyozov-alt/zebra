import { resolveState } from './states'

// ---------------------------------------------------------------------------
// THE DATATRUCK TRUCK EXPORT, TURNED INTO ROWS THIS SYSTEM WILL STAND BEHIND.
//
// 49 trucks leaving a system nobody is going to maintain. The export is the
// only record of them, and it is DIRTY in ways that matter: four VINs are
// keyboard walks, one plate is the string "NAN", the odometer column is 47
// zeroes, and `State` holds "TEXAS" where a two-letter code belongs.
//
// EVERY REWRITE IS STATED AND REPORTED. Not one value is changed by a rule
// that guesses. A make abbreviation maps through a table written out below; a
// state name maps through another; everything else is either carried verbatim
// or dropped to null and named in the preview. The preview exists so Daler can
// read the list of rewrites and say no to any of them BEFORE a row is written.
//
// THE TWO KINDS OF EMPTY ARE KEPT APART, and this is the whole posture of the
// file. `null` means this system does not know. A placeholder — "NAN", "null",
// "1Q2W3E4R", an odometer of 0 — means somebody typed past a required field in
// a system that demanded one, and carrying it across would convert their
// shrug into our claim. A truck with no VIN is a truck to go and find the VIN
// for. A truck whose VIN is `1Q2W3E4R` is a truck nobody will ever look at
// again, because the field is full.
// ---------------------------------------------------------------------------

/** The authority a row is filed under, by the exact text of its `MC number`. */
const AUTHORITY_BY_MC: Readonly<Record<string, string>> = {
  // STATED, NEVER FUZZY. `Dolphin Transport inc` is Datatruck's spelling of
  // the carrier this system calls `Dolphins Transport` — plural, and `Inc`
  // capitalised — and the two are matched here by hand rather than by any
  // similarity rule. A fuzzy matcher that gets this pair right is a fuzzy
  // matcher that will get some future pair wrong, silently, on the table that
  // decides which carrier a load invoices under.
  'RAM Haulage LLC': 'RAM Haulage',
  'Dolphin Transport inc': 'Dolphins Transport',
}

/**
 * Authorities in the export that this system does not operate under.
 *
 * Named rather than left to fall through the default, so that a NEW carrier
 * appearing in a future export is a refusal that gets read, instead of quietly
 * joining the pile of trucks with no authority.
 */
const RETIRED_MC: readonly string[] = ['Midwest Global Logistics LLC']

/**
 * Units whose authority the trucks export does not state, decided from freight.
 *
 * ── WHY A TABLE AND NOT A RULE ───────────────────────────────────────────
 *
 * Three units were held by the seed: `7072` and `2400` carry a blank MC
 * number, and `9587` is filed under `Midwest Global Logistics LLC`. Between
 * them they run 891 loads worth $835,724 in the Datatruck load history, so
 * they are not decommissioned equipment — all three moved freight in the week
 * the export was taken.
 *
 * The trucks export cannot answer this and the LOAD history can, imperfectly:
 * every one of these units ran under several MC numbers across the year, which
 * is the finding that also made the load↔truck join org-wide rather than
 * per-authority. `scripts/profile-datatruck-loads.ts` prints both readings
 * that could decide it — where a unit ran MOST, and where it ran LAST — and
 * for all three they agree:
 *
 *   7072   81 of 172 loads RAM Haulage, last ran 2026-09-05 RAM Haulage
 *   9587  144 of 344 loads RAM Haulage, last ran 2026-09-03 RAM Haulage
 *   2400  264 of 375 loads RAM Haulage, last ran 2026-09-06 RAM Haulage
 *
 * NOTE WHAT 9587 SAYS. The trucks export files it under Midwest Global and its
 * freight says otherwise twice over — the export's MC column is stale for that
 * row. A rule that trusted the export would put a live RAM truck under a
 * retired carrier; a rule that trusted the plurality everywhere would rewrite
 * the 46 rows that are already right. Hence a table of three, by hand.
 *
 * IT IS A STATEMENT, NOT A DERIVATION, and that is deliberate — the same
 * reasoning `AUTHORITY_BY_MC` is written around. A table can be read and
 * disagreed with in review. A majority-vote over loads cannot, and it would
 * silently re-decide every future export.
 */
const UNIT_AUTHORITY: Readonly<Record<string, string>> = {
  '7072': 'RAM Haulage',
  '9587': 'RAM Haulage',
  '2400': 'RAM Haulage',
}

/**
 * Make abbreviations, spelled out.
 *
 * `FREGHITLAINR` IS IN HERE ON PURPOSE. It is a typo, four rows carry it, and
 * mapping a typo is the exact move this file otherwise refuses — so it is
 * written out as a literal rather than reached by any edit-distance rule. The
 * difference is that a table can be read and disagreed with, and a distance
 * threshold cannot.
 */
const MAKE: Readonly<Record<string, string>> = {
  FRHT: 'Freightliner',
  FREIG: 'Freightliner',
  FREIGHTLINER: 'Freightliner',
  FREGHITLAINR: 'Freightliner',
  VOLV: 'Volvo',
  VOLVO: 'Volvo',
  PTRB: 'Peterbilt',
  PETERBILT: 'Peterbilt',
}

/** Text a person typed to get past a required field. Never a value. */
const PLACEHOLDER = /^(nan|null|none|n\/a|na|not specified|-|\.|0)$/i

const VIN_LENGTH = 17

/**
 * The characters a VIN may contain.
 *
 * I, O AND Q ARE EXCLUDED BY THE STANDARD — ISO 3779 leaves them out precisely
 * because they are unreadable apart from 1 and 0 on a stamped door plate. So a
 * 17-character string containing one is not a VIN, however much it looks like
 * one, and three rows in this export contain an `O` sitting exactly where a
 * zero belongs (`3AKJHHDR`**O**`MSMC1119`).
 *
 * NOT CORRECTED TO A ZERO. That is the obvious reading and it is still a
 * guess: this seed would be inventing a character in the number that
 * identifies a vehicle to every inspection, title and recall lookup it will
 * ever appear in. Dropped to null and named, so somebody reads the door.
 */
const VIN_CHARACTERS = /^[A-HJ-NPR-Z0-9]+$/

/** A cell's real content, or null. Placeholders are not content. */
function real(value: string | undefined): string | null {
  const trimmed = (value ?? '').trim()
  if (trimmed === '' || PLACEHOLDER.test(trimmed)) return null
  return trimmed
}

export interface PlannedTruck {
  unitNumber: string
  /** The `Company.name` this truck files under. */
  authority: string
  vin: string | null
  make: string | null
  model: string | null
  year: number | null
  plate: string | null
  plateState: string | null
  /** Every value this planner changed or dropped, in words, for the preview. */
  corrections: string[]
}

export interface HeldTruck {
  unitNumber: string
  /** Why it cannot be written, in a sentence the report prints as-is. */
  reason: string
  /** Enough of the row to identify the truck without opening the export. */
  detail: string
}

export interface TruckPlan {
  planned: PlannedTruck[]
  held: HeldTruck[]
  /** Rows read from the file, planned or not. */
  read: number
}

export function planTrucks(
  records: readonly Record<string, string>[],
): TruckPlan {
  const planned: PlannedTruck[] = []
  const held: HeldTruck[] = []
  const seen = new Map<string, string>()

  for (const record of records) {
    // PLAIN TRIM, NOT `real`. The placeholder list contains "0" and "NA", and
    // a unit number is whatever is painted on the door — a truck genuinely
    // called "0" must not be dropped by a rule written for empty VIN fields.
    // Every other column goes through `real`; the key does not.
    const unitNumber = (record['Unit number'] ?? '').trim() || null
    const mc = (record['MC number'] ?? '').trim()
    const vinRaw = (record['Vin'] ?? '').trim()
    const detail =
      `${record['Year'] ?? ''} ${record['Make'] ?? ''} ` +
      `vin ${vinRaw || '(none)'} plate ${record['Plate number'] ?? '(none)'}`

    if (!unitNumber) {
      held.push({
        unitNumber: '(blank)',
        reason: 'no unit number, which is the key this seed files trucks under',
        detail: detail.trim(),
      })
      continue
    }

    // ── WHICH AUTHORITY ─────────────────────────────────────────────────
    //
    // `Truck.companyId` IS NOT NULLABLE. A truck belongs to an operating
    // authority in this schema — that is what makes "which carrier ran this
    // truck in Q2" answerable at all — so there is no row shape for a truck
    // with no carrier. These are held and named rather than parked under a
    // default, because a default here is this system inventing which carrier
    // is responsible for a vehicle.
    // THE STATED UNIT OVERRIDE WINS OVER THE MC COLUMN, and only for the
    // three units named in `UNIT_AUTHORITY`. Two of them have no MC at all;
    // the third has one the freight contradicts. Everything else resolves
    // through the export exactly as before.
    const authority = UNIT_AUTHORITY[unitNumber] ?? AUTHORITY_BY_MC[mc]
    if (!authority) {
      held.push({
        unitNumber,
        reason: RETIRED_MC.includes(mc)
          ? `filed under ${mc}, which this system does not operate under`
          : mc === ''
            ? 'no authority in the export'
            : `unrecognised authority ${JSON.stringify(mc)}`,
        detail: detail.trim(),
      })
      continue
    }

    // A unit number repeated within one authority is two trucks claiming one
    // key, and the partial unique index would refuse the second anyway — with
    // a database error rather than a sentence naming both.
    const key = `${authority}/${unitNumber}`
    const clash = seen.get(key)
    if (clash) {
      held.push({
        unitNumber,
        reason: `unit number already used under ${authority} by ${clash}`,
        detail: detail.trim(),
      })
      continue
    }
    seen.set(key, `vin ${vinRaw || '(none)'}`)

    const corrections: string[] = []

    // ── VIN: SEVENTEEN CHARACTERS OR NOTHING ────────────────────────────
    //
    // Four rows carry `1`, `1B2A3D`, `1W2E3R4T`, `1Q2W3E4R` — the last two are
    // walks along the top row of a keyboard. A VIN is a checksummed 17-digit
    // identifier; none of these is a near miss. Dropped to null so somebody
    // goes and finds the real one, and named in the preview so it is a task
    // rather than a hole.
    let vin: string | null = real(record['Vin'])
    if (vin && vin.length !== VIN_LENGTH) {
      corrections.push(
        `vin ${JSON.stringify(vin)} dropped — ${vin.length} characters, a VIN is ${VIN_LENGTH}`,
      )
      vin = null
    }
    if (vin) vin = vin.toUpperCase()
    if (vin && !VIN_CHARACTERS.test(vin)) {
      const offending = [...new Set(vin.split(''))]
        .filter((character) => !VIN_CHARACTERS.test(character))
        .join(', ')
      corrections.push(
        `vin ${JSON.stringify(vin)} dropped — contains ${offending}, which a VIN cannot`,
      )
      vin = null
    }

    // ── PLATE STATE ─────────────────────────────────────────────────────
    const stateRaw = (record['State'] ?? '').trim()
    let plateState: string | null = null
    if (stateRaw !== '') {
      const resolved = resolveState(stateRaw)
      if (resolved.ok) {
        plateState = resolved.code
        if (resolved.rewritten) {
          corrections.push(
            `state ${JSON.stringify(stateRaw)} -> ${resolved.code}`,
          )
        }
      } else {
        corrections.push(
          `state ${JSON.stringify(stateRaw)} dropped — not a code and not in the stated name table`,
        )
      }
    }

    // ── MAKE ────────────────────────────────────────────────────────────
    const makeRaw = real(record['Make'])
    let make = makeRaw
    if (makeRaw) {
      const mapped = MAKE[makeRaw.toUpperCase()]
      if (mapped && mapped !== makeRaw) {
        make = mapped
        corrections.push(`make ${JSON.stringify(makeRaw)} -> ${mapped}`)
      } else if (!mapped) {
        corrections.push(
          `make ${JSON.stringify(makeRaw)} carried verbatim — not in the stated table`,
        )
      }
    }

    // ── YEAR ────────────────────────────────────────────────────────────
    const yearRaw = real(record['Year'])
    let year: number | null = null
    if (yearRaw) {
      const parsed = Number(yearRaw)
      // 2000 appears twice and is plausible for a tractor still working. A
      // year outside living range is a typo, not a vintage truck.
      if (Number.isInteger(parsed) && parsed >= 1980 && parsed <= 2030) {
        year = parsed
      } else {
        corrections.push(
          `year ${JSON.stringify(yearRaw)} dropped — not a plausible model year`,
        )
      }
    }

    // ── ODOMETER IS NOT CARRIED AT ALL ──────────────────────────────────
    //
    // 47 of 49 rows read 0 and the other two read 385.99 and 136.2, which are
    // not odometers on a tractor that has been working for years. The column
    // holds nothing, and a fleet list showing 0 miles on 47 trucks is a
    // confident wrong answer where a blank is a true one. Reported, not read.

    planned.push({
      unitNumber,
      authority,
      vin,
      make,
      model: real(record['Model']),
      year,
      plate: real(record['Plate number']),
      plateState,
      corrections,
    })
  }

  return { planned, held, read: records.length }
}
