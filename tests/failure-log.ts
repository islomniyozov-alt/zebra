import { appendFileSync, mkdirSync, rmSync } from 'node:fs'
import { dirname } from 'node:path'

// ---------------------------------------------------------------------------
// EVERY FAILURE WRITTEN DOWN THE MOMENT IT HAPPENS.
//
// FLAG 87'S SHAPE, AGAIN. On 2026-09-04 a gate reported "2 failed | 210 passed"
// and then died on a dropped Neon socket. The crash bypassed the reporter, so
// the summary that names WHICH tests failed was never printed — eight files
// showed partial counts and the two failures were unidentifiable. A failure
// whose diagnosis is destroyed by how it was reported.
//
// The captured log did not help, because the thing that never ran was the
// reporter's final render, not the terminal. Capturing stdout preserves what
// was printed; nothing preserves what was going to be printed.
//
// SO FAILURES ARE APPENDED AS THEY OCCUR, with `appendFileSync` — synchronous
// on purpose. A buffered write is exactly what a process death discards, and
// this file exists for the case where the process dies.
//
// It is a list of names, not a replacement for the reporter. When the run ends
// normally the reporter is better in every way and this is redundant; when the
// run dies it is the only thing that knows what went wrong.
// ---------------------------------------------------------------------------

/** Where the list lands. Set by the gate so the receipt and the log agree. */
export const FAILURE_LOG =
  process.env.ZEBRA_FAILURE_LOG ?? '.integration-failures.log'

export function resetFailureLog(): void {
  try {
    rmSync(FAILURE_LOG, { force: true })
  } catch {
    // A log we cannot clear is a log we can still append to; the run matters
    // more than the tidiness of its evidence file.
  }
}

export function recordFailure(line: string): void {
  try {
    mkdirSync(dirname(FAILURE_LOG), { recursive: true })
  } catch {
    // Directory already exists, or cannot be made. `appendFileSync` will say.
  }
  try {
    appendFileSync(FAILURE_LOG, `${line}\n`)
  } catch {
    // NEVER THROW FROM THE RECORDER. A logging failure that fails the run
    // would be this file causing the outage it exists to explain.
  }
}
