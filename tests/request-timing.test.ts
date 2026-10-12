import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  DASHBOARD_READS,
  dashboardTimingLine,
  shellIsolateMark,
  shellTimingLine,
  timed,
} from '@/lib/request-timing'

// ---------------------------------------------------------------------------
// GAPS 26, MEASUREMENT ONLY. The shell and the dashboard each write one
// structured line per request; these hold the lines' shapes — numbers and a
// role, exactly the named fields, nothing that could carry PII — and that the
// two pages write them.
// ---------------------------------------------------------------------------

describe('the shell timing line', () => {
  it('carries exactly the named fields', () => {
    const line = JSON.parse(
      shellTimingLine({
        role: 'DISPATCHER',
        spans: {
          sessionMs: 310,
          accountMs: 220,
          densityMs: 480,
          totalMs: 1030,
        },
        isolate: { isolateRenders: 1, isolateIdleMs: null },
        startedAt: Date.UTC(2026, 9, 12, 9, 0, 0),
      }),
    )
    expect(Object.keys(line).sort()).toEqual(
      [
        'event',
        'role',
        'sessionMs',
        'accountMs',
        'densityMs',
        'totalMs',
        'sinceModuleEvalMs',
        'isolateRenders',
        'isolateIdleMs',
        'startedAt',
      ].sort(),
    )
    expect(line).toMatchObject({ event: 'shell.timing', densityMs: 480 })
  })

  it('an isolate’s first render has no idle figure; the next has the gap', () => {
    const first = shellIsolateMark(5_000_000)
    const second = shellIsolateMark(5_030_000)
    expect(second.isolateRenders).toBe(first.isolateRenders + 1)
    expect(second.isolateIdleMs).toBe(30_000)
  })
})

describe('the dashboard timing line', () => {
  it('names each of the seven reads, null where the role is not shown one', () => {
    const line = JSON.parse(
      dashboardTimingLine({
        role: 'DISPATCHER',
        reads: {
          money: null,
          queue: 1200,
          panels: 1400,
          topDrivers: null,
          dqf: 2100,
          horizons: 1900,
          companies: 900,
        },
        fanOutMs: 2100,
        totalMs: 2300,
        startedAt: Date.UTC(2026, 9, 12, 9, 0, 1),
      }),
    )
    expect(Object.keys(line).sort()).toEqual(
      [
        'event',
        'role',
        ...DASHBOARD_READS.map((name) => `${name}Ms`),
        'fanOutMs',
        'totalMs',
        'startedAt',
      ].sort(),
    )
    expect(line).toMatchObject({
      event: 'dashboard.timing',
      moneyMs: null,
      dqfMs: 2100,
      fanOutMs: 2100,
    })
  })
})

describe('the spans', () => {
  it('`timed` reports the wait and hands the value back', async () => {
    const { value, ms } = await timed(
      () =>
        new Promise<string>((resolve) => setTimeout(() => resolve('x'), 20)),
    )
    expect(value).toBe('x')
    expect(ms).toBeGreaterThanOrEqual(15)
  })

  it('the shell and the dashboard write their lines', () => {
    const layout = readFileSync('src/app/(app)/layout.tsx', 'utf8')
    expect(layout).toMatch(
      /const \{ value: session, ms: sessionMs \} = await timed\(/,
    )
    expect(layout).toMatch(/console\.log\(\s*shellTimingLine\(/)
    const page = readFileSync('src/app/(app)/dashboard/page.tsx', 'utf8')
    expect(page).toMatch(/console\.log\(\s*dashboardTimingLine\(/)
    // All seven, positionally, so a read added to the fan-out without a span
    // fails here.
    for (const [index, name] of DASHBOARD_READS.entries())
      expect(page, name).toContain(`settled('${name}', fanOut[${index}])`)
  })
})
