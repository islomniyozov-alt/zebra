import 'dotenv/config'
import { hostname } from 'node:os'
import { readdirSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { neonConfig, Pool } from '@neondatabase/serverless'
import {
  TEMPLATE_DB,
  WORKER_DB_PREFIX,
  withDatabase,
  workerCount,
  workerDatabase,
} from './worker-db'

// ---------------------------------------------------------------------------
// ONE RUNNER PER DATABASE — NOW OWNED BY THE SUITE, NOT BY A LAUNCHER.
//
// On 2026-08-19 a gate and a `deploy:prod` started fifteen seconds apart
// against the same dev branch. One came back 417 passed and wrote a receipt;
// the other died in the audit suite. Both were void, and the GREEN one was the
// dangerous half: a run earned while another process is writing the same
// tables looks exactly like proof.
//
// The lock that fixed it lived in `scripts/integration-gate.mjs`, which meant
// it guarded `npm run test:integration` and `deploy:prod` and nothing else. A
// bare `npx vitest --project integration` — the obvious thing to type when
// reproducing a single failure, and the thing that WAS typed while diagnosing
// this very class of bug — walked straight past it. A guard on one door of a
// room with three is a guard on none.
//
// SO IT LIVES HERE, in `globalSetup`, which Vitest runs exactly once per run,
// in the main process, before any worker starts, whatever invoked it.
//
// NOT IN `tests/setup.ts`. That is a `setupFiles` entry and it executes ONCE
// PER TEST FILE IN ITS OWN PROCESS — measured: three files produced three
// executions under three distinct pids. A session-scoped lock there would be
// taken and dropped twenty-seven times a run, leaving a gap between every
// file, and any overlap between a finishing process and a starting one would
// refuse a legitimate run. Right intent, wrong lifecycle.
//
// `pg_try_advisory_lock` IS SESSION-SCOPED, which is the property that matters:
// it lives as long as the connection and dies with it. A lock row in a table
// would survive ^C, and the first interrupted run would block every run after
// it until somebody deleted the row by hand.
// ---------------------------------------------------------------------------

/** Arbitrary, and only has to agree with itself. */
const RUNNER_LOCK_KEY = 8127346501

/** Keeps the lock's connection from being reaped during a long run. */
const KEEPALIVE_MS = 60_000

let release: (() => Promise<void>) | null = null

/** Migration directory names, which is what `_prisma_migrations` records. */
function migrationsOnDisk(): string[] {
  return readdirSync('prisma/migrations', { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort()
}

/**
 * Bring the template up to date, or confirm it already is.
 *
 * SAYS WHICH BRANCH IT TOOK, always. A template is a cache of a schema, and a
 * cache nobody can see the freshness of is how a suite comes to prove last
 * week's migrations. The comparison is against the migrations FOLDER rather
 * than against a timestamp: a name present on disk and absent from the
 * template is the only thing that actually matters.
 */
async function ensureTemplate(adminUrl: string): Promise<void> {
  const admin = new Pool({ connectionString: adminUrl, max: 1 })
  const exists = await admin.query(
    'select 1 from pg_database where datname = $1',
    [TEMPLATE_DB],
  )
  if (exists.rowCount === 0) {
    await admin.query(`create database "${TEMPLATE_DB}"`)
    console.log(`[integration] template ${TEMPLATE_DB} created`)
  }
  await admin.end()

  const wanted = migrationsOnDisk()

  // A SEPARATE, SHORT-LIVED CONNECTION TO THE TEMPLATE, closed before anything
  // copies from it. `CREATE DATABASE ... TEMPLATE` refuses while any session is
  // connected to the source, so every read of the template is opened and shut
  // rather than held.
  const templateUrl = withDatabase(adminUrl, TEMPLATE_DB)
  let applied: string[] = []
  const probe = new Pool({ connectionString: templateUrl, max: 1 })
  try {
    const rows = await probe.query(
      'select migration_name from _prisma_migrations where finished_at is not null',
    )
    applied = rows.rows.map((row) => row.migration_name as string).sort()
  } catch {
    // No `_prisma_migrations` at all — a fresh or half-built template.
    applied = []
  } finally {
    await probe.end()
  }

  const missing = wanted.filter((name) => !applied.includes(name))
  if (missing.length === 0) {
    console.log(
      `[integration] template ${TEMPLATE_DB} is current (${applied.length} migrations) — reused`,
    )
    return
  }

  console.log(
    `[integration] template ${TEMPLATE_DB} is STALE: missing ${missing.length} of ${wanted.length}` +
      ` (${missing.slice(0, 3).join(', ')}${missing.length > 3 ? ', …' : ''})`,
  )
  // TWO VERY DIFFERENT COSTS, AND SAYING THE WRONG ONE IS NOT A ROUNDING
  // ERROR. `migrate deploy` applies only what is PENDING, so catching a
  // template up to a newly-landed migration takes seconds — measured, one
  // migration, and the run was indistinguishable from a normal one. The 155
  // seconds is the price of building a template from EMPTY, which happens on a
  // fresh machine and after somebody drops it.
  //
  // The message used to quote 155s for both. Wrong in the reassuring
  // direction: it would tell a reader that a routine schema change costs three
  // minutes of every run, which is the sort of thing that gets a cache
  // "optimised" into a correctness hole by somebody trying to help.
  console.log(
    missing.length === wanted.length
      ? `[integration] building it from empty — this costs ~155s, and only when the template is missing or dropped`
      : `[integration] applying ${missing.length} pending migration(s) — seconds, not the full chain`,
  )

  const result = spawnSync('npx', ['prisma', 'migrate', 'deploy'], {
    stdio: 'inherit',
    shell: true,
    env: {
      ...process.env,
      DATABASE_URL: templateUrl,
      DIRECT_DATABASE_URL: templateUrl,
    },
  })
  if (result.status !== 0) {
    throw new Error('migrating the integration template failed')
  }
  console.log('[integration] template migrated')
}

/**
 * Drop every worker database, then build one per worker from the template.
 *
 * THE SWEEP IS UNCONDITIONAL AND IT IS SAFE BECAUSE OF THE LOCK. A crashed run
 * leaves its databases behind; the run lock is already held by the time this
 * executes, so nothing else on this branch can be using them. `WITH (FORCE)`
 * because a leaked connection from a killed run would otherwise make its own
 * corpse undroppable.
 */
async function buildWorkerDatabases(adminUrl: string): Promise<void> {
  const admin = new Pool({ connectionString: adminUrl, max: 12 })
  try {
    const orphans = await admin.query(
      `select datname from pg_database where datname like $1`,
      [`${WORKER_DB_PREFIX}%`],
    )
    for (const row of orphans.rows) {
      await admin.query(`drop database "${row.datname}" with (force)`)
    }
    if (orphans.rowCount) {
      console.log(
        `[integration] swept ${orphans.rowCount} worker database(s) from a previous run`,
      )
    }

    // NOTHING MAY BE CONNECTED TO THE SOURCE, and something always is.
    //
    // `CREATE DATABASE ... TEMPLATE` fails with 55006 — "There is 1 other
    // session using the database" — if a single connection remains. The
    // migrate step above runs as a child process and its connection outlives
    // the exit of the CLI by a moment, so the very first copy raced it and
    // lost. This is not a hypothetical: it is what happened on the first run.
    //
    // Terminating is safe here for the same reason the sweep is: the run lock
    // is held, so any session on the template is a leftover of ours.
    await admin.query(
      `select pg_terminate_backend(pid) from pg_stat_activity
        where datname = $1 and pid <> pg_backend_pid()`,
      [TEMPLATE_DB],
    )

    const count = workerCount()
    const startedAt = Date.now()

    // COPIED CONCURRENTLY, ON SEPARATE CONNECTIONS. A populated copy costs
    // ~20 seconds — measured, 55 tables — so eight of them in series would be
    // 160s of setup and would give back most of what parallelism won. They are
    // independent: each reads the same template and writes a different
    // database, and Postgres serialises only the parts that must be.
    const copy = async (slot: number) => {
      // AND A BOUNDED RETRY, because termination is asynchronous: the backend
      // is asked to go away, and `pg_stat_activity` stops listing it slightly
      // before the database stops counting it.
      let lastError: unknown = null
      for (let attempt = 0; attempt < 10; attempt++) {
        try {
          await admin.query(
            `create database "${workerDatabase(slot)}" template "${TEMPLATE_DB}"`,
          )
          lastError = null
          break
        } catch (error) {
          lastError = error
          if ((error as { code?: string }).code !== '55006') throw error
          await admin.query(
            `select pg_terminate_backend(pid) from pg_stat_activity
              where datname = $1 and pid <> pg_backend_pid()`,
            [TEMPLATE_DB],
          )
          await new Promise((resolve) => setTimeout(resolve, 300))
        }
      }
      if (lastError) throw lastError
    }

    await Promise.all(
      Array.from({ length: count }, (_, index) => copy(index + 1)),
    )
    console.log(
      `[integration] ${count} worker database(s) copied from ${TEMPLATE_DB} in ${Date.now() - startedAt}ms`,
    )
  } finally {
    await admin.end()
  }
}

export async function setup(): Promise<void> {
  const url = process.env.DIRECT_DATABASE_URL
  if (!url) {
    throw new Error(
      'DIRECT_DATABASE_URL is not set; refusing to run the integration suite.',
    )
  }

  neonConfig.webSocketConstructor ??= WebSocket
  neonConfig.poolQueryViaFetch = false

  const pool = new Pool({ connectionString: url, max: 1 })
  // ONE CLIENT, CHECKED OUT AND HELD. An advisory lock belongs to a session, so
  // it has to be the same connection for the whole run; handing the query to a
  // pool free to rotate connections takes a lock and immediately loses it.
  const client = await pool.connect()

  const got = await client.query('select pg_try_advisory_lock($1) as got', [
    RUNNER_LOCK_KEY,
  ])

  if (got.rows[0]?.got !== true) {
    let who = ''
    try {
      const other = await client.query(
        `select application_name, client_addr, backend_start
           from pg_stat_activity
          where pid <> pg_backend_pid()
            and application_name like 'zebra-integration%'
          order by backend_start asc
          limit 1`,
      )
      const row = other.rows[0]
      if (row) {
        who =
          `\n  The other runner: ${row.application_name}` +
          `${row.client_addr ? ` from ${row.client_addr}` : ''}` +
          `, started ${new Date(row.backend_start).toLocaleString()}.`
      }
    } catch {
      // pg_stat_activity is the courtesy, not the mechanism.
    }

    client.release()
    await pool.end().catch(() => {})

    // Printed AND thrown. The throw is what makes the exit non-zero; the print
    // is what makes it readable, because a stack trace at the top of a
    // 55-minute command is not an explanation.
    const message =
      '\n' +
      '='.repeat(70) +
      '\nANOTHER INTEGRATION RUN IS ALREADY USING THIS DATABASE.\n\n' +
      'Two suites mutating one database do not produce two results. They\n' +
      'produce one void result that can still come back GREEN — which is how\n' +
      'a receipt got written for an uncontrolled run on 2026-08-19.' +
      who +
      '\n\nWait for it to finish, then run this again.\n' +
      '='.repeat(70) +
      '\n'
    console.error(message)
    throw new Error('another integration run holds the database lock')
  }

  // The name the next runner reads out of pg_stat_activity.
  await client.query(
    `set application_name = 'zebra-integration ${hostname()} pid ${process.pid}'`,
  )

  const keepalive = setInterval(() => {
    client.query('select 1').catch(() => {})
  }, KEEPALIVE_MS)
  keepalive.unref?.()

  // ONLY NOW, WITH THE LOCK HELD. The sweep drops databases; doing that before
  // knowing this is the only run would be dropping somebody else's.
  await ensureTemplate(url)
  await buildWorkerDatabases(url)

  release = async () => {
    clearInterval(keepalive)
    try {
      await client.query('select pg_advisory_unlock($1)', [RUNNER_LOCK_KEY])
    } catch {
      // Unlocking a dead connection is already unlocked.
    }
    client.release()
    await pool.end().catch(() => {})
  }
}

export async function teardown(): Promise<void> {
  // RELEASED WHATEVER HAPPENED. A red suite that kept the lock would make the
  // next attempt look like a concurrency problem instead of the failure it was.
  try {
    await release?.()
  } finally {
    release = null
  }
}
