import { chromium } from 'playwright'
import { neonConfig, Pool } from '@neondatabase/serverless'

// ---------------------------------------------------------------------------
// §2.4 AND §4's THIRD BOX, ON THE DEPLOYED WORKER.
//
//   "An expired truck/driver warns at dispatch, doesn't block. The assignment
//    flow surfaces the expiry in words next to the confirm; the dispatcher
//    proceeds if the business says so; the audit row records that the warning
//    was displayed."
//
// Three claims, and the middle one is the one that matters. A warning that
// blocks is a stranded load; a warning that does not appear is nothing; and a
// warning nobody can prove was shown is not an audit answer. So this drives the
// board: assign a truck whose registration lapsed, read the words, confirm, and
// then read the assignment row back out of the database.
//
//   SHOT_CHROME=... node -r dotenv/config scripts/verify-dispatch-warning.mjs
// ---------------------------------------------------------------------------

const BASE =
  process.env.VERIFY_BASE ?? 'https://zebra-dev.tajikcargollc.workers.dev'
const TAG = `DW${Date.now().toString(36).slice(-4).toUpperCase()}`

neonConfig.webSocketConstructor ??= WebSocket
neonConfig.poolQueryViaFetch = false
const pool = new Pool({ connectionString: process.env.DIRECT_DATABASE_URL })

const results = []
const record = (label, ok, detail) => {
  results.push({ label, ok })
  console.log(`${ok ? 'ok  ' : 'FAIL'}  ${label.padEnd(56)} ${detail}`)
}

