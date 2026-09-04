import { neonConfig, Pool } from '@neondatabase/serverless'

// ---------------------------------------------------------------------------
// WHAT THE CONNECTION ACTUALLY DOES, MEASURED.
//
// Three drops in one day — one mid-gate crash, one at setup, one across four
// node-project files — and three explanations available for free: the client,
// Neon, or the link between them. This asks instead.
//
// It exists because two constants in this repository are justified by numbers
// nobody can reproduce: `LOAD_WRITE_TIMEOUT_MS` cites "200ms per round trip
// from a laptop in Tajikistan", and two scripts assert "a branch with a
// connection ceiling" without ever having read one.
//
//   node -r dotenv/config scripts/measure-neon.mjs
//   node -r dotenv/config scripts/measure-neon.mjs --idle 6
//
// DEV ONLY. It opens up to eight connections and runs `SELECT 1` several
// hundred times; that is not a thing to point at production, and it never
// reads the production URL.
// ---------------------------------------------------------------------------

const url = process.env.DIRECT_DATABASE_URL
if (!url) {
  console.error('No DIRECT_DATABASE_URL. Nothing to measure.')
  process.exit(1)
}

neonConfig.webSocketConstructor ??= WebSocket
neonConfig.poolQueryViaFetch = false

const idleArg = process.argv.indexOf('--idle')
const idleMinutes = idleArg === -1 ? 0 : Number(process.argv[idleArg + 1] ?? 6)

const drops = []

const median = (values) => {
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[Math.floor(sorted.length / 2)] ?? 0
}
const percentile = (values, p) => {
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))] ?? 0
}

/** One pool, `count` sequential round trips, every duration kept. */
async function probe(count) {
  const pool = new Pool({ connectionString: url, max: 1 })
  // THE INSTRUMENT MUST OUTLIVE ITS SUBJECT. A dropped socket emits 'error' on
  // the pool; unlistened, that is a process death, and the measurement dies
  // with the thing it was measuring. Recorded as data instead.
  pool.on('error', (error) => drops.push(error?.message || 'socket dropped'))
  const timings = []
  try {
    // Warm the socket first: the FIRST query on a new pool pays the WebSocket
    // handshake and, on a suspended compute, the resume. Counting it as a
    // round trip would inflate every level equally and hide the thing being
    // compared.
    await pool.query('select 1')
    for (let i = 0; i < count; i++) {
      const started = performance.now()
      await pool.query('select 1')
      timings.push(performance.now() - started)
    }
  } finally {
    await pool.end()
  }
  return timings
}

async function main() {
  const facts = new Pool({ connectionString: url, max: 1 })
  facts.on('error', (error) => drops.push(error?.message || 'socket dropped'))
  const handshakeStarted = performance.now()
  const [{ rows: uptime }, { rows: limits }, { rows: activity }] =
    await Promise.all([
      facts.query(
        `select pg_postmaster_start_time() as started,
                extract(epoch from now() - pg_postmaster_start_time())::int as uptime_s,
                now() as at`,
      ),
      facts.query(
        `select name, setting from pg_settings
          where name in ('max_connections','idle_in_transaction_session_timeout')`,
      ),
      facts.query(
        `select count(*)::int as total,
                count(*) filter (where state = 'active')::int as active,
                count(*) filter (where state = 'idle')::int as idle
           from pg_stat_activity where datname = current_database()`,
      ),
    ])
  const handshake = Math.round(performance.now() - handshakeStarted)

  console.log(
    `Measured ${uptime[0].at.toISOString()} against ${new URL(url).host}\n`,
  )

  // 1. IS THE COMPUTE BEING RESTARTED? Neon suspends an idle compute and a
  // resume drops every socket that was open. A postmaster started minutes ago
  // means it suspended and came back; days means it never went away.
  console.log('COMPUTE')
  console.log(`  postmaster started   ${uptime[0].started.toISOString()}`)
  console.log(`  uptime               ${uptime[0].uptime_s}s`)
  console.log(`  first-query cost     ${handshake}ms (handshake + any resume)`)

  console.log('\nLIMITS')
  for (const row of limits)
    console.log(`  ${row.name.padEnd(36)} ${row.setting}`)
  console.log(
    `  in use now                           ${activity[0].total} ` +
      `(${activity[0].active} active, ${activity[0].idle} idle)`,
  )

  await facts.end()

  // 2. ROUND TRIP, AT THE CONCURRENCY THE SUITE ACTUALLY USES.
  console.log('\nROUND TRIP — `select 1`, after warm-up, 20 per connection')
  console.log('  workers   median      p95      max   samples')
  for (const workers of [1, 4, 8]) {
    const runs = await Promise.all(
      Array.from({ length: workers }, () => probe(20)),
    )
    const all = runs.flat()
    console.log(
      `  ${String(workers).padStart(7)}   ` +
        `${median(all).toFixed(0).padStart(6)}ms  ` +
        `${percentile(all, 0.95).toFixed(0).padStart(5)}ms  ` +
        `${Math.max(...all)
          .toFixed(0)
          .padStart(5)}ms  ` +
        `${String(all.length).padStart(7)}`,
    )
  }

  // 3. DOES AN IDLE CONNECTION SURVIVE? The suspend threshold is minutes, so
  // this is opt-in and slow. A socket that dies here is the answer to "do the
  // drops cluster after idle gaps".
  if (idleMinutes > 0) {
    console.log(`\nIDLE — holding one connection for ${idleMinutes} minute(s)`)
    const pool = new Pool({ connectionString: url, max: 1 })
    await pool.query('select 1')
    const before = Date.now()
    await new Promise((resolve) => setTimeout(resolve, idleMinutes * 60_000))
    try {
      const started = performance.now()
      await pool.query('select 1')
      console.log(
        `  survived ${Math.round((Date.now() - before) / 1000)}s idle; ` +
          `next query ${Math.round(performance.now() - started)}ms`,
      )
    } catch (error) {
      console.log(
        `  DROPPED after ${Math.round((Date.now() - before) / 1000)}s idle: ` +
          `${error instanceof Error ? error.message || error.name : String(error)}`,
      )
    } finally {
      await pool.end().catch(() => {})
    }
  }
}

process.on('uncaughtException', (error) => {
  // Same containment as tests/socket-crash-guard.ts, for the same reason: an
  // unlistened 'error' on a Neon client is a process death, and a measurement
  // that dies mid-run reports nothing about the drop it just witnessed.
  // PRINTED, NOT SWALLOWED. An earlier version of this handler recorded and
  // returned, so two runs exited 0 having written nothing at all — the exact
  // shape this script was written to investigate, produced by the script.
  drops.push(`uncaught: ${error?.message || String(error)}`)
  console.error('UNCAUGHT during measurement:', error?.message || error)
  process.exitCode = 1
})

await main()
if (drops.length > 0) {
  console.log(`
DROPS DURING THIS RUN: ${drops.length}`)
  for (const drop of drops.slice(0, 8))
    console.log(`  ${drop || '(no message)'}`)
}
