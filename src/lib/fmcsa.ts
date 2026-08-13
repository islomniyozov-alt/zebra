// ---------------------------------------------------------------------------
// FMCSA QCMobile, FROM THE WORKER.
//
// `fetch` only, for the reason claude.ts and gemini.ts give: this runs on
// workerd, and the whole surface needed here is a GET with a query parameter.
//
// THE WEBKEY NEVER LEAVES THE SERVER. It is a secret on the worker
// (`FMCSA_WEBKEY`), read here and nowhere else, and every caller is a server
// action — a browser fetch to this API would put the key in the network tab of
// anybody who opened the form.
//
// WHAT THIS MODULE IS FOR, beyond the Add Authority screen: the same lookup
// verifies a BROKER. A carrier checking whether a broker's authority is active
// before hauling for them is the same question against the same record with a
// different `censusType`, so nothing here knows about companies, customers or
// any screen. It takes a number and returns what the register says.
//
// IT REPORTS, IT DOES NOT DECIDE. `concernsFor` names what is wrong with an
// authority; whether that blocks anything is the caller's business. Phase 4's
// warn-not-block posture is the precedent and the reason: the office knows
// things the register does not, and a lookup that refused to fill in a form
// would be a lookup people work around.
//
// UNVERIFIED AGAINST THE LIVE API AT THE TIME OF WRITING. `FMCSA_WEBKEY` is
// set on the workers by the owner and deliberately absent from this machine,
// so the shapes below are the DOCUMENTED ones and the tests are written from
// the documentation rather than from a recorded response. `parseCarrier` is
// therefore deliberately forgiving about what is missing and strict about what
// it claims: a field it cannot find is null, never a guess.
// ---------------------------------------------------------------------------

const ENDPOINT = 'https://mobile.fmcsa.dot.gov/qc/services/carriers'

/** Ten seconds. A form is waiting, and a hung lookup must fall back to typing. */
const TIMEOUT_MS = 10_000

export type FmcsaFailure =
  | 'no_web_key'
  | 'bad_number'
  | 'not_found'
  | 'http_error'
  | 'unreadable'
  | 'unreachable'

export class FmcsaError extends Error {
  constructor(
    readonly reason: FmcsaFailure,
    message: string,
    readonly status?: number,
  ) {
    super(message)
    this.name = 'FmcsaError'
  }
}

/** Which register number was typed. The two endpoints are different URLs. */
export type CarrierQueryKind = 'dot' | 'mc'

export interface CarrierQuery {
  kind: CarrierQueryKind
  /** Digits only. See `carrierNumber`. */
  number: string
}

/**
 * What the register says about one authority.
 *
 * EVERY FIELD NULLABLE, because every field is absent for somebody. A carrier
 * registered last week has no safety rating; a sole proprietor has no DBA. A
 * shape that pretended otherwise would push the guessing into the callers.
 */
export interface CarrierRecord {
  dotNumber: string | null
  legalName: string | null
  dbaName: string | null
  addressLine1: string | null
  city: string | null
  state: string | null
  postalCode: string | null
  phone: string | null
  /** `CARRIER`, `BROKER`, `SHIPPER` — the register's own words. */
  entityType: string | null
  /** `Interstate`, `Intrastate Non-Hazmat` — the register's own words. */
  operation: string | null
  /** `Y`/`N` as a boolean; null when the field is absent. */
  allowedToOperate: boolean | null
  /** `A` active, `I` inactive. Kept as the letter; `concernsFor` reads it. */
  statusCode: string | null
  /** Present means an out-of-service order. The date is the register's. */
  outOfServiceDate: string | null
  /** `A` active, `I` inactive, `N` none — per authority kind. */
  commonAuthority: string | null
  contractAuthority: string | null
  brokerAuthority: string | null
  safetyRating: string | null
}

/**
 * Something worth saying out loud about this authority.
 *
 * Names rather than sentences: the words live in the message catalogue with
 * every other sentence a person reads, in three languages.
 */
export type CarrierConcern =
  | 'not_allowed_to_operate'
  | 'out_of_service'
  | 'inactive'
  | 'no_active_authority'
  | 'unsatisfactory_rating'

