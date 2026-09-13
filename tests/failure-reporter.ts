import type { Reporter } from 'vitest/node'
import { recordFailure, writeRunCount } from './failure-log'

/** Named, because an escaped newline has now been mangled twice in transit. */
const NEWLINE = String.fromCharCode(10)

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

/** The first line of an error message, prefixed, or nothing at all. */
function firstLine(message: string | undefined): string {
  const first = message?.split(NEWLINE)[0]?.trimEnd()
  return first ? ` — ${first}` : ''
}

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

  /**
   * How many test cases actually executed.
   *
   * ── A NON-ZERO EXIT DOES NOT SAY WHETHER ANY TEST RAN ────────────────────
   *
   * On 2026-09-07 all 29 integration files failed to LOAD — "Vitest failed to
   * find the runner", `Tests no tests` — and the deploy gate called it "the
   * integration suite is red". Nothing was red. Nothing ran. That is the same
   * wrong-cause failure the gate's own refusal wording was just fixed for, one
   * layer down: the exit code cannot tell a suite that failed from a suite
   * that never started, so the caller cannot either.
   *
   * Counted here rather than parsed out of stdout, because the gate inherits
   * stdio and there is nothing to parse — and a count from the reporter is the
   * thing that ran, not a description of it.
   */
  private ran = 0

  /**
   * A RETRY IS NEVER SILENT (owner's ruling, 2026-09-13).
   *
   * The integration project retries once on a dropped Neon socket and on
   * nothing else. A retry that healed the run and said nothing would turn a
   * measured, unexplained network fault into an invisible one — and the cause
   * is still unidentified, so the rate is the evidence. Every retry is written
   * to the failure log with its file and its offset into the run, beside the
   * failures, because that is the file somebody reads after a bad run.
   *
   * Counted too, so "how often is this happening" is answerable without
   * grepping.
   */
  private retried = 0
  private readonly startedAt = Date.now()

  onTestCaseResult(testCase: {
    fullName?: string
    name?: string
    project?: { name?: string }
    module?: { moduleId?: string; project?: { name?: string } }
    result: () => {
      state?: string
      errors?: readonly { message?: string }[]
    }
    // RETRIES LIVE ON THE DIAGNOSTIC, NOT THE RESULT, and the first version of
    // this read `result().retryCount` — which is not on that type. It compiled,
    // it ran, and it logged `RETRIES 0` for a run whose test demonstrably
    // retried. A reporter that cannot see the thing it reports is worse than
    // no reporter: it answers the question wrongly rather than not at all.
    diagnostic?: () => { retryCount?: number; flaky?: boolean } | undefined
  }): void {
    const result = testCase.result()
    const retryCount = testCase.diagnostic?.()?.retryCount ?? 0

    // A case that PASSED after a retry is the interesting one: nothing else in
    // the run will ever mention it.
    if (retryCount > 0) {
      this.retried++
      const at = Math.round((Date.now() - this.startedAt) / 1000)
      recordFailure(
        `RETRY [${testCase.module?.moduleId ?? 'unknown file'}] ` +
          `t+${at}s attempt ${retryCount + 1} ` +
          `ended ${result.state ?? '?'} > ${testCase.fullName ?? testCase.name ?? 'unnamed test'}` +
          `${firstLine(result.errors?.[0]?.message)}`,
      )
    }

    // EVERY case that reached a result, passed or failed. A skipped test did
    // not run and must not count towards "the suite started".
    if (result.state === 'passed' || result.state === 'failed') this.ran++
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

  /**
   * The count, where the gate can read it without parsing anything.
   *
   * WRITTEN EVEN WHEN IT IS ZERO — that is the case it exists for.
   */
  onTestRunEnd(): void {
    writeRunCount(this.ran)
    // THE RATE, ONCE, AT THE END. A zero line is the useful one: it says the
    // retry did not fire rather than leaving its absence to be inferred from
    // a log with nothing in it.
    recordFailure(
      `RETRIES ${this.retried} of ${this.ran} case(s) needed a second attempt`,
    )
  }
}
