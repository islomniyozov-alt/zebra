import { describe, expect, it } from 'vitest'
import {
  packetLineOf,
  parseArgs,
  probeLine,
  runVerdict,
} from '../scripts/packet-probe.mjs'

// ---------------------------------------------------------------------------
// The packet probe's reading (BROKER-LOAD-BRIEF R9; GAPS 44): clean is every
// run 200 with a tail event whose outcome is ok and names no ceiling. A ray
// the tail never delivered is not clean.
// ---------------------------------------------------------------------------

const lineOf = (outcome: string) => ({
  level: 'log',
  message: JSON.stringify({
    event: 'packet.timing',
    outcome,
    isolateTag: 'ab12cd34',
    isolatePacketRequests: 1,
  }),
})
const ok = {
  status: 200,
  worker: {
    outcome: 'ok',
    exceptions: [],
    logs: [
      { level: 'log', message: '{"event":"pg.connect"}' },
      lineOf('built'),
    ],
  },
}

describe('the packet probe reads the route’s own line', () => {
  it('finds packet.timing among the other log lines', () => {
    expect(packetLineOf(ok.worker)).toMatchObject({
      isolateTag: 'ab12cd34',
      isolatePacketRequests: 1,
    })
    expect(packetLineOf({ logs: [{ message: 'not json' }] })).toBeNull()
  })

  it('a run served from the stored packet measured nothing', () => {
    expect(
      runVerdict({ ...ok, worker: { ...ok.worker, logs: [lineOf('reused')] } }),
    ).toBe('served reused, not built')
  })

  it('a run without the line cannot say it built', () => {
    expect(runVerdict({ ...ok, worker: { ...ok.worker, logs: [] } })).toBe(
      'no packet.timing line — unreadable',
    )
  })
})

describe('the packet probe', () => {
  it('reads a clean run as ok', () => {
    expect(runVerdict(ok)).toBe('ok')
  })

  it('names the memory ceiling, in either of the runtime’s wordings', () => {
    expect(
      runVerdict({
        status: 200,
        worker: {
          outcome: 'exceededMemory',
          exceptions: [
            { name: 'Error', message: 'Worker exceeded memory limit.' },
          ],
          logs: [],
        },
      }),
    ).toBe('MEMORY CEILING')
  })

  it('an undelivered ray is unreadable, never clean', () => {
    expect(runVerdict({ status: 200, worker: null })).toBe(
      'no tail event — unreadable',
    )
    expect(probeLine([ok, ok, { status: 200, worker: null }])).toMatch(/NOT OK/)
  })

  it('a refused or failed GET is not clean', () => {
    expect(runVerdict({ status: 409, worker: ok.worker })).toBe('HTTP 409')
    expect(
      runVerdict({
        status: 200,
        worker: { ...ok.worker, outcome: 'exception' },
      }),
    ).toBe('outcome exception')
  })

  it('three clean builds read OK', () => {
    expect(probeLine([ok, ok, ok])).toBe(
      'PACKET PROBE CLEAN — OK. 3 build(s), 0 exceededMemory, every ray accounted for.',
    )
  })

  it('an unknown argument is an error, not a default', () => {
    expect(parseArgs([])).toMatchObject({ runs: 3 })
    expect(() => parseArgs(['--run', '3'])).toThrow(/unknown argument/)
    expect(() => parseArgs(['--runs', 'x'])).toThrow(/not a count/)
  })
})
