// ---------------------------------------------------------------------------
// Rows that exist only long enough to be photographed.
//
// §12: real reference data only, and no fake brokers or loads left behind.
// "If test rows are needed for screenshots, they are created through the UI
// and deleted." So this creates them through the UI, runs the screenshot pass,
// and deletes them — printing the row counts either side, because the first
// walkthrough script crashed before its cleanup and left two trucks sitting in
// the dev database until a screenshot caught them.
//
//   SHOT_CHROME=... node -r dotenv/config scripts/screenshot-fixtures.mjs
// ---------------------------------------------------------------------------

import { chromium } from 'playwright'
import { neonConfig, Pool } from '@neondatabase/serverless'
import { spawnSync } from 'node:child_process'

const BASE =
  process.env.SHOT_BASE ?? 'https://zebra-dev.tajikcargollc.workers.dev'
const MARK = 'SHOT'

neonConfig.webSocketConstructor ??= WebSocket
neonConfig.poolQueryViaFetch = false
const pool = new Pool({ connectionString: process.env.DIRECT_DATABASE_URL })

const counts = async () => {
  const { rows } = await pool.query(`
    select (select count(*) from "Load") loads,
           (select count(*) from "Truck") trucks,
           (select count(*) from "Trailer") trailers,
           (select count(*) from "Driver") drivers,
           (select count(*) from "Customer") brokers,
           (select count(*) from "AssetAssignment") periods`)
  return JSON.stringify(rows[0])
}

