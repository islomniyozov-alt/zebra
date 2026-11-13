import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  parseArgs,
  probeVerdict,
  routesFor,
  verdictLine,
  withDistinctCounts,
} from '../scripts/isolate-probe.mjs'
import { readRouteMatrix } from '../scripts/sweep.mjs'

// ---------------------------------------------------------------------------
// THE ISOLATE PROBE'S PURE HALF (§6.10 v10.94; GAPS 44). The fetching needs a
// worker and a tail; the reading does not, and the reading is what decides
// clean from NOT OK, so it is the half that gets tested — the same split the
// sweep's `tally` has.
// ---------------------------------------------------------------------------

const ceiling = {
  outcome: 'ok',
  exceptions: [
    { name: 'Error', message: 'Dynamic import exceeded memory limits.' },
  ],
  logs: [],
}
const fine = { outcome: 'ok', exceptions: [], logs: [] }
const other = {
  outcome: 'exception',
  exceptions: [{ name: 'TypeError', message: 'x is not a function' }],
  logs: [],
}

const row = (pass: number, route: string, status: number, worker: unknown) => ({
  pass,
  route,
  status,
  ray: `${pass}-${route}`,
  worker,
})

describe('the fixed route set', () => {
  it('is the role’s `reach` routes from §6.8, in the table’s order', () => {
    const matrix = readRouteMatrix(readFileSync('TMS-DESIGN-SYSTEM.md', 'utf8'))
    const routes = routesFor(matrix, 'accounting')
    expect(routes.length).toBeGreaterThan(10)
    expect(routes).toContain('/dashboard')
    // The table's order, not alphabetical: the first row of the table is
    // the first route fetched, whatever its name.
    const tableOrder = [...matrix.keys()].filter((route) =>
      routes.includes(route),
    )
    expect(routes).toEqual(tableOrder)
    // A role the table refuses everywhere reaches nothing — and nothing is
    // not clean (below).
    expect(
      routesFor(new Map([['/a', { driver: 'refuse' }]]), 'driver'),
    ).toEqual([])
  })

  it('an unknown argument is refused, not defaulted', () => {
    expect(parseArgs(['--role', 'driver']).role).toBe('driver')
    expect(parseArgs([]).role).toBe('accounting')
    expect(() => parseArgs(['--root', 'x'])).toThrow(/unknown argument/)
  })
})

describe('distinct routes', () => {
  it('counts a route once however often it is asked for, so pass 2 adds nothing', () => {
    const rows = withDistinctCounts([
      row(1, '/a', 200, fine),
      row(1, '/b', 200, fine),
      row(1, '/a', 200, fine),
      row(2, '/a', 200, fine),
      row(2, '/b', 200, fine),
    ])
    expect(rows.map((r) => r.distinct)).toEqual([1, 2, 2, 2, 2])
  })
})

describe('the reading', () => {
  it('is clean only when nothing failed, nothing was empty, and every ray was accounted for', () => {
    const clean = probeVerdict(
      withDistinctCounts([row(1, '/a', 200, fine), row(2, '/a', 200, fine)]),
    )
    expect(clean.clean).toBe(true)
    expect(clean.notOk).toBe(false)
    expect(clean.shape).toBe('clean')
    expect(verdictLine(clean, 'accounting')).toMatch(
      /^ISOLATE PROBE CLEAN — OK\./,
    )

    // An undelivered ray on a 200 is named and withholds "clean" without
    // making the probe NOT OK: the fault that would need the account did
    // not happen, but the reading is not complete either.
    const undelivered = probeVerdict(
      withDistinctCounts([row(1, '/a', 200, null), row(2, '/a', 200, fine)]),
    )
    expect(undelivered.clean).toBe(false)
    expect(undelivered.undelivered).toEqual(['1-/a'])

    // Nothing fetched is not clean — "sees no rows" is true of an empty set.
    const empty = probeVerdict([])
    expect(empty.clean).toBe(false)
    expect(empty.notOk).toBe(true)
    expect(empty.shape).toBe('nothing fetched')
  })

  it('reads the shape: a first 500 at a distinct count, and a second pass as red as the first’s end', () => {
    const rows = withDistinctCounts([
      row(1, '/a', 200, fine),
      row(1, '/b', 200, fine),
      row(1, '/c', 500, ceiling),
      row(1, '/d', 500, ceiling),
      row(2, '/a', 500, ceiling),
      row(2, '/b', 500, ceiling),
      row(2, '/c', 500, ceiling),
      row(2, '/d', 200, fine),
    ])
    const verdict = probeVerdict(rows)
    expect(verdict.passes[1]).toMatchObject({
      requests: 4,
      failed: 2,
      firstAtDistinct: 3,
      ceiling: 2,
      unaccounted: 0,
      otherFault: 0,
    })
    expect(verdict.passes[2]).toMatchObject({
      requests: 4,
      failed: 3,
      ceiling: 3,
    })
    expect(verdict.shape).toBe('rises with distinct routes, and stays up')
    expect(verdict.notOk).toBe(true)
    const line = verdictLine(verdict, 'accounting')
    expect(line).toMatch(/NOT OK/)
    expect(line).toContain('first at distinct route 3')
    expect(line).toContain('pass 2: 3 of 4')
  })

  it('a 500 from the first request is its own shape, and a 500 the tail never accounted for is NOT OK by itself', () => {
    const first = probeVerdict(
      withDistinctCounts([row(1, '/a', 500, ceiling), row(2, '/a', 200, fine)]),
    )
    expect(first.shape).toBe('from the first request')

    const silent = probeVerdict(
      withDistinctCounts([
        row(1, '/a', 200, fine),
        row(1, '/b', 500, null),
        row(2, '/a', 200, fine),
        row(2, '/b', 200, fine),
      ]),
    )
    expect(silent.passes[1]?.unaccounted).toBe(1)
    expect(silent.passes[1]?.ceiling).toBe(0)
    expect(silent.notOk).toBe(true)
    expect(verdictLine(silent, 'accounting')).toContain('1 unaccounted')
  })

  it('tells the ceiling from any other exception, by the runtime’s words', () => {
    const verdict = probeVerdict(
      withDistinctCounts([
        row(1, '/a', 500, other),
        row(1, '/b', 500, ceiling),
        row(2, '/a', 200, fine),
        row(2, '/b', 200, fine),
      ]),
    )
    expect(verdict.passes[1]).toMatchObject({
      failed: 2,
      ceiling: 1,
      otherFault: 1,
    })
  })
})
