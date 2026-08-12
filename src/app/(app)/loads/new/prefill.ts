import { normalizeTypedDate } from '@/lib/typed-date'
import type { Prefill } from './RateConOffer'

// ---------------------------------------------------------------------------
// WHAT THE FORM READS OUT OF AN EXTRACTION.
//
// Pure functions, in their own module, because the form they belong to is a
// client component whose imports reach `server-only` — so nothing in it can be
// unit tested. These three are the whole path between what a model said and
// what a dispatcher sees, and the paste walkthrough found a bug in one of them
// that reading the code twice did not.
// ---------------------------------------------------------------------------

export type StopKind = 'PICKUP' | 'DELIVERY' | 'INTERMEDIATE'

/**
 * One field out of an extraction, by dotted path.
 *
 * Returns null when the model did not carry it OR when the whole extraction is
 * absent — the caller then falls back to an empty input, which is exactly the
 * typing path. A missing field must never become an empty string in a form,
 * because an empty string is a value somebody has to notice is wrong.
 */
export function fieldAt(
  prefill: Prefill | null,
  path: string,
): { value: unknown; confidence: string } | null {
  if (!prefill) return null

  const stop = /^stops\[(\d+)\]\.(\w+)$/.exec(path)
  const source = prefill.extracted as unknown as Record<string, unknown>

  // Three shapes, and the third is the one that was missing: `money.linehaul`
  // was looked up as a literal key called "money.linehaul", found nothing, and
  // left the rate field empty on a form that had everything else right. The
  // walkthrough caught it; a type could not, because the payload is `unknown`
  // by the time it gets here.
  const money = /^money\.(\w+)$/.exec(path)

  const raw = stop
    ? ((source['stops'] as Record<string, unknown>[] | undefined)?.[
        Number(stop[1])
      ]?.[stop[2]!] ?? null)
    : money
      ? ((source['money'] as Record<string, unknown> | undefined)?.[
          money[1]!
        ] ?? null)
      : (source[path] ?? null)

  if (!raw || typeof raw !== 'object') return null
  return raw as { value: unknown; confidence: string }
}

/**
 * A stop's date, in the form's own typed-date convention.
 *
 * The model returns `2026-08-14T07:00` — a local ISO value with no zone, which
 * is what the document printed. `normalizeTypedDate` already accepts the date
 * half of that, so the conversion is a slice rather than a parse: no Date
 * object is constructed, and therefore no timezone is applied to a value that
 * never had one. A document saying 14 August must not become the 13th because
 * the browser is west of UTC.
 *
 * The window start is preferred over the appointment when both are present:
 * "06:00 - 10:00" means the driver may arrive at six, and the earlier number is
 * the one a dispatcher plans against.
 */
export function typedDateFrom(
  prefill: Prefill,
  stopPath: string,
): string | null {
  const scheduled = fieldAt(prefill, `${stopPath}.scheduledAt`)
  const windowStart = fieldAt(prefill, `${stopPath}.windowStart`)
  // `??` FALLS THROUGH ON null AND undefined AND NOT ON ''. A model that sends
  // `windowStart: ""` would otherwise win over a perfectly good scheduledAt,
  // slice to an empty string and normalise to null — a stop with a printed
  // date arriving dateless. Emptiness is absence here.
  const text = (value: unknown) =>
    typeof value === 'string' && value.trim() !== '' ? value : null
  const raw = text(windowStart?.value) ?? text(scheduled?.value)
  if (raw === null) return null

  const day = raw.slice(0, 10)
  return normalizeTypedDate(day)
}

/**
 * The type the extraction READ for a stop, if it read one.
 *
 * Null rather than a guess. §6's acceptance says "types read not assumed", and
 * the position of a stop in a list is exactly the assumption it forbids: a
 * four-stop Amazon run can be pick, pick, drop, drop.
 */
export function stopTypeFrom(prefill: Prefill, index: number): StopKind | null {
  const field = fieldAt(prefill, `stops[${index}].type`)
  const value = typeof field?.value === 'string' ? field.value : null
  return value === 'PICKUP' || value === 'DELIVERY' || value === 'INTERMEDIATE'
    ? value
    : null
}

/**
 * The stop rows a prefill implies, merged over the rows already on screen.
 *
 * Its own function because the component cannot be imported into a test — and
 * because this is where the interesting decisions are: how many rows, whose
 * type wins, and whether a date the dispatcher typed survives.
 */
export function stopRowsFrom<
  T extends { key: string; type: StopKind; date: string },
>(
  prefill: Prefill,
  current: readonly T[],
  mintKey: () => string,
): { key: string; type: StopKind; date: string }[] | null {
  const stops = (prefill.extracted as { stops?: unknown[] }).stops ?? []
  if (stops.length < 2) return null

  return stops.map((_, index) => ({
    key: current[index]?.key ?? mintKey(),
    // READ, NEVER ASSUMED (spec §5, brief §6). Position implies nothing: a
    // four-stop Amazon run can be pick, pick, drop, drop.
    type: stopTypeFrom(prefill, index) ?? current[index]?.type ?? 'DELIVERY',
    // A date the dispatcher already typed is never overwritten — the same
    // rule the rate follows.
    date:
      current[index]?.date || typedDateFrom(prefill, `stops[${index}]`) || '',
  }))
}
