import { afterEach, describe, expect, it } from 'vitest'
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { looksLikeSocketDeath } from './socket-crash-guard'

// ---------------------------------------------------------------------------
// THE GUARD, RUN — INCLUDING THE HALF THAT ONLY EXISTS IN A REAL PROCESS.
//
// On 2026-09-04 a gate printed "2 failed | 210 passed" and then died on a
// dropped Neon socket. The two tests had already failed correctly; the crash
// arrived a tick later and took the reporter's failure list with it, so nobody
// could say WHICH two. Flag 87's shape: a failure whose diagnosis is destroyed
// by how it was reported.
//
// The containment is a `process.on('uncaughtException')` handler, and an
// assertion that reads the handler is worth very little — the whole question is
// what Node does with the process afterwards. So the second half of this file
// spawns a real one, throws a real uncaught exception at it, and checks that it
// survived and wrote the reason down.
// ---------------------------------------------------------------------------

const LOG = join(process.cwd(), '.tmp-socket-guard.log')

afterEach(() => rmSync(LOG, { force: true }))

/** A child that installs the guard, throws `shape`, then reports it is alive. */
function childOutcome(shape: string): { code: number; log: string } {
  const script = `
    require('tsx/cjs')
    const { installSocketCrashGuard } = require(${JSON.stringify(
      join(process.cwd(), 'tests', 'socket-crash-guard.ts'),
    )})
    installSocketCrashGuard()
    setTimeout(() => {
      const error = new Error(${JSON.stringify(shape)})
      error.stack = ${JSON.stringify(shape)}
      throw error
    }, 1)
    setTimeout(() => { console.log('STILL ALIVE'); process.exit(0) }, 400)
  `

  let code = 0
  let stdout = ''
  try {
    stdout = execFileSync(process.execPath, ['-e', script], {
      encoding: 'utf8',
      env: { ...process.env, ZEBRA_FAILURE_LOG: LOG },
    })
  } catch (error) {
    const failure = error as { status?: number; stdout?: string }
    code = failure.status ?? 1
    stdout = failure.stdout ?? ''
  }

  return {
    code: stdout.includes('STILL ALIVE') ? 0 : code || 1,
    log: existsSync(LOG) ? readFileSync(LOG, 'utf8') : '',
  }
}

describe('what counts as a connection going away', () => {
  it('recognises the crash that killed the gate', () => {
    const error = new Error('Unhandled error. ()')
    error.stack =
      'Error: Unhandled error. ()\n at kn._handleErrorEvent\n at WebSocket.#onSocketClose'
    expect(looksLikeSocketDeath(error)).toBe(true)
  })

  it('recognises the 57P01 shape that ends runs at teardown', () => {
    expect(
      looksLikeSocketDeath(
        new Error('terminating connection due to administrator command'),
      ),
    ).toBe(true)
  })

  // THE HALF THAT KEEPS THIS HONEST. A blanket handler in a test suite is how
  // a real crash becomes a green run — the opposite of the problem being
  // solved — so anything unrecognised must fall through.
  it('does not recognise an ordinary programming error', () => {
    expect(
      looksLikeSocketDeath(
        new TypeError('Cannot read properties of undefined'),
      ),
    ).toBe(false)
    expect(looksLikeSocketDeath(new Error('expected 3 to be 4'))).toBe(false)
  })
})

describe('a real process, given a real uncaught exception', () => {
  it('survives a dropped socket and writes down why', () => {
    const outcome = childOutcome(
      'Error: Unhandled error. ()\n at WebSocket.#onSocketClose',
    )

    // THE POINT. The run continues; the failure the socket already caused is
    // reported by the test that owned it.
    expect(outcome.code).toBe(0)
    expect(outcome.log).toContain('SOCKET')
  })

  // AND THE PAIRING, WITHOUT WHICH THE ABOVE PROVES NOTHING: a guard that
  // swallowed everything would also pass that test.
  it('still dies on an error that is not a dropped socket', () => {
    const outcome = childOutcome('TypeError: something is genuinely broken')

    expect(outcome.code).not.toBe(0)
    expect(outcome.log).not.toContain('SOCKET')
  })
})
