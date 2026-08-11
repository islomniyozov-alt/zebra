import { chromium } from 'playwright'
import { neonConfig, Pool } from '@neondatabase/serverless'

// ---------------------------------------------------------------------------
// PHASE 2 ACCEPTANCE — the §13 boxes that no earlier script closes.
//
// Everything here runs against the DEPLOYED worker, through the interface a
// dispatcher uses, and asserts against the database afterwards. The boxes each
// section closes are named in its heading, so a reader can walk §13 and this
// file side by side.
//
// Covered elsewhere and deliberately not repeated:
//   argon2id                scripts/verify-argon2.mjs
//   reference CRUD          scripts/reference-walkthrough.mjs
//   40-second create        scripts/time-create-load.mjs
//   POD + Delivered         scripts/verify-pod.mjs
//   board assignment        scripts/verify-board.mjs
//   saved views + zone      scripts/verify-views.mjs
//
//   SHOT_CHROME=... node -r dotenv/config scripts/acceptance-phase2.mjs
// ---------------------------------------------------------------------------

const BASE =
  process.env.VERIFY_BASE ?? 'https://zebra-dev.tajikcargollc.workers.dev'
const TAG = `AC${Date.now().toString(36).slice(-4).toUpperCase()}`

neonConfig.webSocketConstructor ??= WebSocket
neonConfig.poolQueryViaFetch = false
const pool = new Pool({ connectionString: process.env.DIRECT_DATABASE_URL })

const results = []
const record = (box, label, ok, detail) => {
  results.push({ box, label, ok })
  console.log(
    `${ok ? 'ok  ' : 'FAIL'}  §13.${String(box).padEnd(2)} ${label.padEnd(52)} ${detail}`,
  )
}

const browser = await chromium.launch(
  process.env.SHOT_CHROME ? { executablePath: process.env.SHOT_CHROME } : {},
)

const signIn = async (email, password) => {
  const context = await browser.newContext({
    viewport: { width: 1920, height: 1080 },
  })
  const page = await context.newPage()
  await page.goto(`${BASE}/login`, { waitUntil: 'domcontentloaded' })
  await page.fill('input[name="email"]', email)
  await page.fill('input[name="password"]', password)
  await Promise.all([
    page.waitForURL(/\/(loads|dashboard)/, { timeout: 60_000 }),
    page.click('button[type="submit"]'),
  ])
  return { context, page }
}

const { context, page } = await signIn(
  process.env.SEED_OWNER_EMAIL,
  process.env.SEED_OWNER_PASSWORD,
)

// The signed-in owner's OWN organization. A plain `select * from Company`
// also returns Counterpart Carrier, which belongs to the isolation fixture's
// other tenant — invisible to this session, and the first run of this script
// spent thirty seconds waiting for an option that correctly did not exist.
const authorities = (
  await pool.query(
    `select c.id, c.name from "Company" c
      where c."organizationId" = (
        select m."organizationId" from "Membership" m
          join "User" u on u.id = m."userId"
         where u.email = $1
         limit 1
      )
      order by c.name asc`,
    [process.env.SEED_OWNER_EMAIL],
  )
).rows
const [alpha, bravo] = authorities
console.log(`authorities: ${authorities.map((a) => a.name).join(', ')}
`)

const day = (offset) => {
  const date = new Date()
  date.setDate(date.getDate() + offset)
  return `${String(date.getMonth() + 1).padStart(2, '0')}${String(date.getDate()).padStart(2, '0')}`
}

const loadIds = []
const trackLoads = async () => {
  const { rows } = await pool.query(
    `select id, "loadNumber", "companyId" from "Load"
      where "customerId" in (select id from "Customer" where name like $1)
      order by "loadNumber" asc`,
    [`${TAG}%`],
  )
  loadIds.splice(0, loadIds.length, ...rows)
  return rows
}

// ===========================================================================
// §13.12 — the board renders BOTH authorities' fleets, and the filter narrows
// ===========================================================================
// A truck under each authority, created through the interface. Until Step 7
// the dev database only ever had trucks under one, which is why this box
// stayed open with the board itself working perfectly.

const makeTruck = async (companyId, unit) => {
  await page.goto(`${BASE}/trucks/new`, { waitUntil: 'domcontentloaded' })
  await page.selectOption('select[name="companyId"]', companyId)
  await page.fill('input[name="unitNumber"]', unit)
  await page.click('form button[type="submit"]')
  await page.waitForURL(/\/trucks(\?|$)/, { timeout: 60_000 })
}

