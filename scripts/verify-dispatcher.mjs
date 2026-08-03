import { chromium } from 'playwright'
import { neonConfig, Pool } from '@neondatabase/serverless'

// ---------------------------------------------------------------------------
// §13.10 — a DISPATCHER session, on the deployed worker.
//
//   * financial fields are ABSENT from the payload, not hidden in CSS;
//   * a route the role does not hold is refused when typed into the URL.
//
// Both halves are paired with the OWNER doing the identical thing and getting
// through (standing rule 11). A 404 for a dispatcher proves nothing on its own
// — a typo in the path produces the same 404, and so does a route that was
// never deployed.
//
// THE USER IS CREATED IN SQL, and that is a deviation from §12 worth naming:
// there is no user-management screen yet, so there is no interface to create
// one through. It is removed at the end, and it carries the same precomputed
// argon2id fixture hash the test suite uses — a credential that is in the
// repository and therefore not a secret.
//
//   SHOT_CHROME=... node -r dotenv/config scripts/verify-dispatcher.mjs
// ---------------------------------------------------------------------------

const BASE =
  process.env.VERIFY_BASE ?? 'https://zebra-dev.tajikcargollc.workers.dev'
const TAG = `DS${Date.now().toString(36).slice(-4).toUpperCase()}`
const EMAIL = `dispatcher-${TAG.toLowerCase()}@example.test`

// tests/fixtures/password.ts — 'fixture-passphrase-not-a-secret'.
const PASSWORD = 'fixture-passphrase-not-a-secret'
const PASSWORD_HASH =
  '$argon2id$v=19$m=19456,t=2,p=1$QWPZfjPNHX7SzkzEhN7lmA$cIktCmqh5BDzNiX/oDLSz2ZjmT/QWflqP2N5X2XR+hg'

neonConfig.webSocketConstructor ??= WebSocket
neonConfig.poolQueryViaFetch = false
const pool = new Pool({ connectionString: process.env.DIRECT_DATABASE_URL })

/**
 * A cuid-SHAPED id.
 *
 * `gen_random_uuid()` looked like the obvious thing and is not: `assertUserId`
 * in src/lib/tenancy.ts requires /^c[a-z0-9]{24}$/, so a UUID user signs in and
 * then dies inside the audit attribution with the login page showing nothing
 * at all. Found with `wrangler tail`, which is where the message was.
 */
const cuid = () => {
  const alphabet = 'abcdefghijklmnopqrstuvwxyz0123456789'
  let id = 'c'
  for (let index = 0; index < 24; index++) {
    id += alphabet[Math.floor(Math.random() * alphabet.length)]
  }
  return id
}

const results = []
const record = (label, ok, detail) => {
  results.push({ label, ok })
  console.log(`${ok ? 'ok  ' : 'FAIL'}  ${label.padEnd(54)} ${detail}`)
}

const organizationId = (
  await pool.query(
    `select m."organizationId" id from "Membership" m
       join "User" u on u.id = m."userId" where u.email = $1 limit 1`,
    [process.env.SEED_OWNER_EMAIL],
  )
).rows[0].id

const companyId = (
  await pool.query(
    'select id from "Company" where "organizationId" = $1 order by name asc limit 1',
    [organizationId],
  )
).rows[0].id

const user = (
  await pool.query(
    `insert into "User" (id, email, name, "passwordHash", "isActive", "updatedAt")
       values ($4, $1, $2, $3, true, now()) returning id`,
    [EMAIL, `Dispatcher ${TAG}`, PASSWORD_HASH, cuid()],
  )
).rows[0]
const membership = (
  await pool.query(
    `insert into "Membership" (id, "userId", "organizationId", role, "updatedAt")
       values ($3, $1, $2, 'DISPATCHER', now()) returning id`,
    [user.id, organizationId, cuid()],
  )
).rows[0]

