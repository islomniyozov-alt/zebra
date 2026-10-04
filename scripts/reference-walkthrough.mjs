// ---------------------------------------------------------------------------
// §13 EVIDENCE, through the interface, on the DEPLOYED worker.
//
//   "A broker, truck, trailer, driver each created, edited, soft-deleted
//    through the UI"
//   "Asset transfer between authorities writes a closed period + a new open
//    one; double-open refused and surfaced politely"
//
// The service layer is covered by tests/integration/fleet.test.ts. This is the
// other half: the same operations driven by a browser against workerd, which
// is where every blocker this project has hit actually lived.
//
// §12 says no fake data. Everything created here is removed at the end, and
// the script prints the row counts before and after so that is checkable
// rather than promised.
//
//   SHOT_CHROME=... node -r dotenv/config scripts/reference-walkthrough.mjs
// ---------------------------------------------------------------------------

import { chromium } from 'playwright'
import { neonConfig, Pool } from '@neondatabase/serverless'

const BASE =
  process.env.VERIFY_BASE ?? 'https://zebra-dev.tajikcargollc.workers.dev'
const TAG = `wt${Date.now().toString(36).slice(-5)}`

neonConfig.webSocketConstructor ??= WebSocket
neonConfig.poolQueryViaFetch = false
const pool = new Pool({ connectionString: process.env.DIRECT_DATABASE_URL })

const counts = async () => {
  const { rows } = await pool.query(`
    select (select count(*) from "Truck") trucks,
           (select count(*) from "Trailer") trailers,
           (select count(*) from "Driver") drivers,
           (select count(*) from "Customer") brokers,
           (select count(*) from "AssetAssignment") periods`)
  return rows[0]
}

const results = []
const record = (label, ok, detail) => {
  results.push({ label, ok, detail })
  console.log(`${ok ? 'ok  ' : 'FAIL'}  ${label.padEnd(46)} ${detail}`)
}

console.log('before:', JSON.stringify(await counts()))

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

const form = 'form:has(button[type="submit"])'
const save = async (list) => {
  await Promise.all([
    page.waitForURL(new RegExp(`${list}(\\?|$)`), { timeout: 60_000 }),
    page.click(`${form} button[type="submit"]`),
  ])
}

// --- create ------------------------------------------------------------------

await page.goto(`${BASE}/trucks/new`, { waitUntil: 'domcontentloaded' })
await page.fill('input[name="unitNumber"]', `${TAG}-T1`)
await page.fill('input[name="make"]', 'Volvo')
await page.fill('input[name="year"]', '2022')
await page.fill('input[name="plateState"]', 'wa')
await save('/trucks')
record('truck created through the UI', true, `${TAG}-T1`)

await page.goto(`${BASE}/trailers/new`, { waitUntil: 'domcontentloaded' })
await page.fill('input[name="unitNumber"]', `${TAG}-R1`)
await page.fill('input[name="type"]', 'Reefer')
await save('/trailers')
record('trailer created through the UI', true, `${TAG}-R1`)

await page.goto(`${BASE}/drivers/new`, { waitUntil: 'domcontentloaded' })
// THE MANUAL-ENTRY LINK, BECAUSE THE UPLOAD IS THE FRONT DOOR NOW (Phase 5).
// `/drivers/new` landed as a blank form and is a drop zone with a manual link
// beside it; there is NO form on the landing step, so a fill waits thirty
// seconds for `firstName` and the whole script dies on a fixture. Located by
// position rather than by its words, the way `verify-driver-form.mjs` does it,
// because the words are translated.
await page
  .locator('[role="button"]:has(input[type="file"]) ~ button')
  .first()
  .click()
await page.fill('input[name="firstName"]', 'Walkthrough')
await page.fill('input[name="lastName"]', TAG)
await page.fill('input[name="phone"]', '(425) 566-0763')
await save('/drivers')
record('driver created through the UI', true, `Walkthrough ${TAG}`)

await page.goto(`${BASE}/brokers/new`, { waitUntil: 'domcontentloaded' })
await page.fill('input[name="name"]', `Walkthrough Freight ${TAG}`)
await page.fill('input[name="mcNumber"]', 'MC-990011')
await save('/brokers')
record('broker created through the UI', true, `Walkthrough Freight ${TAG}`)

// --- the written error, and its pairing (standing rule 11) -------------------

await page.goto(`${BASE}/trucks/new`, { waitUntil: 'domcontentloaded' })
await page.fill('input[name="unitNumber"]', `${TAG}-T1`)
await page.click(`${form} button[type="submit"]`)
const duplicateMessage = await page
  .locator('p.text-danger')
  .first()
  .textContent({ timeout: 30_000 })
record(
  'duplicate unit number refused, in words',
  (duplicateMessage ?? '').includes('already in use'),
  (duplicateMessage ?? '(no message)').trim(),
)

