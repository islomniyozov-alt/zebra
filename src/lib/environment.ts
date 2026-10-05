// ---------------------------------------------------------------------------
// WHICH DATABASE IS THIS WORKER LOOKING AT? (§6.1.2)
//
// One function, so the ribbon's rule can be watched failing without a worker.
// The alternative — an inline `process.env.NEON_BRANCH !== 'production'` in a
// layout — is the arrangement that put the production gate beyond reach of every
// test for two phases.
//
// ── `NEON_BRANCH`, FOR THE REASON `statement-send.ts` ALREADY GIVES ──────
//
// It names THE DATA. `NODE_ENV` is `production` in every built worker including
// dev's, so it cannot tell them apart; a hostname test breaks the day
// zebratms.com is attached; and the question a person is really asking when they
// look up is "whose rows am I about to change".
//
// ── THE LABEL IS THE BRANCH, NOT THE WORD "DEV" ─────────────────────────
//
// CI forks per-run branches called `ci-<run id>` and a preview worker would be
// something else again. A ribbon that says DEV above a `ci-884` database is
// confidently wrong, which is worse than absent — so it prints what it read.
// ---------------------------------------------------------------------------

export interface EnvironmentEnv {
  NEON_BRANCH?: string | undefined
}

/**
 * The branch to announce, or `null` on production.
 *
 * NULL IS THE PRODUCTION ANSWER, and the caller renders nothing at all for it —
 * not an empty band, not a ribbon reading "production". §6.1.2: the absence is
 * the signal, because an element that can render a label on production is an
 * element that can render the WRONG label on production.
 *
 * AN UNSET BRANCH IS ANNOUNCED, NOT ASSUMED SAFE. A worker whose binding went
 * missing is not a production worker; it is a worker nobody can place, which is
 * exactly when somebody should be told. It says so in those words rather than
 * printing an empty string.
 */
export function ribbonBranch(env: EnvironmentEnv): string | null {
  const label = (env.NEON_BRANCH ?? '').trim()
  // FOLDED THE WAY THE PRODUCTION GATE FOLDS IT (`prisma/production-gate.ts`),
  // so ` Production` is production to both of them. Two guards disagreeing about
  // what the production label looks like is the gap that folding closes.
  if (label.toLowerCase() === 'production') return null
  return label === '' ? 'unknown' : label
}
