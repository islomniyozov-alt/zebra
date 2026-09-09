import { readCostOf, type AskResult, type ReadCost } from './claude'
import { askModel } from './model-engine'
import { parseCoiResponse } from './extraction/coi-parse'
import { COI_EXTRACTION_SYSTEM_WITH_SCHEMA } from './extraction/coi-prompt'
import { proposeCoverage } from './extraction/coi-coverages'
import { checkVin, sameVin } from './extraction/vin'
import {
  checkCarrier,
  digits,
  judgeCoverageRow,
  namesAgree,
  refuseCoi,
  type CarrierCheck,
  type CoiRefusal,
  type RowRefusal,
} from './extraction/coi-refusal'
import type { ComplianceType } from '@/generated/prisma/client'
import type { Confidence } from './extraction/envelope'
import type { ExtractedCoi } from './extraction/coi-shape'

// ---------------------------------------------------------------------------
// READING A CERTIFICATE OF INSURANCE, AND WHAT A CONFIRMED ONE BECOMES.
//
// ── THE SAME POSTURE AS THE MEDICAL CARD, AND ONE REAL DIFFERENCE ─────────
//
// It goes through `askModel`, chooses no engine of its own, transcribes rather
// than interprets, and refuses on a doubtful spine. All of that is
// `med-cert.ts`'s shape and the reasoning is written out there.
//
// WHAT DIFFERS IS THE SUBJECT — AND IT IS NOT WHAT THIS FILE FIRST BELIEVED.
//
// The first version said: a medical certificate belongs to a PERSON the reader
// has to identify, a certificate of insurance belongs to the CARRIER and the
// carrier is stated, so there is no matching to do. That was wrong, and
// `corpus/coi/acord25-01.pdf` is the counter-example. Its insured is CHAPAN
// INC — an owner-operator's own entity, which is not one of this system's
// authorities and never will be. Asking a dispatcher "which of your six
// carriers is this for" would have produced a wrong answer with no honest one
// available.
//
// So the subject BRANCHES ON WHAT THE CERTIFICATE PROVES (owner's ruling,
// 2026-09-09), and `decideCoiSubject` below is that rule.
//
// ── AND THE COVERAGES ARE A LIST, READ AS PRINTED ────────────────────────
//
// The first version assumed liability was always present and that cargo shared
// the liability term. The same certificate carries neither coverage. So
// nothing here decides what a row is: the printed type travels to the confirm
// step, `coi-coverages.ts` proposes an obligation beside it, and a person
// agrees or changes it.
//
// NOTHING IS PERSISTED BY READING. The certificate is read, matched and
// dropped. Filing it is a separate, confirmed action.
// ---------------------------------------------------------------------------

export type CoiReadOutcome =
  | { ok: true; fields: ExtractedCoi; cost: ReadCost }
  | {
      ok: false
      reason: 'unsupported_type' | 'call_failed' | 'unparsable' | CoiRefusal
      cost: ReadCost | null
    }

/** Nothing read, in the shape a read returns. */
export const NOTHING_READ: ExtractedCoi = {
  insuredName: null,
  insuredMc: null,
  insuredDot: null,
  coverages: null,
  vehicles: null,
}

export async function readCoi(input: {
  base64: string
  mimeType: string
  /** Named by an accuracy run, absent everywhere else. */
  model?: string
  apiKey?: string
}): Promise<CoiReadOutcome> {
  let answer: AskResult
  try {
    answer = await askModel({
      base64: input.base64,
      mimeType: input.mimeType,
      system: COI_EXTRACTION_SYSTEM_WITH_SCHEMA,
      prompt:
        'Read this certificate of insurance and return the JSON described.',
      ...(input.model ? { model: input.model } : {}),
      ...(input.apiKey ? { apiKey: input.apiKey } : {}),
    })
  } catch (error) {
    const reason =
      error instanceof Error &&
      'reason' in error &&
      (error.reason === 'document_too_large' ||
        error.reason === 'unsupported_media_type' ||
        error.reason === 'truncated')
        ? ('unsupported_type' as const)
        : ('call_failed' as const)
    // Nothing was billed: the call never produced an answer.
    return { ok: false, reason, cost: null }
  }

  const cost = readCostOf(answer)

  let fields: ExtractedCoi
  try {
    fields = parseCoiResponse(answer.text)
  } catch {
    return { ok: false, reason: 'unparsable', cost }
  }

  const refusal = refuseCoi(fields)
  if (refusal) return { ok: false, reason: refusal, cost }

  return { ok: true, fields, cost }
}

