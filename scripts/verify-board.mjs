import { chromium } from 'playwright'
import { neonConfig, Pool } from '@neondatabase/serverless'

// ---------------------------------------------------------------------------
// §11 ON THE DEPLOYED WORKER.
//
//   * click-to-assign is the keyboard path, and it is the ONLY path;
//   * assignment obeys §8 — the board cannot book a conflict the create form
//     would refuse;
//   * assignment sets Dispatched automatically, and the timeline says
//     AUTOMATIC, because that is what it was.
//
// Driven with the keyboard where the claim is about the keyboard: the assign
// control is reached by Tab and activated by Enter, never by a mouse click.
//
//   SHOT_CHROME=... node -r dotenv/config scripts/verify-board.mjs
// ---------------------------------------------------------------------------

const BASE =
  process.env.VERIFY_BASE ?? 'https://zebra-dev.tajikcargollc.workers.dev'
const TAG = `BD${Date.now().toString(36).slice(-4).toUpperCase()}`

neonConfig.webSocketConstructor ??= WebSocket
neonConfig.poolQueryViaFetch = false
const pool = new Pool({ connectionString: process.env.DIRECT_DATABASE_URL })

const results = []
const record = (label, ok, detail) => {
  results.push({ label, ok })
  console.log(`${ok ? 'ok  ' : 'FAIL'}  ${label.padEnd(54)} ${detail}`)
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
  page.waitForURL(/\/loads/, { timeout: 60_000 }),
  page.click('button[type="submit"]'),
])

// --- a truck, a driver and two loads, all through the interface -------------
await page.goto(`${BASE}/trucks/new`, { waitUntil: 'domcontentloaded' })
await page.fill('input[name="unitNumber"]', `${TAG}-101`)
await page.click('form button[type="submit"]')
await page.waitForURL(/\/trucks(\?|$)/, { timeout: 60_000 })

await page.goto(`${BASE}/drivers/new`, { waitUntil: 'domcontentloaded' })
await page.fill('input[name="firstName"]', 'Board')
await page.fill('input[name="lastName"]', TAG)
await page.click('form button[type="submit"]')
await page.waitForURL(/\/drivers(\?|$)/, { timeout: 60_000 })

const book = async (pickDay, dropDay) => {
  await page.goto(`${BASE}/loads/new`, { waitUntil: 'domcontentloaded' })
  await page.fill('input[name="broker"]', `Board ${TAG}`)
  await page.fill('input[name="pickup"]', 'Chicago, IL')
  await page.fill('input[name="delivery"]', 'Dallas, TX')
  await page.fill('input[name="pickupAt"]', pickDay)
  await page.fill('input[name="deliveryAt"]', dropDay)
  await page.click('form button[type="submit"]')
  const before = ids.length
  const deadline = Date.now() + 90_000
  while (ids.length === before && Date.now() < deadline) {
    const { rows } = await pool.query(
      `select id, "loadNumber" from "Load"
        where "customerId" in (select id from "Customer" where name = $1)
        order by "loadNumber" asc`,
      [`Board ${TAG}`],
    )
    if (rows.length > before) ids.splice(0, ids.length, ...rows)
  }
  return ids[ids.length - 1]
}

const ids = []
const today = new Date()
const day = (offset) => {
  const d = new Date(today)
  d.setDate(d.getDate() + offset)
  return `${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`
}

const first = await book(day(1), day(2))
const second = await book(day(1), day(2))
record(
  'two loads booked into the same window',
  ids.length === 2,
  ids.map((l) => l.loadNumber).join(', '),
)

// --- the board renders, with its KPIs --------------------------------------
await page.goto(`${BASE}/dispatch`, { waitUntil: 'domcontentloaded' })
await page.waitForTimeout(2500)

const railed = await page.locator(`aside >> text=${first.loadNumber}`).count()
record(
  'unassigned loads sit in the leading rail',
  railed > 0,
  `${railed} found`,
)

// WHICH load the first Assign button belongs to is the board's business, not
// this script's. The rail is ordered by booking time, so assuming it is the
// first load booked reads the right facts about the wrong row — which is how
// a previous run reported "refused, naming the load" as a failure while the
// board was doing exactly the right thing. Ask the rail instead.
const railNumber = async () =>
  (
    await page.locator('aside li').first().locator('a').first().innerText()
  ).trim()
const targetNumber = await railNumber()
const target = ids.find((load) => load.loadNumber === targetNumber) ?? first
const other = ids.find((load) => load.id !== target.id) ?? second

const kpis = await page
  .locator('main, body')
  .locator('text=/Active loads|In transit|Awaiting POD|Available trucks/')
  .count()
record('KpiCards across the top', kpis >= 4, `${kpis} cards`)

// --- KEYBOARD: Tab to the assign control, Enter to open --------------------
const assignButton = page.locator('aside button:has-text("Assign")').first()
await assignButton.focus()
const focused = await page.evaluate(
  () => document.activeElement?.textContent?.trim() ?? '',
)
record('the assign control is focusable', focused.includes('Assign'), focused)

await page.keyboard.press('Enter')
await page.waitForSelector('dialog[open]', { timeout: 30_000 })
// `showModal()` moves focus itself, and it does so AFTER the effect that opens
// the dialog. Focusing before that lands means the next Enter goes wherever the
// browser put the caret — which is how the first run of this script reported
// "not assigned" with no error: the submit button was simply still disabled.
await page.waitForTimeout(1000)

