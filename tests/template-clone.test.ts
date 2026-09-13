import { Pool } from '@neondatabase/serverless'
import { afterAll, describe, expect, it } from 'vitest'
import {
  describeSession,
  setConnectable,
  terminateSessionsOn,
  withApplicationName,
  withDatabase,
} from './worker-db'

// ---------------------------------------------------------------------------
// A DATABASE WITH SOMEBODY ON IT CANNOT BE A TEMPLATE.
//
// `CREATE DATABASE ... TEMPLATE` fails with 55006 if ONE session remains, and
// on 2026-09-11 that refused three deploys in a single day. Each time the gate
// never reached a test — so nothing was proven about the suite either way —
// and each time a retry minutes later passed.
//
// ── WHY THIS RUNS AGAINST A SCRATCH DATABASE ─────────────────────────────
//
// The obvious test is to hold a session open on `zebra_template` and watch the
// clone fail. That test would be running inside a suite whose own setup clones
// that template, so it would either break its own run or be quietly prevented
// from doing so — and either way it would not be measuring what it claimed.
//
// So it builds its own database, does the identical thing to it, and cleans up.
// The subject is `terminateSessionsOn`, which takes the database by name for
// exactly this reason.
//
// ── AND IT IS IN THE `node` PROJECT, DELIBERATELY ────────────────────────
//
// The integration project runs against per-worker clones and its globalSetup is
// the very code under test. This needs the admin connection and nothing else.
// ---------------------------------------------------------------------------

const adminUrl = process.env.DIRECT_DATABASE_URL
const nonce = Math.random().toString(36).slice(2, 8)
const SCRATCH = `zebra_clonetest_${nonce}`
const COPY = `zebra_clonecopy_${nonce}`
const LOCKED = `zebra_locked_${nonce}`
const LOCKED_COPY = `zebra_lockedcopy_${nonce}`

const admin = adminUrl ? new Pool({ connectionString: adminUrl, max: 4 }) : null

/** A session held open on the scratch database, as a stranger's would be. */
let squatter: Pool | null = null

afterAll(async () => {
  if (squatter) await squatter.end().catch(() => undefined)
  if (admin) {
    await admin
      .query(`drop database if exists "${COPY}" with (force)`)
      .catch(() => undefined)
    await admin
      .query(`drop database if exists "${SCRATCH}" with (force)`)
      .catch(() => undefined)
    for (const database of [LOCKED_COPY, LOCKED]) {
      // UNLOCKED BEFORE DROPPING. `DROP DATABASE ... WITH (FORCE)` works on a
      // locked one, but leaving the unlock out would mean a failed drop
      // stranded a database nobody could open to find out why.
      await setConnectable(admin, database, true).catch(() => undefined)
      await admin
        .query(`drop database if exists "${database}" with (force)`)
        .catch(() => undefined)
    }
    await admin.end()
  }
})

