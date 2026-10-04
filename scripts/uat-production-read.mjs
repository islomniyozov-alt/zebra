// ---------------------------------------------------------------------------
// WHAT PRODUCTION ACTUALLY HOLDS, for the Tier 0 and Tier 1 boxes of
// UAT-CHECKLIST.md that are facts about rows rather than things a person sees.
//
//   node -r dotenv/config scripts/uat-production-read.mjs --target=production
//   node -r dotenv/config scripts/uat-production-read.mjs --target=dev
//
// ── IT REFUSES TO GUESS THE TARGET ────────────────────────────────────────
//
// Same reason `verify-secrets.mjs` does: the whole value of a production reading
// is that it came from production, and a default would be a reading whose source
// is an assumption. `--target=dev` exists so the SQL can be PROVEN before
// somebody runs this against the database that matters — which is how it was
// checked, because this machine's session was not permitted to read production.
//
// ── READ ONLY, AS A MECHANISM AND NOT A PROMISE ───────────────────────────
//
// Everything runs inside `BEGIN TRANSACTION READ ONLY`, so a statement that
// tried to write would be refused by Postgres rather than caught by review. The
// credential here is the branch OWNER — the only production string on this
// machine — which also means RLS does not apply to it: that is why this script
// exists in one file that can be read in one sitting, and why it prints
// aggregates and role assignments rather than freight.
//
// It names nobody's password and prints no email in full.
// ---------------------------------------------------------------------------

import { neonConfig, Pool } from '@neondatabase/serverless'

neonConfig.webSocketConstructor ??= WebSocket
neonConfig.poolQueryViaFetch = false

const target = process.argv
  .slice(2)
  .find((argument) => argument.startsWith('--target='))
  ?.slice('--target='.length)

if (target !== 'production' && target !== 'dev') {
  console.error('Pass --target=production or --target=dev. Nothing read.')
  process.exit(2)
}

const variable =
  target === 'production' ? 'PROD_DIRECT_DATABASE_URL' : 'DIRECT_DATABASE_URL'
const url = process.env[variable]
if (!url) {
  console.error(`MISSING: ${variable}. Nothing read.`)
  process.exit(2)
}
// SAY WHICH DATABASE, because the whole value of a production reading is that it
// came from production — and `.env` is full of dev.
console.log(`reading ${new URL(url).hostname}\n`)

/** `name <local@domain>` with the local part masked. */
const mask = (email) => {
  const [local, domain] = String(email).split('@')
  return `${local.slice(0, 2)}***@${domain ?? '?'}`
}

const pool = new Pool({ connectionString: url, max: 1 })

try {
  await pool.query('BEGIN TRANSACTION READ ONLY')

  const { rows: users } = await pool.query(`
    select u.name, u.email, u."isActive", u."lastLoginAt", u."createdAt",
           coalesce(string_agg(distinct m.role::text, ','), '(no membership)') as roles
      from "User" u
      left join "Membership" m on m."userId" = u.id
     group by u.id, u.name, u.email, u."isActive", u."lastLoginAt", u."createdAt"
     order by u."createdAt"
  `)

  console.log(
    `── EVERY ACCOUNT ON ${target.toUpperCase()} ──────────────────────────`,
  )
  for (const row of users) {
    console.log(
      [
        row.isActive ? 'ACTIVE  ' : 'INACTIVE',
        row.roles.padEnd(12),
        row.name.padEnd(24),
        mask(row.email).padEnd(24),
        `created ${row.createdAt.toISOString().slice(0, 10)}`,
        row.lastLoginAt
          ? `last signed in ${row.lastLoginAt.toISOString().slice(0, 16)}Z`
          : 'NEVER SIGNED IN',
      ].join('  '),
    )
  }

  // THE THREE TIER 0 QUESTIONS, ASKED OF THE ROWS RATHER THAN OF THE LIST ABOVE.
  const typo = users.filter((row) =>
    /disptach/i.test(`${row.name} ${row.email}`),
  )
  const dispatchers = users.filter((row) => row.roles.includes('DISPATCHER'))
  const admins = users.filter((row) => row.roles.includes('ADMIN'))

  console.log('\n── TIER 0 ──────────────────────────────────────────────────')
  console.log(
    `the "Disptach" typo account: ${
      typo.length === 0
        ? 'NOT PRESENT (never created, or renamed)'
        : typo
            .map(
              (row) =>
                `${row.name} — ${row.isActive ? 'STILL ACTIVE' : 'deactivated'}`,
            )
            .join('; ')
    }`,
  )
  console.log(
    `dispatcher accounts: ${
      dispatchers.length === 0
        ? 'NONE'
        : dispatchers
            .map(
              (row) =>
                `${row.name} (${row.isActive ? 'active' : 'inactive'}, ${row.lastLoginAt ? 'has signed in' : 'NEVER SIGNED IN'})`,
            )
            .join('; ')
    }`,
  )
  console.log(
    `ADMIN accounts (the Live Check account would be one): ${
      admins.length === 0 ? 'NONE' : admins.map((row) => row.name).join('; ')
    }`,
  )

  // ── TIER 1, THE TRAIL ───────────────────────────────────────────────────
  const { rows: trail } = await pool.query(`
    select a.action::text as action, a."entityType", a."createdAt", u.name as actor
      from "AuditLog" a
      left join "User" u on u.id = a."userId"
     where a."entityType" in ('User', 'Membership')
     order by a."createdAt" desc
     limit 20
  `)
  console.log('\n── TIER 1, THE TRAIL: every User/Membership audit row ───────')
  if (trail.length === 0) {
    console.log('NONE. The Users screen activity left no audit rows.')
  } else {
    for (const row of trail) {
      console.log(
        `${row.createdAt.toISOString().slice(0, 16)}Z  ${row.action.padEnd(8)} ${row.entityType.padEnd(10)} by ${row.actor ?? '(no user)'}`,
      )
    }
  }

  const { rows: byDay } = await pool.query(`
    select date_trunc('day', "createdAt")::date::text as day,
           count(*)::int as rows
      from "AuditLog"
     group by 1 order by 1 desc limit 7
  `)
  console.log('\naudit rows per day, last seven days with activity:')
  for (const row of byDay) console.log(`  ${row.day}  ${row.rows}`)

  // ── TIER 3: HAS REAL FREIGHT HAPPENED, AND IS PRODUCTION CLEAN ──────────
  const { rows: counts } = await pool.query(`
    select
      (select count(*)::int from "Company")   as companies,
      (select count(*)::int from "Load")      as loads,
      (select count(*)::int from "Truck")     as trucks,
      (select count(*)::int from "Driver")    as drivers,
      -- Customer, not Broker (no backticks in here: one closes the template).
      -- The screens say broker and the schema says customer; this script asked
      -- for the word on the screen, Postgres said no, and that is the argument
      -- for having run it against dev first.
      (select count(*)::int from "Customer")  as brokers,
      (select count(*)::int from "Document")  as documents,
      (select count(*)::int from "Invoice")   as invoices,
      (select count(*)::int from "Settlement") as settlements,
      (select count(*)::int from "Session" where "expiresAt" > now()) as live_sessions
  `)
  console.log(
    `\n── WHAT IS IN ${target.toUpperCase()} (Tier 3 reads this) ──────────────`,
  )
  for (const [key, value] of Object.entries(counts[0])) {
    console.log(`  ${key.padEnd(14)} ${value}`)
  }
} finally {
  // COMMIT A READ-ONLY TRANSACTION, which is the same as rolling it back and
  // says so without pretending anything was undone.
  await pool.query('COMMIT').catch(() => {})
  await pool.end()
}
