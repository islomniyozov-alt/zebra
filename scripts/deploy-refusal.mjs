// ---------------------------------------------------------------------------
// WHY THE DEPLOY REFUSED, IN WORDS THAT NAME THE ACTUAL CAUSE.
//
// IT LIVES IN ITS OWN FILE SO IT CAN BE TESTED. `deploy.mjs` runs on import —
// it builds and ships as a side effect — so a test that imported it to check a
// string would deploy the application. Splitting the mapping out is the whole
// reason this file exists; there is nothing else in it.
//
// ── THE FAILURE THIS REPLACED ─────────────────────────────────────────────
//
// The refusal said "the integration suite is red" for every outcome. On
// 2026-09-07 it said it after 482 PASSING tests: the working tree had been
// edited while the suite ran, so no receipt could be written. The message sent
// the reader to debug tests that had passed.
//
// The same day it said it again after `CREATE DATABASE ... TEMPLATE` lost a
// race in `globalSetup` — a run in which ZERO tests executed, and about which
// "red" says something false rather than merely unhelpful.
//
// THREE OUTCOMES, THREE DIFFERENT ACTIONS, and only one of them is "fix the
// tests". A gate that collapses them is a gate whose output has to be
// distrusted and re-derived by hand, which is how people learn to skip it.
// ---------------------------------------------------------------------------

/**
 * The refusal to print, as `[headline, advice]`.
 *
 * `reason` comes from `runIntegrationSuite`. An unrecognised or missing one
 * falls through to the test-failure wording, which is the conservative choice:
 * it is the only branch that tells somebody to go and look at the tests, and
 * being sent to look needlessly is cheaper than being told nothing is wrong.
 */
export function refusalMessage(reason, target) {
  if (reason === 'tree_moved') {
    return [
      `Refusing to deploy to ${target}: THE SUITE PASSED, but the working ` +
        'tree changed while it ran, so no receipt was written.',
      'Nothing is wrong with the tests. Commit or stash, then re-run — and ' +
        'leave the tree alone for the duration of the run.',
    ]
  }

  if (reason === 'not_runnable') {
    return [
      `Refusing to deploy to ${target}: the integration suite could not run. ` +
        'It never reached the tests, so nothing has been proven about them ' +
        'either way.',
      'Read the reason printed above; it is not a test failure.',
    ]
  }

  return [
    `Refusing to deploy to ${target}: the integration suite is red.`,
    'Fix it, or deploy with --skip-integration and say why in the report.',
  ]
}
