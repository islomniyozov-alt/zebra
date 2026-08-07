import { chromium } from 'playwright'
import { neonConfig, Pool } from '@neondatabase/serverless'

// ---------------------------------------------------------------------------
// PHASE 4 §3 STEP 4, END TO END, ON THE DEPLOYED WORKER.
//
// Driven entirely through the interface: record an inspection, land on it, add
// two violations — one of which grounds the truck — and watch the derived state
// move from clean to out of service. Then withdraw the out-of-service one and
// watch it move back, because clean is read off the violations and not stored.
//
// The reason this exists rather than trusting the integration suite: the suite
// calls the service, and Ahmad clicking Add load proved that a role-specific
// path can fail on a screen the service is perfectly happy with. This drives
// the forms.
//
//   SHOT_CHROME=... node -r dotenv/config scripts/verify-inspections.mjs
// ---------------------------------------------------------------------------

const BASE =
  process.env.VERIFY_BASE ?? 'https://zebra-dev.tajikcargollc.workers.dev'
const TAG = `RI${Date.now().toString(36).slice(-4).toUpperCase()}`

neonConfig.webSocketConstructor ??= WebSocket
neonConfig.poolQueryViaFetch = false
const pool = new Pool({ connectionString: process.env.DIRECT_DATABASE_URL })

