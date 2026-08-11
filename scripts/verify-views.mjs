import { chromium } from 'playwright'
import { neonConfig, Pool } from '@neondatabase/serverless'

// ---------------------------------------------------------------------------
// TWO STEP 6 CLAIMS, ON THE DEPLOYED WORKER.
//
//   * saved views are a PER-USER STORE, not localStorage — so a view saved in
//     one browser has to be there in a second, cookie-sharing but
//     storage-separate context;
//   * a place accepts an EXPLICIT timezone, the derivation stays the fallback,
//     and clearing the field returns to the derivation.
//
// Both were shipped broken once already. `export const VIEW_INITIAL` in a
// "use server" file made every save a 500 with an empty error slot, and
// nothing short of running it deployed would have said so — which is the whole
// argument for this file existing.
//
//   SHOT_CHROME=... node -r dotenv/config scripts/verify-views.mjs
// ---------------------------------------------------------------------------

const BASE =
  process.env.VERIFY_BASE ?? 'https://zebra-dev.tajikcargollc.workers.dev'
const TAG = `VW${Date.now().toString(36).slice(-4).toUpperCase()}`
const VIEW_NAME = `Booked ${TAG}`

neonConfig.webSocketConstructor ??= WebSocket
neonConfig.poolQueryViaFetch = false
const pool = new Pool({ connectionString: process.env.DIRECT_DATABASE_URL })

const results = []
const record = (label, ok, detail) => {
  results.push({ label, ok })
  console.log(`${ok ? 'ok  ' : 'FAIL'}  ${label.padEnd(52)} ${detail}`)
}

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
  page.waitForURL(/\/(loads|dashboard)/, { timeout: 60_000 }),
  page.click('button[type="submit"]'),
])

// --- saved views -----------------------------------------------------------
await page.goto(`${BASE}/loads?status=BOOKED`, {
  waitUntil: 'domcontentloaded',
})
await page.waitForTimeout(1500)

const saveControl = page.locator('button:has-text("Save")').first()
record(
  'the save control appears only on a filtered table',
  await saveControl.isVisible(),
  'visible with ?status=BOOKED',
)

await saveControl.click()
await page.fill('input[name="name"]', VIEW_NAME)
await page.locator('form button[type="submit"]:has-text("Save")').click()
await page.waitForTimeout(8000)

const chip = page.locator(`a:has-text("${VIEW_NAME}")`).first()
record(
  'the view is pinned above the table as a chip',
  await chip.isVisible(),
  VIEW_NAME,
)

const stored = (
  await pool.query(
    `select value from "UserPreference" where key = 'view.loads'
      and "userId" in (select id from "User" where email = $1)`,
    [process.env.SEED_OWNER_EMAIL],
  )
).rows[0]
const storedViews = stored ? stored.value : []
record(
  'it is a row in the database, not localStorage',
  Array.isArray(storedViews) &&
    storedViews.some((view) => view.name === VIEW_NAME),
  JSON.stringify(storedViews),
)

record(
  'the chip carries the query the dispatcher was looking at',
  (await chip.getAttribute('href')) === '/loads?status=BOOKED',
  await chip.getAttribute('href'),
)

// A SECOND browser context: same cookie, empty localStorage. This is the
// difference the ride-along asked for and the only way to see it.
const second = await browser.newContext({
  viewport: { width: 1920, height: 1080 },
})
await second.addCookies(await context.cookies())
const otherPage = await second.newPage()
await otherPage.goto(`${BASE}/loads`, { waitUntil: 'domcontentloaded' })
await otherPage.waitForTimeout(1500)
record(
  'and it follows the user to another browser',
  await otherPage.locator(`a:has-text("${VIEW_NAME}")`).first().isVisible(),
  'present in a context with no shared storage',
)
await second.close()