// SCOPED TO ONE AUTHORITY, and that is the whole point of this line.
//
// Every earlier version of this script made an UNSCOPED dispatcher, whose
// `companyScopes` is empty — the same shape an owner has. So the scope filter
// was never exercised, and seven screens went on spreading a `companyId`
// filter into a query on `Company`, whose column is `id`. Prisma throws at
// runtime; TypeScript cannot see it, because excess properties are not checked
// through a spread into a `where`. It reached production, and a dispatcher
// found it by clicking Add load on his first afternoon.
await pool.query(
  `insert into "MembershipCompany" (id, "membershipId", "companyId", "organizationId")
     values ($1, $2, $3, $4)`,
  [cuid(), membership.id, companyId, organizationId],
)

// A truck with a purchase price and a broker with a credit limit — the two
// fields §16 flag 5 says no permission resource covers, and which are
// therefore omitted from every payload rather than gated.
const truck = (
  await pool.query(
    `insert into "Truck" (id, "organizationId", "companyId", "unitNumber", "purchasePriceCents", "updatedAt")
       values ($4, $1, $2, $3, 18750000, now()) returning id`,
    [organizationId, companyId, `${TAG}-901`, cuid()],
  )
).rows[0]
// A truck with a companyId and no OPEN AssetAssignment is exactly the
// disagreement `findAuthorityDrift` exists to catch, and `npm run check` fails
// on it. An earlier version of this script inserted the truck without one and
// left three of them behind when it crashed — the drift check found all three,
// which is the system working, and is why the period is opened here.
await pool.query(
  `insert into "AssetAssignment" (id, "organizationId", "companyId", "truckId", "effectiveFrom")
     values ($1, $2, $3, $4, now())`,
  [cuid(), organizationId, companyId, truck.id],
)

const broker = (
  await pool.query(
    `insert into "Customer" (id, "organizationId", name, "creditLimitCents", "updatedAt")
       values ($3, $1, $2, 5000000, now()) returning id`,
    [organizationId, `${TAG} Broker`, cuid()],
  )
).rows[0]

const browser = await chromium.launch(
  process.env.SHOT_CHROME ? { executablePath: process.env.SHOT_CHROME } : {},
)

const session = async (email, password) => {
  const context = await browser.newContext({
    viewport: { width: 1920, height: 1080 },
  })
  const page = await context.newPage()
  await page.goto(`${BASE}/login`, { waitUntil: 'domcontentloaded' })
  await page.fill('input[name="email"]', email)
  await page.fill('input[name="password"]', password)
  await page.click('button[type="submit"]')
  await page
    .waitForURL(/\/(loads|dashboard)/, { timeout: 60_000 })
    .catch(async () => {
      const said = await page
        .locator('[role="alert"], p.text-danger')
        .first()
        .textContent()
        .catch(() => null)
      throw new Error(`login as ${email} failed: ${said ?? '(no message)'}`)
    })
  return { context, page }
}

const dispatcher = await session(EMAIL, PASSWORD)
record(
  'the dispatcher can sign in',
  dispatcher.page.url().includes('/loads'),
  dispatcher.page.url().replace(BASE, ''),
)

const scoped = (
  await pool.query(
    `select count(*)::int n from "MembershipCompany" mc
       join "Membership" m on m.id = mc."membershipId" where m."userId" = $1`,
    [user.id],
  )
).rows[0]
record(
  'and is restricted to one authority',
  scoped.n === 1,
  `${scoped.n} company scope — the configuration that broke`,
)

// --- the payload, not the pixels -------------------------------------------
// 187,500.00 is the purchase price. Searching the RESPONSE BODY, not the
// rendered text: a field hidden with CSS is still in the payload and this is
// exactly the difference §7 is about.
const bodyOf = async (page, path) => {
  const response = await page.goto(`${BASE}${path}`, {
    waitUntil: 'domcontentloaded',
  })
  return {
    status: response?.status() ?? 0,
    body: (await response?.text()) ?? '',
  }
}

const trucksPage = await bodyOf(dispatcher.page, '/trucks')
record(
  'the trucks payload carries no purchase price',
  !trucksPage.body.includes('18750000') && !trucksPage.body.includes('187,500'),
  `${trucksPage.body.length} bytes, unit ${trucksPage.body.includes(`${TAG}-901`) ? 'present' : 'MISSING'}`,
)

