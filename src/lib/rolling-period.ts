// ---------------------------------------------------------------------------
// THE ROLLING WINDOW EVERY CHARTED SCREEN ANSWERS FOR.
//
// Owner's ruling, 2026-10-02: calendar windows are out. A calendar window is
// empty for the first days of whatever it names — "this quarter" on 2 October
// was two days long and $0 — so the presets are spans backwards from today and
// are the same size every day they are opened.
//
// ── WHY THIS IS ITS OWN MODULE ───────────────────────────────────────────
//
// It lived in `dashboard-kpis.ts` beside the dashboard's money readers, which
// made "the window" and "the dashboard's money" one import. §6.2.7 puts the
// same picker on /accounting/reports, and that screen has no business pulling
// in `dashboardFor` to learn what thirteen weeks means.
//
// SPLIT PER IMPORTER, not per string (AGENTS.md): every caller of the period
// half now imports from here, and `dashboard-kpis.ts` keeps the money half and
// imports the window like anybody else. Nothing is re-exported from there — two
// paths to one symbol is how the next split goes wrong.
//
// ── THE WEEK IS A SETTLEMENT WEEK ────────────────────────────────────────
//
// Sunday to Sunday (MONEY-DESIGN §0), the same boundary the settlement engine
// pays in and the same one SQL groups on. A Monday-based week here would put a
// Sunday load in a different week from the statement that paid it.
// ---------------------------------------------------------------------------

/** Day or week. A property of the preset — see `grainOf`. */
export type Grain = 'day' | 'week'

export interface PeriodWindow {
  /** Inclusive. */
  from: Date
  /** EXCLUSIVE, as every query reading this treats it. */
  to: Date
}

/**
 * The four windows a charted screen answers for. ROLLING, never calendar.
 */
export const PERIODS = ['d7', 'w4', 'w13', 'w52'] as const

export type PeriodKey = (typeof PERIODS)[number]

export function isPeriodKey(value: string): value is PeriodKey {
  return (PERIODS as readonly string[]).includes(value)
}

/** The default. A quarter of trading, always populated. */
export const DEFAULT_PERIOD: PeriodKey = 'w13'

/**
 * The grain a preset draws in. A PROPERTY OF THE PRESET, not of the span.
 *
 * The span rule this replaces — daily under about five weeks, weekly above —
 * existed only because a calendar quarter could be two days old. Rolling
 * windows have a fixed size, so the reason is gone.
 *
 * `w4` IS WEEKLY THOUGH IT IS 28 DAYS, where the span rule would have drawn it
 * daily. Four weekly bars is the comparison that preset is for, and this is the
 * one place the two rules visibly disagree.
 */
export function grainOf(key: PeriodKey): Grain {
  return key === 'd7' ? 'day' : 'week'
}

/** How many buckets a preset shows, including the partial current one. */
const BUCKETS: Record<PeriodKey, number> = {
  d7: 7,
  w4: 4,
  w13: 13,
  w52: 52,
}

/**
 * The Sunday a settlement week opens on, in UTC.
 *
 * MONEY-DESIGN §0, and the same boundary `WEEK_START` computes in SQL. It is
 * written here as well so a series can generate its EMPTY weeks: a week with no
 * freight returns no row, and a series driven only by rows would draw eleven
 * points across thirteen weeks and label none of them.
 */
export function sundayOf(day: Date): Date {
  const start = new Date(
    Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate()),
  )
  start.setUTCDate(start.getUTCDate() - start.getUTCDay())
  return start
}

/** The last `count` settlement weeks, oldest first, ending with `now`'s week. */
export function recentSundays(now: Date, count: number): Date[] {
  const latest = sundayOf(now)
  const out: Date[] = []
  for (let back = count - 1; back >= 0; back--) {
    const week = new Date(latest)
    week.setUTCDate(week.getUTCDate() - back * 7)
    out.push(week)
  }
  return out
}

/**
 * The window a preset means, in UTC.
 *
 * ── IT ENDS WITH THE CURRENT SETTLEMENT WEEK, DRAWN AS FAR AS TODAY ──────
 *
 * `to` is EXCLUSIVE and is tomorrow's midnight, so everything delivered today
 * counts and the answer is stable for the rest of the day. The final bucket is
 * therefore PARTIAL — the week is still running — which the chart marks,
 * because a short last bar otherwise reads as a decline that did not happen.
 *
 * ── THE WEEKLY PRESETS OPEN ON A SUNDAY ─────────────────────────────────
 *
 * MONEY-DESIGN §0, and the same boundary the SQL groups on: counting back in
 * sevens from an arbitrary weekday would put each bucket's start mid-week, and
 * the rows SQL grouped into Sundays would have nowhere to land.
 */
export function periodWindow(key: PeriodKey, now: Date): PeriodWindow {
  const today = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
  )
  const to = new Date(today)
  to.setUTCDate(to.getUTCDate() + 1)

  if (key === 'd7') {
    const from = new Date(today)
    from.setUTCDate(from.getUTCDate() - (BUCKETS.d7 - 1))
    return { from, to }
  }

  // BACK FROM THE SUNDAY THAT OPENED THIS WEEK, so the last bucket is the
  // current partial week and the first is a whole one.
  const from = sundayOf(today)
  from.setUTCDate(from.getUTCDate() - (BUCKETS[key] - 1) * 7)
  return { from, to }
}

/**
 * Every bucket in the window, oldest first, INCLUDING the empty ones.
 *
 * A bucket with no freight returns no row from SQL, so a series built from rows
 * draws a dense week where there was a sparse one and labels none of it. This
 * generates the axis and the rows are looked up into it — the same argument
 * `recentSundays` was written for, generalised to both grains.
 *
 * WEEKLY BUCKETS ARE SUNDAYS, including the one the period opens inside: a
 * period starting on a Wednesday belongs to the week that opened on the Sunday
 * before it, because that is the bucket SQL will have grouped it into. Starting
 * the axis on the Wednesday would leave that week's row with nowhere to land.
 */
export function bucketsIn(period: PeriodWindow, grain: Grain): Date[] {
  const out: Date[] = []
  const cursor =
    grain === 'week'
      ? sundayOf(period.from)
      : new Date(
          Date.UTC(
            period.from.getUTCFullYear(),
            period.from.getUTCMonth(),
            period.from.getUTCDate(),
          ),
        )
  // A CAP, because a year-to-date in weeks is 52 and a mistake is thousands.
  while (cursor < period.to && out.length < 400) {
    out.push(new Date(cursor))
    cursor.setUTCDate(cursor.getUTCDate() + (grain === 'week' ? 7 : 1))
  }
  return out
}

/**
 * Does `to` fall inside the bucket that starts at `start`?
 *
 * THE PARTIAL BUCKET, which is always the last one: the week is unfinished, so
 * its bar is short for a reason that is about the calendar rather than about
 * the freight. The chart marks it and says so on hover.
 */
export function isPartialBucket(start: Date, grain: Grain, to: Date): boolean {
  const end = new Date(start)
  end.setUTCDate(end.getUTCDate() + (grain === 'week' ? 7 : 1))
  return to < end
}
