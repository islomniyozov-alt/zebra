import { PERSON_DRIVER } from './driver-kind'
import { companyScopeFilter, type TxClient } from './tenancy'

// ---------------------------------------------------------------------------
// THE LOADS LIST'S BROKER AND DRIVER TYPEAHEADS (TMS-DESIGN-SYSTEM.md §6.7
// item 2).
//
// THE OPTIONS ARE READ ON FIRST FOCUS, NOT ON EVERY RENDER. The list is the
// screen a dispatcher reloads all morning, and a broker list and a driver list
// on every render would be two statements for a filter used a few times a day.
// The page pays only for the chosen name, and only while a filter is set.
// ---------------------------------------------------------------------------

export type FilterKind = 'customer' | 'driver'

export function isFilterKind(value: unknown): value is FilterKind {
  return value === 'customer' || value === 'driver'
}

export interface FilterOption {
  id: string
  label: string
}

/** A broker list is long; a typeahead over this many still answers instantly. */
export const FILTER_OPTION_LIMIT = 3000

/** A driver's name the way the loads list prints it: first, then last. */
const driverLabel = (driver: { firstName: string; lastName: string }) =>
  `${driver.firstName} ${driver.lastName}`.trim()

/**
 * Every broker, or every driver in the viewer's scope.
 *
 * BROKERS ARE NOT SCOPED: they are shared across authorities (the schema note
 * at `Company`). DRIVERS ARE SCOPED, and terminated drivers are included,
 * because the filter is how somebody finds a driver's old loads. Referral
 * payees are left out: they never drive a load.
 */
export async function loadFilterOptions(
  tx: TxClient,
  kind: FilterKind,
  companyScopes: readonly string[],
): Promise<FilterOption[]> {
  if (kind === 'customer') {
    const customers = await tx.customer.findMany({
      where: { deletedAt: null },
      orderBy: { name: 'asc' },
      take: FILTER_OPTION_LIMIT,
      select: { id: true, name: true },
    })
    return customers.map((row) => ({ id: row.id, label: row.name }))
  }
  const drivers = await tx.driver.findMany({
    where: {
      deletedAt: null,
      ...PERSON_DRIVER,
      ...companyScopeFilter(companyScopes),
    },
    orderBy: [{ firstName: 'asc' }, { lastName: 'asc' }],
    take: FILTER_OPTION_LIMIT,
    select: { id: true, firstName: true, lastName: true },
  })
  return drivers.map((row) => ({ id: row.id, label: driverLabel(row) }))
}

/**
 * The names behind `?customer=` and `?driver=`, so the control can say what is
 * chosen. Nothing is read for a filter that is not set.
 *
 * Unscoped by design: the id came from the URL, and RLS already walls it to
 * this organization. An id that names nothing returns no label, and the list
 * shows its filtered empty state.
 */
export async function loadFilterLabels(
  tx: TxClient,
  ids: { customer?: string; driver?: string },
): Promise<{ customer: string | null; driver: string | null }> {
  const [customer, driver] = await Promise.all([
    ids.customer
      ? tx.customer.findFirst({
          where: { id: ids.customer },
          select: { name: true },
        })
      : null,
    ids.driver
      ? tx.driver.findFirst({
          where: { id: ids.driver },
          select: { firstName: true, lastName: true },
        })
      : null,
  ])
  return {
    customer: customer?.name ?? null,
    driver: driver ? driverLabel(driver) : null,
  }
}
