import { readFileSync } from 'node:fs'
import { describe, expect, it, vi } from 'vitest'
import {
  DASHBOARD_READS,
  dashboardTimingLine,
  pageTimingLine,
  shellIsolateMark,
  shellTimingLine,
  timed,
  writeTimingLater,
  writeTimingLine,
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
      /const \{ value: shell, ms: sessionMs \} = await timed\(/,
    )
    // Through `after()`, not a bare console.log: a render inside a sign-in's
    // POST response logged nothing the tail could see (§6.10, 2026-10-13).
    expect(layout).toMatch(/writeTimingLine\(\s*shellTimingLine\(/)
    expect(layout).not.toMatch(/console\.log\(\s*shellTimingLine\(/)
    const page = readFileSync('src/app/(app)/dashboard/page.tsx', 'utf8')
    expect(page).toMatch(/writeTimingLine\(\s*dashboardTimingLine\(/)
    expect(page).not.toMatch(/console\.log\(\s*dashboardTimingLine\(/)
    // All seven, positionally, so a read added to the fan-out without a span
    // fails here.
    for (const [index, name] of DASHBOARD_READS.entries())
      expect(page, name).toContain(`settled('${name}', fanOut[${index}])`)
  })

  it('writes from after() in a request, and directly outside one', () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})
    try {
      let task: (() => void) | null = null
      writeTimingLine('{"event":"shell.timing"}', (t) => void (task = t))
      expect(log).not.toHaveBeenCalled()
      task!()
      expect(log).toHaveBeenCalledWith('{"event":"shell.timing"}')
      log.mockClear()
      writeTimingLine('{"event":"dashboard.timing"}', () => {
        throw new Error('`after` was called outside a request scope')
      })
      expect(log).toHaveBeenCalledWith('{"event":"dashboard.timing"}')
    } finally {
      log.mockRestore()
    }
  })
})

// ---------------------------------------------------------------------------
// THE PAGE'S LINE (GAPS 42, owner's instruction 2026-11-12): statements and
// wall, built once the response has gone out.
// ---------------------------------------------------------------------------

describe('the page timing line', () => {
  it('carries exactly the named fields, and a count that was not kept is null', () => {
    const line = JSON.parse(
      pageTimingLine({
        role: 'ACCOUNTING',
        statements: 17,
        totalMs: 1288,
        startedAt: Date.UTC(2026, 10, 12, 18, 45, 0),
      }),
    )
    expect(line).toEqual({
      event: 'page.timing',
      role: 'ACCOUNTING',
      statements: 17,
      totalMs: 1288,
      startedAt: '2026-11-12T18:45:00.000Z',
    })
    expect(Object.keys(line)).toEqual([
      'event',
      'role',
      'statements',
      'totalMs',
      'startedAt',
    ])
    expect(
      JSON.parse(
        pageTimingLine({
          role: null,
          statements: null,
          totalMs: 0,
          startedAt: 0,
        }),
      ).statements,
    ).toBeNull()
  })

  it('is BUILT when after() runs it, not when it is scheduled — the count read then is the final one', () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})
    try {
      let statements = 2
      let task: (() => void) | null = null
      writeTimingLater(
        () => JSON.stringify({ event: 'page.timing', statements }),
        (t) => void (task = t),
      )
      statements = 9 // the page's own reads, after the layout scheduled the line
      expect(log).not.toHaveBeenCalled()
      task!()
      expect(log).toHaveBeenCalledWith('{"event":"page.timing","statements":9}')
      log.mockClear()
      writeTimingLater(
        () => '{"event":"page.timing","statements":1}',
        () => {
          throw new Error('`after` was called outside a request scope')
        },
      )
      expect(log).toHaveBeenCalledWith('{"event":"page.timing","statements":1}')
    } finally {
      log.mockRestore()
    }
  })

  it('both shells write it from the thunk, reading the request’s one client', () => {
    for (const path of [
      'src/app/(app)/layout.tsx',
      'src/app/(portal)/layout.tsx',
    ]) {
      const layout = readFileSync(path, 'utf8')
      expect(layout, path).toMatch(
        /writeTimingLater\(\(\) =>\s*pageTimingLine\(\{/,
      )
      expect(layout, path).toMatch(/statements: statementsOf\(client\)/)
      expect(layout, path).toMatch(/const client = requestClient\(\)/)
      expect(layout, path).not.toMatch(/writeTimingLine\(\s*pageTimingLine\(/)
    }
    // The counter is kept where the client is built, and only there.
    const db = readFileSync('src/lib/db.ts', 'utf8')
    expect(db).toMatch(/log: \[\{ emit: 'event', level: 'query' \}\]/)
    expect(db).toMatch(/client\.\$on\('query'/)
  })
})
