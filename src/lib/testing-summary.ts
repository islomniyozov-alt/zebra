import { listedAuthorities } from './companies'
import { TEST_KINDS, type TestKind } from './random-testing'
import type { TxClient } from './tenancy'

// ---------------------------------------------------------------------------
// THE RANDOM-TESTING PROGRAMME AS NUMBERS (TMS-DESIGN-SYSTEM.md §6.9).
//
// Owner's ruling on GAPS 18, 2026-10-11: accounting needs the year-end figure
// for the insurance renewal, and that figure is a COUNT. The pool itself — who
// was selected — is owner/safety only under 49 CFR Part 40.
//
// SO THIS MODULE CANNOT RETURN A PERSON. The draws are read for their
// authority, quarter and pool size; the selections are grouped in the database
// by draw, kind and outcome and come back as counts. No query here selects a
// name, a driver id or a member key, and `tests/integration/random-testing
// .test.ts` holds the returned value to that against a pool whose names it
// knows. Results are not stored anywhere in Zebra; a NOT_TESTED reason is not
// read.
// ---------------------------------------------------------------------------

export interface KindCounts {
  selected: number
  /** Outcome TESTED: a test was completed. */
  tested: number
}

export interface QuarterSummary {
  quarter: 1 | 2 | 3 | 4
  /** False when no draw was made: the page says so rather than printing 0s. */
  drawn: boolean
  poolSize: number
  kinds: Record<TestKind, KindCounts>
}

export interface AuthoritySummary {
  companyId: string
  name: string
  quarters: QuarterSummary[]
}

const QUARTERS = [1, 2, 3, 4] as const

const emptyKinds = (): Record<TestKind, KindCounts> =>
  Object.fromEntries(
    TEST_KINDS.map((kind) => [kind, { selected: 0, tested: 0 }]),
  ) as Record<TestKind, KindCounts>

/** One year, every authority the viewer may see, every quarter. */
export async function testingSummary(
  tx: TxClient,
  input: { year: number; companyScopes: readonly string[] },
): Promise<AuthoritySummary[]> {
  const authorities = await listedAuthorities(tx, input.companyScopes)
  const companyIds = authorities.map((authority) => authority.id)

  const draws = await tx.randomDraw.findMany({
    where: { year: input.year, companyId: { in: companyIds } },
    select: { id: true, companyId: true, quarter: true, poolSize: true },
  })
  const counts = await tx.randomSelection.groupBy({
    by: ['drawId', 'kind', 'outcome'],
    where: { drawId: { in: draws.map((draw) => draw.id) } },
    _count: { _all: true },
  })

  return authorities.map((authority) => ({
    companyId: authority.id,
    name: authority.name,
    quarters: QUARTERS.map((quarter) => {
      const draw = draws.find(
        (row) => row.companyId === authority.id && row.quarter === quarter,
      )
      const kinds = emptyKinds()
      if (draw) {
        for (const row of counts.filter((c) => c.drawId === draw.id)) {
          const kind = row.kind as TestKind
          if (!kinds[kind]) continue
          kinds[kind].selected += row._count._all
          if (row.outcome === 'TESTED') kinds[kind].tested += row._count._all
        }
      }
      return {
        quarter,
        drawn: draw !== undefined,
        poolSize: draw?.poolSize ?? 0,
        kinds,
      }
    }),
  }))
}
