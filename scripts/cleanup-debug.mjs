import { neonConfig, Pool } from '@neondatabase/serverless'

// Removes rows left behind by ad-hoc debugging against the dev database —
// the loads booked under a `Debug <TAG>` broker while chasing the dispatch
// board's silent 500. Verification scripts clean up after themselves; the
// things you type at 2am do not.

neonConfig.webSocketConstructor ??= WebSocket
neonConfig.poolQueryViaFetch = false
const pool = new Pool({ connectionString: process.env.DIRECT_DATABASE_URL })

const { rows } = await pool.query(
  `select id, "loadNumber" from "Load"
    where "customerId" in (select id from "Customer" where name like 'Debug DBG%')`,
)
for (const load of rows) {
  for (const table of [
    'LoadStatusEvent',
    'LoadAssignment',
    'LoadStop',
    'Communication',
    'Document',
  ]) {
    await pool.query(`delete from "${table}" where "loadId" = $1`, [load.id])
  }
  await pool.query('delete from "AuditLog" where "entityId" = $1', [load.id])
  await pool.query('delete from "Load" where id = $1', [load.id])
}
await pool.query(`delete from "Customer" where name like 'Debug DBG%'`)
await pool.query(
  `delete from "AssetAssignment" where "truckId" in (select id from "Truck" where "unitNumber" like 'DBG%')`,
)
await pool.query(`delete from "Truck" where "unitNumber" like 'DBG%'`)

// Saved views left by repeated `verify-views` runs. One stays — it is a real
// row saved through the real interface and it is what the Loads screenshot
// shows — but a column of near-identical chips is test residue, not evidence.
const prefs = await pool.query(
  `select id, value from "UserPreference" where key = 'view.loads'`,
)
for (const row of prefs.rows) {
  const kept = row.value.filter((view) => !/^Booked VW/.test(view.name))
  const dropped = row.value.filter((view) => /^Booked VW/.test(view.name))
  if (dropped.length <= 1) continue
  await pool.query('update "UserPreference" set value = $1 where id = $2', [
    JSON.stringify([...kept, dropped[dropped.length - 1]]),
    row.id,
  ])
  console.log(`trimmed ${dropped.length - 1} duplicate saved view(s)`)
}

console.log(
  `removed ${rows.length} debug load(s); loads remaining: ${
    (await pool.query('select count(*)::int n from "Load"')).rows[0].n
  }`,
)
await pool.end()
