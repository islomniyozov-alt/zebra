// ---------------------------------------------------------------------------
// A VIN TYPED ON ADD TRUCK, DECODED BY NHTSA'S vPIC (TMS §6.5 part 3, v11.54;
// owner's ruling 2026-11-24).
//
// ── A HELP, NEVER A GATE ──────────────────────────────────────────────────
//
// The decode fills make, model and year so nobody types what the VIN already
// says. It never blocks a save: a VIN vPIC does not know (an import, an old
// trailer), a timeout, or a phone with no signal all end in "Could not decode
// VIN" and three empty fields a person can type into. Nothing here is stored;
// what is in the fields when Save is pressed is what the writer gets, through
// the same `createTruck` validation as a hand-typed value.
//
// ── CALLED FROM THE BROWSER ───────────────────────────────────────────────
//
// vPIC answers `Access-Control-Allow-Origin: *`, free and keyless, so the
// office's own browser asks it directly and nothing passes through the Worker
// — no outbound call inside a request, no secret, no transaction anywhere
// near it (the latency rule: never hold Postgres across a third party).
//
// ── NOT THE CHECK DIGIT ───────────────────────────────────────────────────
//
// vPIC decodes a VIN whose check digit fails (it reports error code 1 and
// still names the maker), and so does this: `extraction/vin.ts` flags a VIN
// READ OFF A DOCUMENT, where a misread is the risk; here a person typed it and
// is looking at the truck. The only local refusal is the length — a VIN that
// is not 17 characters is not one vPIC can decode, so it is not sent.
// ---------------------------------------------------------------------------

export const VPIC_ORIGIN = 'https://vpic.nhtsa.dot.gov'

/** How long the form waits for vPIC before saying it could not decode. */
export const VIN_DECODE_TIMEOUT_MS = 8_000

export interface DecodedVin {
  make: string | null
  model: string | null
  year: number | null
}

export type VinDecode = { ok: true; decoded: DecodedVin } | { ok: false }

/** The VIN as vPIC is asked about it: trimmed, upper case, no spaces. */
export function normalizeVin(raw: string): string {
  return raw.replace(/\s+/g, '').toUpperCase()
}

/** True when the VIN is worth sending — 17 letters and digits. */
export function decodableVin(raw: string): boolean {
  return /^[A-Z0-9]{17}$/.test(normalizeVin(raw))
}

export function vpicUrl(raw: string): string {
  return `${VPIC_ORIGIN}/api/vehicles/DecodeVinValues/${encodeURIComponent(
    normalizeVin(raw),
  )}?format=json`
}

const text = (value: unknown): string | null => {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed === '' || trimmed === 'Not Applicable' ? null : trimmed
}

/**
 * vPIC's answer, read. Decoded when it names a make, a model or a year —
 * an answer with none of the three is "could not decode", whatever its
 * error code says, because there is nothing to fill.
 */
export function readVpic(body: unknown): VinDecode {
  const results = (body as { Results?: unknown } | null)?.Results
  if (!Array.isArray(results) || results.length === 0) return { ok: false }
  const row = results[0] as Record<string, unknown>
  const yearText = text(row.ModelYear)
  const year =
    yearText !== null && /^\d{4}$/.test(yearText) ? Number(yearText) : null
  const decoded: DecodedVin = {
    make: text(row.Make),
    model: text(row.Model),
    year: year !== null && year >= 1900 && year <= 2100 ? year : null,
  }
  if (decoded.make === null && decoded.model === null && decoded.year === null)
    return { ok: false }
  return { ok: true, decoded }
}

/**
 * Ask vPIC about one VIN. Every failure — not 17 characters, no network, a
 * timeout, a non-200, a body that is not JSON — is `{ ok: false }`, never a
 * throw: the caller's only response to any of them is the same sentence.
 */
export async function decodeVin(
  raw: string,
  fetchImpl: typeof fetch = fetch,
  timeoutMs: number = VIN_DECODE_TIMEOUT_MS,
): Promise<VinDecode> {
  if (!decodableVin(raw)) return { ok: false }
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const response = await fetchImpl(vpicUrl(raw), {
      signal: controller.signal,
    })
    if (!response.ok) return { ok: false }
    return readVpic(await response.json())
  } catch {
    return { ok: false }
  } finally {
    clearTimeout(timer)
  }
}

// ---------------------------------------------------------------------------
// THE CROSS-CHECK (TMS §6.5 part 4, v11.55). When make, model or year came
// from a registration or from the keyboard, the decode does not overwrite
// them: it says where vPIC disagrees, and the form shows "VIN decodes to …"
// beside the field. A mismatch to look at, never a correction.
//
// A CAB CARD ABBREVIATES THE MAKE. States print the NCIC vehicle make code —
// FRHT, KW, PTRB — where vPIC says FREIGHTLINER, KENWORTH, PETERBILT. Without
// the codes below every registration would "disagree" with its own VIN. A
// code not listed still agrees when one name begins the other (UTILITY and
// UTILITY TRAILER MANUFACTURER); anything else is a mismatch, which costs a
// look, never a block.
// ---------------------------------------------------------------------------

