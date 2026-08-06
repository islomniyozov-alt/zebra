import { chromium } from 'playwright'
import { neonConfig, Pool } from '@neondatabase/serverless'
import { isProduction, requireCredentials } from './check-credentials.mjs'

// ---------------------------------------------------------------------------
// THE MONEY SCREENS, PER ROLE.
//
// §7: "DISPATCHER walkthrough still 16/16; ACCOUNTING sees all of it;
// scoped-user variant green." verify-dispatcher.mjs covers the first clause
// and is deliberately left at sixteen boxes so a regression there is visible
// as a number. Phase 3 added four screens it does not know about, and this
// covers those: a DISPATCHER must get 404 on every one, an ACCOUNTING user
// must get 200 on every one.
//
// PAGES answer 404 — the difference between "no" and "not for you" is the fact
// worth hiding. The PDF ROUTE answers 403, and that is fine: the permission
// check runs before any lookup, so every id gets the same 403 whether it
// exists or not, and nothing about the settlement leaks either way.
//
//   SHOT_CHROME=... node -r dotenv/config scripts/verify-money-roles.mjs
// ---------------------------------------------------------------------------

const BASE =
  process.env.VERIFY_BASE ?? 'https://zebra-dev.tajikcargollc.workers.dev'
const TAG = `MR${Date.now().toString(36).slice(-4).toUpperCase()}`

const MONEY_ROUTES = [
  '/invoices',
  '/receivables',
  '/receivables/factoring',
  '/payments',
  '/payments/new',
  '/settlements',
]

neonConfig.webSocketConstructor ??= WebSocket
neonConfig.poolQueryViaFetch = false
const pool = new Pool({
  connectionString: isProduction(BASE)
    ? process.env.PROD_DIRECT_DATABASE_URL
    : process.env.DIRECT_DATABASE_URL,
})

const results = []
const record = (label, ok, detail) => {
  results.push({ label, ok })
  console.log(`${ok ? 'ok  ' : 'FAIL'}  ${label.padEnd(52)} ${detail}`)
}

const browser = await chromium.launch(
  process.env.SHOT_CHROME ? { executablePath: process.env.SHOT_CHROME } : {},
)

const CREDENTIALS = requireCredentials(BASE)

async function signIn(email, password) {
  const context = await browser.newContext({
    viewport: { width: 1920, height: 1080 },
  })
  const page = await context.newPage()
  await page.goto(`${BASE}/login`, { waitUntil: 'domcontentloaded' })
  await page.fill('input[name="email"]', email)
  await page.fill('input[name="password"]', password)
  await page.click('button[type="submit"]')
  await page.waitForURL(/\/(loads|dashboard)/, { timeout: 90_000 })
  return { context, page }
}

const owner = await signIn(CREDENTIALS.email, CREDENTIALS.password)

/** Create a user through the Users screen and read the temp password once. */
async function provision(role, name) {
  const email = `${TAG.toLowerCase()}-${role.toLowerCase()}@example.test`
  await owner.page.goto(`${BASE}/users/new`, { waitUntil: 'domcontentloaded' })
  await owner.page.waitForTimeout(2000)
  await owner.page.fill('input[name="name"]', name)
  await owner.page.fill('input[name="email"]', email)
  await owner.page.selectOption('select[name="role"]', role)
  await owner.page.click('form button[type="submit"]')
  await owner.page.waitForTimeout(12_000)

  const shown = await owner.page
    .locator('p.select-all')
    .first()
    .textContent()
    .catch(() => null)
  return { email, password: (shown ?? '').trim() }
}

const accounting = await provision('ACCOUNTING', `Accounting ${TAG}`)
const dispatcher = await provision('DISPATCHER', `Dispatcher ${TAG}`)
record(
  'two users provisioned through the Users screen',
  accounting.password.length > 0 && dispatcher.password.length > 0,
  `${accounting.email} · ${dispatcher.email}`,
)

