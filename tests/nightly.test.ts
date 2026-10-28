import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

// ---------------------------------------------------------------------------
// THE NIGHTLY IS THE SAME GATE, AND IT SHIPS NOTHING (build queue item 6).
//
// Read out of ci.yml rather than asserted about it: a schedule that quietly
// lost its deploy gate would redeploy dev at four in the morning, and a sweep
// step that ran on every push would add a browser install to every commit.
// ---------------------------------------------------------------------------
const ci = readFileSync('.github/workflows/ci.yml', 'utf8')

const step = (name: string): string => {
  const at = ci.indexOf(`- name: ${name}\n`)
  expect(at, name).toBeGreaterThan(-1)
  const next = ci.indexOf('\n      - name: ', at + 1)
  return ci.slice(at, next === -1 ? undefined : next)
}

describe('the nightly', () => {
  it('is scheduled, once, before the office opens', () => {
    expect(ci).toMatch(
      /\n  schedule:\n(?:\s+#.*\n)*\s+- cron: '0 9 \* \* \*'\n/,
    )
  })

  it('never deploys on the schedule, nor on a nightly run by hand', () => {
    // A dispatched run with `sweep=true` is the nightly on a different clock
    // (2026-10-27): the push run already deployed its sha, and the first such
    // run proved what a deploy after the sweep does — refuses the tree the
    // sweep had dirtied. So it ships nothing either.
    expect(step('deploy dev')).toContain(
      "if: vars.CI_DEPLOY == 'true' && github.event_name != 'schedule' && github.event.inputs.sweep != 'true'",
    )
  })

  it('can be run by hand, through one named input and nothing else', () => {
    expect(ci).toMatch(
      /\n  workflow_dispatch:\n    inputs:\n      sweep:\n(?:\s+#.*\n)*\s+description: .*\n\s+required: false\n\s+default: 'false'\n/,
    )
  })

  it('sweeps dev on the schedule or when asked by name, and reads the verdict from the file', () => {
    const sweep = step('nightly sweep of dev')
    expect(sweep).toContain(
      "if: github.event_name == 'schedule' || github.event.inputs.sweep == 'true'",
    )
    expect(sweep).toContain('run-status.mjs nightly-sweep -- npm run sweep')
    // THE FILE IS THE VERDICT: the run is allowed to "fail" the shell, and the
    // step's own exit comes from `--check` reading the status file. THE LOG
    // LIVES OUTSIDE THE TREE: a `sweep.log` in the checkout dirtied the tree
    // for the step after it (2026-10-27).
    expect(sweep).toMatch(/SWEEP_LOG="\$RUNNER_TEMP\/sweep\.log"/)
    expect(sweep).toMatch(/npm run sweep > "\$SWEEP_LOG" 2>&1 \|\| true/)
    expect(sweep).not.toMatch(/> sweep\.log/)
    // THE LAST COMMAND OF THE STEP, after the comment block that introduces
    // the next step is set aside: a `--check` that was followed by anything
    // would hand the step's exit code to that something.
    const commands = sweep
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line !== '' && !line.startsWith('#'))
    expect(commands.at(-1)).toBe(
      'node scripts/run-status.mjs --check nightly-sweep',
    )
  })

  it('signs in to production once a night too, with its own verdict, whatever the sweep did', () => {
    // Owner's ruling 7, 2026-10-28: GitHub's cron is best-effort (it skipped
    // two hourly slots on the 27th), so no watch depends on one schedule
    // alone — the nightly carries the production check as well.
    const check = step('nightly production sign-in')
    expect(check).toContain(
      "if: always() && (github.event_name == 'schedule' || github.event.inputs.sweep == 'true')",
    )
    for (const name of [
      'PROD_CHECK_EMAIL',
      'PROD_CHECK_PASSWORD',
      'CLOUDFLARE_ACCOUNT_ID',
    ])
      expect(check).toContain(`${name}: \${{ secrets.${name} }}`)
    // The tail token, never the deploy token: the only caller allowed a tail
    // on production is this check, for its own duration.
    expect(check).toContain(
      'CLOUDFLARE_API_TOKEN: ${{ secrets.CLOUDFLARE_TAIL_TOKEN }}',
    )
    expect(check).toMatch(/PROD_LOG="\$RUNNER_TEMP\/prod-signin\.log"/)
    expect(check).toContain(
      'run-status.mjs nightly-prod-signin -- npm run check:prod-signin',
    )
    const commands = check
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line !== '' && !line.startsWith('#'))
    expect(commands.at(-1)).toBe(
      'node scripts/run-status.mjs --check nightly-prod-signin',
    )
    // And it comes AFTER the sweep: one tail at a time, dev's then production's.
    expect(ci.indexOf('- name: nightly sweep of dev')).toBeLessThan(
      ci.indexOf('- name: nightly production sign-in'),
    )
  })
})