export type DecodeField = 'make' | 'model' | 'year'

/** NCIC make codes seen on tractor and trailer cab cards, to vPIC's names. */
export const NCIC_MAKES: Readonly<Record<string, string>> = {
  FRHT: 'FREIGHTLINER',
  FRTL: 'FREIGHTLINER',
  KW: 'KENWORTH',
  KENW: 'KENWORTH',
  PTRB: 'PETERBILT',
  PETE: 'PETERBILT',
  INTL: 'INTERNATIONAL',
  NAVI: 'INTERNATIONAL',
  VOLV: 'VOLVO TRUCK',
  WSTR: 'WESTERN STAR',
  UTIL: 'UTILITY TRAILER MANUFACTURER',
  UTLT: 'UTILITY TRAILER MANUFACTURER',
  GDAN: 'GREAT DANE',
  WABA: 'WABASH',
  WBSH: 'WABASH',
  HYUN: 'HYUNDAI TRANSLEAD',
  STOU: 'STOUGHTON',
  VANG: 'VANGUARD',
}

const squash = (value: string) => value.toUpperCase().replace(/[^A-Z0-9]/g, '')

/** True when two spellings of a make or model name the same thing. */
function sameName(a: string, b: string, codes: boolean): boolean {
  const left = squash(codes ? (NCIC_MAKES[squash(a)] ?? a) : a)
  const right = squash(codes ? (NCIC_MAKES[squash(b)] ?? b) : b)
  if (left === '' || right === '') return true
  return left.startsWith(right) || right.startsWith(left)
}

/**
 * vPIC's value for each field whose current value disagrees with it. A field
 * that is empty, or that vPIC says nothing about, is never a mismatch.
 */
export function decodeMismatches(
  current: Readonly<Record<DecodeField, string>>,
  decoded: DecodedVin,
): Partial<Record<DecodeField, string>> {
  const out: Partial<Record<DecodeField, string>> = {}
  const make = current.make.trim()
  if (
    make !== '' &&
    decoded.make !== null &&
    !sameName(make, decoded.make, true)
  )
    out.make = decoded.make
  const model = current.model.trim()
  if (
    model !== '' &&
    decoded.model !== null &&
    !sameName(model, decoded.model, false)
  )
    out.model = decoded.model
  const year = current.year.trim()
  if (year !== '' && decoded.year !== null && Number(year) !== decoded.year)
    out.year = String(decoded.year)
  return out
}

/** Where a decoded field's value came from, as the form tracks it. */
export type FieldSource = 'none' | 'vin' | 'doc' | 'typed'

export interface DecodeMerge {
  /** The values the decode puts in the fields. */
  fill: Partial<Record<DecodeField, string>>
  /** Each field the decode filled, now sourced from the VIN. */
  filled: DecodeField[]
  /** "VIN decodes to {value}", beside a kept field vPIC disagrees with. */
  mismatch: Partial<Record<DecodeField, string>>
  /** "Card: {value}", the card's spelling of a make the decode replaced. */
  card: Partial<Record<DecodeField, string>>
}

/**
 * WHAT ONE DECODE DOES TO THE FORM (TMS §6.5 parts 3–5).
 *
 * - A field that is empty, or that the decode itself filled, takes vPIC's
 *   value.
 * - THE MAKE FROM THE DOCUMENT IS REPLACED (part 5, v11.56): vPIC's make is
 *   the make, and the card's own spelling (VOLV for VOLVO TRUCK) is kept
 *   beside it as "Card: …" whenever the two are not the same letters.
 * - Any other field holding a value from the document, and ANY field typed
 *   by hand, keeps it; where vPIC disagrees, "VIN decodes to …" is shown.
 * - A field vPIC says nothing about is left exactly as it is.
 */
export function mergeDecode(
  fields: readonly DecodeField[],
  current: Readonly<Record<DecodeField, string>>,
  sources: Readonly<Record<DecodeField, FieldSource>>,
  decoded: DecodedVin,
): DecodeMerge {
  const out: DecodeMerge = { fill: {}, filled: [], mismatch: {}, card: {} }
  const kept: Record<DecodeField, string> = { make: '', model: '', year: '' }
  for (const field of fields) {
    const answer =
      field === 'year'
        ? decoded.year === null
          ? null
          : String(decoded.year)
        : decoded[field]
    if (answer === null) continue
    const now = current[field].trim()
    const replaceDocMake = field === 'make' && sources.make === 'doc'
    if (now === '' || sources[field] === 'vin' || replaceDocMake) {
      out.fill[field] = answer
      out.filled.push(field)
      if (replaceDocMake && now !== '' && squash(now) !== squash(answer))
        out.card[field] = now
    } else {
      kept[field] = current[field]
    }
  }
  out.mismatch = decodeMismatches(kept, decoded)
  return out
}
