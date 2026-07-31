import { chromium } from 'playwright'
import { neonConfig, Pool } from '@neondatabase/serverless'
import { writeFileSync, unlinkSync } from 'node:fs'

// ---------------------------------------------------------------------------
// §7, END TO END, ON THE DEPLOYED WORKER.
//
//   "POD received — set automatically when a confirmed Document of type POD
//    attaches. Never manually."
//
// Driven entirely through the interface: book a load, mark it delivered from
// the detail screen, upload a POD from the documents panel, and watch the load
// reach POD received without anybody selecting that status anywhere.
//
// It also exercises the two things the timeline exists to show. A SECOND
// Delivered click, made after the POD has landed, must be refused as stale and
// must appear in the history — the timeline is the audit answer, and an answer
// that omits the refusals agrees with whoever tells the story first.
//
//   SHOT_CHROME=... node -r dotenv/config scripts/verify-pod.mjs
// ---------------------------------------------------------------------------

const BASE =
  process.env.VERIFY_BASE ?? 'https://zebra-dev.tajikcargollc.workers.dev'
const TAG = `PD${Date.now().toString(36).slice(-4).toUpperCase()}`
const PDF = `${process.env.TEMP ?? '/tmp'}/${TAG}.pdf`

writeFileSync(
  PDF,
  '%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[]/Count 0>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n',
)

neonConfig.webSocketConstructor ??= WebSocket
neonConfig.poolQueryViaFetch = false
const pool = new Pool({ connectionString: process.env.DIRECT_DATABASE_URL })

const results = []
const record = (label, ok, detail) => {
  results.push({ label, ok })
  console.log(`${ok ? 'ok  ' : 'FAIL'}  ${label.padEnd(52)} ${detail}`)
}

const statusOf = async (loadId) =>
  (
    await pool.query('select "operationalStatus" s from "Load" where id = $1', [
      loadId,
    ])
  ).rows[0]?.s

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
await Promise.all([
  page.waitForURL(/\/loads/, { timeout: 60_000 }),
  page.click('button[type="submit"]'),
])

// --- book a load through the form ------------------------------------------
await page.goto(`${BASE}/loads/new`, { waitUntil: 'domcontentloaded' })
await page.fill('input[name="broker"]', `POD ${TAG}`)
await page.fill('input[name="pickup"]', 'Chicago, IL')
await page.fill('input[name="delivery"]', 'Dallas, TX')
await page.fill('input[name="pickupAt"]', '901')
await page.fill('input[name="deliveryAt"]', '903')
await page.fill('input[name="rate"]', '2450')
// The BUTTON, not Ctrl+Enter. The hotkey is bound in a useEffect, so it needs
// hydration, and this script raced it: one run submitted nothing and reported
// no error because there was no error. The hotkey is proven by the Step 4
// timing runs; here the point is the load, not how it was saved.
await page.click('form button[type="submit"]')

let load = null
const bookedBy = Date.now() + 90_000
while (!load && Date.now() < bookedBy) {
  const { rows } = await pool.query(
    `select id, "loadNumber" from "Load"
      where "customerId" in (select id from "Customer" where name = $1)`,
    [`POD ${TAG}`],
  )
  load = rows[0] ?? null
}
record(
  'load booked through the form',
  Boolean(load),
  load?.loadNumber ??
    (await page
      .locator('[role="alert"], p.text-danger')
      .allTextContents()
      .then((all) => all.join(' | ') || '(the form reported nothing)')),
)
if (!load) {
  await browser.close()
  await pool.end()
  process.exit(1)
}

// --- the one manual click --------------------------------------------------
await page.goto(`${BASE}/loads/${load.id}`, { waitUntil: 'domcontentloaded' })
await page.click('button:has-text("Mark delivered")')
await page.waitForFunction(
  () => !document.querySelector('button[type="submit"][disabled]'),
  null,
  { timeout: 60_000 },
)
let status = await statusOf(load.id)
const deliveredBy = Date.now() + 60_000
while (status !== 'DELIVERED' && Date.now() < deliveredBy) {
  status = await statusOf(load.id)
}
record('Delivered is one manual click', status === 'DELIVERED', status)

// --- the POD slot must be showing as MISSING now ---------------------------
await page.reload({ waitUntil: 'domcontentloaded' })
const missing = await page
  .locator('text=Missing — this load needs one.')
  .count()
record(
  'a delivered load shows its POD slot as missing',
  missing >= 1,
  `${missing} dashed placeholder(s)`,
)

// --- upload the POD from the documents panel -------------------------------
// The POD slot's own file input, not the rate confirmation's.
const podInput = page
  .locator('div:has(> div > h3:text-is("POD")) input[type="file"]')
  .first()
await podInput.setInputFiles(PDF)

status = await statusOf(load.id)
const podBy = Date.now() + 120_000
while (status !== 'POD_RECEIVED' && Date.now() < podBy) {
  status = await statusOf(load.id)
}
record(
  'POD confirm sets POD received AUTOMATICALLY',
  status === 'POD_RECEIVED',
  status,
)

const events = await pool.query(
  `select "toStatus", source, outcome from "LoadStatusEvent"
    where "loadId" = $1 order by "occurredAt" asc`,
  [load.id],
)
record(
  'the POD transition is recorded as AUTOMATIC',
  events.rows.some(
    (e) => e.toStatus === 'POD_RECEIVED' && e.source === 'AUTOMATIC',
  ),
  JSON.stringify(events.rows.map((e) => `${e.toStatus}/${e.source}`)),
)

