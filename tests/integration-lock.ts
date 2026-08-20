import 'dotenv/config'
import { hostname } from 'node:os'
import { neonConfig, Pool } from '@neondatabase/serverless'

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