// ── WHOSE FILE DOES THIS BELONG IN ─────────────────────────────────────────

/** One of this tenant's authorities, as the subject rule needs it. */
export interface CoiAuthority {
  id: string
  name: string
  mcNumber: string | null
  dotNumber: string | null
}

/** One truck, as the subject rule needs it. */
export interface CoiTruck {
  id: string
  unitNumber: string
  vin: string | null
  companyId: string
  companyName: string
}

/** What became of one vehicle the certificate named. */
export type CoiVehicle =
  | {
      kind: 'truck'
      vin: string
      description: string | null
      truck: CoiTruck
      /** Whether filing would write this VIN onto a truck that has none. */
      fills: boolean
    }
  | {
      kind: 'no_truck'
      vin: string
      description: string | null
    }
  | {
      kind: 'unreadable'
      /** As printed. Carried through unchanged — `vin.ts` never corrects. */
      printed: string
      description: string | null
      reason: 'wrong_length' | 'illegal_character' | 'check_digit'
    }

export type CoiSubject =
  | { kind: 'company'; company: CoiAuthority; because: string }
  | { kind: 'trucks'; truckIds: string[]; because: string }
  | { kind: 'ask'; because: string }

/**
 * WHOSE CERTIFICATE IS THIS — decided by what the document proves.
 *
 * The owner's ruling of 2026-09-09, in three branches:
 *
 *   INSURED MATCHES A ZEBRA AUTHORITY → file at the company. This is the
 *   ordinary case: our own carrier's fleet policy, and it becomes company-level
 *   rows that every truck inherits (`FLEET_COMPLIANCE_TYPES`).
 *
 *   NO AUTHORITY MATCH BUT THE VINs MATCH TRUCKS → file per truck. This is the
 *   owner-operator: CHAPAN INC insures two tractors that run under RAM
 *   Haulage's authority, and the policy is genuinely the vehicles' rather than
 *   the carrier's. Filing it at RAM Haulage would say the fleet is covered by
 *   a policy that names two trucks.
 *
 *   NEITHER → ASK. Not "guess the most likely carrier", not "attach it to the
 *   only authority": a certificate this system cannot place is a certificate
 *   whose subject a person has to state.
 *
 * ── THE ORDER IS NOT ARBITRARY ───────────────────────────────────────────
 *
 * The authority check runs FIRST. Our own carriers' certificates also name
 * vehicles sometimes, and a fleet policy that happened to schedule three
 * tractors must still land on the company — otherwise a carrier's liability
 * cover would file against three trucks and the other hundred would show
 * uninsured.
 *
 * ── IT DECIDES, IT DOES NOT WRITE ────────────────────────────────────────
 *
 * Every branch's answer goes on the confirm step with the reason in words, and
 * the person can override it. `because` is that sentence, and it is built here
 * rather than on the screen so the reasoning lives beside the rule.
 */
export function decideCoiSubject(
  fields: ExtractedCoi,
  against: {
    authorities: readonly CoiAuthority[]
    /** Trucks whose VIN matches one the certificate named. Looked up by the caller. */
    trucks: readonly CoiTruck[]
  },
): { subject: CoiSubject; vehicles: CoiVehicle[] } {
  const vehicles = matchVehicles(fields, against.trucks)

  const printed = fields.insuredName?.value?.trim() ?? ''
  const printedDot = digits(fields.insuredDot?.value ?? '')
  const printedMc = digits(fields.insuredMc?.value ?? '')

  // ── DOES IT NAME ONE OF OURS? ──────────────────────────────────────────
  //
  // A NUMBER BEATS A NAME where the certificate prints one. `RAM HAULAGE LLC`
  // and `RAM Haulage` are the same carrier and a USDOT number cannot be spelled
  // two ways — the reasoning `checkCarrier` records at length.
  const byNumber = against.authorities.find(
    (row) =>
      (printedDot !== '' && digits(row.dotNumber ?? '') === printedDot) ||
      (printedMc !== '' && digits(row.mcNumber ?? '') === printedMc),
  )
  const byName = printed
    ? against.authorities.find((row) => namesAgree(printed, row.name))
    : undefined

  const company = byNumber ?? byName
  if (company) {
    return {
      subject: {
        kind: 'company',
        company,
        because: byNumber
          ? `The insured's ${printedDot !== '' && digits(company.dotNumber ?? '') === printedDot ? 'USDOT' : 'MC'} number is ${company.name}'s.`
          : `The certificate names ${JSON.stringify(printed)}, which is ${company.name}.`,
      },
      vehicles,
    }
  }

  // ── NO AUTHORITY. DOES IT NAME TRUCKS WE RUN? ─────────────────────────
  const matched = vehicles.filter((row) => row.kind === 'truck')
  if (matched.length > 0) {
    const units = matched.map((row) => row.truck.unitNumber)
    return {
      subject: {
        kind: 'trucks',
        truckIds: matched.map((row) => row.truck.id),
        because: printed
          ? `${JSON.stringify(printed)} is not one of your authorities, but this certificate names ${units.length === 1 ? 'a truck' : 'trucks'} you run: ${units.join(', ')}.`
          : `The insured could not be read, but this certificate names ${units.length === 1 ? 'a truck' : 'trucks'} you run: ${units.join(', ')}.`,
      },
      vehicles,
    }
  }

  // ── NEITHER ────────────────────────────────────────────────────────────
  const named = vehicles.filter((row) => row.kind === 'no_truck').length
  return {
    subject: {
      kind: 'ask',
      because: printed
        ? named > 0
          ? `${JSON.stringify(printed)} is not one of your authorities, and the ${named === 1 ? 'vehicle it names is not' : `${named} vehicles it names are not`} on any truck on record.`
          : `${JSON.stringify(printed)} is not one of your authorities, and the certificate names no vehicles.`
        : 'Neither the insured nor a vehicle on this certificate could be placed.',
    },
    vehicles,
  }
}

