import { readCostOf, type AskResult, type ReadCost } from './claude'
import { askModel } from './model-engine'
import { readNothing } from './extraction/read-nothing'
import { parseAnnualInspectionResponse } from './extraction/inspection-parse'
import { ANNUAL_INSPECTION_SYSTEM_WITH_SCHEMA } from './extraction/inspection-prompt'
import {
  inspectionExpiry,
  judgeInspection,
  type InspectionVerdicts,
} from './extraction/inspection-fields'
import type { ExtractedAnnualInspection } from './extraction/inspection-shape'
import { sameVin } from './extraction/vin'

// ---------------------------------------------------------------------------
// READING AN ANNUAL DOT INSPECTION (TMS §7.8, v11.47).
//
// The same posture as `med-cert.ts` — claim, call, parse, judge, never write —
// with one deliberate difference: a doubtful field is UNREADABLE on its own
// (`inspection-fields.ts`) instead of discarding the reading. The whole read
// is refused only when nothing usable came back at all.
//
// IT NEVER WRITES. It returns a proposal; a person confirms the truck and the
// values, and the confirm form files through `readRenewalForm` and
// `recordRenewal` — the compliance panel's own path (§0 rule 14).
// ---------------------------------------------------------------------------

export type AnnualInspectionReadOutcome =
  | {
      ok: true
      fields: ExtractedAnnualInspection
      verdicts: InspectionVerdicts
      cost: ReadCost
    }
  | {
      ok: false
      reason: 'unsupported_type' | 'call_failed' | 'unparsable' | 'read_nothing'
      /** What the attempt cost, or null when no engine was reached. */
      cost: ReadCost | null
    }

export async function readAnnualInspection(input: {
  base64: string
  mimeType: string
  /** Named by an accuracy run, absent everywhere else. */
  model?: string
  apiKey?: string
  /** The day the document arrived. The clock is read here and nowhere deeper. */
  uploadedOn?: Date
}): Promise<AnnualInspectionReadOutcome> {
  let answer: AskResult
  try {
    answer = await askModel({
      base64: input.base64,
      mimeType: input.mimeType,
      system: ANNUAL_INSPECTION_SYSTEM_WITH_SCHEMA,
      prompt:
        'Read this annual vehicle inspection report and return the JSON described.',
      kind: 'inspection',
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
    return { ok: false, reason, cost: null }
  }

  const cost = readCostOf(answer)
  let fields: ExtractedAnnualInspection
  try {
    fields = parseAnnualInspectionResponse(answer.text)
  } catch {
    return { ok: false, reason: 'unparsable', cost }
  }
  if (readNothing({ base64: input.base64, fields })) {
    return { ok: false, reason: 'read_nothing', cost }
  }
  const verdicts = judgeInspection(
    fields,
    (input.uploadedOn ?? new Date()).toISOString().slice(0, 10),
  )
  return { ok: true, fields, verdicts, cost }
}

export interface TruckCandidate {
  id: string
  unitNumber: string
  vin: string | null
}

export type TruckMatch =
  | { kind: 'one'; truck: TruckCandidate; by: 'unit' | 'vin' }
  | { kind: 'none' }
  | { kind: 'several'; trucks: TruckCandidate[] }

/**
 * Propose the truck: an EXACT fleet-unit match, else an exact VIN match. It
 * proposes; a person confirms. Nearest-match is refused for the reason
 * `matchDriverByName` gives — a roster has near-twins, and a wrong truck is a
 * wrong legal record.
 */
export function matchTruck(
  verdicts: InspectionVerdicts,
  trucks: readonly TruckCandidate[],
): TruckMatch {
  const fold = (text: string) => text.trim().toUpperCase()
  if (verdicts.fleetUnit.read) {
    const unit = fold(verdicts.fleetUnit.value)
    const byUnit = trucks.filter((truck) => fold(truck.unitNumber) === unit)
    if (byUnit.length === 1)
      return { kind: 'one', truck: byUnit[0]!, by: 'unit' }
    if (byUnit.length > 1) return { kind: 'several', trucks: byUnit }
  }
  if (verdicts.vin.read) {
    const vin = verdicts.vin.value
    const byVin = trucks.filter((truck) => sameVin(truck.vin, vin))
    if (byVin.length === 1) return { kind: 'one', truck: byVin[0]!, by: 'vin' }
    if (byVin.length > 1) return { kind: 'several', trucks: byVin }
  }
  return { kind: 'none' }
}

/**
 * What the confirm form is prefilled with, in the compliance panel's own field
 * names (`COMPLIANCE_FORM_FIELDS`). An unreadable field is the empty string —
 * the form shows "—, enter by hand" beside it — never a guess.
 */
export interface InspectionFormPrefill {
  expiresAt: string
  issuedAt: string
  identifier: string
  issuer: string
  notes: string
}

/** `yyyy-mm-dd` to `mm/dd/yyyy`, the way the typed-date fields show a date. */
const typedDate = (iso: string) => {
  const [year, month, day] = iso.split('-')
  return `${month}/${day}/${year}`
}

export function inspectionPrefill(
  verdicts: InspectionVerdicts,
): InspectionFormPrefill {
  const issuer = [
    verdicts.inspectorName.read ? verdicts.inspectorName.value : '',
    verdicts.agency.read ? verdicts.agency.value : '',
  ]
    .filter((part) => part !== '')
    .join(' · ')
  return {
    issuedAt: verdicts.inspectionDate.read
      ? typedDate(verdicts.inspectionDate.value)
      : '',
    expiresAt: verdicts.inspectionDate.read
      ? typedDate(inspectionExpiry(verdicts.inspectionDate.value))
      : '',
    identifier: verdicts.reportNumber.read ? verdicts.reportNumber.value : '',
    issuer,
    notes: verdicts.result.read
      ? `Annual inspection ${verdicts.result.value}`
      : '',
  }
}