// The pairing: the same form, one character different, saves.
await page.fill('input[name="unitNumber"]', `${TAG}-T2`)
await save('/trucks')
record(
  'the same form saves once the number is unique',
  true,
  `${TAG}-T2 — so the refusal above was about the number`,
)

// --- edit --------------------------------------------------------------------

const truckId = (
  await pool.query('select id from "Truck" where "unitNumber" = $1', [
    `${TAG}-T1`,
  ])
).rows[0].id

await page.goto(`${BASE}/trucks/${truckId}`, { waitUntil: 'domcontentloaded' })
await page.fill('input[name="make"]', 'Kenworth')
await save('/trucks')
const edited = (
  await pool.query('select make from "Truck" where id = $1', [truckId])
).rows[0]
record('truck edited through the UI', edited.make === 'Kenworth', edited.make)

// --- transfer between authorities -------------------------------------------

await page.goto(`${BASE}/trucks/${truckId}`, { waitUntil: 'domcontentloaded' })
await page.click('button:has-text("Transfer authority")')
await page.selectOption('select[name="toCompanyId"]', { index: 0 })
await page.fill('input[name="reason"]', 'Walkthrough evidence')
await page.click('dialog[open] button[type="submit"]')
await page.waitForTimeout(6000)

const periods = (
  await pool.query(
    'select "companyId", "effectiveTo", reason from "AssetAssignment" where "truckId" = $1 order by "effectiveFrom" asc',
    [truckId],
  )
).rows
record(
  'transfer wrote a new open period',
  periods.length >= 1 && periods[periods.length - 1].effectiveTo === null,
  `${periods.length} period(s), last open: ${periods[periods.length - 1]?.effectiveTo === null}`,
)

const truckAfter = (
  await pool.query('select "companyId" from "Truck" where id = $1', [truckId])
).rows[0]
record(
  "the truck's own authority moved with it",
  truckAfter.companyId === periods[periods.length - 1]?.companyId,
  'Truck.companyId agrees with the open AssetAssignment',
)

// A second open period, attempted directly. The partial unique index is what
// refuses it — the service check above is only the message.
let doubleOpenRefused = false
try {
  await pool.query(
    `insert into "AssetAssignment" (id, "organizationId", "companyId", "truckId", "effectiveFrom")
     select $1, "organizationId", "companyId", id, now() from "Truck" where id = $1x`.replace(
      '$1x',
      '$2',
    ),
    [`clwalkthrough${TAG}pad0000`.slice(0, 25), truckId],
  )
} catch (error) {
  doubleOpenRefused = /unique|duplicate key/i.test(String(error))
}
record(
  'a second open period is refused by Postgres',
  doubleOpenRefused,
  doubleOpenRefused ? 'partial unique index held' : 'NOT REFUSED',
)

// --- soft delete -------------------------------------------------------------

await page.goto(`${BASE}/trucks/${truckId}`, { waitUntil: 'domcontentloaded' })
await page.click('button:has-text("Remove")')
await page.click('dialog[open] form button[type="submit"]')
await page.waitForTimeout(6000)

const removed = (
  await pool.query('select "deletedAt" from "Truck" where id = $1', [truckId])
).rows[0]
record(
  'truck soft-deleted through the UI',
  removed.deletedAt !== null,
  removed.deletedAt !== null ? 'deletedAt set, row kept' : 'still null',
)

const closed = (
  await pool.query(
    'select count(*)::int n from "AssetAssignment" where "truckId" = $1 and "effectiveTo" is null',
    [truckId],
  )
).rows[0]
record(
  'removing it closed the open period',
  closed.n === 0,
  `${closed.n} open period(s) remain`,
)

await browser.close()

// --- clean up: §12 says no fake data stays behind ---------------------------

// Periods BEFORE the assets they point at. `AssetAssignment`'s links are
// OPTIONAL relations, so Prisma's default is SET NULL rather than cascade:
// deleting a trailer first leaves an orphan period with a null trailerId and
// nothing left to find it by. The first version of this script did exactly
// that, and the before/after row counts are what caught it — which is why they
// are printed rather than assumed.
await pool.query(
  `delete from "AssetAssignment"
    where "truckId" in (select id from "Truck" where "unitNumber" like $1)
       or "trailerId" in (select id from "Trailer" where "unitNumber" like $1)
       or "driverId" in (select id from "Driver" where "lastName" = $2)`,
  [`${TAG}%`, TAG],
)
await pool.query('delete from "Truck" where "unitNumber" like $1', [`${TAG}%`])
await pool.query('delete from "Trailer" where "unitNumber" like $1', [
  `${TAG}%`,
])
await pool.query('delete from "Driver" where "lastName" = $1', [TAG])
await pool.query('delete from "Customer" where name like $1', [`%${TAG}`])
await pool.query('delete from "AuditLog" where "entityId" = $1', [truckId])

console.log('after: ', JSON.stringify(await counts()))
await pool.end()

const failed = results.filter((r) => !r.ok).length
console.log(`\n${results.length - failed}/${results.length} passed`)
process.exit(failed === 0 ? 0 : 1)