/**
 * Each vehicle the certificate named, against the trucks we hold.
 *
 * ── THE CHECK DIGIT RUNS BEFORE THE LOOKUP ───────────────────────────────
 *
 * A VIN that fails ISO 3779 is not used as a key. It could not match anything
 * legitimately, and a partial or fuzzy match on a VIN known to be misread is
 * how a certificate lands on the wrong truck. It is shown as read, unchanged,
 * with the reason — see `vin.ts` on why nothing here corrects it.
 */
function matchVehicles(
  fields: ExtractedCoi,
  trucks: readonly CoiTruck[],
): CoiVehicle[] {
  const rows: CoiVehicle[] = []

  for (const vehicle of fields.vehicles ?? []) {
    const description = vehicle.description?.value?.trim() || null
    const printed = vehicle.vin?.value?.trim()
    if (!printed) continue

    const check = checkVin(printed)
    if (!check) continue
    if (!check.ok) {
      rows.push({
        kind: 'unreadable',
        printed: check.vin,
        description,
        reason: check.reason,
      })
      continue
    }

    const truck = trucks.find((row) => sameVin(row.vin, check.vin))
    if (truck) {
      rows.push({
        kind: 'truck',
        vin: check.vin,
        description,
        truck,
        // A TRUCK FOUND BY ITS VIN ALREADY HAS ITS VIN. This is false by
        // construction here, and it is still computed rather than hard-coded:
        // the field means "filing would write this", and a lookup that later
        // matches on something else must not silently keep saying no.
        fills: truck.vin === null,
      })
      continue
    }

    // A VALID VIN NO TRUCK CARRIES. This is where a null gets filled: the
    // confirm step offers the VIN-less trucks and a person attaches it. See
    // `planVinFill`.
    rows.push({ kind: 'no_truck', vin: check.vin, description })
  }

  return rows
}

/**
 * What writing this VIN onto this truck would do. ADD-MISSING, NEVER REPLACE.
 *
 * The owner's ruling: the certificate's VINs fill our nulls. A truck that
 * already carries a DIFFERENT VIN is a discrepancy between two records and not
 * something a document reader gets to resolve — the same posture the load
 * import takes on every field it enriches, and the same posture `checkCarrier`
 * takes on a name that disagrees. It is reported and a person decides.
 */
export type VinFill = 'fills' | 'already_matches' | 'conflict'

export function planVinFill(
  truck: { vin: string | null },
  vin: string,
): VinFill {
  if (truck.vin === null || truck.vin.trim() === '') return 'fills'
  return sameVin(truck.vin, vin) ? 'already_matches' : 'conflict'
}

// ── WHAT THE CONFIRM STEP SHOWS ────────────────────────────────────────────