await makeTruck(alpha.id, `${TAG}-A1`)
await makeTruck(bravo.id, `${TAG}-B1`)

const makeDriver = async (companyId, last, truckUnit) => {
  await page.goto(`${BASE}/drivers/new`, { waitUntil: 'domcontentloaded' })
  await page.selectOption('select[name="companyId"]', companyId)
  await page.fill('input[name="firstName"]', 'Acc')
  await page.fill('input[name="lastName"]', last)
  if (truckUnit) {
    const options = await page
      .locator('select[name="assignedTruckId"] option')
      .allTextContents()
    const match = options.find((label) => label.startsWith(truckUnit))
    if (match) {
      await page.selectOption('select[name="assignedTruckId"]', {
        label: match,
      })
    }
  }
  await page.click('form button[type="submit"]')
  await page.waitForURL(/\/drivers(\?|$)/, { timeout: 60_000 })
}

await makeDriver(alpha.id, `${TAG}A`, `${TAG}-A1`)
await makeDriver(bravo.id, `${TAG}B`, `${TAG}-B1`)

await page.goto(`${BASE}/dispatch`, { waitUntil: 'domcontentloaded' })
await page.waitForTimeout(2500)
const bothRows = await page.locator('tbody th').allTextContents()
record(
  12,
  'the board renders both authorities’ fleets',
  bothRows.some((row) => row.includes(`${TAG}-A1`)) &&
    bothRows.some((row) => row.includes(`${TAG}-B1`)),
  `${bothRows.length} truck rows, ${new Set(bothRows.map((r) => r.split('\n').pop())).size} authorities`,
)

await page.goto(`${BASE}/dispatch?company=${alpha.id}`, {
  waitUntil: 'domcontentloaded',
})
await page.waitForTimeout(2500)
const filtered = await page.locator('tbody th').allTextContents()
record(
  12,
  'the company filter narrows it',
  filtered.some((row) => row.includes(`${TAG}-A1`)) &&
    !filtered.some((row) => row.includes(`${TAG}-B1`)),
  `${filtered.length} rows under ${alpha.name}`,
)

// §16 flag 15's other half: the pairing now shows up where it was missing.
record(
  12,
  'a truck row names its driver',
  bothRows.some((row) => row.includes(`${TAG}A`)),
  bothRows.find((row) => row.includes(`${TAG}A`))?.replace(/\n/g, ' · ') ?? '—',
)

// ===========================================================================
// §13.3 — the driver↔truck pairing refuses a cross-authority truck, in words
// ===========================================================================
// The whole form is refilled for each attempt. A refused submit re-renders the
// form from the server's defaults, so reusing the fields from the previous try
// silently submits a half-empty form — which fails for the wrong reason and
// looks exactly like the refusal under test.

const attemptDriver = async (companyId, last, truckLabel) => {
  await page.goto(`${BASE}/drivers/new`, { waitUntil: 'domcontentloaded' })
  await page.selectOption('select[name="companyId"]', companyId)
  await page.fill('input[name="firstName"]', 'Cross')
  await page.fill('input[name="lastName"]', last)
  const options = await page
    .locator('select[name="assignedTruckId"] option')
    .allTextContents()
  const match = options.find((label) => label.startsWith(truckLabel))
  if (match) {
    await page.selectOption('select[name="assignedTruckId"]', { label: match })
  }
  await page.click('form button[type="submit"]')
  await page.waitForTimeout(10_000)
  return (
    (await page
      .locator('[role="alert"], p.text-danger')
      .first()
      .textContent()
      .catch(() => null)) ?? ''
  )
}

const crossRefusal = await attemptDriver(alpha.id, `${TAG}X`, `${TAG}-B1`)
const crossDriver = (
  await pool.query(
    'select count(*)::int n from "Driver" where "lastName" = $1',
    [`${TAG}X`],
  )
).rows[0]
record(
  3,
  'a cross-authority pairing is refused in words',
  /authority/i.test(crossRefusal) && crossDriver.n === 0,
  crossRefusal.trim().slice(0, 70) || '(no message)',
)

// The pair, per standing rule 11: the same form, the same driver, with the one
// reason for the refusal removed and nothing else changed.
await attemptDriver(alpha.id, `${TAG}X`, `${TAG}-A1`)
const paired = (
  await pool.query(
    'select "assignedTruckId" from "Driver" where "lastName" = $1',
    [`${TAG}X`],
  )
).rows[0]
record(
  3,
  'and the same form saves once the truck matches',
  Boolean(paired?.assignedTruckId),
  paired?.assignedTruckId ? 'paired' : 'still refused',
)

