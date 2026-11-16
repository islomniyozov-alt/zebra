import { describe, expect, it } from 'vitest'
import {
  DAY_MS,
  invocationOf,
  limitNamed,
  observabilityConfig,
  rayIdOf,
  rayLine,
  readRays,
  tallyDays,
} from '../scripts/workers-logs.mjs'

// ---------------------------------------------------------------------------
// THE PERSISTED WORKERS LOGS' PURE HALF (GAPS 44, owner's ruling 2026-11-16).
// The query needs the Observability token; the reading — which limit, by the
// runtime's own outcome, and UNREADABLE rather than silence — does not.
// ---------------------------------------------------------------------------

const event = (over: Record<string, unknown> = {}) => ({
  timestamp: Date.parse('2026-11-16T10:01:30Z'),
  $metadata: { rayId: 'a5b10b7b58e9a9b4', type: 'cf-worker-event' },
  $workers: {
    outcome: 'exceededMemory',
    wallTimeMs: 1840,
    cpuTimeMs: 212,
    event: {
      request: {
        method: 'POST',
        url: 'https://zebra-dev.tajikcargollc.workers.dev/login',
      },
      response: { status: 503 },
    },
    ...over,
  },
})

describe('the reading of one invocation', () => {
  it('keeps the outcome, wall, CPU and path, and names the limit by the outcome', () => {
    const one = invocationOf(event())
    expect(one).toMatchObject({
      ray: 'a5b10b7b58e9a9b4',
      method: 'POST',
      path: '/login',
      status: 503,
      outcome: 'exceededMemory',
      wallMs: 1840,
      cpuMs: 212,
      memory: null,
    })
    expect(limitNamed(one)).toBe('exceededMemory')
    expect(limitNamed(invocationOf(event({ outcome: 'exceededCpu' })))).toBe(
      'exceededCpu',
    )
    expect(limitNamed(invocationOf(event({ outcome: 'ok' })))).toBeNull()
    expect(rayLine('r', [one])).toContain('(LIMIT: exceededMemory)')
    expect(rayLine('r', [one])).toContain('memory not in the event')
  })

  it('keeps a memory figure when the event carries one, and any unknown key', () => {
    const one = invocationOf(event({ memoryUsedBytes: 133_000_000 }))
    expect(one.memory).toBe(133_000_000)
    expect(one.extra).toEqual({ memoryUsedBytes: 133_000_000 })
  })
})

describe('the ray as the logs hold it', () => {
  it('drops the colo the cf-ray header ends in, and nothing else', () => {
    expect(rayIdOf('a5b10b7b58e9a9b4-IAD')).toBe('a5b10b7b58e9a9b4')
    expect(rayIdOf('a5b419d4bbb9521a-DYU')).toBe('a5b419d4bbb9521a')
    expect(rayIdOf('a5b10b7b58e9a9b4')).toBe('a5b10b7b58e9a9b4')
  })
})

describe('unreadable is not clean', () => {
  it('names the missing token instead of returning nothing', async () => {
    expect(observabilityConfig({ R2_ACCOUNT_ID: 'a' }).unreadable).toMatch(
      /CLOUDFLARE_OBSERVABILITY_TOKEN/,
    )
    const read = await readRays(
      { R2_ACCOUNT_ID: 'a' },
      'zebra-dev',
      ['r'],
      0,
      1,
    )
    expect(read.unreadable).toMatch(/CLOUDFLARE_OBSERVABILITY_TOKEN/)
    expect(rayLine('r', [], read.unreadable)).toMatch(/^r: UNREADABLE/)
    // A ray the logs do not hold is unreadable too, not a clean request.
    expect(rayLine('r', [])).toMatch(/UNREADABLE — no persisted invocation/)
  })
})

describe('the seven days', () => {
  it('tallies each limit per UTC day with its routes, and leaves an ok day empty', () => {
    const day1 = Date.parse('2026-11-15T00:00:00Z')
    const day2 = day1 + DAY_MS
    const day3 = day2 + DAY_MS
    const at = (t: number, outcome: string, path: string) =>
      invocationOf({
        timestamp: t,
        $metadata: { rayId: `${t}` },
        $workers: {
          outcome,
          event: { request: { url: `https://x.dev${path}` } },
        },
      })
    const days = tallyDays(
      [day1, day2, day3],
      [
        at(day1 + 1000, 'exceededMemory', '/payments/import'),
        at(day1 + 2000, 'exceededMemory', '/payments/import'),
        at(day1 + 3000, 'exceededCpu', '/login'),
        at(day1 + 4000, 'ok', '/dashboard'),
        at(day2 + 1000, 'exceededCpu', '/portal'),
        at(day3 + 1000, 'ok', '/dashboard'),
      ],
    )
    expect(days[0]).toEqual({
      day: '2026-11-15',
      byOutcome: { exceededMemory: 2, exceededCpu: 1 },
      routes: {
        'exceededMemory /payments/import': 2,
        'exceededCpu /login': 1,
      },
    })
    // The next day's limit is that day's, not spilled into the one before.
    expect(days[1]).toEqual({
      day: '2026-11-16',
      byOutcome: { exceededCpu: 1 },
      routes: { 'exceededCpu /portal': 1 },
    })
    expect(days[2]).toEqual({ day: '2026-11-17', byOutcome: {}, routes: {} })
  })
})
