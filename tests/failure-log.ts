import {
  appendFileSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
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

/**
 * When this process started, so each line can say how far into the run it is.
 *
 * ELAPSED, NOT WALL CLOCK, BECAUSE THE QUESTION IS ABOUT DURATION. On
 * 2026-09-05 two gates failed on compute instability and the obvious next
 * question — do the failures cluster past some elapsed point, making two short
 * runs safer than one long one — could not be answered, because the log
 * recorded only one timestamp for the whole run. The failures were all there
 * and none of them said when.
 *
 * That is flag 88's lesson in its cheapest possible form: the instrument has
 * to record the axis you will want to measure along, and nobody knows they
 * needed it until the question arrives. Six characters per line buys it.
 */
const STARTED_AT = Date.now()

export function recordFailure(line: string): void {
  try {
    mkdirSync(dirname(FAILURE_LOG), { recursive: true })
  } catch {
    // Directory already exists, or cannot be made. `appendFileSync` will say.
  }
  try {
    // PER WORKER, NOT PER RUN. Vitest forks one process per worker, so this
    // clock starts when that worker starts rather than when the gate did — a
    // few seconds apart, which is immaterial against a fifteen-minute run and
    // the reason the unit is seconds rather than milliseconds.
    const elapsed = Math.round((Date.now() - STARTED_AT) / 1000)
    appendFileSync(FAILURE_LOG, `[t+${elapsed}s] ${line}\n`)
  } catch {
    // NEVER THROW FROM THE RECORDER. A logging failure that fails the run
    // would be this file causing the outage it exists to explain.
  }
}

/**
 * Where the reporter records how many test cases executed.
 *
 * BESIDE THE FAILURE LOG AND FOR THE SAME REASON: the gate spawns vitest with
 * inherited stdio, so there is no output to parse, and a count written by the
 * reporter is a count of what actually ran rather than a description of it.
 */
export const RUN_COUNT_FILE = `${FAILURE_LOG}.count`

/** Overwrites, never appends — one run, one count. Zero is the useful case. */
export function writeRunCount(ran: number): void {
  try {
    mkdirSync(dirname(RUN_COUNT_FILE), { recursive: true })
    writeFileSync(RUN_COUNT_FILE, String(ran))
  } catch {
    // A count that will not write must not fail a suite that passed. The gate
    // treats a missing count as "unknown" rather than as zero — see
    // `readRunCount`.
  }
}

/**
 * How many tests the last run executed, or null when nothing said.
 *
 * NULL IS NOT ZERO. Zero means the reporter ran and saw no test; null means
 * the count is missing, and inferring "nothing ran" from a missing file would
 * turn every unrelated write failure into a false diagnosis.
 */
export function readRunCount(): number | null {
  try {
    const text = readFileSync(RUN_COUNT_FILE, 'utf8').trim()
    if (text === '') return null
    const value = Number(text)
    return Number.isInteger(value) && value >= 0 ? value : null
  } catch {
    return null
  }
}