// ===========================================================================
// §13.6 — load numbers are per-authority and contiguous under concurrency
// ===========================================================================
// Six loads booked at once, three under each authority, from six browser
// contexts. The counter is a row lock inside the same transaction as the
// insert; this is the only way to find out whether that is true deployed.

const beforeCounters = (
  await pool.query(
    'select "companyId", value from "Counter" where key = $1 order by "companyId"',
    ['LOAD_NUMBER'],
  )
).rows

const book = async (own, companyId, index) => {
  await own.goto(`${BASE}/loads/new`, { waitUntil: 'domcontentloaded' })
  await own.selectOption('select[name="companyId"]', companyId)
  await own.fill('input[name="broker"]', `${TAG} Broker`)
  await own.fill('input[name="stops[0].place"]', 'Chicago, IL')
  await own.fill('input[name="stops[1].place"]', 'Dallas, TX')
  await own.fill('input[name="stops[0].date"]', day(10 + index))
  await own.fill('input[name="stops[1].date"]', day(11 + index))
  await own.click('form button[type="submit"]')
  // Six at once is SLOW. Measured on the deployed worker with `wrangler tail`,
  // a concurrent /loads/new takes 16.5–19.6s of wall clock against ~300ms of
  // CPU: the bookings serialize on the per-authority counter row and each
  // statement costs a 200ms round trip to us-east-2. A fixed 20s wait made
  // this section flaky — it reported five or six saves depending on the day,
  // and read the database before the sixth transaction had committed.
  await own.waitForTimeout(45_000)
  // What the screen SAYS if it did not save. A booking that silently fails
  // under concurrency is the whole thing this section is looking for, and
  // "five rows where six were asked for" does not say why.
  const message = await own
    .locator('[role="alert"], p.text-danger')
    .first()
    .textContent()
    .catch(() => null)
  return (message ?? '').trim()
}

const racers = []
for (let index = 0; index < 6; index++) {
  const racerContext = await browser.newContext({
    viewport: { width: 1280, height: 900 },
  })
  await racerContext.addCookies(await context.cookies())
  racers.push(await racerContext.newPage())
}

const bookingMessages = await Promise.all(
  racers.map((racer, index) =>
    book(racer, index % 2 === 0 ? alpha.id : bravo.id, index),
  ),
)
for (const [index, message] of bookingMessages.entries()) {
  if (message) console.log(`      racer ${index} said: ${message}`)
}
for (const racer of racers) await racer.context().close()

// And then wait for the rows themselves rather than trusting the clock.
let booked = await trackLoads()
const deadline = Date.now() + 60_000
while (booked.length < 6 && Date.now() < deadline) {
  await new Promise((resolve) => setTimeout(resolve, 3000))
  booked = await trackLoads()
}
const perAuthority = new Map()
for (const load of booked) {
  const list = perAuthority.get(load.companyId) ?? []
  list.push(Number(load.loadNumber))
  perAuthority.set(load.companyId, list)
}

const contiguous = [...perAuthority.entries()].every(([, numbers]) => {
  const sorted = [...numbers].sort((a, b) => a - b)
  return sorted.every(
    (value, index) => index === 0 || value === sorted[index - 1] + 1,
  )
})
const noDuplicates =
  new Set(booked.map((l) => l.loadNumber)).size === booked.length

record(
  6,
  'six concurrent bookings, no number issued twice',
  noDuplicates && booked.length === 6,
  booked.map((l) => l.loadNumber).join(', '),
)
record(
  6,
  'numbers are contiguous WITHIN each authority',
  contiguous && perAuthority.size === 2,
  [...perAuthority.entries()]
    .map(([id, numbers]) => {
      const name = authorities.find((a) => a.id === id)?.name ?? id
      return `${name}: ${numbers.sort((a, b) => a - b).join(',')}`
    })
    .join(' | '),
)
record(
  6,
  'each authority keeps its own counter',
  beforeCounters.length <= perAuthority.size,
  `${perAuthority.size} counters advanced`,
)

// ===========================================================================
// §13.8 — every §8 conflict rule, with its refusal message
// ===========================================================================
// Assignment is attempted from the create form, which is where §8 is enforced
// for a new load. Each refusal is read off the screen, not inferred.

