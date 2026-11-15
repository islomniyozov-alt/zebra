import type { TxClient } from '@/lib/tenancy'
import { companyScopeFilter } from '@/lib/tenancy'
import { listedAuthorities } from '@/lib/companies'
import { countTruckHealth } from '@/lib/data-health'
import { keyFor } from '@/lib/grid-columns'
import {
  listWhere,
  truckListWhere,
  type TruckListParams,
} from '@/lib/truck-list'
import { truckListCounts } from '@/lib/truck-list-counts'
import { readTruckRows } from '@/lib/truck-list-rows'
import { TRUCKS_GRID, type TruckListData } from '@/lib/truck-list-page'

// ---------------------------------------------------------------------------
// WHAT THE TRUCKS PAGE READ BEFORE ITS ONE CALL (§6.5 part 1 v11.11), kept as
// the reference `readTruckListData` is held equal to: the Prisma rows and
// their five loaders, the counts, the makes, the health counts and the column
// row, each its own read.
// ---------------------------------------------------------------------------

export async function trucksByPrisma(
  tx: TxClient,
  companyScopes: readonly string[],
  params: TruckListParams,
  options: {
    now: Date
    take: number
    userId: string
    healthCompanyIds: readonly string[]
  },
): Promise<TruckListData> {
  const scope = companyScopeFilter(companyScopes)
  const where = truckListWhere(params, scope)
  const columns = await tx.userPreference.findFirst({
    where: { userId: options.userId, key: keyFor(TRUCKS_GRID) },
    select: { value: true, organizationId: true },
  })
  return {
    rows: await readTruckRows(tx, listWhere(where), {
      now: options.now,
      take: options.take,
      attention: params.attention,
    }),
    counts: await truckListCounts(tx, params, companyScopes),
    authorities: await listedAuthorities(tx, companyScopes),
    makes: (
      await tx.truck.findMany({
        where: {
          AND: [
            scope,
            params.company ? { companyId: params.company } : {},
            { deletedAt: null, make: { not: null } },
          ],
        },
        distinct: ['make'],
        select: { make: true },
        orderBy: { make: 'asc' },
      })
    ).flatMap((truck) => (truck.make ? [truck.make] : [])),
    health: await countTruckHealth(tx, {
      companyIds: options.healthCompanyIds,
    }),
    columnsRow: columns,
  }
}
