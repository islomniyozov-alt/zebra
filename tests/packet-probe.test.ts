import { describe, expect, it } from 'vitest'
import { parseArgs, probeLine, runVerdict } from '../scripts/packet-probe.mjs'

// ---------------------------------------------------------------------------
// The packet probe's reading (BROKER-LOAD-BRIEF R9; GAPS 44): clean is every
// run 200 with a tail event whose outcome is ok and names no ceiling. A ray
// the tail never delivered is not clean.
// ---------------------------------------------------------------------------

const ok = { status: 200, worker: { outcome: 'ok', exceptions: [], logs: [] } }

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
