import { neonConfig, Pool } from '@neondatabase/serverless'

// ---------------------------------------------------------------------------
// FIND — AND ONLY THEN REMOVE — INTEGRATION FIXTURE ROWS FROM A DATABASE.
//
// Written for one incident: `deploy:prod` was run in a terminal whose
// `DIRECT_DATABASE_URL` pointed at production, so the deploy gate's
// integration suite created its fixtures THERE. The gate refused and nothing
// shipped, but rows may have been left behind.
//
// READ-ONLY UNLESS TOLD OTHERWISE. It prints what it found, by name, and exits.
// `--delete` is a second, separate decision and needs `--yes` beside it.
//
// IT TARGETS WHATEVER `DIRECT_DATABASE_URL` NAMES and prints that host first,
// because the whole incident was somebody not knowing which database their
// terminal was pointing at. Read the host line before you read anything else.
//
//   node -r dotenv/config scripts/sweep-test-rows.mjs                 # look
//   node -r dotenv/config scripts/sweep-test-rows.mjs --delete --yes  # act
// ---------------------------------------------------------------------------

const DELETE = process.argv.includes('--delete')
const CONFIRMED = process.argv.includes('--yes')

const url = process.env.DIRECT_DATABASE_URL
if (!url) {
  console.error('DIRECT_DATABASE_URL is not set. Nothing to sweep.')
  process.exit(1)
}

console.log(`Target: ${new URL(url).hostname}`)
console.log(
  `Branch label (NEON_BRANCH): ${process.env.NEON_BRANCH ?? '(unset)'}`,
)
console.log(DELETE ? 'Mode:   DELETE\n' : 'Mode:   read-only\n')

if (DELETE && !CONFIRMED) {
  console.error('--delete needs --yes beside it. Nothing was changed.')
  process.exit(1)
}

neonConfig.webSocketConstructor ??= WebSocket
neonConfig.poolQueryViaFetch = false
const pool = new Pool({ connectionString: url })

// THE SIGNATURE, and why each half is safe to match on.
//
// `.test` is reserved by RFC 6761 and can never resolve, so no real person's
// address ends in `@example.test` — that half is exact rather than heuristic.
//
// The slug prefixes are every organization the integration suites create,
// harvested from `tests/integration/*.ts`. Each is followed by a nonce, so the
// pattern is anchored at the start AND requires the separator: `loads-` will
// not match a real tenant called `loads`.
const SLUG_PREFIXES = [
  'audit-',
  'audit-other-',
  'auth-',
  'claims-',
  'co-',
  'compliance-',
  'correction-',
  'counters-a-',
  'counters-b-',
  'dashboard-',
  'docs-',
  'extraction-',
  'facility-',
  'facility-other-',
  'factoring-',
  'fleet-',
  'inspections-',
  'invoices-',
  'iso-',
  'loads-',
  'maintenance-',
  'outsider-',
  'payments-',
  'relay-',
  'reset-',
  'settings-',
  'settlements-',
  'warnings-',
  'warnings-other-',
]

const like = SLUG_PREFIXES.map((_, index) => `slug LIKE $${index + 1}`).join(
  ' OR ',
)
const params = SLUG_PREFIXES.map((prefix) => `${prefix}%`)

const organizations = (
  await pool.query(
    `select id, name, slug, "createdAt" from "Organization"
      where ${like} order by "createdAt"`,
    params,
  )
).rows

const users = (
  await pool.query(
    `select id, email, name, "createdAt" from "User"
      where email like '%@example.test' order by "createdAt"`,
  )
).rows

// Reset tokens hang off users and are the one artefact with a security smell:
// a live token for a test account is still a live token.
const tokens = (
  await pool.query(
    `select t.id, t."userId", u.email, t."expiresAt", t."usedAt"
       from "PasswordResetToken" t
       join "User" u on u.id = t."userId"
      where u.email like '%@example.test'
      order by t."expiresAt"`,
  )
).rows

const attempts = (
  await pool.query(
    `select count(*)::int as n from "LoginAttempt"
      where email like '%@example.test'`,
  )
).rows[0].n

// My own fixture from the inbound-email work uses reserved domains too.
const inbound = (
  await pool.query(
    `select id, "fromAddress", "toAddress", subject from "InboundEmail"
      where "toAddress" like '%@zebratms.test'
         or "fromAddress" like '%@amazon.test'
      order by "receivedAt"`,
  )
).rows

// --- report, by name --------------------------------------------------------

const section = (title, rows, line) => {
  console.log(`${title}: ${rows.length}`)
  for (const row of rows) console.log(`   ${line(row)}`)
  if (rows.length) console.log('')
}

section(
  'Organizations with a fixture slug',
  organizations,
  (o) =>
    `${o.slug.padEnd(28)} "${o.name}"  ${o.createdAt.toISOString()}  ${o.id}`,
)
section(
  'Users at @example.test',
  users,
  (u) =>
    `${u.email.padEnd(38)} "${u.name ?? ''}"  ${u.createdAt.toISOString()}`,
)
section(
  'Password reset tokens for those users',
  tokens,
  (t) =>
    `${t.email.padEnd(38)} expires ${t.expiresAt.toISOString()}  ${
      t.usedAt ? 'used' : 'UNUSED'
    }`,
)
section(
  'Inbound emails from reserved test domains',
  inbound,
  (e) =>
    `${e.toAddress.padEnd(30)} from ${e.fromAddress}  "${e.subject ?? ''}"`,
)
console.log(`Login attempts at @example.test: ${attempts}`)

const total =
  organizations.length +
  users.length +
  tokens.length +
  inbound.length +
  attempts

console.log(`\nTotal fixture artefacts: ${total}`)

if (total === 0) {
  console.log('Nothing to clean up on this database.')
  await pool.end()
  process.exit(0)
}

if (!DELETE) {
  console.log('\nRead-only. Re-run with --delete --yes to remove them.')
  await pool.end()
  process.exit(0)
}

// --- remove -----------------------------------------------------------------
//
// ORGANIZATIONS FIRST AND BY ID. Every tenant table cascades from
// `Organization`, so deleting one takes its companies, loads and documents
// with it — which is right here and is exactly why this script does not
// delete anything the signature did not name.
let removed = 0
for (const organization of organizations) {
  await pool.query('delete from "Organization" where id = $1', [
    organization.id,
  ])
  console.log(`deleted org  ${organization.slug}  "${organization.name}"`)
  removed++
}

// Users are NOT cascaded by Organization — a membership is, the person is not.
for (const user of users) {
  await pool.query('delete from "PasswordResetToken" where "userId" = $1', [
    user.id,
  ])
  await pool.query('delete from "Session" where "userId" = $1', [user.id])
  await pool.query('delete from "User" where id = $1', [user.id])
  console.log(`deleted user ${user.email}`)
  removed++
}

const attemptsGone = await pool.query(
  `delete from "LoginAttempt" where email like '%@example.test'`,
)
const inboundGone = await pool.query(
  `delete from "InboundEmail"
    where "toAddress" like '%@zebratms.test'
       or "fromAddress" like '%@amazon.test'`,
)

console.log(
  `\nRemoved ${removed} named rows, ${attemptsGone.rowCount} login attempts, ` +
    `${inboundGone.rowCount} inbound emails.`,
)

await pool.end()