// --- an explicit timezone on a place ---------------------------------------
// Dallas is in Texas, which spans two zones, so the backfill deliberately left
// it NULL and the screen says it is guessing. That is the case this control
// exists for.
await page.goto(`${BASE}/loads/new`, { waitUntil: 'domcontentloaded' })
await page.fill('input[name="broker"]', `Views ${TAG}`)
await page.fill('input[name="stops[0].place"]', 'Chicago, IL')
await page.fill('input[name="stops[1].place"]', `El Paso ${TAG}, TX`)
const soon = new Date()
soon.setDate(soon.getDate() + 3)
const md = `${String(soon.getMonth() + 1).padStart(2, '0')}${String(soon.getDate()).padStart(2, '0')}`
await page.fill('input[name="stops[0].date"]', md)
await page.fill('input[name="stops[1].date"]', md)
await page.click('form button[type="submit"]')
await page.waitForTimeout(14_000)

const load = (
  await pool.query(
    `select id, "loadNumber" from "Load"
      where "customerId" in (select id from "Customer" where name = $1)`,
    [`Views ${TAG}`],
  )
).rows[0]

await page.goto(`${BASE}/loads/${load.id}`, { waitUntil: 'domcontentloaded' })
await page.waitForTimeout(2000)

const approxBefore = await page.locator('text=/spans two zones/i').count()
record(
  'a split state is shown as an approximation, not a fact',
  approxBefore > 0,
  `${approxBefore} note(s) — TX spans two zones`,
)

// The delivery stop is the second one, and it is the Texas one.
const zoneSelects = page.locator('form select[name="timezone"]')
record(
  'every stop offers an explicit zone',
  (await zoneSelects.count()) === 2,
  `${await zoneSelects.count()} control(s)`,
)

await zoneSelects.nth(1).selectOption('America/Denver')
await page
  .locator('form:has(select[name="timezone"]) button[type="submit"]')
  .nth(1)
  .click()
await page.waitForTimeout(9000)

const place = (
  await pool.query('select timezone from "Location" where name = $1', [
    `El Paso ${TAG}, TX`,
  ])
).rows[0]
record(
  'the explicit zone is stored on the place',
  place?.timezone === 'America/Denver',
  String(place?.timezone),
)

await page.reload({ waitUntil: 'domcontentloaded' })
await page.waitForTimeout(2000)
record(
  'and the screen stops calling it approximate',
  (await page.locator('text=/spans two zones/i').count()) < approxBefore,
  `${await page.locator('text=/spans two zones/i').count()} note(s) left`,
)

// Clearing it must go back to the derivation, or the fallback is a one-way
// door and "approximate" becomes unreachable the moment somebody guesses.
await zoneSelects.nth(1).selectOption('')
await page
  .locator('form:has(select[name="timezone"]) button[type="submit"]')
  .nth(1)
  .click()
await page.waitForTimeout(9000)
const cleared = (
  await pool.query('select timezone from "Location" where name = $1', [
    `El Paso ${TAG}, TX`,
  ])
).rows[0]
record(
  'clearing it returns to the derivation',
  cleared?.timezone === null,
  cleared?.timezone === null ? 'NULL again' : String(cleared?.timezone),
)

await page.screenshot({ path: 'screenshots/load-detail-zone.png' })
await browser.close()

// --- cleanup ---------------------------------------------------------------
// The saved view stays: it is one row, it belongs to the seeded owner, and the
// Loads screenshot is more honest with a real chip in it than with none.
for (const table of ['LoadStatusEvent', 'LoadAssignment', 'LoadStop']) {
  await pool.query(`delete from "${table}" where "loadId" = $1`, [load.id])
}
await pool.query('delete from "AuditLog" where "entityId" = $1', [load.id])
await pool.query('delete from "Load" where id = $1', [load.id])
await pool.query('delete from "Customer" where name = $1', [`Views ${TAG}`])
await pool.query('delete from "Location" where name = $1', [
  `El Paso ${TAG}, TX`,
])
await pool.end()

const failed = results.filter((r) => !r.ok).length
console.log(`${results.length - failed}/${results.length} passed`)
process.exit(failed === 0 ? 0 : 1)
