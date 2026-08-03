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

export function classify({
  label,
  deployedMessage,
  head,
  isKnownCommit,
  changedSourceFiles,
}) {
  if (!deployedMessage) return { state: 'unstamped', loud: false }

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
