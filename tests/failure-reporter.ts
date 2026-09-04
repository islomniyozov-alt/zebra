import type { Reporter } from 'vitest/node'
import { recordFailure, resetFailureLog } from './failure-log'

// A reporter whose only job is to survive the run it is reporting on.
//
// See tests/failure-log.ts for the incident. Vitest's own reporters render the
// failure list when the run ENDS; a crash mid-run means it never renders, and
// the counts printed along the way say how many failed without saying which.
//
// This writes each failure the moment vitest knows about it, so the evidence
// exists before anything has a chance to destroy it.

export default class FailureLogReporter implements Reporter {
  onInit(): void {
    // Cleared per run, not appended across runs — a stale name from yesterday
    // read as today's failure would be worse than no file at all.
    resetFailureLog()
  }

  onTestCaseResult(testCase: {
    fullName?: string
    name?: string
    module?: { moduleId?: string }
    result: () => { state?: string; errors?: readonly { message?: string }[] }
  }): void {
    const result = testCase.result()
    if (result.state !== 'failed') return

    const where = testCase.module?.moduleId ?? 'unknown file'
    const what = testCase.fullName ?? testCase.name ?? 'unnamed test'
    const why = result.errors?.[0]?.message?.split('\n')[0] ?? ''
    recordFailure(`FAIL ${where} > ${what}${why ? ` — ${why}` : ''}`)
  }
}
