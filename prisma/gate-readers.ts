import { readdirSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { join } from 'node:path'
import { latestMigrationNumber } from './production-gate'

// ---------------------------------------------------------------------------
// THE TWO THINGS `production-gate.ts` REFUSES TO READ FOR ITSELF.
//
// The gate is pure so that every refusal can be watched failing without a
// filesystem or a registry. That purity has to end somewhere, and it ends here —
// two functions, each doing one impure thing, each returning a value the gate
// can be handed.
//
// WHY THAT SPLIT IS WORTH A FILE. The first version of this rule lived as four
// `if`s inside `prisma.config.ts`, where no test could reach it; that is how the
// seed went two phases without the gate at all. Keeping the readings separate
// from the decision means the decision stays testable no matter how awkward the
// readings get — and reading the Windows registry is as awkward as it gets.
// ---------------------------------------------------------------------------

/** The ordinal of the newest migration, from the directory the CLI applies. */
export function readLatestMigrationNumber(
  dir = join(process.cwd(), 'prisma', 'migrations'),
): number | undefined {
  try {
    return latestMigrationNumber(readdirSync(dir))
  } catch {
    // A MISSING DIRECTORY IS NOT A ZERO. `undefined` makes the gate ask for
    // "<the migration number being applied>" instead of asserting that the
    // answer is nought, which would accept `ALLOW_PROD_MIGRATION=0`.
    return undefined
  }
}

/** The names this looks for in a persistent scope. */
export const PERSISTENT_NAMES = ['ALLOW_PROD_MIGRATION', 'NEON_BRANCH'] as const

/**
 * Which of those names are set in a PERSISTENT Windows scope.
 *
 * `undefined` means the question could not be answered — and the gate treats
 * that as a refusal on the production path, because a check that did not happen
 * must not read as a check that passed.
 *
 * ── ONE POWERSHELL CALL, NOT FOUR ─────────────────────────────────────────
 *
 * Each name has two hives to ask about. Four `GetEnvironmentVariable` calls
 * would be four process spawns on the slowest possible platform for spawning;
 * this asks once and prints one line per name that is set.
 *
 * ── AND IT IS WINDOWS-ONLY ON PURPOSE ─────────────────────────────────────
 *
 * There are no User/Machine hives elsewhere, so on any other platform the honest
 * answer is "none are persisted that way" rather than "cannot tell": the hazard
 * does not exist there. CI is Linux and never takes the production path anyway —
 * `NEON_BRANCH=ci-<run id>` is not the production label.
 */
export interface ScopeRun {
  error?: unknown
  status?: number | null
  stdout?: string | undefined
}

/**
 * How the shell is run. Injectable for ONE reason: the fail-closed branch below
 * is unreachable on a machine where PowerShell works, which is every machine
 * this will run on — so a break that deleted it was watched NOT firing, and an
 * untested refusal is a refusal nobody knows works.
 */
export type ScopeRunner = (script: string) => ScopeRun

const powershellRunner: ScopeRunner = (script) =>
  spawnSync(
    'powershell',
    ['-NoProfile', '-NonInteractive', '-Command', script],
    {
      encoding: 'utf8',
      timeout: 20_000,
    },
  )

export function readPersistedScopes(
  names: readonly string[] = PERSISTENT_NAMES,
  run: ScopeRunner = powershellRunner,
  platform: string = process.platform,
): string[] | undefined {
  if (platform !== 'win32') return []

  const script = names
    .map(
      (name) =>
        `foreach ($s in 'User','Machine') { ` +
        `if ([Environment]::GetEnvironmentVariable('${name}', $s)) { '${name}' } }`,
    )
    .join('; ')

  const result = run(script)

  // FAIL CLOSED, LOUDLY ENOUGH TO BE FIXED. A missing shell, a timeout, a
  // non-zero exit — each means the hives were not read, and each returns
  // `undefined` rather than an empty list.
  if (
    result.error ||
    result.status !== 0 ||
    typeof result.stdout !== 'string'
  ) {
    return undefined
  }

  const found = result.stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => names.includes(line))

  return [...new Set(found)]
}
