// ---------------------------------------------------------------------------
// DRIVERS WHO LOOK LIKE THE SAME PERSON TWICE, WITHIN ONE AUTHORITY.
//
//   node -r dotenv/config scripts/duplicate-drivers.mjs --target=production
//   node -r dotenv/config scripts/duplicate-drivers.mjs --target=dev
//
// A PREVIEW. It reads, prints, and stops — the merge is a decision about two
// people's pay history and belongs to the owner, not to a script. Everything
// below runs inside `BEGIN TRANSACTION READ ONLY`, so a statement that tried to
// write anything is refused by Postgres rather than caught by review.
//
// ── WHY TWO SIGNALS AND NOT A NAME MATCH ─────────────────────────────────
//
// Names are the worst key available here: the Datatruck export carries initials,
// nicknames, two spellings of the same surname, and in one case a middle name in
// the first-name column. A name match would group strangers and miss twins.
//
// A PHONE NUMBER IS THE PERSON and a truck is what they sit in, so:
//
//   * the same phone, folded to its digits, under one authority;
//   * the same `assignedTruckId` under one authority.
//
// Each is reported separately, because they mean different things: a shared phone
// is almost always one person entered twice, while a shared truck can be a real
// handover that nobody closed — and the second needs a human to tell those apart.
//
// ── IT PRINTS THE MONEY, WHICH IS THE WHOLE POINT ────────────────────────
//
// A merge has a direction, and the only thing that decides it is which row
// carries the statements. So every row reports how many settlements it has, what
// they total, and when the last one was — plus whether the row is already
// retired. A duplicate with no money and no history is the one to retire; two
// rows that BOTH carry money is a different, worse problem, and this says so
// rather than leaving the reader to notice.
//
// ── THE AUTHORITY IS THE BOUNDARY ────────────────────────────────────────
//
// §6.3: two authorities under one carrier group legitimately employ the same
// person, with two driver rows, two pay rules and two statement series. Grouping
// across authorities would propose merging a real pair. So every group is scoped
// to one `companyId`, and the authority's name is printed with it.
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

console.log(`reading ${new URL(url).hostname} (${target}) — PREVIEW ONLY\n`)

const pool = new Pool({ connectionString: url, max: 1 })
const money = (cents) =>
  `$${((cents ?? 0) / 100).toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`
const day = (value) => (value ? value.toISOString().slice(0, 10) : '—')

// ONE SHAPE FOR BOTH SIGNALS. The money, the history and the retirement flag are
// the same questions whichever way two rows got grouped, so the SQL asks them
// once and the grouping key is the only thing that varies.
const DRIVER_FACTS = `
  select d.id,
         d."companyId",
         c.name                                   as authority,
         d."firstName" || ' ' || d."lastName"      as name,
         d.phone,
         d."assignedTruckId",
         d.status::text                            as status,
         d."deletedAt",
         d."createdAt",
         t."unitNumber"                            as truck,
         coalesce(s.statements, 0)                 as statements,
         coalesce(s.net, 0)                        as net,
         coalesce(s.gross, 0)                      as gross,
         s.last_period
    from "Driver" d
    join "Company" c on c.id = d."companyId"
    left join "Truck" t on t.id = d."assignedTruckId"
    left join (
      select "driverId",
             count(*)::int          as statements,
             sum("netCents")::bigint   as net,
             sum("grossCents")::bigint as gross,
             max("periodStart")     as last_period
        from "Settlement"
       group by "driverId"
    ) s on s."driverId" = d.id
`

/**
 * Digits only: `(425) 566-0763` and `4255660763` are one person.
 *
 * WRITTEN AGAINST THE `facts` ALIAS, like the truck key, so the expression that
 * GROUPS and the expression that FILTERS are the same string in the same scope.
 * The first draft wrote it against `"Driver"` and rewrote the alias with a
 * `String.replace` on the way into the filter — two spellings of one rule, which
 * is the shape of a bug that groups the right rows and filters the wrong ones.
 */
const PHONE_KEY = `regexp_replace(coalesce(f.phone, ''), '[^0-9]', '', 'g')`
const TRUCK_KEY = `f."assignedTruckId"`

const groups = async (label, keyExpression, having) => {
  const { rows } = await pool.query(`
    with facts as (${DRIVER_FACTS}),
    keyed as (
      select f.*, ${keyExpression} as key
        from facts f
       where ${having}
    ),
    dupes as (
      select "companyId", key
        from keyed
       group by 1, 2
      having count(*) > 1
    )
    select k.* from keyed k
      join dupes on dupes."companyId" = k."companyId" and dupes.key = k.key
     order by k.authority, k.key, k."createdAt"
  `)

  console.log(`── ${label} ──────────────────────────────────────────`)
  if (rows.length === 0) {
    console.log('  none\n')
    return 0
  }

  let lastKey = null
  let groupCount = 0
  let bothCarryMoney = 0
  const byGroup = new Map()
  for (const row of rows) {
    const id = `${row.companyId}|${row.key}`
    byGroup.set(id, [...(byGroup.get(id) ?? []), row])
  }

  for (const [id, members] of byGroup) {
    groupCount += 1
    const paid = members.filter((m) => Number(m.statements) > 0)
    if (paid.length > 1) bothCarryMoney += 1
    if (id !== lastKey) {
      console.log(
        `\n  ${members[0].authority} — ${label.toLowerCase()} ${members[0].key}` +
          (paid.length > 1 ? '   ** BOTH ROWS CARRY STATEMENTS **' : ''),
      )
      lastKey = id
    }
    for (const m of members) {
      console.log(
        `    ${m.id.slice(0, 10)}  ${String(m.name).padEnd(26)} ` +
          `${String(m.truck ?? '—').padEnd(8)} ${m.status.padEnd(14)} ` +
          `${m.deletedAt ? 'RETIRED ' : 'active  '} ` +
          `${String(m.statements).padStart(3)} stmt  net ${money(Number(m.net)).padStart(12)}  ` +
          `gross ${money(Number(m.gross)).padStart(12)}  last ${day(m.last_period)}  ` +
          `added ${day(m.createdAt)}`,
      )
    }
  }
  console.log(
    `\n  ${groupCount} group(s), ${bothCarryMoney} where more than one row carries statements\n`,
  )
  return groupCount
}

try {
  await pool.query('BEGIN TRANSACTION READ ONLY')

  // A BLANK PHONE IS NOT A SHARED PHONE. Without this clause every driver with
  // no number on file joins one enormous group, which is the most confident
  // possible wrong answer.
  const byPhone = await groups('SAME PHONE', PHONE_KEY, `${PHONE_KEY} <> ''`)
  const byTruck = await groups(
    'SAME TRUCK',
    TRUCK_KEY,
    `${TRUCK_KEY} is not null`,
  )

  console.log('='.repeat(70))
  console.log(
    `PREVIEW ONLY — nothing was changed. ${byPhone} phone group(s), ${byTruck} truck group(s).`,
  )
  console.log(
    "A merge is the owner's decision: keep the row with the statements, retire the other",
  )
  console.log(
    'from Fleet -> Drivers, and move any pay rule by hand. Two rows both carrying',
  )
  console.log(
    'statements is not a merge — it is a question for the accountant.',
  )
  console.log('='.repeat(70))
} finally {
  // Committing a read-only transaction is the same as rolling it back, and says
  // so without pretending anything was undone.
  await pool.query('COMMIT').catch(() => {})
  await pool.end()
}
