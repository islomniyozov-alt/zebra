import type { PeriodWindow } from '@/lib/rolling-period'
import type { RawParams } from '@/lib/list-view'

// ---------------------------------------------------------------------------
// THE ROLLING WINDOW, PUSHED INTO THE PARAMS A LIST ALREADY READS. §6.2.8.
//
// ── WHY THIS EXISTS AT ALL ───────────────────────────────────────────────
//
// The picker replaced the `from`/`to` range on Invoices and Payments, and for one
// commit that left the control moving the summary strip while the ROWS underneath
// were unfiltered — a control that appears to work, which is the failure §7.4 is
// about. `applyList` already filters by `params.from`/`params.to` through
// `shape.dateOf`; this hands it the picker's window in the form it reads, rather
// than teaching `applyList` about presets.
//
// ── AND `all` IS AN ABSENCE, NOT A PRESET ────────────────────────────────
//
// Owner's ruling, 2026-10-04: a BALANCE figure — open, overdue, unapplied — has
// no date bound, so its link must open a list with no date bound or the figure
// stops being the sum of the rows. `?period=all` is that state. The picker still
// offers exactly four presets (v10.17) and shows none active here; the reader
// leaves by choosing one.
// ---------------------------------------------------------------------------

/** The `?period=` value meaning "no date filter". NOT one of `PERIODS`. */
export const ALL_DATES = 'all'

/** A bare date, which is what `readListParams` parses out of `from`/`to`. */
const day = (at: Date) => at.toISOString().slice(0, 10)

/**
 * `raw`, plus the window as the `from`/`to` a list reader understands.
 *
 * A NULL WINDOW RETURNS `raw` UNTOUCHED, bounds and all — including any `from` or
 * `to` somebody still has in a bookmarked URL, which is the one case where the
 * old range parameters survive and should keep working.
 *
 * `to` IS INCLUSIVE WHERE THE WINDOW'S IS EXCLUSIVE, so a millisecond comes off
 * rather than a day: taking a day off would drop the current week's last bucket,
 * and the week boundary is exactly where that is invisible (MONEY-DESIGN §0).
 */
export function windowed(
  raw: RawParams,
  window: PeriodWindow | null,
): RawParams {
  if (window === null) return raw
  return {
    ...raw,
    from: day(window.from),
    to: day(new Date(window.to.getTime() - 1)),
  }
}