const brokersPage = await bodyOf(dispatcher.page, '/brokers')
record(
  'the brokers payload carries no credit limit',
  !brokersPage.body.includes('5000000') && !brokersPage.body.includes('50,000'),
  `${brokersPage.body.length} bytes, broker ${brokersPage.body.includes(`${TAG} Broker`) ? 'present' : 'MISSING'}`,
)

// The pair: the same two figures ARE absent for an owner too, because they are
// omitted from the payload rather than gated by role. Stated so that nobody
// reads the two checks above as proof of a permission check that does not
// exist — see §16 flag 5.
const owner = await session(
  process.env.SEED_OWNER_EMAIL,
  process.env.SEED_OWNER_PASSWORD,
)
const ownerTrucks = await bodyOf(owner.page, '/trucks')
record(
  'and they are absent for an OWNER too — omitted, not gated (flag 5)',
  !ownerTrucks.body.includes('18750000'),
  'no permission resource covers fleet money yet',
)

// --- THE SCREENS A DISPATCHER ACTUALLY USES --------------------------------
//
// Every check in this file until now asserted a REFUSAL: the payload without
// the money, the route that 404s. None of them ever opened a screen a
// dispatcher works on all day and looked at the status code.
//
// So Ahmad clicked Add load on his first afternoon and got a server error,
// on a path an owner opens fifty times a day without trouble. A role-specific
// failure needs a role-specific walk, and "it refuses what it should" is only
// half of that.
const DISPATCHER_SCREENS = [
  '/loads',
  '/loads/new',
  '/dispatch',
  '/trucks',
  '/trailers',
  '/drivers',
  '/brokers',
  '/account',
]

for (const path of DISPATCHER_SCREENS) {
  const page = await bodyOf(dispatcher.page, path)
  record(
    `a dispatcher can open ${path}`,
    page.status === 200,
    `HTTP ${page.status}`,
  )
}

// --- a route the role does not hold ----------------------------------------
const dispatcherNew = await bodyOf(dispatcher.page, '/trucks/new')
record(
  'a dispatcher typing /trucks/new is refused',
  dispatcherNew.status === 404,
  `HTTP ${dispatcherNew.status}`,
)

const ownerNew = await bodyOf(owner.page, '/trucks/new')
record(
  'and the SAME url works for an owner (rule 11)',
  ownerNew.status === 200 && ownerNew.body.includes('unitNumber'),
  `HTTP ${ownerNew.status}`,
)

// The navigation does not offer what the role cannot reach, either (§7).
const nav = await dispatcher.page.goto(`${BASE}/loads`, {
  waitUntil: 'domcontentloaded',
})
const navBody = (await nav?.text()) ?? ''
record(
  'the sidebar omits the Money group entirely',
  !navBody.includes('>Settlements<') && !navBody.includes('>Invoices<'),
  'not rendered and not hidden',
)

await browser.close()

// --- cleanup ---------------------------------------------------------------
await pool.query('delete from "Session" where "userId" = $1', [user.id])
await pool.query('delete from "LoginAttempt" where email = $1', [EMAIL])
await pool.query('delete from "AuditLog" where "userId" = $1', [user.id])
await pool.query('delete from "MembershipCompany" where "membershipId" = $1', [
  membership.id,
])
await pool.query('delete from "Membership" where id = $1', [membership.id])
await pool.query('delete from "User" where id = $1', [user.id])
await pool.query('delete from "AssetAssignment" where "truckId" = $1', [
  truck.id,
])
await pool.query('delete from "Truck" where id = $1', [truck.id])
await pool.query('delete from "Customer" where id = $1', [broker.id])

console.log(
  `\nleft behind — users: ${(await pool.query('select count(*)::int n from "User" where email = $1', [EMAIL])).rows[0].n}`,
)
await pool.end()

const failed = results.filter((r) => !r.ok).length
console.log(`${results.length - failed}/${results.length} passed`)
process.exit(failed === 0 ? 0 : 1)
