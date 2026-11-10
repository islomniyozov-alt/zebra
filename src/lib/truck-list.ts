import type { Prisma, TruckStatus } from '@/generated/prisma/client'
import {
  truckHealthCheckFor,
  truckHealthWhere,
  type TruckHealthCheck,
} from './data-health'
import { isFleetStatus } from './fleet-codes'
import { HOLDS_SEAT } from './team'
import type { CompanyScopeFilter } from './tenancy'

// ---------------------------------------------------------------------------
// THE TRUCKS LIST'S VIEWS AND ITS WHERE, BUILT ONCE (TMS-DESIGN-SYSTEM.md
// §6.5 part 1, the owner's brief of 2026-11-10).
//
// Four views as chips with counts, `?view=`, ONE PREDICATE EACH — the shape
// `load-views.ts` gave the loads list: a name in the URL resolved through one
// function that the chip's count, the list and the export all read, so the
// number on the chip is the number of rows the click lands on. The page cannot
// own any of this, because a page cannot be unit-tested and every line here is
// a rule.
//
// ── EVERY FILTER IS ANDED ──────────────────────────────────────────────────
//
// The old page merged its filters with object spread; `load-list.ts` records
// what that costs when two of them carry an `OR` (the search here does, and so
// does the Inactive view). Every part is one element of an `AND`.
// ---------------------------------------------------------------------------

/**
 * The four views, in the bar's order. Active is the default: no `?view=`, and
 * an unknown name, open it — a stale link should open (§7.1.6).
 */
export const TRUCK_VIEWS = ['active', 'unassigned', 'all', 'inactive'] as const

export type TruckViewName = (typeof TRUCK_VIEWS)[number]

export const DEFAULT_TRUCK_VIEW: TruckViewName = 'active'

export function isTruckViewName(value: unknown): value is TruckViewName {
  return (
    typeof value === 'string' &&
    (TRUCK_VIEWS as readonly string[]).includes(value)
  )
}

/** The view a `?view=` value names; anything else is Active. */
export function truckViewFor(raw: unknown): TruckViewName {
  return isTruckViewName(raw) ? raw : DEFAULT_TRUCK_VIEW
}

/** Not removed and not sold: the fleet that can still be dispatched or fixed. */
const LIVE_FLEET = {
  deletedAt: null,
  status: { not: 'SOLD' },
} as const satisfies Prisma.TruckWhereInput

/**
 * The rows a view selects.
 *
 *   active      not removed, not SOLD
 *   unassigned  active, and no live driver holds it — `HOLDS_SEAT`, the one
 *               seat definition `team.ts` already uses (§6.4 part 3)
 *   all         every truck, removed included
 *   inactive    removed or SOLD
 *
 * A REMOVED TRUCK IS IN ALL AND INACTIVE, by the brief's words — the opposite
 * of §6.4's toggle for a removed DRIVER, which stands: a removed truck is a
 * unit that left, a removed driver is a mistake.
 */
export function truckViewWhere(view: TruckViewName): Prisma.TruckWhereInput {
  switch (view) {
    case 'active':
      return { ...LIVE_FLEET }
    case 'unassigned':
      return { ...LIVE_FLEET, drivers: { none: HOLDS_SEAT } }
    case 'all':
      return {}
    case 'inactive':
      return { OR: [{ deletedAt: { not: null } }, { status: 'SOLD' }] }
  }
}

/**
 * The six values, in the footer's order: the brief's five, then Sold, which
 * only the views that can hold it show. The same list feeds the status filter
 * in the popover, so the two cannot name different sets.
 */
export const TRUCK_STATUS_ORDER = [
  'AVAILABLE',
  'IN_TRANSIT',
  'DISPATCHED',
  'MAINTENANCE',
  'OUT_OF_SERVICE',
  'SOLD',
] as const satisfies readonly TruckStatus[]

export function isTruckStatus(value: unknown): value is TruckStatus {
  return (
    typeof value === 'string' &&
    (TRUCK_STATUS_ORDER as readonly string[]).includes(value)
  )
}

/**
 * The URL keys the Filters popover owns, for its badge and for Clear filters.
 * HERE AND NOT IN THE CLIENT COMPONENT: a value exported from a 'use client'
 * module reaches a server component as a client reference, not a value — the
 * trucks page answered 500 on dev (2026-11-10, `TRUCK_FILTER_PARAMS is not
 * iterable`) until this moved. `tests/client-module-imports.test.ts` holds
 * every server page to it.
 */
export const TRUCK_FILTER_PARAMS = [
  'status',
  'fleet',
  'make',
  'yearFrom',
  'yearTo',
  'attention',
] as const

/** The views a Sold or Removed truck can appear in (§6.5 part 1, the footer). */
export function viewHoldsInactive(view: TruckViewName): boolean {
  return view === 'all' || view === 'inactive'
}

/** The list's URL, read once. Absent means "not filtering on this". */
export interface TruckListParams {
  view: TruckViewName
  company?: string
  /** Unit, plate or VIN; trimmed; `''` means no search. */
  q: string
  status?: TruckStatus
  /** One of `FLEET_STATUSES`, validated. */
  fleet?: string
  make?: string
  yearFrom?: number
  yearTo?: number
  /** `?attention=1` — the warnings filter, applied after the read. */
  attention: boolean
  tag?: string
  /** `?missing=` — the data-health filter (part 0). */
  missing: TruckHealthCheck | null
}