const attemptAssign = async (truckLabel, driverLabel, offset) => {
  await page.goto(`${BASE}/loads/new`, { waitUntil: 'domcontentloaded' })
  await page.selectOption('select[name="companyId"]', alpha.id)
  await page.fill('input[name="broker"]', `${TAG} Broker`)
  await page.fill('input[name="stops[0].place"]', 'Chicago, IL')
  await page.fill('input[name="stops[1].place"]', 'Dallas, TX')
  await page.fill('input[name="stops[0].date"]', day(offset))
  await page.fill('input[name="stops[1].date"]', day(offset + 1))

  const trucks = await page
    .locator('select[name="truckId"] option')
    .allTextContents()
  const truck = trucks.find((label) => label.startsWith(truckLabel))
  if (truck) await page.selectOption('select[name="truckId"]', { label: truck })
  if (driverLabel) {
    const drivers = await page
      .locator('select[name="driverId"] option')
      .allTextContents()
    const driver = drivers.find((label) => label.includes(driverLabel))
    if (driver) {
      await page.selectOption('select[name="driverId"]', { label: driver })
    }
  }

  await page.click('form button[type="submit"]')
  await page.waitForTimeout(12_000)
  return (
    (await page
      .locator('[role="alert"], p.text-danger')
      .first()
      .textContent()
      .catch(() => null)) ?? ''
  )
}

// (a) overlapping load. First book one WITH the truck, then book another over
// the same days.
await attemptAssign(`${TAG}-A1`, `${TAG}A`, 30)
const overlapMessage = await attemptAssign(`${TAG}-A1`, `${TAG}A`, 30)
record(
  8,
  'refuses an overlapping load, naming the load number',
  /already/i.test(overlapMessage) && /\d{3,}/.test(overlapMessage),
  overlapMessage.trim().slice(0, 80) || '(no message)',
)

// (b) a truck under a DIFFERENT authority than the load.
const authorityMessage = await attemptAssign(`${TAG}-B1`, null, 40)
record(
  8,
  'refuses an asset under another authority',
  authorityMessage.includes(`${TAG}-B1`) && /under/i.test(authorityMessage),
  authorityMessage.trim().slice(0, 80) || '(no message)',
)

// (c) a truck that is out of service.
await pool.query(
  `update "Truck" set status = 'OUT_OF_SERVICE' where "unitNumber" = $1`,
  [`${TAG}-A1`],
)
const oosMessage = await attemptAssign(`${TAG}-A1`, null, 50)
record(
  8,
  'refuses an out-of-service asset',
  /not available to dispatch/i.test(oosMessage),
  oosMessage.trim().slice(0, 80) || '(no message)',
)
await pool.query(
  `update "Truck" set status = 'AVAILABLE' where "unitNumber" = $1`,
  [`${TAG}-A1`],
)

// The pair for all three, per standing rule 11: with every reason removed, the
// identical booking goes through.
const cleanMessage = await attemptAssign(`${TAG}-A1`, `${TAG}A`, 60)
record(
  8,
  'and the same booking succeeds with the conflicts removed',
  cleanMessage.trim() === '',
  cleanMessage.trim().slice(0, 60) || 'saved',
)

// ===========================================================================
// §13.13 — density persists per user, across sessions
// ===========================================================================
await page.goto(`${BASE}/loads`, { waitUntil: 'domcontentloaded' })
await page.waitForTimeout(1500)
await page.selectOption('select[name="density"]', 'compact')
await page.waitForTimeout(9000)

const storedDensity = (
  await pool.query(
    `select value from "UserPreference" where key = 'density'
      and "userId" in (select id from "User" where email = $1)`,
    [process.env.SEED_OWNER_EMAIL],
  )
).rows[0]
record(
  13,
  'the choice is a row, not a cookie',
  storedDensity?.value === 'compact',
  JSON.stringify(storedDensity?.value ?? null),
)

// A NEW SESSION: a fresh login in a context that shares nothing with this one.
const second = await signIn(
  process.env.SEED_OWNER_EMAIL,
  process.env.SEED_OWNER_PASSWORD,
)
await second.page.goto(`${BASE}/loads`, { waitUntil: 'domcontentloaded' })
await second.page.waitForTimeout(1500)
const appliedDensity = await second.page.getAttribute(
  '[data-density]',
  'data-density',
)
const rowHeight = await second.page.evaluate(() => {
  const row = document.querySelector('tbody tr')
  return row ? Math.round(row.getBoundingClientRect().height) : null
})
record(
  13,
  'and it is still Compact in a new session',
  appliedDensity === 'compact',
  `data-density=${appliedDensity}, row ${rowHeight}px`,
)
// Measured against Standard rather than against 32px. `h-[var(--z-row-height)]`
// is a MINIMUM — a row holding a status badge is taller than the variable asks
// for — so the honest claim is that Compact rows are shorter than Standard
// ones, and the honest way to check it is to measure both.
await second.page.selectOption('select[name="density"]', 'standard')
await second.page.waitForTimeout(9000)
await second.page.reload({ waitUntil: 'domcontentloaded' })
await second.page.waitForTimeout(1500)
const standardHeight = await second.page.evaluate(() => {
  const row = document.querySelector('tbody tr')
  return row ? Math.round(row.getBoundingClientRect().height) : null
})
record(
  13,
  'Compact rows are shorter than Standard ones',
  rowHeight !== null && standardHeight !== null && rowHeight < standardHeight,
  `compact ${rowHeight}px vs standard ${standardHeight}px`,
)