describe.skipIf(!adminUrl)('clearing a template before cloning it', () => {
  it('refuses to clone while a session is open, then clones once cleared', async () => {
    if (!admin) return

    await admin.query(`drop database if exists "${SCRATCH}" with (force)`)
    await admin.query(`create database "${SCRATCH}"`)

    // A STRANGER'S SESSION, and stamped so as not to look like ours. This is
    // the case the old code waited for rather than terminated — the wait that
    // cost three deploys.
    squatter = new Pool({
      connectionString: withApplicationName(
        withDatabase(adminUrl!, SCRATCH),
        'somebody-elses-run',
      ),
      max: 1,
    })
    await squatter.query('select 1')

    // ── the failure, watched ───────────────────────────────────────────
    let refused: { code?: string } | null = null
    try {
      await admin.query(`create database "${COPY}" template "${SCRATCH}"`)
    } catch (error) {
      refused = error as { code?: string }
    }
    expect(refused, 'a clone with a session open must refuse').not.toBeNull()
    expect(refused?.code).toBe('55006')

    // ── and the fix ────────────────────────────────────────────────────
    const cleared = await terminateSessionsOn(admin, SCRATCH)
    expect(cleared.length).toBeGreaterThan(0)
    // IT SAYS WHOSE IT WAS. That line is the whole of the trade this makes:
    // a session nobody can prove is ours now gets killed, and the record of
    // whose it was is in the output of the run that killed it.
    expect(cleared.map(describeSession).join(' ')).toContain(
      'somebody-elses-run',
    )

    // ── AND THE FOREIGN SESSION IS ACTUALLY GONE ───────────────────────
    //
    // ASSERTED HERE RATHER THAN INFERRED FROM THE CLONE SUCCEEDING, because
    // the clone succeeds either way given long enough: the retry loop below
    // runs about thirty seconds, and an idle pooled socket closes by itself
    // inside that. That is precisely why the real flake "passed on a retry
    // minutes later" — and a test that only watched the end result would call
    // a sweep that spares foreign sessions a pass. Watched failing by
    // narrowing the terminate to our own application_name.
    const still = (await admin.query(
      `select application_name from pg_stat_activity
        where datname = $1 and pid <> pg_backend_pid()`,
      [SCRATCH],
    )) as { rows: { application_name: string }[] }
    expect(
      still.rows.map((row) => row.application_name),
      'the stranger session must be gone, not merely reported',
    ).not.toContain('somebody-elses-run')

    // Termination is asynchronous — the backend is asked to go away, and
    // `pg_stat_activity` stops listing it slightly before the database stops
    // counting it. The same bounded retry the real copy uses.
    let created = false
    for (let attempt = 0; attempt < 12 && !created; attempt++) {
      try {
        await admin.query(`create database "${COPY}" template "${SCRATCH}"`)
        created = true
      } catch (error) {
        if ((error as { code?: string }).code !== '55006') throw error
        await terminateSessionsOn(admin, SCRATCH)
        await new Promise((resolve) => setTimeout(resolve, 400 * (attempt + 1)))
      }
    }
    expect(created, 'the clone must succeed once the session is cleared').toBe(
      true,
    )
  }, 300_000)

  // ── SHUTTING THE DOOR, WHICH IS THE ACTUAL FIX ────────────────────────
  //
  // Terminating sessions cannot win a race against something that RECONNECTS,
  // and what was reconnecting is a managed background worker — `TimescaleDB
  // Background Worker Scheduler`, caught on `zebra_template` itself by the
  // probe that settled this on 2026-09-13. That is why every sweep reported
  // nothing to sweep and the clone still failed.
  //
  // `allow_connections = false` removes the race rather than trying to win it:
  // it is what Postgres does to `template0`, and `CREATE DATABASE ... TEMPLATE`
  // works from a database nobody may connect to.
  it('copies from a locked database, and nothing can attach to it', async () => {
    if (!admin) return
    await admin.query(`create database "${LOCKED}"`)
    await setConnectable(admin, LOCKED, false)

    // NOBODY MAY CONNECT — asserted by trying, not by reading the catalogue.
    // `datallowconn` being false is what the ALTER wrote; being REFUSED is
    // what the test is about.
    const knocker = new Pool({
      connectionString: withDatabase(adminUrl as string, LOCKED),
      max: 1,
    })
    let refused = false
    try {
      await knocker.query('select 1')
    } catch {
      refused = true
    } finally {
      await knocker.end().catch(() => undefined)
    }
    expect(refused, 'a locked database must refuse a connection').toBe(true)

    // AND IT IS STILL A TEMPLATE. The whole point: the copy does not need the
    // door open, so shutting it costs nothing and removes the 55006 entirely.
    await admin.query(`create database "${LOCKED_COPY}" template "${LOCKED}"`)
    const copied = await admin.query(
      'select 1 from pg_database where datname = $1',
      [LOCKED_COPY],
    )
    expect(copied.rowCount, 'the copy must exist').toBe(1)

    // THE COPY IS CONNECTABLE. `allow_connections` is copied from the template
    // by CREATE DATABASE, so a worker database inheriting `false` would be a
    // suite that cannot open any of its own clones — the one way this fix
    // could quietly break everything.
    const worker = new Pool({
      connectionString: withDatabase(adminUrl as string, LOCKED_COPY),
      max: 1,
    })
    try {
      const alive = await worker.query('select 1 as ok')
      expect(
        (alive.rows[0] as { ok: number }).ok,
        'a copy of a locked template must itself be connectable',
      ).toBe(1)
    } finally {
      await worker.end().catch(() => undefined)
    }
  }, 300_000)

  it('reports nothing when there is nothing to clear', async () => {
    if (!admin) return
    // Not an empty formality: a sweep that always claimed to have killed
    // something would make the "NOT ours" warning meaningless noise.
    const empty = await terminateSessionsOn(admin, `zebra_absent_${nonce}`)
    expect(empty).toEqual([])
  }, 120_000)
})
