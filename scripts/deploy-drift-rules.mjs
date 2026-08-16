// ---------------------------------------------------------------------------
// THE DRIFT DECISION, WITH NO IO IN IT.
//
// Separate from check-deploy-drift.mjs so that a test can import it. That
// script shells out to git and wrangler and ends with `process.exit(0)` — a
// module that runs all of that on import kills the test run it is imported
// into, which is what the first version did.
//
// Standing rule 8: a guardrail nobody has watched fire might be misconfigured,
// and this one fires on a condition that is awkward to stage on purpose —
// production trailing a src/ change happens exactly when you least want to be
// experimenting with your tooling. tests/deploy-drift.test.ts stages every
// state instead.
// ---------------------------------------------------------------------------

/**
 * Does this version's message name a commit?
 *
 * `scripts/deploy.mjs` stamps the short SHA with `--message`. NOTHING ELSE
 * DOES. A secret edited in the Cloudflare dashboard creates a new version with
 * a message of Cloudflare's choosing, and that version is what serves — so the
 * newest version can be one nobody deployed from a commit at all.
 *
 * THAT USED TO SILENCE THIS CHECK. A non-commit message failed `cat-file`,
 * came back as `unknown-commit`, and `unknown-commit` is QUIET. The one signal
 * that says "production is behind a change to src/" would have gone missing
 * for as long as the newest version was a config edit — which is exactly the
 * window after somebody has been fixing secrets by hand, which is exactly when
 * a half-finished deploy is most likely.
 */
export function looksLikeCommit(message) {
  return /^[0-9a-f]{7,40}(\+dirty)?$/i.test(String(message ?? '').trim())
}

export function classify({
  label,
  deployedMessage,
  head,
  isKnownCommit,
  changedSourceFiles,
}) {
  if (!deployedMessage) return { state: 'unstamped', loud: false }

  // A config version serves the CODE of the last real deploy. The caller
  // resolves that commit and passes it here, so drift is still measured
  // against the code actually running rather than going quiet.
  if (!looksLikeCommit(deployedMessage)) {
    return { state: 'config-version-unresolved', loud: false }
  }

  const commit = deployedMessage.replace('+dirty', '')
  if (deployedMessage === head || commit === head) {
    return { state: 'current', loud: false }
  }
  if (!isKnownCommit) return { state: 'unknown-commit', loud: false }

  const touchedSource = changedSourceFiles.length > 0
  return {
    state: touchedSource ? 'behind-source' : 'behind-only',
    // Dev being behind is the normal state of development, and a signal that
    // fires on the normal state is one people learn to skip. Production being
    // behind a change to src/ is the thing that shipped nothing while looking
    // like it shipped everything.
    loud: label === 'production' && touchedSource,
  }
}
