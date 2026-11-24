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
