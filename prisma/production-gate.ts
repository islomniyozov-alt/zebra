// ---------------------------------------------------------------------------
// MAY THIS COMMAND WRITE TO THE PRODUCTION BRANCH?
//
// ONE EXPRESSION OF THE GATE, ASKED BY EVERY LOCAL PATH THAT CAN WRITE SCHEMA
// OR ROWS. `prisma.config.ts` has refused `NEON_BRANCH=production` without
// `NODE_ENV=production` and `ALLOW_PROD_MIGRATION=1` since Phase 1. `seed.ts`
// did NOT: it ran, wrote the operating group, and merely skipped the isolation
// counterpart with a console line. A seed is a write.
//
// So the rule moves here and both ask it. A security rule expressed twice is
// two rules, and the second one is always the one nobody updated.
//
// ── IT IS PURE, SO IT CAN BE WATCHED FAILING ─────────────────────────────
//
// `checkProductionWrite` returns a verdict and `assertProductionWrite` throws
// it. The previous arrangement was four `if`s in a config file that no test
// could reach without running the Prisma CLI — which is how the seed's gap
// survived: nothing could ask it what it would do.
//
// ── WHAT IT DELIBERATELY DOES NOT DO ─────────────────────────────────────
//
// IT DOES NOT CONSTRAIN THE LABEL'S VOCABULARY. `ci.yml` sets
// `NEON_BRANCH=ci-<run id>` and `deploy-production.yml` sets
// `NEON_BRANCH=ci-prod-<run id>`, both pointing at per-run branches forked
// from dev. An allowlist of `dev | production` would refuse every CI run.
// Anything that is not the production label is not production.
//
// IT DOES NOT READ A CONNECTION STRING. Whether the URL is really production
// is a different question with a different instrument —
// `tests/db-target.ts` compares the two endpoints to each other, because a
// label is a sticker on a box. This gate is about the DECLARED intent, and
// both checks exist for the reason either one alone was not enough.
// ---------------------------------------------------------------------------

export interface ProductionGateEnv {
  NEON_BRANCH?: string | undefined
  NODE_ENV?: string | undefined
  ALLOW_PROD_MIGRATION?: string | undefined
}

export type GateVerdict =
  | { ok: true; production: boolean }
  | {
      ok: false
      reason: 'missing_branch' | 'node_env' | 'missing_override'
      message: string
    }

/** The label, folded the way `tests/db-target.ts` folds it. */
function labelOf(env: ProductionGateEnv): string {
  return (env.NEON_BRANCH ?? '').trim().toLowerCase()
}

/**
 * NORMALISED, not compared raw.
 *
 * `prisma.config.ts` compared `=== 'production'`, so ` Production` would have
 * been waved through while `tests/db-target.ts` — which already folds case and
 * whitespace — refused it. Two guards disagreeing about what the production
 * label looks like is a gap, and folding is the side that refuses more.
 */
export function isProductionLabel(env: ProductionGateEnv): boolean {
  return labelOf(env) === 'production'
}

/**
 * May this command write to the branch the environment declares?
 *
 * `operation` names the thing being refused, so the message says "migration" or
 * "seed" rather than something generic the reader has to map back to what they
 * typed.
 */
export function checkProductionWrite(
  env: ProductionGateEnv,
  operation: string,
): GateVerdict {
  if (labelOf(env) === '') {
    return {
      ok: false,
      reason: 'missing_branch',
      message:
        'NEON_BRANCH is not set. Declare it as "dev" or "production" in .env — ' +
        'this refuses to guess which database it points at.',
    }
  }

  if (!isProductionLabel(env)) return { ok: true, production: false }

  if (env.NODE_ENV !== 'production') {
    return {
      ok: false,
      reason: 'node_env',
      message:
        `Refusing to run the ${operation}: NEON_BRANCH=production while ` +
        'NODE_ENV is not production. Set NEON_BRANCH=dev.',
    }
  }

  // THE NAME IS IN THE MESSAGE AND SO IS THE PROHIBITION. A reader who hits
  // this is one copy-paste away from putting it in `.env`, which would leave it
  // set in every future shell and turn the gate off permanently.
  if (!env.ALLOW_PROD_MIGRATION) {
    return {
      ok: false,
      reason: 'missing_override',
      message:
        `Refusing to run the ${operation} against the production branch.\n` +
        '  MISSING: ALLOW_PROD_MIGRATION=1\n' +
        '  It goes on that ONE command and NEVER in .env, .env.example or any ' +
        'committed file — stored there it is not a gate, it is a comment.\n' +
        `  e.g.  NEON_BRANCH=production NODE_ENV=production ` +
        `ALLOW_PROD_MIGRATION=1 <command>`,
    }
  }

  return { ok: true, production: true }
}

/** The same, as the throw a config file or a script needs. */
export function assertProductionWrite(
  env: ProductionGateEnv,
  operation: string,
): void {
  const verdict = checkProductionWrite(env, operation)
  if (!verdict.ok) throw new Error(verdict.message)
}
