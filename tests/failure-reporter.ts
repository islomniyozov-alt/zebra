import type { Reporter } from 'vitest/node'
import { recordFailure } from './failure-log'

// A reporter whose only job is to survive the run it is reporting on.
//
// See tests/failure-log.ts for the incident. Vitest's own reporters render the
// failure list when the run ENDS; a crash mid-run means it never renders, and
// the counts printed along the way say how many failed without saying which.
//
// IT ONLY EVER APPENDS. An earlier version cleared the log in `onInit`, which
// destroyed the very evidence it exists to keep: a node-project run started
// while the gate was mid-flight wiped fourteen recorded failures and left its
// own, and the gate then printed a one-line list that belonged to a different
// run. Whoever OWNS a run clears the file before starting it — that is the
// gate's job, in `scripts/integration-gate.mjs` — and this never deletes
// anything. Destroy-on-init is the wrong instinct for a file whose entire
// purpose is outliving a process.
//
// EACH LINE NAMES ITS PROJECT, so two runs that do overlap interleave legibly
// instead of looking like one confusing run.

export default class FailureLogReporter implements Reporter {
  /**
   * A header per run, so stale lines cannot pass as today's.
   *
   * The file is append-only and only the gate clears it, which leaves an
   * ad-hoc `npm run check` appending to whatever was there before. A reader
   * seeing yesterday's failure and believing it is exactly the confusion this
   * file exists to prevent, so each run announces itself instead.
   */
  onTestRunStart(): void {
    recordFailure(`--- run ${new Date().toISOString()} ---`)
  }

  onTestCaseResult(testCase: {
    fullName?: string
    name?: string
    project?: { name?: string }
    module?: { moduleId?: string; project?: { name?: string } }
    result: () => { state?: string; errors?: readonly { message?: string }[] }
  }): void {
    const result = testCase.result()
    if (result.state !== 'failed') return

    const project =
      testCase.project?.name ?? testCase.module?.project?.name ?? '?'
    const where = testCase.module?.moduleId ?? 'unknown file'
    const what = testCase.fullName ?? testCase.name ?? 'unnamed test'
    const why = result.errors?.[0]?.message?.split('\n')[0] ?? ''
    recordFailure(
      `FAIL [${project}] ${where} > ${what}${why ? ` — ${why}` : ''}`,
    )
  }
}
