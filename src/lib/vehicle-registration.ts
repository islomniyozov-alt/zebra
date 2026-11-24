import { readCostOf, type AskResult, type ReadCost } from './claude'
import { askModel } from './model-engine'
import { readNothing } from './extraction/read-nothing'
import { parseRegistrationResponse } from './extraction/registration-parse'
import { REGISTRATION_SYSTEM_WITH_SCHEMA } from './extraction/registration-prompt'
import {
  judgeRegistration,
  registrationPrefill,
  type RegistrationFormField,
  type RegistrationVerdicts,
} from './extraction/registration-fields'
import type { ExtractedRegistration } from './extraction/registration-shape'

// ---------------------------------------------------------------------------
// READING A VEHICLE REGISTRATION (TMS §6.5 part 4, v11.55).
//
// The inspection reader's posture (`annual-inspection.ts`) — call, parse,
// judge, never write — with its per-field rule: a doubtful field is
// unreadable on its own and the rest stand. The whole read is refused only
// when nothing usable came back at all.
//
// IT NEVER WRITES. It returns a reading; the person fills or corrects the
// Add truck form and Save is the write (`new-asset.ts`).
// ---------------------------------------------------------------------------

export type RegistrationReadOutcome =
  | {
      ok: true
      fields: ExtractedRegistration
      verdicts: RegistrationVerdicts
      prefill: Partial<Record<RegistrationFormField, string>>
      cost: ReadCost
    }
  | {
      ok: false
      reason: 'unsupported_type' | 'call_failed' | 'unparsable' | 'read_nothing'
      /** What the attempt cost, or null when no engine was reached. */
      cost: ReadCost | null
    }

export async function readRegistration(input: {
  base64: string
  mimeType: string
  /** Named by an accuracy run, absent everywhere else. */
  model?: string
  apiKey?: string
  /** The day the document arrived. The clock is read here and nowhere deeper. */
  uploadedOn?: Date
}): Promise<RegistrationReadOutcome> {
  let answer: AskResult
  try {
    answer = await askModel({
      base64: input.base64,
      mimeType: input.mimeType,
      system: REGISTRATION_SYSTEM_WITH_SCHEMA,
      prompt:
        'Read this vehicle registration (cab card) and return the JSON described.',
      kind: 'registration',
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
  let fields: ExtractedRegistration
  try {
    fields = parseRegistrationResponse(answer.text)
  } catch {
    return { ok: false, reason: 'unparsable', cost }
  }
  if (readNothing({ base64: input.base64, fields })) {
    return { ok: false, reason: 'read_nothing', cost }
  }
  const verdicts = judgeRegistration(
    fields,
    (input.uploadedOn ?? new Date()).toISOString().slice(0, 10),
  )
  return {
    ok: true,
    fields,
    verdicts,
    prefill: registrationPrefill(verdicts),
    cost,
  }
}
