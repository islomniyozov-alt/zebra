import { chromium } from 'playwright'
import { neonConfig, Pool } from '@neondatabase/serverless'
import { rateConFixture } from './_ratecon-fixture.mjs'

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

// A WORK ORDER WITH A COST ON IT (Phase 4 step 3). Unlike the two fields
// above, this one IS gated by a resource — `truck.financials` — so the pair
// below is the real thing: the dispatcher's payload has the work order and not
// the money, and the owner's has both. $1,937.11 is deliberately an amount
// nothing else on the screen could produce.
const workOrder = (
  await pool.query(
    `insert into "MaintenanceRecord"
       (id, "organizationId", "companyId", "truckId", "servicedAt", category,
        description, "vendorName", odometer, "costCents", "updatedAt")
       values ($4, $1, $2, $3, now(), 'BRAKES', $5, $6, 412000, 193711, now())
       returning id`,
    [
      organizationId,
      companyId,
      truck.id,
      cuid(),
      `${TAG} steer axle brake job`,
      `${TAG} Truck Service`,
    ],
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
  // The destination moved to /dashboard when the dashboard shipped. Asserted
  // rather than loosened: "signing in lands somewhere" is not the claim worth
  // making, and a dispatcher holds `dashboard:read` through OPERATIONS_READ.
  'the dispatcher can sign in',
  dispatcher.page.url().includes('/dashboard'),
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
  '/dashboard',
  '/loads',
  '/loads/new',
  '/dispatch',
  '/trucks',
  '/trailers',
  '/drivers',
  '/safety',
  '/safety/inspections',
  '/maintenance',
  '/documents',
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

// --- the dashboard's own rows -----------------------------------------------
//
// The action queue is built per role: each row names the resource it needs and
// the ones the session cannot read are never counted. That is asserted in
// tests/dashboard.test.ts against `can`, which proves the FILTER — this proves
// the PAYLOAD, on the deployed worker, by reading what came down the wire.
//
// The same argument as the money fields on /trucks: a number a dispatcher must
// not see is absent from the response, not hidden in CSS.
const dash = await bodyOf(dispatcher.page, '/dashboard')

record(
  'a dispatcher gets the operational dashboard rows',
  dash.status === 200 &&
    (dash.body.includes('Delivered, waiting on a POD') ||
      dash.body.includes('Booked with no truck or driver') ||
      dash.body.includes('Nothing is waiting')),
  `HTTP ${dash.status}`,
)

// Every money row's label, by the words that would appear if one rendered.
const MONEY_ROWS = [
  'Ready to invoice',
  'POD in, no rate entered',
  'Invoices past due',
  'Payments not yet applied',
  'Settlements in draft',
]
const leaked = MONEY_ROWS.filter((label) => dash.body.includes(label))
record(
  'and no money row reaches the payload at all',
  leaked.length === 0,
  leaked.length === 0 ? 'none of five present' : leaked.join(', '),
)

// The week section is money too — heading included, since a heading over an
// empty section still tells a dispatcher there is revenue to be seen.
record(
  'and no revenue section, not even its heading',
  !dash.body.includes('This week') && !dash.body.includes('Both authorities'),
  'absent',
)

// PAIRED, per standing rule 11: the same screen for an owner HAS the money.
//
// This pairing does more than balance the refusal — it proves the LABELS above
// are the strings the screen really renders. Without it, an i18n rename would
// turn "no money row reaches the payload" into a check that passes because it
// is looking for words nothing says any more.
const ownerDash = await bodyOf(owner.page, '/dashboard')
const ownerHas = MONEY_ROWS.filter((label) => ownerDash.body.includes(label))
record(
  'while an owner sees the money rows on the same screen',
  ownerDash.status === 200 &&
    ownerDash.body.includes('This week') &&
    ownerHas.length > 0,
  `HTTP ${ownerDash.status} · ${ownerHas.length} of ${MONEY_ROWS.length} row label(s) live`,
)

// --- the work order and what it cost (Phase 4 step 3) -----------------------
//
// §2.5: "a DISPATCHER sees the work order and not the cost". The pair is the
// whole check — the dispatcher's payload must carry the service and not the
// money, and the owner's must carry both, or the first half is satisfied by a
// screen that simply failed to render.
const maint = await bodyOf(dispatcher.page, '/maintenance')
record(
  'a dispatcher sees the work order itself',
  maint.status === 200 && maint.body.includes(`${TAG} steer axle brake job`),
  `HTTP ${maint.status}`,
)
record(
  'and neither the cost nor the column it would sit in',
  !maint.body.includes('193711') &&
    !maint.body.includes('1,937.11') &&
    !maint.body.includes('>Cost<') &&
    !maint.body.includes('On screen'),
  'no cost cell, no cost header, no on-screen total',
)

// The same work order on the TRUCK's own panel: the panel and the fleet list
// are two different queries and either could put the number back.
const truckPanel = await bodyOf(dispatcher.page, `/trucks/${truck.id}`)
record(
  'the truck panel shows it the same way',
  truckPanel.status === 200 &&
    truckPanel.body.includes(`${TAG} steer axle brake job`) &&
    !truckPanel.body.includes('193711') &&
    !truckPanel.body.includes('1,937.11') &&
    !truckPanel.body.includes('Spent on this asset'),
  `HTTP ${truckPanel.status} — history yes, running total no`,
)

const ownerMaint = await bodyOf(owner.page, '/maintenance')
record(
  'while an OWNER sees the cost on the same screen (rule 11)',
  ownerMaint.status === 200 &&
    ownerMaint.body.includes(`${TAG} steer axle brake job`) &&
    ownerMaint.body.includes('1,937.11'),
  `HTTP ${ownerMaint.status}`,
)

// --- an inspection is read, not written (Phase 4 step 4) --------------------
//
// §2.5's split, one table over: a DISPATCHER reads inspections because a driver
// placed out of service at a scale house decides what happens to the load they
// are under, and files none — recording one is `inspection:create`, FLEET_WRITE.
//
// The pair is the same url twice, because a 404 alone proves nothing: a typo in
// the path gives the same answer, and so does a route that was never deployed.
const dispatcherNewInspection = await bodyOf(
  dispatcher.page,
  '/safety/inspections/new',
)
record(
  'a dispatcher typing /safety/inspections/new is refused',
  dispatcherNewInspection.status === 404,
  `HTTP ${dispatcherNewInspection.status}`,
)

const ownerNewInspection = await bodyOf(owner.page, '/safety/inspections/new')
record(
  'and the SAME url works for an owner (rule 11)',
  ownerNewInspection.status === 200 &&
    ownerNewInspection.body.includes('inspectedAt'),
  `HTTP ${ownerNewInspection.status}`,
)

// --- claims are not a dispatcher's business (Phase 4 step 5) ----------------
//
// §2.5 names the roles for claims and DataQs — OWNER/ADMIN/MANAGER write,
// ACCOUNTING reads — and a DISPATCHER is on neither list. So `/safety/claims`
// is a 404 for them, unlike `/safety` and `/safety/inspections`, which they
// open every day.
//
// The three checks together are the point: two screens that DO open, one that
// does not, and the same refused url working for an owner. Any one alone would
// pass for the wrong reason.
const dispatcherClaims = await bodyOf(dispatcher.page, '/safety/claims')
record(
  'a dispatcher typing /safety/claims is refused',
  dispatcherClaims.status === 404,
  `HTTP ${dispatcherClaims.status}`,
)

const ownerClaims = await bodyOf(owner.page, '/safety/claims')
record(
  'and the SAME url works for an owner (rule 11)',
  ownerClaims.status === 200,
  `HTTP ${ownerClaims.status}`,
)

// The inspection screen is shared, and the DataQs panel on it is not: the
// challenge is claims-side. Asserted on the payload, not the pixels.
const inspectionsList = await bodyOf(dispatcher.page, '/safety/inspections')
record(
  'and the DataQs panel never reaches a dispatcher',
  !inspectionsList.body.includes('DataQs'),
  'no challenge panel in the payload',
)

// --- settings and the documents browser (Phase 4 step 6) --------------------
//
// Settings is `organization:read` — OWNER and ADMIN. A MANAGER who could move
// the settlement week boundary could move every driver's pay period without
// touching a pay rule, so a DISPATCHER certainly cannot.
const dispatcherSettings = await bodyOf(dispatcher.page, '/settings')
record(
  'a dispatcher typing /settings is refused',
  dispatcherSettings.status === 404,
  `HTTP ${dispatcherSettings.status}`,
)

const ownerSettings = await bodyOf(owner.page, '/settings')
record(
  'and the SAME url works for an owner (rule 11)',
  ownerSettings.status === 200 &&
    ownerSettings.body.includes('settlementWeekEndsOn'),
  `HTTP ${ownerSettings.status}`,
)

// THE BROWSER IS A DIFFERENT SHAPE OF CHECK. Both roles open it; what differs
// is what is IN it. A dispatcher holds `document:read` because they upload
// PODs, and the screen is gated per ENTITY — so the settlement PDF filed for
// the seeded driver is absent from their payload and present in the owner's.
const dispatcherDocs = await bodyOf(dispatcher.page, '/documents')
record(
  'a dispatcher can open /documents',
  dispatcherDocs.status === 200,
  `HTTP ${dispatcherDocs.status}`,
)
record(
  'and is offered no chip for a kind they cannot read',
  !dispatcherDocs.body.includes('>Settlement<') &&
    !dispatcherDocs.body.includes('>Invoice<'),
  'no settlement or invoice chip',
)

const ownerDocs = await bodyOf(owner.page, '/documents')
record(
  'while an owner is offered both (rule 11)',
  // THE ENTITY CHIPS, which render for every kind the session may read whatever
  // the data holds. The TYPE chips are a different question — those only render
  // where the count is non-zero, so asserting on them would be asserting about
  // what happens to be in the dev database today.
  ownerDocs.status === 200 &&
    ownerDocs.body.includes('>Settlement<') &&
    ownerDocs.body.includes('>Invoice<'),
  `HTTP ${ownerDocs.status}`,
)

// --- extraction money, per Phase 5 §1.3 and §5 -------------------------------
//
// "A dispatcher's prefill carries no money key and no money label; the same
// document's figures reach OWNER/ACCOUNTING ... — pair-asserted."
//
// ONE MODEL CALL, not two. The extraction is run as the DISPATCHER, which is
// the half that has to be true on the wire; the other half is read out of the
// row it wrote, where the cents are stored for the roles that may see them. Two
// calls would prove the same thing at twice the cost, and this walkthrough runs
// on every step boundary.
//
// It seeds its own document, because a walkthrough that fails for want of
// fixture data is a walkthrough people learn to ignore.
const ratecon = rateConFixture(TAG)

const seeded = await dispatcher.page.evaluate(
  async ({ bytes, companyId, filename }) => {
    const data = new Uint8Array(bytes)
    const digest = await crypto.subtle.digest('SHA-256', data)
    const sha256 = btoa(String.fromCharCode(...new Uint8Array(digest)))

    const minted = await fetch('/api/documents/upload-url', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        companyId,
        filename,
        mimeType: 'application/pdf',
        sizeBytes: data.byteLength,
        sha256,
        documentType: 'RATE_CONFIRMATION',
      }),
    })
    if (!minted.ok) return { error: `mint ${minted.status}` }
    const { pendingUploadId, url, headers } = await minted.json()

    const put = await fetch(url, { method: 'PUT', headers, body: data })
    if (!put.ok) return { error: `put ${put.status}` }

    const read = await fetch(`/api/documents/${pendingUploadId}/extract`, {
      method: 'POST',
    })
    return { pendingUploadId, status: read.status, text: await read.text() }
  },
  {
    bytes: Array.from(ratecon.bytes),
    companyId,
    filename: `${TAG}-ratecon.pdf`,
  },
)

