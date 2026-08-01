import type { TxClient } from './tenancy'

// ---------------------------------------------------------------------------
// PER-USER PREFERENCES — saved views now, density in Step 7.
//
// NOT localStorage, and that is the whole design. §7.4 calls saved views
// "first-class": a named filter set, per user, pinned above the table. A
// dispatcher who builds "my trucks today" on the office machine expects to
// find it on the laptop at home, and localStorage gives them one of the two
// with no way to notice which. §5.1's density preference is the same shape of
// fact — small, personal, useless if it does not follow you — so this store is
// built to hold both rather than growing a second mechanism next step.
//
// EVERY VALUE IS VALIDATED ON READ. The column is `Json` and the row is
// per-user, so a user can put anything in it via a future API and a bad row
// must not take a screen down. Each key owns a parser that returns `null`
// rather than throwing, and a `null` is treated as "no preference set".
// ---------------------------------------------------------------------------

/** Namespaced so one user's keys cannot collide across features. */
export const PREFERENCE_KEYS = {
  /** `view.loads` — the saved filter sets for the Loads table. */
  loadsViews: 'view.loads',
  /** `density` — §5.1's row density. Landed in Step 7, as this said it would. */
  density: 'density',
} as const

// --- density (§5.1) --------------------------------------------------------

export const DENSITIES = ['compact', 'standard', 'comfortable'] as const
export type Density = (typeof DENSITIES)[number]

/** What §5.1 says the default is, and what globals.css renders without help. */
export const DEFAULT_DENSITY: Density = 'standard'

/**
 * Read a stored density, tolerating anything.
 *
 * An unrecognised value is `standard`, not an error and not an empty screen.
 * The value ends up in a `data-density` attribute, so this doubles as the
 * check that stops a preference row putting arbitrary text into the DOM.
 */
export function parseDensity(value: unknown): Density {
  return DENSITIES.includes(value as Density)
    ? (value as Density)
    : DEFAULT_DENSITY
}

export async function readDensity(
  tx: TxClient,
  userId: string,
): Promise<Density> {
  return parseDensity(await readPreference(tx, userId, PREFERENCE_KEYS.density))
}

// --- saved views (§7.4) ----------------------------------------------------

export interface SavedView {
  /** Stable, generated from the name. Used in the URL and as the row key. */
  slug: string
  name: string
  /** The query string, without the leading `?`. Exactly what the URL carries. */
  query: string
}

export const MAX_SAVED_VIEWS = 12

export function slugify(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
}

/**
 * Read saved views, tolerating anything.
 *
 * A malformed row returns an empty list, not an exception. The Loads screen is
 * the most-used surface in the product and it does not fail to render because
 * somebody's preference JSON is odd.
 */
export function parseSavedViews(value: unknown): SavedView[] {
  if (!Array.isArray(value)) return []

  const views: SavedView[] = []
  for (const entry of value) {
    if (typeof entry !== 'object' || entry === null) continue
    const { slug, name, query } = entry as Record<string, unknown>
    if (
      typeof slug !== 'string' ||
      typeof name !== 'string' ||
      typeof query !== 'string' ||
      slug === '' ||
      name === ''
    ) {
      continue
    }
    // The query is put into a URL, so it is normalised through the parser that
    // will read it rather than trusted as a string.
    const normalized = new URLSearchParams(query).toString()
    views.push({ slug, name: name.slice(0, 60), query: normalized })
  }

  // Last write wins on a duplicate slug, and the cap is enforced on read as
  // well as on write — a row that predates the cap should not render 400 chips.
  const bySlug = new Map(views.map((view) => [view.slug, view]))
  return [...bySlug.values()].slice(0, MAX_SAVED_VIEWS)
}

export async function readPreference(
  tx: TxClient,
  userId: string,
  key: string,
): Promise<unknown> {
  const row = await tx.userPreference.findFirst({
    where: { userId, key },
    select: { value: true },
  })
  return row?.value ?? null
}

export async function writePreference(
  tx: TxClient,
  organizationId: string,
  userId: string,
  key: string,
  value: unknown,
): Promise<void> {
  // Upsert on the natural key. The unique index is (userId, organizationId,
  // key), so two tabs saving at once resolve at the index rather than leaving
  // two rows the reader would have to choose between.
  await tx.userPreference.upsert({
    where: {
      userId_organizationId_key: { userId, organizationId, key },
    },
    create: {
      organizationId,
      userId,
      key,
      value: value as never,
    },
    update: { value: value as never },
  })
}

export async function readSavedViews(
  tx: TxClient,
  userId: string,
): Promise<SavedView[]> {
  return parseSavedViews(
    await readPreference(tx, userId, PREFERENCE_KEYS.loadsViews),
  )
}

export type SaveViewFailure = 'no_name' | 'too_many'

/**
 * Add or replace a saved view.
 *
 * Replacing by slug rather than refusing a duplicate name: a dispatcher who
 * saves "my trucks today" twice means "update it", and an error message there
 * would be the interface arguing with somebody about their own bookmark.
 */
export async function saveView(
  tx: TxClient,
  organizationId: string,
  userId: string,
  name: string,
  query: string,
): Promise<
  { ok: true; views: SavedView[] } | { ok: false; reason: SaveViewFailure }
> {
  const slug = slugify(name)
  if (slug === '') return { ok: false, reason: 'no_name' }

  const existing = await readSavedViews(tx, userId)
  const kept = existing.filter((view) => view.slug !== slug)

  if (kept.length >= MAX_SAVED_VIEWS) {
    return { ok: false, reason: 'too_many' }
  }

  const views = [
    ...kept,
    {
      slug,
      name: name.trim().slice(0, 60),
      query: new URLSearchParams(query).toString(),
    },
  ]
  await writePreference(
    tx,
    organizationId,
    userId,
    PREFERENCE_KEYS.loadsViews,
    views,
  )
  return { ok: true, views }
}

export async function deleteView(
  tx: TxClient,
  organizationId: string,
  userId: string,
  slug: string,
): Promise<SavedView[]> {
  const views = (await readSavedViews(tx, userId)).filter(
    (view) => view.slug !== slug,
  )
  await writePreference(
    tx,
    organizationId,
    userId,
    PREFERENCE_KEYS.loadsViews,
    views,
  )
  return views
}
