import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

// ---------------------------------------------------------------------------
// THE NIGHTLY IS THE SAME GATE, AND IT SHIPS NOTHING (build queue item 6).
//
// Read out of ci.yml rather than asserted about it: a schedule that quietly
// lost its deploy gate would redeploy dev at four in the morning, and a sweep
// step that ran on every push would add a browser install to every commit —
// which, since the owner's brief of 2026-11-11 (§6.8), every push that
// DEPLOYS now pays on purpose: the second block below pins the rendered-page
// check to the deploy's own condition, so a push that ships nothing still
// installs no browser.
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

  it("keeps the sweep's detail file as an artifact, pass or fail, every nightly", () => {
    // §6.8, owner's brief 2026-11-10: two nightlies reported SHARED MATCH and
    // the detail JSON that names every claimed ray had died with the runner.
    const keep = step("keep the sweep's detail")
    expect(keep).toContain(
      "if: always() && (github.event_name == 'schedule' || github.event.inputs.sweep == 'true')",
    )
    expect(keep).toContain('uses: actions/upload-artifact@v4')
    expect(keep).toContain('name: nightly-sweep-${{ github.run_id }}')
    expect(keep).toContain('.run-status/nightly-sweep.detail.json')
    expect(keep).toContain('${{ runner.temp }}/sweep.log')
    // Right after the sweep, before production's sign-in.
    expect(ci.indexOf('- name: nightly sweep of dev')).toBeLessThan(
      ci.indexOf("- name: keep the sweep's detail"),
    )
    expect(ci.indexOf("- name: keep the sweep's detail")).toBeLessThan(
      ci.indexOf('- name: nightly production sign-in'),
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

// ---------------------------------------------------------------------------
// THE DEV DEPLOY IS NOT FINISHED UNTIL EVERY PAGE HAS RENDERED (§6.8, owner's
// brief 2026-11-11). Twice on 2026-11-10 a /trucks that answered 500 to every
// role reached dev on a green CI: nothing before the deploy renders a page.
// ---------------------------------------------------------------------------
describe('the dev deploy ends with the rendered-page check', () => {
  const DEPLOY_IF =
    "if: vars.CI_DEPLOY == 'true' && github.event_name != 'schedule' && github.event.inputs.sweep != 'true'"
  const commandsOf = (text: string): string[] =>
    text
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line !== '' && !line.startsWith('#'))
  const at = (name: string): number => {
    const index = ci.indexOf(`- name: ${name}\n`)
    expect(index, name).toBeGreaterThan(-1)
    return index
  }

  it('first asks Cloudflare that dev serves HEAD, and reads that verdict from the file', () => {
    const serves = step('dev serves HEAD')
    // The deploy's own condition: never on the schedule, never on a nightly
    // run by hand, never when CI_DEPLOY has not been set.
    expect(serves).toContain(DEPLOY_IF)
    // THE BASELINE IS READ FROM THE WORKER, with the strict flag that refuses
    // unless dev's stamp is HEAD — a clean sweep of the previous version is
    // the false green this step exists to prevent.
    expect(serves).toContain(
      'run-status.mjs deploy-drift -- node scripts/check-deploy-drift.mjs --require-current dev',
    )
    expect(serves).toContain(
      'CLOUDFLARE_API_TOKEN: ${{ secrets.CLOUDFLARE_API_TOKEN }}',
    )
    expect(commandsOf(serves).at(-1)).toBe(
      'node scripts/run-status.mjs --check deploy-drift',
    )
  })

  it('then sweeps every page as six roles, and the file is the verdict', () => {
    const sweep = step('rendered pages after the dev deploy')
    expect(sweep).toContain(DEPLOY_IF)
    expect(sweep).toContain('run-status.mjs deploy-sweep -- npm run sweep')
    expect(sweep).toMatch(/SWEEP_LOG="\$RUNNER_TEMP\/deploy-sweep\.log"/)
    expect(sweep).toMatch(/npm run sweep > "\$SWEEP_LOG" 2>&1 \|\| true/)
    expect(sweep).not.toMatch(/> sweep\.log/)
    expect(commandsOf(sweep).at(-1)).toBe(
      'node scripts/run-status.mjs --check deploy-sweep',
    )
    // Six roles, or the sweep says NO <ROLE> CREDENTIALS and is NOT OK.
    for (const role of [
      'ADMIN',
      'MANAGER',
      'DISPATCHER',
      'ACCOUNTING',
      'DRIVER',
    ]) {
      expect(sweep).toContain(
        `SEED_${role}_EMAIL: \${{ secrets.SEED_${role}_EMAIL }}`,
      )
      expect(sweep).toContain(
        `SEED_${role}_PASSWORD: \${{ secrets.SEED_${role}_PASSWORD }}`,
      )
    }
    // The tail token, never the deploy token.
    expect(sweep).toContain(
      'CLOUDFLARE_API_TOKEN: ${{ secrets.CLOUDFLARE_TAIL_TOKEN }}',
    )
  })

  it("keeps the deploy sweep's detail as an artifact, pass or fail", () => {
    const keep = step("keep the deploy sweep's detail")
    expect(keep).toContain(`if: always() && ${DEPLOY_IF.slice('if: '.length)}`)
    expect(keep).toContain('uses: actions/upload-artifact@v4')
    expect(keep).toContain('name: deploy-sweep-${{ github.run_id }}')
    expect(keep).toContain('.run-status/deploy-sweep.detail.json')
    expect(keep).toContain('${{ runner.temp }}/deploy-sweep.log')
  })

  it('and they follow the deploy, in that order, before the housekeeping', () => {
    expect(at('deploy dev')).toBeLessThan(at('dev serves HEAD'))
    expect(at('dev serves HEAD')).toBeLessThan(
      at('rendered pages after the dev deploy'),
    )
    expect(at('rendered pages after the dev deploy')).toBeLessThan(
      at("keep the deploy sweep's detail"),
    )
    expect(at("keep the deploy sweep's detail")).toBeLessThan(
      at('keep the failure log'),
    )
  })
})