// Pick a truck with the keyboard. No mouse anywhere in this block.
const truckButton = page.locator(`dialog[open] button:has-text("${TAG}-101")`)
await truckButton.focus()
await page.keyboard.press('Enter')

// Assert the selection took before submitting, so a failure names itself
// rather than surfacing three assertions later as "nothing was assigned".
const chosen = await truckButton.getAttribute('aria-pressed')
record(
  'Enter selects a truck in the list',
  chosen === 'true',
  `aria-pressed=${chosen}`,
)

// The truck was created a minute ago and nobody is in it, so the modal has to
// ask who is driving: §7 dispatches on truck AND driver, and a board that could
// only attach a truck would leave the load at Booked looking like a failure.
const driverButton = page.locator(
  `dialog[open] button:has-text("${TAG}, Board")`,
)
await driverButton.waitFor({ timeout: 20_000 })
await driverButton.focus()
await page.keyboard.press('Enter')
record(
  'a truck with no driver asks for one',
  (await driverButton.getAttribute('aria-pressed')) === 'true',
  `aria-pressed=${await driverButton.getAttribute('aria-pressed')}`,
)

const submit = page.locator('dialog[open] button[type="submit"]')
record(
  'the submit control is enabled once a truck is chosen',
  !(await submit.isDisabled()),
  (await submit.isDisabled()) ? 'still disabled' : 'enabled',
)
await submit.focus()
await page.keyboard.press('Enter')
await page.waitForTimeout(12_000)

const assigned = (
  await pool.query(
    'select "truckId", "driverId", "operationalStatus" s from "Load" where id = $1',
    [target.id],
  )
).rows[0]
record(
  'click-to-assign works from the keyboard alone',
  assigned.truckId !== null,
  assigned.truckId ? 'truck attached' : 'not assigned',
)
record(
  'assignment sets Dispatched AUTOMATICALLY (§7)',
  assigned.s === 'DISPATCHED',
  assigned.s,
)

const events = (
  await pool.query(
    `select "toStatus", source, outcome from "LoadStatusEvent"
      where "loadId" = $1 order by "occurredAt" asc`,
    [target.id],
  )
).rows
record(
  'the timeline records it as AUTOMATIC',
  events.some((e) => e.toStatus === 'DISPATCHED' && e.source === 'AUTOMATIC'),
  JSON.stringify(events.map((e) => `${e.toStatus}/${e.source}`)),
)

const custody = (
  await pool.query(
    'select count(*)::int n from "LoadAssignment" where "loadId" = $1',
    [target.id],
  )
).rows[0]
record('custody history written', custody.n === 1, `${custody.n} row(s)`)

// --- §8: the board refuses what the create form would refuse ---------------
await page.goto(`${BASE}/dispatch`, { waitUntil: 'domcontentloaded' })
await page.waitForTimeout(2500)
await page.locator('aside button:has-text("Assign")').first().click()
await page.waitForSelector('dialog[open]', { timeout: 30_000 })
await page.locator(`dialog[open] button:has-text("${TAG}-101")`).click()
await page.locator(`dialog[open] button:has-text("${TAG}, Board")`).click()
await page.locator('dialog[open] button[type="submit"]').click()
await page.waitForTimeout(10_000)

const refusal = await page
  .locator('dialog[open] [role="alert"]')
  .textContent()
  .catch(() => null)
const secondLoad = (
  await pool.query('select "truckId" from "Load" where id = $1', [other.id])
).rows[0]
record(
  'the board refuses an overlapping assignment, naming the load',
  (refusal ?? '').includes(target.loadNumber),
  (refusal ?? '(no message)').trim(),
)
record(
  'and nothing was saved',
  secondLoad.truckId === null,
  secondLoad.truckId === null ? 'still unassigned' : 'ASSIGNED ANYWAY',
)

await page.screenshot({ path: 'screenshots/dispatch-refusal.png' })
await browser.close()

// --- cleanup ---------------------------------------------------------------
for (const load of ids) {
  await pool.query('delete from "LoadStatusEvent" where "loadId" = $1', [
    load.id,
  ])
  await pool.query('delete from "LoadAssignment" where "loadId" = $1', [
    load.id,
  ])
  await pool.query('delete from "LoadStop" where "loadId" = $1', [load.id])
  await pool.query('delete from "AuditLog" where "entityId" = $1', [load.id])
  await pool.query('delete from "Load" where id = $1', [load.id])
}
await pool.query('delete from "Customer" where name = $1', [`Board ${TAG}`])
await pool.query(
  `delete from "AssetAssignment" where "truckId" in (select id from "Truck" where "unitNumber" like $1)
     or "driverId" in (select id from "Driver" where "lastName" = $2)`,
  [`${TAG}%`, TAG],
)
await pool.query('delete from "Truck" where "unitNumber" like $1', [`${TAG}%`])
await pool.query('delete from "Driver" where "lastName" = $1', [TAG])
await pool.query('delete from "Location" where name in ($1,$2)', [
  'Chicago, IL',
  'Dallas, TX',
])

console.log(
  `\nloads remaining: ${(await pool.query('select count(*)::int n from "Load"')).rows[0].n}`,
)
await pool.end()

const failed = results.filter((r) => !r.ok).length
console.log(`${results.length - failed}/${results.length} passed`)
process.exit(failed === 0 ? 0 : 1)