async function cleanup() {
  // Loads first: they point at the trucks, drivers and brokers below.
  const { rows: shotLoads } = await pool.query(
    `select id from "Load"
      where "customerId" in (select id from "Customer" where name like $1)`,
    [`${MARK}%`],
  )
  for (const load of shotLoads) {
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
  // The places those loads created on the way past. Named after real cities,
  // so they are matched by name and only the ones this script typed.
  await pool.query('delete from "Location" where name = any($1)', [
    [
      'Chicago, IL',
      'Dallas, TX',
      'Seattle, WA',
      'Boise, ID',
      'Memphis, TN',
      'Atlanta, GA',
      'Laredo, TX',
      'Phoenix, AZ',
    ],
  ])
  await pool.query(
    `delete from "AssetAssignment"
      where "truckId" in (select id from "Truck" where "unitNumber" like $1)
         or "trailerId" in (select id from "Trailer" where "unitNumber" like $1)
         or "driverId" in (select id from "Driver" where "lastName" like $1)`,
    [`${MARK}%`],
  )
  await pool.query('delete from "Truck" where "unitNumber" like $1', [
    `${MARK}%`,
  ])
  await pool.query('delete from "Trailer" where "unitNumber" like $1', [
    `${MARK}%`,
  ])
  await pool.query('delete from "Driver" where "lastName" like $1', [
    `${MARK}%`,
  ])
  await pool.query('delete from "Customer" where name like $1', [`${MARK}%`])
  await pool.query(
    'delete from "AssetAssignment" where "truckId" is null and "trailerId" is null and "driverId" is null',
  )
}

console.log('before:', await counts())

const browser = await chromium.launch(
  process.env.SHOT_CHROME ? { executablePath: process.env.SHOT_CHROME } : {},
)

try {
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
  const save = async (list) =>
    Promise.all([
      page.waitForURL(new RegExp(`${list}(\\?|$)`), { timeout: 60_000 }),
      page.click(`${form} button[type="submit"]`),
    ])

  // Enough rows to judge density, alignment and the status vocabulary — the
  // things these screenshots are evidence for. Plausible but obviously not
  // real: nobody should mistake SHOT-101 for a truck.
  const TRUCKS = [
    [
      'SHOT-101',
      'Freightliner',
      'Cascadia',
      '2022',
      'WA',
      '412000',
      'AVAILABLE',
    ],
    ['SHOT-102', 'Peterbilt', '579', '2021', 'IL', '288400', 'DISPATCHED'],
    ['SHOT-103', 'Kenworth', 'T680', '2019', 'TX', '640150', 'MAINTENANCE'],
    ['SHOT-104', 'Volvo', 'VNL 860', '2023', 'WA', '96200', 'OUT_OF_SERVICE'],
  ]
  for (const [unit, make, model, year, state, odo, status] of TRUCKS) {
    await page.goto(`${BASE}/trucks/new`, { waitUntil: 'domcontentloaded' })
    await page.fill('input[name="unitNumber"]', unit)
    await page.fill('input[name="make"]', make)
    await page.fill('input[name="model"]', model)
    await page.fill('input[name="year"]', year)
    await page.fill('input[name="plateState"]', state)
    await page.fill('input[name="currentOdometer"]', odo)
    await page.selectOption('select[name="status"]', status)
    await save('/trucks')
  }

  const BROKERS = [
    [
      'SHOT Landstar Ranger',
      'MC-107012',
      'Jacksonville',
      'FL',
      '30',
      'ACTIVE',
      '',
    ],
    ['SHOT TQL', 'MC-425326', 'Cincinnati', 'OH', '30', 'ACTIVE', ''],
    [
      'SHOT Coyote Logistics',
      'MC-561433',
      'Chicago',
      'IL',
      '45',
      'ON_HOLD',
      'Two invoices past 60 days',
    ],
    [
      'SHOT Meridian Freight',
      'MC-889201',
      'Dallas',
      'TX',
      '30',
      'BLOCKED',
      'Ninety days past due on four invoices',
    ],
  ]
  for (const [name, mc, city, state, terms, status, reason] of BROKERS) {
    await page.goto(`${BASE}/brokers/new`, { waitUntil: 'domcontentloaded' })
    await page.fill('input[name="name"]', name)
    await page.fill('input[name="mcNumber"]', mc)
    await page.fill('input[name="city"]', city)
    await page.fill('input[name="state"]', state)
    await page.fill('input[name="paymentTermsDays"]', terms)
    await page.selectOption('select[name="status"]', status)
    if (reason) await page.fill('input[name="blockedReason"]', reason)
    await save('/brokers')
  }

  // Drivers and loads, so the dispatch board is a board and not an empty
  // grid. §11's claims are about rows, columns and a leading rail, and a
  // screenshot of nothing is evidence of nothing.
  const DRIVERS = [
    ['Marcus', 'SHOT Webb'],
    ['Aliyah', 'SHOT Novak'],
    ['Tomas', 'SHOT Ivanov'],
  ]
  for (const [firstName, lastName] of DRIVERS) {
    await page.goto(`${BASE}/drivers/new`, { waitUntil: 'domcontentloaded' })
    await page.fill('input[name="firstName"]', firstName)
    await page.fill('input[name="lastName"]', lastName)
    await save('/drivers')
  }

  const today = new Date()
  const day = (offset) => {
    const date = new Date(today)
    date.setDate(date.getDate() + offset)
    return `${String(date.getMonth() + 1).padStart(2, '0')}${String(date.getDate()).padStart(2, '0')}`
  }

  // Two assigned at booking (so truck rows have cells), two left unassigned
  // (so the leading rail has something in it). Both halves are the point.
  const LOADS = [
    ['SHOT TQL', 'Chicago, IL', 'Dallas, TX', 1, 3, '285000', '968', 0],
    [
      'SHOT Landstar Ranger',
      'Seattle, WA',
      'Boise, ID',
      1,
      2,
      '192500',
      '498',
      1,
    ],
    [
      'SHOT Coyote Logistics',
      'Memphis, TN',
      'Atlanta, GA',
      2,
      3,
      '134000',
      '384',
      -1,
    ],
    // NOT Meridian Freight: that one is BLOCKED, and src/lib/loads.ts refuses
    // to book a load for a blocked broker. The first version of this fixture
    // used it and quietly produced three loads where it says four.
    ['SHOT TQL', 'Laredo, TX', 'Phoenix, AZ', 4, 5, '241000', '921', -1],
  ]
  for (const [
    broker,
    pickup,
    delivery,
    pickDay,
    dropDay,
    rate,
    miles,
    truckIndex,
  ] of LOADS) {
    await page.goto(`${BASE}/loads/new`, { waitUntil: 'domcontentloaded' })
    await page.fill('input[name="broker"]', broker)
    await page.fill('input[name="stops[0].place"]', pickup)
    await page.fill('input[name="stops[1].place"]', delivery)
    await page.fill('input[name="stops[0].date"]', day(pickDay))
    await page.fill('input[name="stops[1].date"]', day(dropDay))
    await page.fill('input[name="rate"]', rate)
    await page.fill('input[name="miles"]', miles)
    if (truckIndex >= 0) {
      const trucks = await page
        .locator('select[name="truckId"] option')
        .allTextContents()
      // A DIFFERENT truck per load: these two windows overlap, and §8 would
      // refuse the second — correctly — if they shared one.
      const unit = trucks.find((label) =>
        label.includes(`SHOT-10${truckIndex + 1}`),
      )
      if (unit)
        await page.selectOption('select[name="truckId"]', { label: unit })
      const drivers = await page
        .locator('select[name="driverId"] option')
        .allTextContents()
      const who = drivers.filter((label) => label.includes('SHOT'))[truckIndex]
      if (who)
        await page.selectOption('select[name="driverId"]', { label: who })
    }
    await page.click(`${form} button[type="submit"]`)
    await page.waitForTimeout(12_000)
  }

  await browser.close()

  console.log('with fixtures:', await counts())
  console.log('\n--- screenshots ---')
  const shot = spawnSync(
    process.execPath,
    ['-r', 'dotenv/config', 'scripts/screenshots.mjs'],
    { stdio: 'inherit', env: process.env },
  )
  if (shot.status !== 0) throw new Error('screenshot pass failed')
} finally {
  // Deleted whether the pass succeeded or threw. The rows are the point of
  // failure this script exists to avoid.
  if (browser.isConnected()) await browser.close()
  await cleanup()
  console.log('\nafter: ', await counts())
  await pool.end()
}
