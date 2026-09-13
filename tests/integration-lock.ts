import 'dotenv/config'
import { assertSocketCrashGuard } from './socket-crash-guard'
import { hostname } from 'node:os'
import { readdirSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { neonConfig, Pool } from '@neondatabase/serverless'
import {
  TEMPLATE_APPLICATION_NAME,
  TEMPLATE_DB,
  WORKER_DB_PREFIX,
  withApplicationName,
  withDatabase,
  workerCount,
  workerDatabase,
  setConnectable,
  terminateSessionsOn,
  describeSession,
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

  // UNLOCKED TO BE READ, LOCKED AGAIN BEFORE IT IS COPIED.
  //
  // The template is left with `allow_connections = false` between runs — see
  // `setConnectable` for the measurement that put it there. Reading its
  // migration list and running `migrate deploy` against it both need a
  // connection, so it is opened here and shut in `buildWorkerDatabases` before
  // the first copy.
  //
  // SELF-HEALING BY CONSTRUCTION. A run that dies between the two leaves a
  // connectable template, which is the state every run before today left it
  // in — the next run unlocks what is already unlocked and carries on.
  await setConnectable(admin, TEMPLATE_DB, true)
  await admin.end()

  const wanted = migrationsOnDisk()

  // A SEPARATE, SHORT-LIVED CONNECTION TO THE TEMPLATE, closed before anything
  // copies from it. `CREATE DATABASE ... TEMPLATE` refuses while any session is
  // connected to the source, so every read of the template is opened and shut
  // rather than held.
  // STAMPED, so the sessions we are about to open to the template can be told
  // apart from anybody else's. Both consumers below — the probe pool and the
  // `migrate deploy` child — get this URL, and `awaitTemplateIdle` will only
  // terminate what carries this name.
  const templateUrl = withApplicationName(
    withDatabase(adminUrl, TEMPLATE_DB),
    TEMPLATE_APPLICATION_NAME,
  )
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

  // Node on Prisma's own entry rather than `npx` through a shell — see the
  // note in scripts/integration-gate.mjs. Same DEP0190, same fix.
  // A file path, not a package specifier — see scripts/integration-gate.mjs.
  const prisma = fileURLToPath(
    new URL('../node_modules/prisma/build/index.js', import.meta.url),
  )
  const result = spawnSync(process.execPath, [prisma, 'migrate', 'deploy'], {
    stdio: 'inherit',
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
/**
 * Wait until nothing is connected to the template, terminating what is.
 *
 * ASKING RATHER THAN HOPING. This was a fire-and-forget `pg_terminate_backend`
 * followed by copies that retried on 55006, and it was not enough: termination
 * is a REQUEST, and the run that has just migrated the template is the one
 * whose `prisma migrate deploy` child has a backend still winding down. Twelve
 * retries over ~20 seconds went red on exactly that run — the first gate after
 * a new migration landed.
 *
 * So this loops until `pg_stat_activity` agrees the template is idle, and says
 * so if it never does.
 *
 * ── IT ONLY TERMINATES WHAT IT CAN PROVE IS ITS OWN ───────────────────────
 *
 * This used to terminate EVERY session on the template, justified by the run
 * lock: the lock is held, therefore anything here is a leftover of ours. That
 * reasoning assumes the invariant it is protecting, and this project has
 * already had the lock violated once — two runners against the same branch,
 * fifteen seconds apart, which is the incident the header of this file
 * describes. Under exactly that condition the old wait does not merely fail to
 * protect: it reaches into the other runner and kills its connections, and the
 * harder it tries the more of somebody else's work it destroys.
 *
 * So termination is scoped to `application_name = TEMPLATE_APPLICATION_NAME`,
 * which this suite stamps onto every template URL it hands out. Anything else
 * is WAITED FOR — never killed — and if it outlasts the deadline the error
 * names it rather than removing it.
 *
 * AN UNIDENTIFIED SESSION IS TREATED AS SOMEBODY ELSE'S, including our own
 * `migrate deploy` child if its client ignores the parameter. Waiting for a
 * backend that is already winding down costs a moment; the alternative costs
 * somebody else their run.
 */
interface ForeignSession {
  pid: number
  application_name: string | null
  usename: string | null
  client_addr: string | null
  backend_start: string | null
}

async function awaitTemplateIdle(admin: Pool): Promise<void> {
  const deadline = Date.now() + 60_000
  let waited = false

  for (;;) {
    // OURS, BY NAME. Anything without this application_name is left alone.
    await admin.query(
      `select pg_terminate_backend(pid) from pg_stat_activity
        where datname = $1 and pid <> pg_backend_pid()
          and application_name = $2`,
      [TEMPLATE_DB, TEMPLATE_APPLICATION_NAME],
    )

    const { rows } = await admin.query(
      `select pid, application_name, usename::text as usename,
              client_addr::text as client_addr,
              backend_start::text as backend_start
         from pg_stat_activity
        where datname = $1 and pid <> pg_backend_pid()`,
      [TEMPLATE_DB],
    )
    const busy = rows as ForeignSession[]
    if (busy.length === 0) {
      if (waited) console.log(`[integration] template ${TEMPLATE_DB} is idle`)
      return
    }

    if (Date.now() > deadline) {
      // NAMED, NOT REMOVED. If this is another runner, the useful thing is to
      // say who is holding the template — not to take it from them.
      const who = busy
        .map(
          (session) =>
            `pid ${session.pid} (application_name ${
              session.application_name || '(none)'
            }, user ${session.usename ?? '?'}, from ${
              session.client_addr ?? 'local'
            }, since ${session.backend_start ?? '?'})`,
        )
        .join('; ')
      throw new Error(
        `${busy.length} session(s) still connected to ${TEMPLATE_DB} after 60s, ` +
          `and none of them is ours to terminate: ${who}. ` +
          'CREATE DATABASE ... TEMPLATE cannot copy a database in use. ' +
          'If another integration run is in flight against this branch, let it ' +
          'finish — this wait will not kill it.',
      )
    }

    if (!waited) {
      const mine = busy.filter(
        (session) => session.application_name === TEMPLATE_APPLICATION_NAME,
      ).length
      console.log(
        `[integration] waiting for ${busy.length} session(s) to leave ${TEMPLATE_DB}` +
          ` (${mine} ours, ${busy.length - mine} not ours and not terminated)`,
      )
      waited = true
    }
    await new Promise((resolve) => setTimeout(resolve, 500))
  }
}

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

    // ── CLEAR THE TEMPLATE BEFORE CLONING, NOT MERELY WAIT FOR IT ───────
    //
    // `awaitTemplateIdle` below terminates sessions carrying OUR
    // application_name and waits for everything else, which was the right
    // trade while 55006 was rare. It stopped being rare: on 2026-09-11 it
    // refused three deploys in one day, and each time the gate never reached a
    // test — so nothing was proven about the suite either way — and each time a
    // retry minutes later passed.
    //
    // ANYTHING NOT OURS IS NAMED IN THE LOG. That is the whole of the trade: a
    // session we cannot prove is ours now gets terminated, and the line saying
    // whose it was is in the output of the run that did it. A silent kill would
    // be worse than the wait it replaces.
    const cleared = await terminateSessionsOn(admin, TEMPLATE_DB)
    const foreign = cleared.filter(
      (session) => session.application_name !== TEMPLATE_APPLICATION_NAME,
    )
    if (cleared.length > 0) {
      console.log(
        `[integration] cleared ${cleared.length} session(s) off ${TEMPLATE_DB}` +
          ` before cloning (${cleared.length - foreign.length} ours)`,
      )
    }
    for (const session of foreign) {
      console.warn(
        `[integration] terminated a session on ${TEMPLATE_DB} that was NOT ours: ${describeSession(session)}`,
      )
    }

    // ── AND THEN SHUT THE DOOR ──────────────────────────────────────────
    //
    // Measured 2026-09-13: with connections forbidden, four sequential copies
    // took 1,019ms and no refusals; connectable, the same four took 31,720ms
    // and five. Terminating sessions cannot win a race against a MANAGED
    // background worker that reconnects — `TimescaleDB Background Worker
    // Scheduler`, caught on this very database by the probe — and this does
    // not have to win it, because with the door shut there is no race.
    //
    // AFTER the sweep above, which is what makes this legal: `ALTER DATABASE`
    // does not evict anybody, it only stops the next arrival.
    await setConnectable(admin, TEMPLATE_DB, false)

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
    await awaitTemplateIdle(admin)

    const count = workerCount()
    const startedAt = Date.now()

    // COPIED CONCURRENTLY — AND THE MECHANISM THAT ARGUES AGAINST IT IS REAL,
    // WHICH IS WHY THIS NOTE IS LONG.
    //
    // THE MECHANISM. `CREATE DATABASE ... TEMPLATE` is itself a session using
    // the SOURCE, so eight concurrent copies are eight sessions on the template
    // refusing each other with `55006 — There is 1 other session using the
    // database`. An older comment here claimed the copies "are independent:
    // each reads the same template and writes a different database". That was
    // wrong, and the "1 other session" in those errors is usually the copy
    // running beside this one rather than a leftover from a previous run.
    //
    // SERIALISING WAS TRIED, ON 2026-09-05, AND REVERTED THE SAME HOUR.
    // Measured: 81.5s sequential against 1.4–3.4s concurrent. Each copy costs
    // ~10s alone and they parallelise well — a reading of "eight copies in
    // 1.4s" as evidence that copies are cheap gets this exactly backwards, and
    // that misreading is what justified the change.
    //
    // THE RECORD THAT DECIDED IT, across six gates: 55006 killed ONE run.
    // Compute drops killed THREE — a resume mid-setup, a socket lost taking
    // the run lock, and a socket lost inside `awaitTemplateIdle`. Serialising
    // addressed the rare failure and lengthened the window for the common one,
    // and the very next gate died in that longer window.
    //
    // SO: A REAL MECHANISM DOES NOT MAKE A TRADE WORTH IT. Both halves of that
    // have to be established separately, and only the first one was. If you
    // have just rediscovered the 55006 mechanism and are reaching for
    // `for (const slot of slots) await copy(slot)`, this is the note saying it
    // was measured and lost. The bounded retry below is the part that earns
    // its place.
    const copy = async (slot: number) => {
      // AND A BOUNDED RETRY, because termination is asynchronous: the backend
      // is asked to go away, and `pg_stat_activity` stops listing it slightly
      // before the database stops counting it.
      let lastError: unknown = null
      for (let attempt = 0; attempt < 12; attempt++) {
        try {
          await admin.query(
            `create database "${workerDatabase(slot)}" template "${TEMPLATE_DB}"`,
          )
          lastError = null
          break
        } catch (error) {
          lastError = error
          if ((error as { code?: string }).code !== '55006') throw error
          // AND CLEAR IT AGAIN ON THE WAY ROUND. A session that arrived after
          // the sweep above — a worker reconnecting, a migrate child winding
          // down — is exactly what this retry exists for, and waiting for it
          // is what took three deploys.
          for (const session of await terminateSessionsOn(admin, TEMPLATE_DB)) {
            if (session.application_name !== TEMPLATE_APPLICATION_NAME) {
              console.warn(
                `[integration] terminated a late session on ${TEMPLATE_DB} that was NOT ours: ${describeSession(session)}`,
              )
            }
          }
          // THE SAME WAIT, not another blind sleep. A copy that loses this
          // race loses it to a session, and the way to stop losing it is to
          // watch that session leave.
          await awaitTemplateIdle(admin)

          // AND THEN ACTUALLY WAIT, which this did not do.
          //
          // `awaitTemplateIdle` returns as soon as `pg_stat_activity` shows
          // nobody — and the comment above this loop already knew that is
          // EARLIER than the database stops counting the session. So twelve
          // "retries" fired within a few milliseconds of each other, every one
          // of them into the same unfinished teardown, and the budget was gone
          // before the condition could clear. A single-file run failed on
          // 55006 that way while the same command a minute later succeeded.
          //
          // A retry with no delay against an asynchronous condition is not a
          // retry; it is the first attempt twelve times.
          await new Promise((resolve) =>
            setTimeout(resolve, 500 * (attempt + 1)),
          )
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
  // ARMED BEFORE THE FIRST POOL. globalSetup runs in the MAIN process, which
  // was unguarded while the workers were protected — and it is where the lock
  // and the template copy open their sockets. Asserted rather than assumed:
  // `worker-db.ts` installs it on import and this file imports that module,
  // so a failure here means the import chain changed.
  assertSocketCrashGuard('the integration globalSetup')

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

  // ── NO STRAY-SESSION ASSERTION HERE, AND THAT IS A FINDING ───────────
  //
  // One was written on 2026-09-13 and removed the same hour: "no session of
  // ours survives a run" CANNOT FAIL, so it was testing nothing.
  //
  // Vitest destroys each worker PROCESS — and its sockets with it — before
  // this teardown runs in the main process, and nothing in the main process
  // ever connects to a worker database. Verified by deleting a `$disconnect`
  // from `settings.test.ts` and watching the run still report every client
  // closed.
  //
  // The other end is covered already: `buildWorkerDatabases` drops orphan
  // worker databases `with (force)`, which evicts anything a previous run left
  // behind, whatever killed it.
  //
  // AND THE READING THAT PROMPTED IT WAS WRONG. 112 sessions on the worker
  // databases looked like a leak; every one carried `application_name =
  // 'pgbouncer'` — Neon's pooler holding its own server connections, not ours
  // to close, draining on its own schedule. The reading was taken while a run
  // was in flight. A check counting those would have failed every healthy run.
}
