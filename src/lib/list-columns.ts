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
 * Columns the cap never drops (§7.1.7). An absent warnings column reads as
 * "nothing wrong", which is the one thing a hidden column must not be able to
 * say.
 */
export const NEVER_CAPPED: readonly string[] = ['warnings']

/**
 * At most `cap` columns, dropping from the END and skipping `NEVER_CAPPED`.
 *
 * A preference row outlives every deploy and can be edited by hand, so more
 * visible columns than the cap can arrive here. Handing them to `Table` would
 * 500 the page for one person in a way nobody else could reproduce. Dropping
 * from the end keeps the identifying columns, which come first.
 */
export function capColumns(visible: readonly string[], cap: number): string[] {
  const kept = [...visible]
  for (let index = kept.length - 1; kept.length > cap && index > 0; index--) {
    if (!NEVER_CAPPED.includes(kept[index]!)) kept.splice(index, 1)
  }
  return kept
}

/**
 * What a person's stored column choice says, read off whatever is stored
 * (TMS-DESIGN-SYSTEM.md §6.7, owner's ruling of 2026-10-09).
 *
 * THE MEMORY IS THE SET THEY HID, `{ hidden: [...] }`, so a column added later
 * appears for everyone. `hidden: null` means "never chose": the grid's
 * defaults apply.
 *
 * AN ARRAY IS THE OLD SHAPE, the set they SHOWED, and is migrated here: hidden
 * is everything the grid offers that the array leaves out, minus the columns
 * that did not exist while the old shape was current (`addedSinceLegacy`),
 * because leaving out a column you never saw is not hiding it. `migrated` tells
 * the caller to write the new shape back. An old array that names nothing this
 * grid has, or names all of it, was always read as "never chose", and still is.
 */
export function readColumnMemory(
  stored: unknown,
  available: readonly string[],
  addedSinceLegacy: readonly string[] = [],
): { hidden: string[] | null; migrated: boolean } {
  if (Array.isArray(stored)) {
    const shown = new Set(stored.filter((key) => typeof key === 'string'))
    const kept = available.filter((key) => shown.has(key))
    if (kept.length === 0 || kept.length === available.length) {
      return { hidden: null, migrated: false }
    }
    return {
      hidden: available.filter(
        (key) => !shown.has(key) && !addedSinceLegacy.includes(key),
      ),
      migrated: true,
    }
  }
  if (
    stored !== null &&
    typeof stored === 'object' &&
    Array.isArray((stored as { hidden?: unknown }).hidden)
  ) {
    const hidden = (stored as { hidden: unknown[] }).hidden.filter(
      (key): key is string => typeof key === 'string',
    )
    return { hidden, migrated: false }
  }
  return { hidden: null, migrated: false }
}

/**
 * The columns to render, in the table's own order, inside the grid's cap.
 *
 * NEVER BLANK, AND NEVER WITHOUT THE FIRST COLUMN, which carries the row's link
 * and its accessible name. A hidden set that would leave nothing falls back to
 * the defaults, because a table of no columns reads as a broken page rather
 * than as a preference.
 */
export function visibleFromMemory(
  available: readonly string[],
  defaultHidden: readonly string[],
  hidden: readonly string[] | null,
  cap: number = TABLE_COLUMN_CAP,
): string[] {
  const hide = hidden ?? defaultHidden
  let visible = available.filter(
    (key, index) => index === 0 || !hide.includes(key),
  )
  if (visible.length <= 1 && available.length > 1) {
    visible = available.filter((key) => !defaultHidden.includes(key))
  }
  return capColumns(visible, cap)
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
  'deliveryDate',
  'driver',
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
 * §6.7 added Driver and DEL date, which took the declared count to twelve. By
 * the owner's ruling of 2026-10-09 only rate and billing start hidden, which
 * shows ten with more than one authority — so `/loads` is capped at ten
 * (`GRID_COLUMN_CAP`, §7.1.7 amended).
 *
 * WARNINGS IS NOT IN HERE, DELIBERATELY. An absent warnings column reads as
 * "nothing wrong", which is the one thing a hidden column must not be able to
 * say.
 */
export const LOAD_COLUMNS_HIDDEN = ['billing', 'rate'] as const

/**
 * The columns `/loads` gained after column memory changed shape (§6.7): an old
 * saved choice never saw them, so its migration does not count them as hidden.
 */
export const LOAD_COLUMNS_ADDED_SINCE_LEGACY = [
  'driver',
  'deliveryDate',
] as const

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
