import type { Confidence, Maybe } from './envelope'
import type { ExtractedAnnualInspection } from './inspection-shape'
import { parseUsDate } from './us-dates'
import { checkVin } from './vin'

// ---------------------------------------------------------------------------
// EACH FIELD READ OR UNREADABLE — NEVER A GUESS (TMS §7.8, v11.47).
//
// Where this departs from the medical card on purpose. `refuseMedicalCert`
// throws the whole reading away when its spine is doubtful, because a medical
// card has one fact that matters. The owner's ruling here is per field: an
// inspection whose VIN was cut off by the photo's edge still has a legible
// report number and date, and the office should not retype those. So each
// field is judged alone, and a doubtful one becomes `unreadable` — shown as
// "—, enter by hand" — while the rest stand.
//
// PURE, AND THE CLOCK IS PASSED IN. One rule needs the upload day; the reader
// supplies it, as `readMedicalCert` does for its own rule.
// ---------------------------------------------------------------------------

/** Why a field came back unreadable. Each one is a sentence on the form. */
export type UnreadableWhy =
  /** The document does not show it, or the reader returned nothing. */
  | 'not_shown'
  /** The reader said it was reconstructing. */
  | 'low_confidence'
  /** An inspection date that does not convert under `parseUsDate`. */
  | 'not_a_date'
  /** An inspection date after the day the document arrived. */
  | 'after_upload'
  /** A VIN of the wrong length, an illegal character, or a bad check digit. */
  | 'vin_invalid'
  /** A result that does not say passed or failed in so many words. */
  | 'not_pass_fail'

export type Verdict<T, W extends string = UnreadableWhy> =
  | { read: true; value: T; printed: string; confidence: Confidence }
  | {
      read: false
      why: W | 'not_shown' | 'low_confidence'
      printed: string | null
    }

export type InspectionResult = 'passed' | 'failed'

export interface InspectionVerdicts {
  reportNumber: Verdict<string>
  /** ISO `yyyy-mm-dd`, converted from what was printed. */
  inspectionDate: Verdict<string>
  fleetUnit: Verdict<string>
  /** Upper-cased, de-spaced, check digit verified. */
  vin: Verdict<string>
  inspectorName: Verdict<string>
  agency: Verdict<string>
  result: Verdict<InspectionResult>
}

/** Confidence a value must carry to be shown as read. */
const READABLE: readonly Confidence[] = ['high', 'medium']

/**
 * One field, judged alone: not shown, low confidence, or refused by its
 * converter is unreadable; anything else is read. Shared with the
 * registration reader (`registration-fields.ts`), whose converters name
 * their own reasons.
 */
export function judge<T, W extends string = UnreadableWhy>(
  field: Maybe<string>,
  convert: (printed: string) => { ok: true; value: T } | { ok: false; why: W },
): Verdict<T, W> {
  const printed = field?.value?.trim() ?? ''
  if (!field || printed === '')
    return { read: false, why: 'not_shown', printed: null }
  if (!READABLE.includes(field.confidence)) {
    return { read: false, why: 'low_confidence', printed }
  }
  const converted = convert(printed)
  if (!converted.ok) return { read: false, why: converted.why, printed }
  return {
    read: true,
    value: converted.value,
    printed,
    confidence: field.confidence,
  }
}

export const asText = (printed: string) => ({
  ok: true as const,
  value: printed,
})

/** `passed` or `failed` only when the words say so, and only one of them. */
export function readResult(
  printed: string,
): { ok: true; value: InspectionResult } | { ok: false; why: 'not_pass_fail' } {
  const passed = /\bpass(ed|es)?\b/i.test(printed)
  const failed = /\bfail(ed|s|ure)?\b/i.test(printed)
  if (passed === failed) return { ok: false, why: 'not_pass_fail' }
  return { ok: true, value: passed ? 'passed' : 'failed' }
}

export function judgeInspection(
  fields: ExtractedAnnualInspection,
  uploadedOnIso: string,
): InspectionVerdicts {
  return {
    reportNumber: judge(fields.reportNumber, asText),
    inspectionDate: judge(fields.inspectionDate, (printed) => {
      const date = parseUsDate(printed)
      if (!date.ok) return { ok: false, why: 'not_a_date' }
      if (date.iso > uploadedOnIso) return { ok: false, why: 'after_upload' }
      return { ok: true, value: date.iso }
    }),
    fleetUnit: judge(fields.fleetUnit, asText),
    vin: judge(fields.vin, (printed) => {
      const check = checkVin(printed)
      // Never corrected: a VIN that fails is unreadable, not "nearly right".
      if (!check?.ok) return { ok: false, why: 'vin_invalid' }
      return { ok: true, value: check.vin }
    }),
    inspectorName: judge(fields.inspectorName, asText),
    agency: judge(fields.agency, asText),
    result: judge(fields.result, readResult),
  }
}

/**
 * The expiry an annual inspection implies: the same day twelve months later
 * (49 CFR 396.17). Derived by this rule and shown as derived, never read. The
 * 29th of February lands on the 28th.
 */
export function inspectionExpiry(inspectionIso: string): string {
  const [year, month, day] = inspectionIso.split('-').map(Number) as [
    number,
    number,
    number,
  ]
  const lastOfMonth = new Date(Date.UTC(year + 1, month, 0)).getUTCDate()
  return new Date(Date.UTC(year + 1, month - 1, Math.min(day, lastOfMonth)))
    .toISOString()
    .slice(0, 10)
}
