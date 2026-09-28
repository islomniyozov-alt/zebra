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
 * THE PREFIX ON EVERY STAMPED VERSION MESSAGE, AND WHY THERE IS ONE.
 *
 * ── A SHORT SHA CAN BE A NUMBER ───────────────────────────────────────────
 *
 * On 2026-09-28 production deployed `9838e03` and this check read it back as
 * `9838000`. That is the sha parsed as scientific notation — 9838 × 10³ —
 * because a bare `--message 9838e03` is a numeric-looking CLI argument and gets
 * coerced to a number before it ever reaches Cloudflare. The annotation then
 * holds a number, and no amount of care on the reading side can undo it:
 * `9838000` could have been `9838e03`, `98380e02` or `983800e01`.
 *
 * IT FAILED LOUDLY, WHICH IS THE ONLY REASON IT WAS CHEAP — "not a commit in
 * this clone" rather than a confident wrong match. But it left `check:drift`
 * unable to say where production stood, and that is the one thing it exists for.
 *
 * SO THE STAMP CARRIES A PREFIX THAT CANNOT PARSE AS A NUMBER. `sha-9838e03` is
 * a string under any parser, and the reader strips it. The shape only bit a sha
 * matching `^\d+e\d+$` — the previous deploy's `2819d73` was safe because `d`
 * is not an exponent marker — which is exactly the kind of rare that arrives
 * unannounced and costs an afternoon.
 *
 * ONE DEFINITION, READ BY BOTH SIDES. `deploy.mjs` builds the message with
 * `stampFor` and this file parses it. A prefix agreed by two files that each
 * spell it themselves is the same class of bug one layer up.
 */
export const STAMP_PREFIX = 'sha-'

/** The `--message` a deploy stamps. Never numeric, by construction. */
export function stampFor(sha, dirty) {
  return `${STAMP_PREFIX}${sha}${dirty ? '+dirty' : ''}`
}

/**
 * The commit a message names, prefix stripped, or null.
 *
 * ACCEPTS THE BARE FORM TOO, and must: every version already deployed carries
 * an unprefixed sha, and a reader that only understood the new shape would
 * report the whole deployment history as unstamped the moment this shipped.
 */
export function commitFromStamp(message) {
  const text = String(message ?? '').trim()
  const bare = text.startsWith(STAMP_PREFIX)
    ? text.slice(STAMP_PREFIX.length)
    : text
  return /^[0-9a-f]{7,40}(\+dirty)?$/i.test(bare) ? bare : null
}

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
 *
 * A NUMBER IS NOT A COMMIT, and `9838000` arrives as one. It fails here, which
 * is what sends the caller looking for the last real deploy instead.
 */
export function looksLikeCommit(message) {
  return commitFromStamp(message) !== null
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

  // THROUGH `commitFromStamp`, so a prefixed message compares as its commit.
  // Stripping `+dirty` by hand here and the prefix somewhere else would be two
  // places that have to agree about the format — see `STAMP_PREFIX`.
  const commit = (commitFromStamp(deployedMessage) ?? '').replace('+dirty', '')
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

/**
 * What an unreadable run is worth: nothing, loudly.
 *
 * ── WHY THIS IS A FUNCTION AND NOT FOUR LINES IN THE SCRIPT ──────────────
 *
 * The script cannot be tested without Cloudflare, and a check about what to
 * do when Cloudflare is unreachable must not need Cloudflare to prove it
 * works. So the decision lives here, where `tests/deploy-drift.test.ts`
 * reaches it, and the script does what it says.
 *
 * ── THE RULE ─────────────────────────────────────────────────────────────
 *
 * On 2026-09-18 `check:drift` printed `could not be read` for both workers and
 * `not reached (fetch failed)` for the artifact probe, and exited 0, two
 * minutes after a production deploy. Both workers were fine; the machine could
 * not reach Cloudflare. An exit code of 0 from a drift check is read as "no
 * drift" by a person skimming, by `npm run check` and by CI, and nothing in
 * that output stops it.
 *
 * "I could not look" and "I looked and it is fine" are different answers.
 * Only the second may exit 0. Owner's ruling.
 *
 * @param {{ what: string, why: string }[]} unreadable
 * @returns {{ ok: boolean, exitCode: number, lines: string[] }}
 */
export function unreadableRefusal(unreadable) {
  if (unreadable.length === 0) {
    return { ok: true, exitCode: 0, lines: [] }
  }

  return {
    ok: false,
    exitCode: 1,
    lines: [
      '',
      '  ' + '='.repeat(70),
      '  UNREADABLE. THIS IS NOT A REPORT OF NO DRIFT.',
      ...unreadable.map(({ what, why }) => `    ${what}: ${why}`),
      '',
      '  Nothing above says either worker is wrong, and nothing above',
      '  says either worker is right — this run could not look. Fix',
      '  the connection and run it again before reading any verdict.',
      '  ' + '='.repeat(70),
    ],
  }
}

/**
 * Is this wrangler refusing for want of a credential, rather than failing?
 *
 * ── WHY THE ONE EXEMPTION EXISTS ─────────────────────────────────────────
 *
 * `npm run check` runs in CI, where `CLOUDFLARE_API_TOKEN` is deliberately
 * scoped to the deploy step and nowhere else — so the gate has never been able
 * to read either worker, and run 35310541290's gate printed `could not be
 * read` for both while everything was in fact fine. Making unreadability fatal
 * without this would fail every CI run on a condition that is configuration,
 * not breakage.
 *
 * ── AND WHY IT IS THE ONLY ONE ───────────────────────────────────────────
 *
 * The polarity matters more than the list. Everything not recognised here is
 * FATAL, so a novel transport failure fails closed and only this one known,
 * named, self-describing condition is exempt. Written the other way round — a
 * list of fatal errors, everything else benign — the next unfamiliar failure
 * would exit 0 and the ruling would be back where it started.
 *
 * It is also not silence: the caller says `not checked` and says why, in words
 * that cannot be read as a verdict.
 *
 * @param {string} text combined stderr and message from the failed call
 */
export function isMissingCredentials(text) {
  return /necessary to set a CLOUDFLARE_API_TOKEN|CLOUDFLARE_API_TOKEN environment variable/i.test(
    text ?? '',
  )
}
