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
    select (select count(*) from "Truck") trucks,
           (select count(*) from "Trailer") trailers,
           (select count(*) from "Driver") drivers,
           (select count(*) from "Customer") brokers,
           (select count(*) from "AssetAssignment") periods`)
  return JSON.stringify(rows[0])
}

async function cleanup() {
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
    page.waitForURL(/\/loads/, { timeout: 60_000 }),
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