record(
  'a dispatcher can upload and read a rate confirmation',
  seeded.status === 200,
  seeded.error ?? `HTTP ${seeded.status}`,
)
record(
  'and the extraction carries no money key at all',
  Boolean(seeded.text) &&
    !seeded.text.includes('"money"') &&
    !seeded.text.includes('linehaul'),
  'no money on the dispatcher wire',
)

// THE OTHER HALF, from the row that call wrote: the figures did reach cents,
// they simply did not reach the dispatcher.
const stored = seeded.pendingUploadId
  ? (
      await pool.query(
        'select "extractedJson"::text json from "PendingUpload" where id = $1',
        [seeded.pendingUploadId],
      )
    ).rows[0]
  : null
// `jsonb::text` normalises with a space after the colon, which a substring
// match does not allow for — the first version of this check failed on a row
// that was perfectly correct, and printed "linehaulCents present" while doing
// it. The detail line now shows what was actually found.
const linehaul = /"linehaulCents":\s*(\d+)/.exec(stored?.json ?? '')
record(
  'while the same document’s figures are stored in cents (rule 11)',
  linehaul?.[1] === '245000',
  linehaul ? `${linehaul[1]} cents` : '(not stored)',
)

if (seeded.pendingUploadId) {
  await pool.query('delete from "PendingUpload" where id = $1', [
    seeded.pendingUploadId,
  ])
}

// AND THE FORM ITSELF. §5 asks for "no money LABEL", which is a claim about the
// screen rather than the wire: a rate box that is merely disabled still tells a
// dispatcher a rate exists.
const newLoad = await bodyOf(dispatcher.page, '/loads/new')
record(
  'a dispatcher gets no rate field on the create form',
  newLoad.status === 200 && !newLoad.body.includes('name="rate"'),
  `HTTP ${newLoad.status}`,
)

const ownerNewLoad = await bodyOf(owner.page, '/loads/new')
record(
  'while an owner does (rule 11)',
  ownerNewLoad.status === 200 && ownerNewLoad.body.includes('name="rate"'),
  `HTTP ${ownerNewLoad.status}`,
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
await pool.query('delete from "MaintenanceRecord" where id = $1', [
  workOrder.id,
])
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
