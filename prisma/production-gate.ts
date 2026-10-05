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
// ── TWO AMENDMENTS, OWNER'S RULING 2026-10-05 ────────────────────────────
//
// 1. THE VALUE IS THE MIGRATION NUMBER BEING APPLIED, NOT `1`.
//
//    `ALLOW_PROD_MIGRATION=1` is a value that stays true forever. Set once in a
//    shell profile, a Windows User variable or a terminal somebody keeps open
//    for a week, and the gate is off from then on without anybody deciding that.
//    `ALLOW_PROD_MIGRATION=62` stops working the moment migration 63 exists, so
//    the override expires on its own and the operator has to look at what they
//    are applying in order to name it.
//
//    The number is the ORDINAL of the newest directory in `prisma/migrations` —
//    61 of them today, the newest being `20261001010000_migration_61`, which is
//    the numbering this repository already speaks.
//
// 2. A PERSISTED VARIABLE IS A REFUSAL, NOT A CONVENIENCE.
//
//    On Windows an environment variable has three scopes, and two of them
//    outlive the terminal: `setx` and the System Properties dialog write to the
//    User and Machine registry hives. A variable there is in every future shell,
//    including the one somebody opens next month to run a migration they have
//    not thought about. So if `ALLOW_PROD_MIGRATION` or `NEON_BRANCH` is found in
//    either hive, the production write is refused and the message says how to
//    remove it — the same reasoning as "never in .env", applied to the place
//    nobody thinks of as a file.
//
//    AND IF THE HIVES CANNOT BE READ, THAT IS ALSO A REFUSAL on the production
//    path. An unreadable registry means the check did not happen, and a check
//    that did not happen must not read as a check that passed.
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
      reason:
        | 'missing_branch'
        | 'node_env'
        | 'missing_override'
        | 'stale_override'
        | 'persisted_variable'
        | 'scopes_unknown'
      message: string
    }

/**
 * What the caller knows that this file cannot: which migration is being applied,
 * and what the machine's persistent environment holds.
 *
 * PASSED IN RATHER THAN READ HERE, so the gate stays pure and every refusal can
 * be watched failing without a filesystem or a registry. `latestMigrationNumber`
 * and `readPersistedScopes` are the two readers, and they are separate on
 * purpose.
 */
export interface ProductionGateContext {
  /** The ordinal of the migration being applied — the expected override value. */
  expected?: number | undefined
  /**
   * Variable names found in a PERSISTENT Windows scope (User or Machine).
   * `undefined` means the scopes could not be read, which is not the same as
   * none and is refused on the production path.
   */
  persisted?: string[] | undefined
}

/**
 * The migration number, from the directory listing.
 *
 * COUNTED, because that is the numbering in use: 61 directories today and the
 * newest is named `migration_61`. A timestamp prefix sorts but does not count,
 * and the operator needs the number they already say out loud.
 */
export function latestMigrationNumber(entries: readonly string[]): number {
  return entries.filter((name) => /^\d{14}_/.test(name)).length
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
  context: ProductionGateContext = {},
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

  // THE PERSISTENT SCOPES, BEFORE THE OVERRIDE IS EVEN LOOKED AT. A correct
  // value in the wrong place is still a gate that is permanently off, and
  // checking the value first would let the message congratulate somebody on an
  // override that outlives their terminal.
  if (context.persisted === undefined) {
    return {
      ok: false,
      reason: 'scopes_unknown',
      message:
        `Refusing to run the ${operation}: the persistent environment could ` +
        'not be read, so nobody knows whether this override outlives the ' +
        'terminal.\n' +
        '  A check that did not happen is not a check that passed.\n' +
        '  Read them by hand and say what you found:\n' +
        "    powershell -c \"[Environment]::GetEnvironmentVariable('ALLOW_PROD_MIGRATION','User')\"",
    }
  }

  if (context.persisted.length > 0) {
    const names = [...context.persisted].sort().join(', ')
    return {
      ok: false,
      reason: 'persisted_variable',
      message:
        `Refusing to run the ${operation}: ${names} ` +
        `${context.persisted.length === 1 ? 'is' : 'are'} set in a PERSISTENT ` +
        'Windows scope (User or Machine).\n' +
        '  A variable in the registry is in every future shell, including the ' +
        'one somebody opens next month. That is the same mistake as putting it ' +
        'in .env, in the place nobody thinks of as a file.\n' +
        '  Remove it, then run the command with the value inline:\n' +
        names
          .split(', ')
          .map(
            (name) =>
              `    setx ${name} "" && reg delete HKCU\\Environment /v ${name} /f`,
          )
          .join('\n'),
    }
  }

  // THE NAME IS IN THE MESSAGE AND SO IS THE PROHIBITION. A reader who hits
  // this is one copy-paste away from putting it in `.env`, which would leave it
  // set in every future shell and turn the gate off permanently.
  const expected = context.expected
  const wanted = expected === undefined ? null : String(expected)

  if (!env.ALLOW_PROD_MIGRATION) {
    return {
      ok: false,
      reason: 'missing_override',
      message:
        `Refusing to run the ${operation} against the production branch.\n` +
        `  MISSING: ALLOW_PROD_MIGRATION=${wanted ?? '<the migration number being applied>'}\n` +
        '  NOT 1. The value is the migration number, so the override expires ' +
        'when the next migration lands instead of staying true forever.\n' +
        '  It goes on that ONE command and NEVER in .env, .env.example, any ' +
        'committed file, or a Windows User/Machine variable — stored anywhere ' +
        'it is not a gate, it is a comment.\n' +
        `  e.g.  NEON_BRANCH=production NODE_ENV=production ` +
        `ALLOW_PROD_MIGRATION=${wanted ?? '<number>'} <command>`,
    }
  }

  // A VALUE THAT IS NOT THE NUMBER IS REFUSED BY NAME, and `1` is called out
  // because it is what every reader of the old rule will type first.
  if (wanted !== null && env.ALLOW_PROD_MIGRATION.trim() !== wanted) {
    const given = env.ALLOW_PROD_MIGRATION.trim()
    return {
      ok: false,
      reason: 'stale_override',
      message:
        `Refusing to run the ${operation}: ALLOW_PROD_MIGRATION is "${given}" ` +
        `and the migration being applied is ${wanted}.\n` +
        (given === '1'
          ? '  "1" was the old value and is no longer accepted: it is true ' +
            'forever, which is what made it worth removing.\n'
          : '  A stale number means this terminal was set up for a migration ' +
            'that has already landed.\n') +
        `  Run it again with ALLOW_PROD_MIGRATION=${wanted}, inline.`,
    }
  }

  return { ok: true, production: true }
}

/** The same, as the throw a config file or a script needs. */
export function assertProductionWrite(
  env: ProductionGateEnv,
  operation: string,
  context: ProductionGateContext = {},
): void {
  const verdict = checkProductionWrite(env, operation, context)
  if (!verdict.ok) throw new Error(verdict.message)
}
