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

  it('never deploys on the schedule', () => {
    expect(step('deploy dev')).toContain(
      "if: vars.CI_DEPLOY == 'true' && github.event_name != 'schedule'",
    )
  })

  it('sweeps dev on the schedule only, and reads the verdict from the file', () => {
    const sweep = step('nightly sweep of dev')
    expect(sweep).toContain("if: github.event_name == 'schedule'")
    expect(sweep).toContain('run-status.mjs nightly-sweep -- npm run sweep')
    // THE FILE IS THE VERDICT: the run is allowed to "fail" the shell, and the
    // step's own exit comes from `--check` reading the status file.
    expect(sweep).toMatch(/npm run sweep > sweep\.log 2>&1 \|\| true/)
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
})