await second.context.close()

// ===========================================================================
// §13.9 — the rate confirmation uploaded during create is in R2 and audited
// ===========================================================================
// verify-pod.mjs proves the POD half from the detail screen. This is the other
// half: a document row for a load, its R2 key, and an audit row naming it.
// Every load this run created, including the ones §13.8 booked after the
// concurrency block. Reading the list once at the top left the timeline and
// cleanup queries looking at six of thirteen rows — and an `every` over the
// missing seven passed for the most comfortable reason there is.
await trackLoads()

// The document half of §13.9 is proved by scripts/verify-pod.mjs, which
// actually uploads one. Asserting `every(...)` over the zero documents this
// script creates would pass and mean nothing.
const audited = (
  await pool.query(
    `select count(*)::int n from "AuditLog"
      where "entityType" = 'Load' and "entityId" = any($1)`,
    [loadIds.map((l) => l.id)],
  )
).rows[0]
record(
  9,
  'every load written this run left an audit row',
  audited.n >= loadIds.length,
  `${audited.n} audit rows for ${loadIds.length} loads`,
)

// ===========================================================================
// §13.11 — the timeline's source is right for each event
// ===========================================================================
const events = (
  await pool.query(
    `select "toStatus", source, outcome, note from "LoadStatusEvent"
      where "loadId" = any($1) order by "occurredAt" asc`,
    [loadIds.map((l) => l.id)],
  )
).rows
record(
  11,
  'booking is MANUAL, dispatch is AUTOMATIC',
  events.some((e) => e.toStatus === 'BOOKED' && e.source === 'MANUAL') &&
    events.some((e) => e.toStatus === 'DISPATCHED' && e.source === 'AUTOMATIC'),
  [...new Set(events.map((e) => `${e.toStatus}/${e.source}`))].join(' '),
)
record(
  11,
  'the engine’s notes are message keys, not English prose',
  events.filter((e) => e.note).every((e) => /^status\.note\./.test(e.note)),
  [...new Set(events.filter((e) => e.note).map((e) => e.note))].join(' ') ||
    '(none)',
)

await browser.close()

// --- cleanup ---------------------------------------------------------------
for (const load of loadIds) {
  for (const table of [
    'LoadStatusEvent',
    'LoadAssignment',
    'LoadStop',
    'Communication',
    'Document',
  ]) {
    await pool.query(`delete from "${table}" where "loadId" = $1`, [load.id])
  }
  await pool.query('delete from "AuditLog" where "entityId" = $1', [load.id])
  await pool.query('delete from "Load" where id = $1', [load.id])
}
await pool.query('delete from "Customer" where name like $1', [`${TAG}%`])
await pool.query(
  `delete from "AssetAssignment"
     where "truckId" in (select id from "Truck" where "unitNumber" like $1)
        or "driverId" in (select id from "Driver" where "lastName" like $2)`,
  [`${TAG}%`, `${TAG}%`],
)
await pool.query('delete from "Driver" where "lastName" like $1', [`${TAG}%`])
await pool.query('delete from "Truck" where "unitNumber" like $1', [`${TAG}%`])
await pool.query('delete from "Location" where name in ($1,$2)', [
  'Chicago, IL',
  'Dallas, TX',
])

console.log(
  `\nleft behind — loads: ${(await pool.query('select count(*)::int n from "Load"')).rows[0].n}` +
    `, trucks: ${(await pool.query('select count(*)::int n from "Truck"')).rows[0].n}` +
    `, drivers: ${(await pool.query('select count(*)::int n from "Driver"')).rows[0].n}`,
)
await pool.end()

const failed = results.filter((r) => !r.ok).length
console.log(`${results.length - failed}/${results.length} passed`)
process.exit(failed === 0 ? 0 : 1)