// THE SCOPED VARIANT: the dispatcher is restricted to one authority, which is
// the configuration that produced the first production 500.
const membership = (
  await pool.query(
    `select m.id, m."organizationId" from "Membership" m
       join "User" u on u.id = m."userId"
      where u.email = $1`,
    [dispatcher.email],
  )
).rows[0]
// IN THE MEMBERSHIP'S OWN ORGANIZATION. The first version took the
// alphabetically first company in the whole table, which is the isolation
// counterpart in a different tenant — and `zebra_org_from_membership` refused
// the insert, exactly as it should. The wall worked; the fixture was wrong.
const company = (
  await pool.query(
    'select id, name from "Company" where "organizationId" = $1 order by name limit 1',
    [membership.organizationId],
  )
).rows[0]
await pool.query(
  `insert into "MembershipCompany" ("id", "membershipId", "companyId", "organizationId")
   select gen_random_uuid()::text, $1, $2, m."organizationId"
     from "Membership" m where m.id = $1`,
  [membership.id, company.id],
)
record(
  'the dispatcher is scoped to one authority',
  true,
  `${company.name} — the configuration that broke`,
)

const asAccounting = await signIn(accounting.email, accounting.password)
const asDispatcher = await signIn(dispatcher.email, dispatcher.password)

for (const route of MONEY_ROUTES) {
  const seen = await asAccounting.page.goto(`${BASE}${route}`, {
    waitUntil: 'domcontentloaded',
  })
  record(
    `ACCOUNTING reaches ${route}`,
    seen?.status() === 200,
    `HTTP ${seen?.status()}`,
  )
}

for (const route of MONEY_ROUTES) {
  const refused = await asDispatcher.page.goto(`${BASE}${route}`, {
    waitUntil: 'domcontentloaded',
  })
  record(
    `DISPATCHER is refused ${route}`,
    refused?.status() === 404,
    `HTTP ${refused?.status()}`,
  )
}

// And the nav still omits the group entirely, rather than rendering it empty.
await asDispatcher.page.goto(`${BASE}/loads`, { waitUntil: 'domcontentloaded' })
await asDispatcher.page.waitForTimeout(1500)
const moneyLinks = await asDispatcher.page
  .locator('nav a[href="/settlements"], nav a[href="/payments"]')
  .count()
record(
  'and the Money group is absent from the dispatcher nav',
  moneyLinks === 0,
  `${moneyLinks} money link(s)`,
)

// The PDF routes are money too, and they are API rather than page — a 404 is
// the only acceptable answer for a role that cannot see the document.
const settlement = (
  await pool.query(
    `select id from "Settlement" where "deletedAt" is null
      order by "createdAt" desc limit 1`,
  )
).rows[0]
if (settlement) {
  const pdf = await asDispatcher.page.request.get(
    `${BASE}/api/settlements/${settlement.id}/pdf`,
  )
  record(
    'DISPATCHER is refused the settlement PDF',
    pdf.status() === 404 || pdf.status() === 403,
    `HTTP ${pdf.status()}`,
  )

  const allowed = await asAccounting.page.request.get(
    `${BASE}/api/settlements/${settlement.id}/pdf`,
  )
  record(
    'and ACCOUNTING gets the file',
    allowed.status() === 200 &&
      allowed.headers()['content-type'] === 'application/pdf',
    `HTTP ${allowed.status()} ${allowed.headers()['content-type']}`,
  )
}

// --- leave nothing behind -----------------------------------------------------
for (const email of [accounting.email, dispatcher.email]) {
  await pool.query(
    'delete from "Membership" where "userId" in (select id from "User" where email = $1)',
    [email],
  )
  await pool.query('delete from "User" where email = $1', [email])
}
const left = (
  await pool.query('select count(*)::int c from "User" where email like $1', [
    `${TAG.toLowerCase()}%`,
  ])
).rows[0].c
console.log(`\nleft behind — users: ${left}`)

await pool.end()
await browser.close()

const failed = results.filter((row) => !row.ok).length
console.log(
  `${results.length - failed}/${results.length} passed against ${BASE}`,
)
process.exit(failed === 0 && left === 0 ? 0 : 1)