/** One coverage row, transcribed, judged, and ready to become a record. */
export interface CoiCoverage {
  /** The TYPE OF INSURANCE cell as printed. Shown verbatim, always. */
  printedType: string | null
  /** What `coi-coverages.ts` thinks it is. A default on a control, never a value. */
  proposedType: ComplianceType | null
  /** A sentence about this coverage that a person should read. */
  caution: string | null
  /** ISO day. The compliance row's `expiresAt`, which is NOT NULL. */
  expiresAt: string | null
  effectiveAt: string | null
  identifier: string | null
  issuer: string | null
  /** Exactly as printed. Never parsed to cents here — it may not be money. */
  limit: string | null
  /**
   * The lowest confidence of any cell on this row.
   *
   * THE LOWEST, NOT THE AVERAGE OR THE FIRST. A row whose type is `high` and
   * whose policy number is `low` is a row somebody has to look at, and any
   * summary that reports better than its worst cell is the failure per-element
   * confidence was introduced to end.
   */
  confidence: Confidence
  /** Why this row cannot become a record, when it cannot. */
  refusal: RowRefusal | null
}

export interface CoiProposal {
  coverages: CoiCoverage[]
  vehicles: CoiVehicle[]
  subject: CoiSubject
  insuredName: string | null
  /**
   * The carrier cross-check — ONLY on the company branch.
   *
   * On the trucks branch the insured is SUPPOSED to be somebody else's entity,
   * so comparing it to the trucks' carrier would produce a warning on every
   * correct owner-operator certificate. `subject.because` says what happened
   * instead, which is the honest sentence for that case.
   */
  carrier: CarrierCheck | null
}

const RANK: Record<Confidence, number> = { high: 0, medium: 1, low: 2 }

/**
 * What the confirm step shows, and what a click would file.
 *
 * ── THE LIMIT GOES IN THE NOTE, NOT INTO A COLUMN ────────────────────────
 *
 * `ComplianceItem` has no money field, and adding one to hold a printed limit
 * would be a column that exists for one document type and is null on every
 * other row. The limit is evidence about the policy rather than something this
 * system computes with, so it is recorded as text where a person reads it —
 * exactly as printed, which on the first real certificate means "Deductibles -
 * Comp: $2,500, Coll: $2,500". That is not a number and was never going to be.
 *
 * ── EVERY ROW IS RETURNED, INCLUDING THE ONES THAT CANNOT BE FILED ───────
 *
 * A row with no usable expiry carries its `refusal` and travels to the screen
 * anyway. Dropping it would mean a certificate quietly evidencing less than it
 * prints — and a person looking at three coverages and two rows has learned
 * something a silently-shortened list would not have told them.
 */
export function coiProposal(
  fields: ExtractedCoi,
  against: {
    authorities: readonly CoiAuthority[]
    trucks: readonly CoiTruck[]
  },
): CoiProposal {
  const { subject, vehicles } = decideCoiSubject(fields, against)

  const coverages: CoiCoverage[] = (fields.coverages ?? []).map((row) => {
    const dates = judgeCoverageRow(row)
    const printedType = row.type?.value?.trim() || null
    const printedLimit = row.limit?.value?.trim() || null
    // THE WHOLE ROW, NOT THE TYPE CELL. On the first real certificate the
    // words "Non-Trucking Liability" came back in the LIMIT — see
    // `coi-coverages.ts` for the read and the asymmetry it forced.
    const proposal = proposeCoverage(printedType, printedLimit)

    const cells = [
      row.type,
      row.insurer,
      row.policyNumber,
      row.effectiveAt,
      row.expiresAt,
      row.limit,
    ].filter((cell) => cell !== null)
    const confidence =
      cells.length === 0
        ? 'low'
        : cells.reduce<Confidence>(
            (worst, cell) =>
              RANK[cell.confidence] > RANK[worst] ? cell.confidence : worst,
            'high',
          )

    return {
      printedType,
      proposedType: proposal.type,
      caution: proposal.caution,
      expiresAt: dates.ok ? dates.expiresIso : null,
      effectiveAt: dates.ok ? dates.effectiveIso : null,
      identifier: row.policyNumber?.value?.trim() || null,
      issuer: row.insurer?.value?.trim() || null,
      limit: printedLimit,
      confidence,
      refusal: dates.ok ? null : dates.reason,
    }
  })

  return {
    coverages,
    vehicles,
    subject,
    insuredName: fields.insuredName?.value?.trim() || null,
    carrier:
      subject.kind === 'company'
        ? checkCarrier(fields, {
            name: subject.company.name,
            mcNumber: subject.company.mcNumber,
            dotNumber: subject.company.dotNumber,
          })
        : null,
  }
}

/** Every VIN the certificate yielded that passed the check digit. For the truck lookup. */
export function readableVins(fields: ExtractedCoi): string[] {
  const out: string[] = []
  for (const vehicle of fields.vehicles ?? []) {
    const check = checkVin(vehicle.vin?.value)
    if (check?.ok) out.push(check.vin)
  }
  return out
}