// --- the race, reproduced faithfully ---------------------------------------
//
// Once a load is at POD received the Mark delivered button is gone, so the
// stale case cannot be produced by clicking twice on a fresh page. The way it
// actually happens is a RACE: a dispatcher's screen was rendered while the
// load was still Delivered, a POD confirm landed in between, and their click
// arrives against a load that has already moved on.
//
// So that is what is staged here — a second load, its page rendered at
// Delivered with the button live, and the POD confirmed from another tab
// before the click. Nothing simulated: the same button, the same action, the
// same server.
await page.goto(`${BASE}/loads/new`, { waitUntil: 'domcontentloaded' })
await page.fill('input[name="broker"]', `POD ${TAG}`)
await page.fill('input[name="pickup"]', 'Chicago, IL')
await page.fill('input[name="delivery"]', 'Dallas, TX')
await page.fill('input[name="pickupAt"]', '915')
await page.fill('input[name="deliveryAt"]', '917')
// The BUTTON, not Ctrl+Enter. The hotkey is bound in a useEffect, so it needs
// hydration, and this script raced it: one run submitted nothing and reported
// no error because there was no error. The hotkey is proven by the Step 4
// timing runs; here the point is the load, not how it was saved.
await page.click('form button[type="submit"]')

let racer = null
const racerBy = Date.now() + 90_000
while (!racer && Date.now() < racerBy) {
  const { rows } = await pool.query(
    `select id from "Load" where "customerId" in
       (select id from "Customer" where name = $1) and id <> $2`,
    [`POD ${TAG}`, load.id],
  )
  racer = rows[0] ?? null
}

// Their screen is rendered while the load is still Booked, so the button is
// live. (It is correctly hidden once a load reaches Delivered — offering a
// no-op is its own bug — which is exactly why the race has to start here.)
await page.goto(`${BASE}/loads/${racer.id}`, { waitUntil: 'domcontentloaded' })
const staleButton = page.locator('button:has-text("Mark delivered")')
const buttonWasOffered = (await staleButton.count()) > 0

// Meanwhile, in the other tab, the POD lands.
const second = await context.newPage()
await second.goto(`${BASE}/loads/${racer.id}`, {
  waitUntil: 'domcontentloaded',
})
// The file input's onChange is React's, so it does nothing until the page has
// hydrated. Without this wait the upload silently never starts, and every
// assertion after it measures a race that never happened — which is exactly
// what the previous run reported.
await second.waitForTimeout(3000)
await second
  .locator('div:has(> div > h3:text-is("POD")) input[type="file"]')
  .first()
  .setInputFiles(PDF)
let racerStatus = await statusOf(racer.id)
const racePodBy = Date.now() + 120_000
while (racerStatus !== 'POD_RECEIVED' && Date.now() < racePodBy) {
  racerStatus = await statusOf(racer.id)
}
await second.close()

// Loudly, and BEFORE anything downstream pretends to measure the race.
record(
  'the racing POD landed first',
  racerStatus === 'POD_RECEIVED',
  racerStatus,
)

// And now the click that lost the race.
if (buttonWasOffered) {
  await staleButton.click()
  await page.waitForTimeout(9000)
}

const refused = await pool.query(
  `select "fromStatus", "toStatus", source, outcome from "LoadStatusEvent"
    where "loadId" = $1 and outcome = 'REFUSED_STALE'`,
  [racer.id],
)

record(
  'the load did not go backwards',
  (await statusOf(racer.id)) === 'POD_RECEIVED',
  await statusOf(racer.id),
)
record(
  'the losing click is RECORDED as refused, not swallowed',
  refused.rows.length === 1,
  JSON.stringify(refused.rows),
)

// ...and the timeline has to SHOW it. A recorded refusal nobody can see is
// the same as no refusal.
await page.goto(`${BASE}/loads/${racer.id}`, { waitUntil: 'domcontentloaded' })
await page.waitForTimeout(1500)
const shown = await page.locator('text=refused').count()
const explained = await page.locator('text=/Someone tried to set/').count()
record(
  'the timeline SHOWS the refusal',
  shown > 0 && explained > 0,
  `${shown} marker(s), ${explained} explanation(s)`,
)

// The requirement is that the two are DISTINGUISHABLE, not that there are
// three of them — this load has two applied events, and an assertion counting
// to three was measuring the fixture rather than the screen.
const manual = await page.locator('text=/^manual$/').count()
const automatic = await page.locator('text=/^automatic$/').count()
record(
  'the timeline distinguishes MANUAL from AUTOMATIC',
  manual > 0 && automatic > 0,
  `${manual} manual, ${automatic} automatic`,
)

await page.screenshot({ path: 'screenshots/load-detail-timeline.png' })

await browser.close()

// --- cleanup ---------------------------------------------------------------
for (const id of [load.id, racer.id]) {
  await pool.query('delete from "Document" where "loadId" = $1', [id])
  await pool.query('delete from "PendingUpload" where "targetId" = $1', [id])
  await pool.query('delete from "LoadStatusEvent" where "loadId" = $1', [id])
  await pool.query('delete from "LoadStop" where "loadId" = $1', [id])
  await pool.query('delete from "Communication" where "loadId" = $1', [id])
  await pool.query('delete from "AuditLog" where "entityId" = $1', [id])
  await pool.query('delete from "Load" where id = $1', [id])
}
await pool.query('delete from "Customer" where name = $1', [`POD ${TAG}`])
await pool.query('delete from "Location" where name in ($1, $2)', [
  'Chicago, IL',
  'Dallas, TX',
])
unlinkSync(PDF)

const remaining = await pool.query('select count(*)::int n from "Load"')
console.log(`\nloads remaining: ${remaining.rows[0].n}`)
await pool.end()

const failed = results.filter((r) => !r.ok).length
console.log(`${results.length - failed}/${results.length} passed`)
process.exit(failed === 0 ? 0 : 1)