const results = []
const record = (label, ok, detail) => {
  results.push({ label, ok })
  console.log(`${ok ? 'ok  ' : 'FAIL'}  ${label.padEnd(54)} ${detail}`)
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

// A truck of its own, with the open assignment period the drift check demands.
const truck = (
  await pool.query(
    `insert into "Truck" (id, "organizationId", "companyId", "unitNumber", "updatedAt")
       values ($4, $1, $2, $3, now()) returning id`,
    [organizationId, companyId, `${TAG}-902`, cuid()],
  )
).rows[0]
await pool.query(
  `insert into "AssetAssignment" (id, "organizationId", "companyId", "truckId", "effectiveFrom")
     values ($1, $2, $3, $4, now())`,
  [cuid(), organizationId, companyId, truck.id],
)

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

// --- record the event -------------------------------------------------------
await page.goto(`${BASE}/safety/inspections/new`, {
  waitUntil: 'domcontentloaded',
})
await page.fill('input[name="inspectedAt"]', '803')
await page.selectOption('select[name="level"]', 'LEVEL_1')
await page.fill('input[name="state"]', 'in')
await page.fill('input[name="reportNumber"]', `${TAG}-REPORT`)
await page.fill('input[name="location"]', 'Gary weigh station')
await page.selectOption('select[name="truckId"]', truck.id)
await page.click('button[type="submit"]')

// The action redirects straight to the event, because the violations go on next.
await page.waitForURL(/\/safety\/inspections\/c[a-z0-9]{24}/, {
  timeout: 60_000,
})
const inspectionId = page.url().split('/').pop()
record(
  'recording lands on the inspection, not back on the list',
  Boolean(inspectionId),
  page.url().replace(BASE, ''),
)

const stored = (
  await pool.query(
    'select state, "companyId", "truckId" from "RoadsideInspection" where id = $1',
    [inspectionId],
  )
).rows[0]
record(
  'the state is uppercased and the authority came from the truck',
  stored?.state === 'IN' &&
    stored?.companyId === companyId &&
    stored?.truckId === truck.id,
  `state ${stored?.state}`,
)

/**
 * The result badge in the page heading.
 *
 * READ FROM THE HEADING, not from the whole body. Every label the violation
 * panel can render travels in its props — including "Clean — nothing was
 * written" and the out-of-service checkbox caption — so a body-text search
 * finds both words on every inspection regardless of its state. The first
 * version of this script did exactly that and passed on the wrong reason.
 */
const resultBadge = async () => {
  await page.goto(`${BASE}/safety/inspections/${inspectionId}`, {
    waitUntil: 'domcontentloaded',
  })
  return (await page.locator('h1').innerText()).trim()
}

record(
  'with nothing written it reads as clean',
  (await resultBadge()).includes('Clean'),
  'derived from zero violations',
)

// --- the violations ---------------------------------------------------------
const addViolation = async (code, description, oos) => {
  await page.goto(`${BASE}/safety/inspections/${inspectionId}`, {
    waitUntil: 'domcontentloaded',
  })
  await page.fill('input[name="code"]', code)
  await page.fill('input[name="description"]', description)
  if (oos) await page.check('input[name="outOfService"]')
  await page.click('form:has(input[name="code"]) button[type="submit"]')
  // WAIT FOR THE ROW, not for a clock. The first run polled the database 1.5
  // seconds after the click and found one violation where two had been typed —
  // the second was still in flight, and the script reported a bug that was its
  // own impatience.
  await page
    .locator(`li:has-text("${code.toUpperCase()}")`)
    .first()
    .waitFor({ timeout: 30_000 })
}

await addViolation('392.2c', 'Failure to obey traffic control device', false)
await addViolation('393.75a3', 'Tire — audible air leak', true)

const violations = (
  await pool.query(
    'select code, "outOfService", "organizationId" from "InspectionViolation" where "inspectionId" = $1 order by code',
    [inspectionId],
  )
).rows
record(
  'both violations landed, uppercased',
  violations.length === 2 &&
    violations.every((v) => v.code === v.code.toUpperCase()),
  violations.map((v) => v.code).join(', ') || 'none',
)
record(
  'and the trigger derived their organizationId from the inspection',
  violations.every((v) => v.organizationId === organizationId),
  'no organizationId came from the caller',
)

const withViolations = await resultBadge()
record(
  'the inspection now reads as out of service',
  withViolations.includes('Out of service') &&
    !withViolations.includes('Clean'),
  'derived from the violation, not a column',
)

// The truck's own panel is a different query and must agree.
const panelBody = await (
  await page.goto(`${BASE}/trucks/${truck.id}`, {
    waitUntil: 'domcontentloaded',
  })
).text()
record(
  "the truck's panel shows the same event and the same codes",
  panelBody.includes('393.75A3') && panelBody.includes('Out of service'),
  'panel and detail agree',
)

// --- withdrawing puts it back -----------------------------------------------
//
// The whole argument for deriving rather than storing: withdraw the code that
// grounded the truck and the inspection is honestly clean again. A stored flag
// would still say out of service here.
let withdrawn = 0
// Re-counted every pass and reloaded between them. Clicking N times off one
// count is how the first run withdrew the same row twice: the second click
// landed on a button the re-render had not yet replaced, `updateMany` matched
// nothing, and the script reported two withdrawals having made one.
for (let pass = 0; pass < 5; pass++) {
  await page.goto(`${BASE}/safety/inspections/${inspectionId}`, {
    waitUntil: 'domcontentloaded',
  })
  const buttons = page.locator('button:has-text("Withdraw")')
  if ((await buttons.count()) === 0) break
  await buttons.first().click()
  await page.waitForTimeout(2000)
  withdrawn += 1
}

record(
  'withdrawing every violation makes it clean again',
  (await resultBadge()).includes('Clean'),
  `${withdrawn} withdrawn`,
)

const remaining = (
  await pool.query(
    'select count(*)::int n from "InspectionViolation" where "inspectionId" = $1 and "deletedAt" is null',
    [inspectionId],
  )
).rows[0].n
const kept = (
  await pool.query(
    'select count(*)::int n from "InspectionViolation" where "inspectionId" = $1',
    [inspectionId],
  )
).rows[0].n
record(
  'and the withdrawn rows are still there — soft, not gone',
  remaining === 0 && kept === 2,
  `${kept} rows, ${remaining} live`,
)

await browser.close()

// --- cleanup ----------------------------------------------------------------
await pool.query(
  'delete from "InspectionViolation" where "inspectionId" = $1',
  [inspectionId],
)
await pool.query('delete from "RoadsideInspection" where id = $1', [
  inspectionId,
])
await pool.query('delete from "AssetAssignment" where "truckId" = $1', [
  truck.id,
])
await pool.query('delete from "Truck" where id = $1', [truck.id])
await pool.end()

const failed = results.filter((r) => !r.ok).length
console.log(`${results.length - failed}/${results.length} passed`)
process.exit(failed === 0 ? 0 : 1)
