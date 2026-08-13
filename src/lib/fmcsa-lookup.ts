import type { MessageKey, Translate } from './i18n'
import {
  FmcsaError,
  type CarrierConcern,
  type CarrierRecord,
  type FmcsaFailure,
  type LookupAudience,
  carrierNumber,
  concernsFor,
  lookupCarrier,
} from './fmcsa'
import { takeLookupSlot } from './fmcsa-gate'

// ---------------------------------------------------------------------------
// ONE LOOKUP, TWO CALLERS.
//
// The Add authority screen and the broker screen ask the register the same
// question and must answer it in the same words. Two copies of "which number
// do we send", "what does a 503 say" and "which of these is worth warning
// about" is two copies that drift, and the one that drifts is the one nobody
// is looking at.
//
// WHAT IS SHARED: the budget, the number parsing, the call, and the sentences.
// WHAT IS NOT: which register field lands in which form field. `Company` and
// `Customer` are different tables with different columns, and pretending
// otherwise would put a mapping in here that neither caller could read.
// ---------------------------------------------------------------------------

export interface LookupRequest {
  /** Whatever is typed in the DOT box. May be empty. */
  dot: string
  /** Whatever is typed in the MC box. May be empty. */
  mc: string
  /** Whose budget this comes out of. */
  userId: string
}

export type LookupOutcome =
  | { ok: true; carrier: CarrierRecord }
  | { ok: false; messageKey: MessageKey; values?: Record<string, string> }

/**
 * Ask the register, within budget.
 *
 * Returns a message KEY rather than a sentence: the caller has the translator
 * and the caller decides where the words go. Nothing here throws — every way
 * this can fail is one of the sentences, because the whole contract of the
 * lookup is that it degrades to a form somebody types into.
 */
export async function runCarrierLookup(
  request: LookupRequest,
): Promise<LookupOutcome> {
  // USDOT FIRST WHEN BOTH ARE TYPED. A DOT number identifies exactly one
  // authority; a docket number can exist as MC, FF and MX at once, and the
  // register answers that endpoint with a list. Preferring the unambiguous one
  // is not a preference about which field matters.
  const dot = carrierNumber(request.dot)
  const mc = carrierNumber(request.mc)
  const query = dot
    ? ({ kind: 'dot', number: dot } as const)
    : mc
      ? ({ kind: 'mc', number: mc } as const)
      : null

  if (!query) {
    return { ok: false, messageKey: 'fmcsa.error.needNumber' }
  }

  // THE BUDGET IS TAKEN AFTER THE NUMBER IS READ AND BEFORE THE CALL. Charging
  // for a request that was never going to leave the building would let a
  // dispatcher lock themselves out by fumbling a field; not charging until
  // after the call would mean a slow register lets the burst through while it
  // is still answering.
  const slot = takeLookupSlot(request.userId)
  if (!slot.allowed) {
    return {
      ok: false,
      messageKey: 'fmcsa.error.tooMany',
      values: { seconds: String(slot.retryAfterSeconds) },
    }
  }

  try {
    return { ok: true, carrier: await lookupCarrier(query) }
  } catch (error) {
    if (error instanceof FmcsaError) {
      return { ok: false, messageKey: FAILURE_KEYS[error.reason] }
    }
    // An unexpected throw is still not worth a 500 on a form somebody can
    // finish by typing.
    return { ok: false, messageKey: 'fmcsa.error.unavailable' }
  }
}

const FAILURE_KEYS: Record<FmcsaFailure, MessageKey> = {
  no_web_key: 'fmcsa.error.noKey',
  bad_number: 'fmcsa.error.needNumber',
  not_found: 'fmcsa.error.notFound',
  http_error: 'fmcsa.error.unavailable',
  unreadable: 'fmcsa.error.unavailable',
  unreachable: 'fmcsa.error.unavailable',
}

/** `Active` / `Inactive`, in the reader's language, or null if unsaid. */
export function renderStatus(
  carrier: CarrierRecord,
  t: Translate,
): string | null {
  if (carrier.statusCode === null) return null
  return carrier.statusCode.toUpperCase() === 'A'
    ? t('fmcsa.active')
    : t('fmcsa.inactive')
}

/**
 * One sentence per thing worth saying, in the order somebody should hear it.
 *
 * The out-of-service sentence names its date, because "there is an order" and
 * "there was an order in 2019" are different facts.
 */
export function renderConcerns(
  carrier: CarrierRecord,
  audience: LookupAudience,
  t: Translate,
): string[] {
  return concernsFor(carrier, audience).map((concern) =>
    t(CONCERN_KEYS[concern]).replace('{date}', carrier.outOfServiceDate ?? ''),
  )
}

const CONCERN_KEYS: Record<CarrierConcern, MessageKey> = {
  not_allowed_to_operate: 'fmcsa.warn.notAllowedToOperate',
  out_of_service: 'fmcsa.warn.outOfService',
  inactive: 'fmcsa.warn.inactive',
  no_active_authority: 'fmcsa.warn.noActiveAuthority',
  unsatisfactory_rating: 'fmcsa.warn.unsatisfactoryRating',
  broker_authority_inactive: 'fmcsa.warn.brokerAuthorityInactive',
  broker_authority_none: 'fmcsa.warn.brokerAuthorityNone',
}