/** A plausible model year, four digits. Anything else is not a bound. */
function readYear(value: string | undefined): number | undefined {
  if (value === undefined || !/^\d{4}$/.test(value)) return undefined
  return Number(value)
}

export function readTruckListParams(
  params: Record<string, string | string[] | undefined>,
): TruckListParams {
  const one = (key: string): string | undefined => {
    const value = params[key]
    return typeof value === 'string' && value !== '' ? value : undefined
  }
  const status = one('status')
  const fleet = one('fleet')
  let yearFrom = readYear(one('yearFrom'))
  let yearTo = readYear(one('yearTo'))
  // A `to` BEFORE `from` NARROWS NOTHING, like a malformed date range on the
  // loads list: an impossible bound would list nothing and read as "no trucks
  // of those years", a confident answer to a question nobody asked.
  if (yearFrom !== undefined && yearTo !== undefined && yearTo < yearFrom) {
    yearFrom = undefined
    yearTo = undefined
  }
  return {
    view: truckViewFor(one('view')),
    company: one('company'),
    q: (one('q') ?? '').trim(),
    status: isTruckStatus(status) ? status : undefined,
    fleet: fleet !== undefined && isFleetStatus(fleet) ? fleet : undefined,
    make: one('make'),
    yearFrom,
    yearTo,
    attention: one('attention') === '1',
    tag: one('tag'),
    missing: truckHealthCheckFor(one('missing')),
  }
}

/**
 * Unit, plate or VIN contains the term, case-insensitively — the three
 * identifiers a unit is looked up by on the phone and on a citation.
 */
export function truckSearchWhere(term: string): Prisma.TruckWhereInput {
  const trimmed = term.trim()
  if (trimmed === '') return {}
  const contains = { contains: trimmed, mode: 'insensitive' as const }
  return {
    OR: [{ unitNumber: contains }, { plate: contains }, { vin: contains }],
  }
}

/**
 * THE DATA-HEALTH FILTER BRINGS ITS OWN BASE, as it does on the drivers list:
 * live trucks, because the footer's count (part 0) is over live trucks. The
 * view still applies, so the figure's link lists the same rows from Active
 * and All alike — a SOLD truck with a gap is the one row the count holds and
 * Active does not, and there is none on either database today.
 */
export function truckHealthBase(): Prisma.TruckWhereInput {
  return { deletedAt: null }
}

/** Every filter on the list, one `where` per group. */
export interface TruckListWhere {
  /** Scope, authority, search, fleet status, make, years, tag, health. */
  base: Prisma.TruckWhereInput
  view: Prisma.TruckWhereInput
  status: Prisma.TruckWhereInput
}

export function truckListWhere(
  params: TruckListParams,
  scope: CompanyScopeFilter,
): TruckListWhere {
  const base: Prisma.TruckWhereInput = {
    AND: [
      scope,
      params.company ? { companyId: params.company } : {},
      truckSearchWhere(params.q),
      params.fleet ? { fleetStatus: params.fleet } : {},
      // EXACT, because the select offers the stored spellings: `FRHT` is a
      // make on dev and a typed "Freightliner" would miss it (§6.5 part 1).
      params.make ? { make: params.make } : {},
      params.yearFrom !== undefined ? { year: { gte: params.yearFrom } } : {},
      params.yearTo !== undefined ? { year: { lte: params.yearTo } } : {},
      params.tag ? { tags: { has: params.tag } } : {},
      ...(params.missing
        ? [truckHealthBase(), truckHealthWhere(params.missing)]
        : []),
    ],
  }
  return {
    base,
    view: truckViewWhere(params.view),
    status: params.status ? { status: params.status } : {},
  }
}

const and = (...parts: Prisma.TruckWhereInput[]): Prisma.TruckWhereInput => ({
  AND: parts,
})

/** The rows on screen and in the file. */
export function listWhere(where: TruckListWhere): Prisma.TruckWhereInput {
  return and(where.base, where.view, where.status)
}

/**
 * A view chip's count: every other filter, and this view in place of the
 * active one (§7.4 — a chip ignores its own group). The status filter is
 * honoured, so "Unassigned 12" under `?status=AVAILABLE` opens twelve rows.
 */
export function viewCountWhere(
  where: TruckListWhere,
  view: TruckViewName,
): Prisma.TruckWhereInput {
  return and(where.base, where.status, truckViewWhere(view))
}

/**
 * The footer's status chips are a REPORT of the rows the view selects — every
 * filter, the status filter included — by the Status column's own predicate:
 * `status`, over live rows. A removed row reads "Removed" in that column and
 * counts under `REMOVED` here, never under its stored status.
 */
export function statusChipWhere(
  where: TruckListWhere,
  chip: TruckStatus | 'REMOVED',
): Prisma.TruckWhereInput {
  return and(
    listWhere(where),
    chip === 'REMOVED'
      ? { deletedAt: { not: null } }
      : { deletedAt: null, status: chip },
  )
}