const cuid = () => {
  const alphabet = 'abcdefghijklmnopqrstuvwxyz0123456789'
  let id = 'c'
  for (let index = 0; index < 24; index++) {
    id += alphabet[Math.floor(Math.random() * alphabet.length)]
  }
  return id
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

const customer = (
  await pool.query(
    `insert into "Customer" (id, "organizationId", name, "updatedAt")
       values ($3, $1, $2, now()) returning id`,
    [organizationId, `${TAG} Broker`, cuid()],
  )
).rows[0]

// A truck with a LAPSED registration, and its open authority period.
const truck = (
  await pool.query(
    `insert into "Truck" (id, "organizationId", "companyId", "unitNumber", "updatedAt")
       values ($4, $1, $2, $3, now()) returning id`,
    [organizationId, companyId, `${TAG}-904`, cuid()],
  )
).rows[0]
await pool.query(
  `insert into "AssetAssignment" (id, "organizationId", "companyId", "truckId", "effectiveFrom")
     values ($1, $2, $3, $4, now())`,
  [cuid(), organizationId, companyId, truck.id],
)
const driver = (
  await pool.query(
    `insert into "Driver" (id, "organizationId", "companyId", "firstName", "lastName", "assignedTruckId", "updatedAt")
       values ($3, $1, $2, 'Warn', $4, $5, now()) returning id`,
    [organizationId, companyId, cuid(), TAG, truck.id],
  )
).rows[0]
await pool.query(
  `insert into "AssetAssignment" (id, "organizationId", "companyId", "driverId", "effectiveFrom")
     values ($1, $2, $3, $4, now())`,
  [cuid(), organizationId, companyId, driver.id],
)

await pool.query(
  `insert into "ComplianceItem"
     (id, "organizationId", "companyId", "truckId", type, "expiresAt", identifier, "updatedAt")
     values ($3, $1, $2, $4, 'REGISTRATION', now() - interval '40 days', $5, now())`,
  [organizationId, companyId, cuid(), truck.id, `${TAG}-PLATE`],
)

// A booked load for it to be assigned to.
const load = (
  await pool.query(
    `insert into "Load" (id, "organizationId", "companyId", "customerId", "loadNumber", "operationalStatus", "updatedAt")
       values ($5, $1, $2, $3, $4, 'BOOKED', now()) returning id`,
    [organizationId, companyId, customer.id, `${TAG}-L1`, cuid()],
  )
).rows[0]

const browser = await chromium.launch(
  process.env.SHOT_CHROME ? { executablePath: process.env.SHOT_CHROME } : {},
)
const context = await browser.newContext({
  viewport: { width: 1920, height: 1080 },
})
const page = await context.newPage()

await page.goto(`${BASE}/login`, { waitUntil: 'domcontentloaded' })
await page.fill('input[name="email"]', process.env.SEED_OWNER_EMAIL)
await page.fill('input[name="password"]', process.env.SEED_OWNER_PASSWORD)
await page.click('button[type="submit"]')
await page.waitForURL(/\/(loads|dashboard)/, { timeout: 60_000 })

// --- open the board and pick the truck ---------------------------------------
await page.goto(`${BASE}/dispatch`, { waitUntil: 'domcontentloaded' })

// THE CARD, THEN ITS BUTTON. The load number on a board card is a Link to the
// load — clicking the text navigates away rather than opening the picker, which
// is what the first version of this script did and then waited thirty seconds
// for a modal on the wrong page.
const card = page.locator('li', { hasText: `${TAG}-L1` }).first()
await card.waitFor({ timeout: 30_000 })
await card.locator('button').last().click()
await page.locator(`button:has-text("${TAG}-904")`).first().click()

// First submit: this is where §2.4 says the words appear.
await page.locator('form button[type="submit"]').last().click()

// WAIT FOR THE WARNING ITSELF, not for `[role="alert"]`. Next renders an empty
// `role="alert"` route announcer into every page, so waiting on that selector
// resolves instantly and reads the DOM before the server action has answered —
// which is what the first version of this script did, twice, and then reported
// a feature that works as broken.
const warning = page
  .locator('[role="alert"]')
  .filter({ hasText: `${TAG}-904` })
  .first()
await warning.waitFor({ timeout: 30_000 })

const warned = await warning.innerText()
record(
  'the expiry appears in words, next to the confirm',
  warned.includes(`${TAG}-904`) && /40/.test(warned),
  warned.replace(/\s+/g, ' ').slice(0, 78),
)

const notYet = (
  await pool.query('select "truckId" from "Load" where id = $1', [load.id])
).rows[0]
record(
  'and NOTHING is assigned until somebody confirms',
  notYet.truckId === null,
  'the load is untouched',
)

// --- confirm ------------------------------------------------------------------
//
// The button changed its own label and colour when the warning appeared, which
// is the difference between a confirm and the submit somebody already pressed.
const confirm = page.locator('form button[type="submit"]').last()
const confirmLabel = (await confirm.innerText()).trim()
record(
  'the confirm names what it is about to do, differently from before',
  confirmLabel.length > 0 && confirmLabel !== 'Assign',
  confirmLabel,
)

await confirm.click()

// Wait for the load to move rather than for a clock.
let assigned = null
for (let attempt = 0; attempt < 15; attempt++) {
  assigned = (
    await pool.query(
      'select "truckId", "operationalStatus" from "Load" where id = $1',
      [load.id],
    )
  ).rows[0]
  if (assigned?.truckId) break
  await page.waitForTimeout(1000)
}
record(
  'confirming dispatches it — the warning did not block',
  assigned?.truckId === truck.id &&
    assigned?.operationalStatus === 'DISPATCHED',
  `${assigned?.operationalStatus}`,
)

// --- the audit row ------------------------------------------------------------
const custody = (
  await pool.query(
    'select reason from "LoadAssignment" where "loadId" = $1 order by "assignedAt" desc limit 1',
    [load.id],
  )
).rows[0]
record(
  'and the assignment records that the warning was displayed',
  Boolean(custody?.reason?.includes('REGISTRATION expired')),
  custody?.reason ?? '(no reason recorded)',
)

// The row is audited field by field like every other write, so the reason is
// in the audit log too — which is where somebody looks a year later.
const audited = (
  await pool.query(
    `select changes from "AuditLog"
      where "entityType" = 'LoadAssignment' order by "createdAt" desc limit 1`,
  )
).rows[0]
record(
  'in the audit log, not only on the row',
  JSON.stringify(audited?.changes ?? {}).includes('REGISTRATION expired'),
  'field-level diff carries it',
)

await browser.close()

// --- cleanup -------------------------------------------------------------------
await pool.query('delete from "LoadStatusEvent" where "loadId" = $1', [load.id])
await pool.query('delete from "LoadAssignment" where "loadId" = $1', [load.id])
await pool.query('delete from "Load" where id = $1', [load.id])
await pool.query('delete from "ComplianceItem" where "truckId" = $1', [
  truck.id,
])
await pool.query('delete from "AssetAssignment" where "driverId" = $1', [
  driver.id,
])
await pool.query('delete from "Driver" where id = $1', [driver.id])
await pool.query('delete from "AssetAssignment" where "truckId" = $1', [
  truck.id,
])
await pool.query('delete from "Truck" where id = $1', [truck.id])
await pool.query('delete from "Customer" where id = $1', [customer.id])
await pool.end()

const failed = results.filter((r) => !r.ok).length
console.log(`${results.length - failed}/${results.length} passed`)
process.exit(failed === 0 ? 0 : 1)
