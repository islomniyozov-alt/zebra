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

// DATATRUCK'S ORDER (§6.7, the second pass, owner's brief 2026-11-16): load ·
// ref · status · customer · driver · truck · trailer · authority · pickup ·
// delivery · DEL date · documents, then the three behind the chooser.
export const LOAD_COLUMN_KEYS = [
  'loadNumber',
  'reference',
  'status',
  'customer',
  'driver',
  'truck',
  'trailer',
  'company',
  'pickup',
  'delivery',
  'deliveryDate',
  'documents',
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
 * WARNINGS JOINED THEM ON 2026-11-16 (§6.7, the second pass, owner's brief).
 * It was kept out because an absent warnings column reads as "nothing wrong";
 * the dot after a load's number (`LoadsTable`) now says what the column did,
 * so the reason holds without the column. Twelve show with more than one
 * authority, which is `/loads`' cap.
 */
export const LOAD_COLUMNS_HIDDEN = ['billing', 'rate', 'warnings'] as const

/**
 * The columns `/loads` gained after column memory changed shape (§6.7): an old
 * saved choice never saw them, so its migration does not count them as hidden.
 */
export const LOAD_COLUMNS_ADDED_SINCE_LEGACY = [
  'driver',
  'deliveryDate',
] as const

// ── /trucks ───────────────────────────────────────────────────────────────
//
// DATATRUCK'S ORDER (§6.5 part 1, the owner's brief of 2026-11-10): unit ·
// make · model · plate · VIN · year · state · authority · driver · owner name
// · odometer · status · warnings, with the three columns the list already had
// — fleet status, aging, heading to — after status. Sixteen declared with the
// authority column, nine shown.

export const TRUCK_COLUMN_KEYS = [
  'unitNumber',
  'make',
  'model',
  'plate',
  'vin',
  'year',
  'plateState',
  'company',
  'driver',
  'ownerName',
  'odometer',
  'status',
  'fleetStatus',
  'aging',
  'headingTo',
  'warnings',
] as const

/**
 * §6.5 part 1: the brief's four — owner name, VIN, fleet status, aging — and
 * heading to, which the brief drops from the default set. Model and odometer
 * sat here for a day to keep the default set inside §7.1's nine; the owner's
 * ruling of 2026-11-10 caps `/trucks` at eleven (`GRID_COLUMN_CAP`) and they
 * are in the default set — the brief's eleven, shown with the authority
 * column, ten without.
 */
export const TRUCK_COLUMNS_HIDDEN = [
  'ownerName',
  'vin',
  'fleetStatus',
  'aging',
  'headingTo',
] as const

/**
 * The columns `/trucks` gained on 2026-11-10 (§6.5 part 1): an old saved
 * choice never saw them, so its migration does not count them as hidden.
 */
export const TRUCK_COLUMNS_ADDED_SINCE_LEGACY = [
  'vin',
  'plateState',
  'driver',
  'ownerName',
] as const

// ── /drivers (§6.4 part 1) ────────────────────────────────────────────────
//
// TWELVE DECLARED, NINE SHOWN. The brief names ten; CDL already existed. Email
// and CDL go behind the chooser: a dispatcher reads this list for who can go
// where, and both are desk facts. Team (§6.4 part 3, v11.22) is the brief's
// "in the picker": behind the chooser from the start. The Terminated and
// Vacation board tabs add their own date column in the page, outside this set.
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
  'team',
  'cdl',
  'warnings',
] as const

/** §7.1.7: never warnings. */
export const DRIVER_COLUMNS_HIDDEN = ['email', 'team', 'cdl'] as const

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
  'createdBy',
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
 * DATATRUCK'S NINE SHOW (§6.2.10 part 7, R4 and R5; owner's ruling
 * 2026-11-17): Batch ID · Status · Created by · Created date · Check date ·
 * Period · Settlements · Amount · Authority. Datatruck's list has neither gross
 * nor deductions, so both are a tick away, with `notes`, which truncates to
 * nothing useful in a column.
 *
 * THIS REVERSES, BY RULING, the line that stood here: "not gross, deductions
 * or amount — those three are why §6.2.9 touched this grid". Amount (net)
 * stays shown; the other two remain one tick from the screen.
 */
export const BATCH_COLUMNS_HIDDEN = ['gross', 'deductions', 'notes'] as const

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