/**
 * A typed register number, as digits.
 *
 * Accepts what somebody actually types: `MC-123456`, `mc 123456`, `USDOT
 * 1234567`, `1234567`. The API takes the bare number — a docket lookup for
 * `MC-123456` is `/docket-number/123456` — so the prefix is stripped rather
 * than sent, and anything that is not a plain number after that is refused
 * instead of being sent as a URL segment.
 */
export function carrierNumber(typed: string): string | null {
  const stripped = typed
    .trim()
    .replace(/^(us\s*dot|usdot|dot|mc|mx|ff)[\s.:#-]*/i, '')
    .replace(/[\s,]/g, '')
  return /^\d{1,9}$/.test(stripped) ? String(Number(stripped)) : null
}

export interface LookupOptions {
  webKey?: string | undefined
  /** Injected in tests. Nothing else has a reason to pass it. */
  fetchImpl?: typeof fetch
}

/**
 * One authority, from the register.
 *
 * Throws `FmcsaError` with a named reason for everything, so the caller can
 * turn each into its own sentence — and, more to the point, so a lookup that
 * fails degrades to a form somebody types into rather than to a stack trace.
 */
export async function lookupCarrier(
  query: CarrierQuery,
  options: LookupOptions = {},
): Promise<CarrierRecord> {
  const webKey = options.webKey ?? process.env.FMCSA_WEBKEY
  if (!webKey) {
    throw new FmcsaError(
      'no_web_key',
      'FMCSA_WEBKEY is not set on this worker.',
    )
  }
  if (!/^\d{1,9}$/.test(query.number)) {
    throw new FmcsaError('bad_number', `Not a register number: ${query.number}`)
  }

  const path =
    query.kind === 'dot'
      ? `${ENDPOINT}/${query.number}`
      : `${ENDPOINT}/docket-number/${query.number}`

  const call = options.fetchImpl ?? fetch

  let response: Response
  try {
    response = await call(
      `${path}?webKey=${encodeURIComponent(webKey)}`,
      // Explicit and short. FMCSA is a public service with public-service
      // latency, and the alternative to a timeout is a form that spins.
      { headers: { accept: 'application/json' }, signal: timeout() },
    )
  } catch (error) {
    // A DNS failure, a TLS failure, an abort. All one thing to the person
    // waiting: the register did not answer, type it in.
    throw new FmcsaError(
      'unreachable',
      `FMCSA did not answer: ${error instanceof Error ? error.message : 'unknown'}`,
    )
  }

  // 404 IS AN ANSWER, NOT A FAULT. "No carrier with that number" is a sentence
  // worth showing; "FMCSA returned 404" is not.
  if (response.status === 404) {
    throw new FmcsaError('not_found', `No carrier for ${query.number}.`, 404)
  }
  if (!response.ok) {
    const body = await response.text().catch(() => '')
    throw new FmcsaError(
      'http_error',
      `FMCSA returned ${response.status}: ${body.slice(0, 200)}`,
      response.status,
    )
  }

  let payload: unknown
  try {
    payload = await response.json()
  } catch {
    throw new FmcsaError('unreadable', 'FMCSA did not return JSON.')
  }

  const carrier = parseCarrier(payload)
  if (!carrier) {
    // A 200 WITH NOTHING IN IT IS HOW THIS API SAYS NOT FOUND, at least on the
    // docket endpoint, which answers an unknown number with an empty content
    // array rather than a 404. Mapped onto the same named failure so the
    // screen says one thing for one situation.
    throw new FmcsaError('not_found', `No carrier for ${query.number}.`)
  }
  return carrier
}

/** `AbortSignal.timeout` exists on workerd; guarded for older runtimes. */
function timeout(): AbortSignal | undefined {
  return typeof AbortSignal !== 'undefined' && 'timeout' in AbortSignal
    ? AbortSignal.timeout(TIMEOUT_MS)
    : undefined
}

/**
 * The register's JSON, as a `CarrierRecord`, or null when there is no carrier
 * in it.
 *
 * TWO SHAPES, because the two endpoints differ: a DOT lookup answers with
 * `content` as an OBJECT holding one carrier, and a docket lookup with
 * `content` as an ARRAY — one entry per prefix, since a single docket number
 * can exist as MC, FF and MX. The first entry is taken: they describe the same
 * authority and differ in the prefix, which this module does not report.
 *
 * Exported because it is the half worth testing. `lookupCarrier` is a `fetch`
 * and this is the reading.
 */
export function parseCarrier(payload: unknown): CarrierRecord | null {
  const content = (payload as { content?: unknown } | null)?.content
  const first = Array.isArray(content) ? content[0] : content
  const carrier = (first as { carrier?: unknown } | null)?.carrier
  if (!carrier || typeof carrier !== 'object') return null

  const row = carrier as Record<string, unknown>

  // Every reader is null-on-anything-unexpected. The register is a third
  // party: a field that changes type must produce a blank on a form, never a
  // "[object Object]" in a legal name.
  const text = (key: string): string | null => {
    const value = row[key]
    if (typeof value === 'string') return value.trim() || null
    if (typeof value === 'number') return String(value)
    return null
  }
  const nested = (key: string, inner: string): string | null => {
    const value = row[key]
    if (!value || typeof value !== 'object') return null
    const found = (value as Record<string, unknown>)[inner]
    return typeof found === 'string' ? found.trim() || null : null
  }
  const yesNo = (key: string): boolean | null => {
    const value = text(key)
    if (value === null) return null
    return value.toUpperCase() === 'Y'
      ? true
      : value.toUpperCase() === 'N'
        ? false
        : null
  }

  return {
    dotNumber: text('dotNumber'),
    legalName: text('legalName'),
    dbaName: text('dbaName'),
    // The PHYSICAL address, not the mailing one. An authority's physical
    // address is what its invoices carry and what a DOT audit uses; the
    // mailing address is frequently an accountant's office.
    addressLine1: text('phyStreet'),
    city: text('phyCity'),
    state: text('phyState'),
    postalCode: text('phyZipcode'),
    // Passed through exactly as the register holds it — usually ten bare
    // digits. NOT reformatted into (214) 555-1234: the extraction contract's
    // rule 5 forbids the reader computing values, and a phone number somebody
    // can compare against the register beats a prettier one they cannot.
    phone: text('telephone'),
    entityType: nested('censusTypeId', 'censusTypeDesc'),
    operation: nested('carrierOperation', 'carrierOperationDesc'),
    allowedToOperate: yesNo('allowedToOperate'),
    statusCode: text('statusCode'),
    // Null is the good news: a date here is an out-of-service order.
    outOfServiceDate: text('oosDate'),
    commonAuthority: text('commonAuthorityStatus'),
    contractAuthority: text('contractAuthorityStatus'),
    brokerAuthority: text('brokerAuthorityStatus'),
    safetyRating: text('safetyRating'),
  }
}

/**
 * Everything wrong with this authority, in the order somebody should hear it.
 *
 * WORDS, NOT A SCORE. Phase 4's dispatch-time compliance warning is the
 * precedent: a sentence naming what is wrong beats a badge, because a badge
 * has to be interpreted and a sentence can be acted on.
 *
 * `allowedToOperate: N` comes first because it is the one that ends the
 * conversation — everything else is a reason it might be N.
 */
export function concernsFor(carrier: CarrierRecord): CarrierConcern[] {
  const concerns: CarrierConcern[] = []

  if (carrier.allowedToOperate === false) {
    concerns.push('not_allowed_to_operate')
  }
  if (carrier.outOfServiceDate) concerns.push('out_of_service')
  if (carrier.statusCode && carrier.statusCode.toUpperCase() === 'I') {
    concerns.push('inactive')
  }

  // NONE OF THE THREE ACTIVE. Reported only when the register actually
  // answered about all three: a record with every authority field absent is a
  // record that says nothing, and "no active authority" would be this module
  // inventing bad news out of a gap.
  const authorities = [
    carrier.commonAuthority,
    carrier.contractAuthority,
    carrier.brokerAuthority,
  ]
  if (
    authorities.some((status) => status !== null) &&
    !authorities.some((status) => status?.toUpperCase() === 'A')
  ) {
    concerns.push('no_active_authority')
  }

  // The register's own word. "Conditional" is not listed: it is a real rating
  // a real carrier hauls under, and warning about it would be this screen
  // taking a position the FMCSA did not.
  if (carrier.safetyRating?.toUpperCase() === 'U') {
    concerns.push('unsatisfactory_rating')
  }

  return concerns
}
