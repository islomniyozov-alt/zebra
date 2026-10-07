// ---------------------------------------------------------------------------
// THE COLUMNS THE TWO OPERATIONAL LISTS SHOW (§7.1.7).
//
// §7.1 caps a table at nine columns and `Table` THROWS above it. `/loads`
// declares ten with the authority column and `/trucks` eleven — twelve with it —
// so both pages returned 500 until they adopted §7.1.4's chooser: /trucks for
// every organization, /loads for any carrier with more than one authority.
//
// ── WHY THIS IS A MODULE AND NOT TWO LOCAL CONSTANTS ──────────────────────
//
// The settlement workbench met the cap first (§6.2.2, v10.2) and solved it in
// its own file. The solution did not generalise, and three weeks later the two
// busiest lists in the application walked into the same throw. The arithmetic —
// "what did this person choose, and what if that is still more than nine" — is
// the part that was worth having in one place.
// ---------------------------------------------------------------------------

/** §7.1, enforced by a throw in `Table` rather than by sideways scrolling. */
export const TABLE_COLUMN_CAP = 9

/**
 * Which columns to render, from what this user has stored.
 *
 * ── TWO CASES THAT BOTH LOOK LIKE "EVERYTHING" ────────────────────────────
 *
 * `readGridColumns` returns the whole available list when no preference exists —
 * sensible for a grid of eight columns, and the throw for these two. So a set
 * that is literally all of them is read as "never chosen" and becomes the
 * default. Somebody who ticks every box is also asking for more than nine, and
 * the default set is the only honest answer to that.
 *
 * ── AND THE SLICE IS NOT DECORATION (§7.1.7) ──────────────────────────────
 *
 * A preference row outlives every deploy and can be edited by hand, so a stored
 * list naming ten columns that all still exist can arrive here. Handing it to
 * `Table` would 500 the page for one person in a way nobody else could
 * reproduce — which is strictly worse than the bug this module fixes, because it
 * would not show up in any live check.
 */
export function visibleWithinCap(
  available: readonly string[],
  defaultHidden: readonly string[],
  stored: readonly string[],
): string[] {
  const kept = available.filter((key) => stored.includes(key))
  // EMPTY COUNTS AS NEVER CHOSEN TOO. `visibleColumns` already falls back to
  // everything when a stored list names nothing this table still has, and
  // `saveGridColumns` refuses an empty choice — but a direct caller handing this
  // `[]` would otherwise get a table of one column, which reads as a broken page
  // rather than as a preference.
  const chosen =
    kept.length === 0 || kept.length === available.length
      ? available.filter((key) => !defaultHidden.includes(key))
      : kept
  return chosen.slice(0, TABLE_COLUMN_CAP)
}

// ── /loads ────────────────────────────────────────────────────────────────
//
// THE ORDER IS THE TABLE'S ORDER, in `LoadsTable`. A stored preference is a SET
// of what to show; letting it reorder columns too would mean a five-phase-old
// row deciding that money sits left of a load number.

export const LOAD_COLUMN_KEYS = [
  'loadNumber',
  'company',
  'customer',
  'pickup',
  'delivery',
  'truck',
  'status',
  'billing',
  'rate',
  'warnings',
] as const

/**
 * §7.1.7: billing status is the accounting view of the same load, and it has
 * whole screens of its own (§6.2.8). The operational badge is the dispatcher's
 * question and stays.
 *
 * WARNINGS IS NOT IN HERE, DELIBERATELY. An absent warnings column reads as
 * "nothing wrong", which is the one thing a hidden column must not be able to
 * say.
 */
export const LOAD_COLUMNS_HIDDEN = ['billing'] as const

// ── /trucks ───────────────────────────────────────────────────────────────

export const TRUCK_COLUMN_KEYS = [
  'unitNumber',
  'company',
  'make',
  'model',
  'year',
  'plate',
  'odometer',
  'status',
  'fleetStatus',
  'aging',
  'headingTo',
  'warnings',
] as const

/**
 * §7.1.7: specifications identify a unit at a desk, once. This list is read for
 * where the unit is and whether it can run. Make and plate stay, because they
 * are how a truck gets described on the phone.
 */
export const TRUCK_COLUMNS_HIDDEN = ['model', 'year', 'odometer'] as const

// ── /drivers (§6.4 part 1) ────────────────────────────────────────────────
//
// ELEVEN DECLARED, NINE SHOWN. The brief names ten; CDL already existed. Email
// and CDL go behind the chooser: a dispatcher reads this list for who can go
// where, and both are desk facts. The Terminated and Vacation board tabs add
// their own date column in the page, outside this set.
export const DRIVER_COLUMN_KEYS = [
  'name',
  'ready',
  'type',
  'status',
  'lastActivity',
  'company',
  'phone',
  'email',
  'truck',
  'cdl',
  'warnings',
] as const

/** §7.1.7: never warnings. */
export const DRIVER_COLUMNS_HIDDEN = ['email', 'cdl'] as const

// ── /payroll/batches, the batches tab ─────────────────────────────────────
//
// ELEVEN COLUMNS, AND IT HAD A CHOOSER ALL ALONG. §6.2.9 added gross,
// deductions and net to this grid on 2026-10-04 and took it from eight to
// eleven — past the cap, in the same session that fixed /loads and /trucks for
// being past the cap, by the same hands. `tests/accounting-surface.test.ts`
// checks this key list against the page's `Column` array and was green: it asks
// whether the two agree, never how many there are.
//
// THE KEYS LIVE HERE AND NOT IN THE PAGE so that one test can count every grid
// that runs past nine. The page's other tab (balances, seven columns) stays in
// the page, because it is not one of them.

export const BATCH_COLUMN_KEYS = [
  'batchNumber',
  'status',
  'created',
  'checkDate',
  'period',
  'statements',
  'gross',
  'deductions',
  'amount',
  'payCompany',
  'notes',
] as const

/**
 * §7.1.7: `created` is bookkeeping — the row's own age, next to a check date and
 * a period that are the dates anybody asks about — and `notes` is free text that
 * truncates to nothing useful in a column. Both a tick away.
 *
 * NOT `gross`, `deductions` OR `amount`: those three are why §6.2.9 touched this
 * grid, and hiding them by default would answer a 500 by undoing the feature.
 */
export const BATCH_COLUMNS_HIDDEN = ['created', 'notes'] as const

/**
 * The keys a list actually has this request.
 *
 * THE AUTHORITY COLUMN IS CONDITIONAL (§6.3): a single-authority carrier never
 * renders it, and passing it as available anyway would let it occupy one of the
 * nine slots in the slice above — showing eight columns on a screen entitled to
 * nine, for no visible reason.
 */
export function columnKeysFor<Key extends string>(
  all: readonly Key[],
  showCompany: boolean,
): Key[] {
  // GENERIC, SO THE LITERAL UNION SURVIVES. `/loads` indexes an exhaustive
  // header map with what this returns (§7.1.7), and a `string[]` here would make
  // that an implicit `any` — which is the shape of a checkbox labelled
  // `undefined`.
  return all.filter((key) => key !== 'company' || showCompany)
}
