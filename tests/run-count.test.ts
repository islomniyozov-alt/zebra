import { describe, expect, it } from 'vitest'
import { rmSync, writeFileSync } from 'node:fs'
import { RUN_COUNT_FILE, readRunCount, writeRunCount } from './failure-log'

// ---------------------------------------------------------------------------
// HOW MANY TESTS RAN — THE NUMBER THAT TELLS "RED" FROM "NEVER STARTED".
//
// On 2026-09-07 all 29 integration files failed to load and the deploy gate
// said "the integration suite is red". Nothing was red; nothing ran. An exit
// code cannot tell those apart, so the reporter counts what it actually saw.
//
// NULL IS NOT ZERO, and that is the whole subtlety. Zero means the reporter
// ran and saw no case — the diagnosis. Null means nobody said, and treating a
// missing file as zero would convert any unrelated write failure into a
// confident wrong answer about the tests.
// ---------------------------------------------------------------------------

describe('the run count', () => {
  it('round-trips a real count', () => {
    writeRunCount(482)
    expect(readRunCount()).toBe(482)
  })

  it('records zero as zero, which is the case it exists for', () => {
    writeRunCount(0)
    expect(readRunCount()).toBe(0)
    // Not falsy-collapsed into null on the way back out.
    expect(readRunCount()).not.toBeNull()
  })

  it('reads a missing file as null rather than as zero', () => {
    rmSync(RUN_COUNT_FILE, { force: true })
    expect(readRunCount()).toBeNull()
  })

  it('reads garbage as null rather than guessing', () => {
    for (const junk of ['', '   ', 'none', '-1', '3.5']) {
      writeFileSync(RUN_COUNT_FILE, junk)
      expect(readRunCount(), JSON.stringify(junk)).toBeNull()
    }
  })
})
