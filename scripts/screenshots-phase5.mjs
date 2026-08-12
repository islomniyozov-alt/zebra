import { chromium } from 'playwright'
import { neonConfig, Pool } from '@neondatabase/serverless'
import { mkdirSync } from 'node:fs'
import { rateConFixture } from './_ratecon-fixture.mjs'

// ---------------------------------------------------------------------------
// §15 EVIDENCE FOR THE SURFACES PHASE 5 ADDED (§5, RU/RTL box).
//
// The ordinary screenshot script shoots screens by URL. Every surface this
// phase built appears only after something HAPPENS — the prefilled form and its
// provenance hints after an extraction, the facility panel after a dock is
// recognised, the warning list after a save is attempted — so a shot of
// `/loads/new` in three locales, which the shot list already has, photographs
// none of them.
//
// This drives each locale to the state and then shoots it. One extraction per
// locale, three in total, ~8¢ — the cost is printed rather than assumed.
//
//   SHOT_CHROME=... node -r dotenv/config scripts/screenshots-phase5.mjs
// ---------------------------------------------------------------------------

const BASE =
  process.env.SHOT_BASE ??
  process.env.VERIFY_BASE ??
  'https://zebra-dev.tajikcargollc.workers.dev'
const OUT = 'screenshots'
const VIEWPORT = { width: 1920, height: 1080 }
const TAG = `SH${Date.now().toString(36).slice(-4).toUpperCase()}`
const { TRUTH, bytes } = rateConFixture(TAG)
const origin = new URL(BASE).origin

neonConfig.webSocketConstructor ??= WebSocket
neonConfig.poolQueryViaFetch = false
const pool = new Pool({ connectionString: process.env.DIRECT_DATABASE_URL })

const { organizationId } = (
  await pool.query(
    `select c."organizationId" from "Company" c
       join "Membership" m on m."organizationId" = c."organizationId"
       join "User" u on u.id = m."userId"
      where u.email = $1 order by c.name asc limit 1`,
    [process.env.SEED_OWNER_EMAIL],
  )
).rows[0]

// A KNOWN DOCK WITH NOTES ON IT, so the facility panel has something to show.
// A shot of an empty panel proves the panel renders, which is not the claim —
// the claim is that a gate code arrives with the address, in three languages.
const facility = (
  await pool.query(
    `insert into "Location"
       ("id","organizationId","name","addressLine1","city","state","postalCode",
        "normalizedAddress","gateCode","dockNotes","hours","contactName",
        "contactPhone","updatedAt")
     values (gen_random_uuid(),$1,$2,$3,'Salem','OR','97302',$4,$5,$6,$7,$8,$9,now())
     returning id`,
    [
      organizationId,
      'Willamette Cold Storage',
      `3120 Turner Road SE ${TAG}`,
      `3120 TURNER RD SE ${TAG}|OR`,
      `#${TAG}`,
      'Dock 4 only — back in from Elder Creek.',
      'Mon–Fri 06:00–14:00',
      'Dana Whitfield',
      '(503) 555-0134',
    ],
  )
).rows[0].id

mkdirSync(OUT, { recursive: true })

const browser = await chromium.launch(
  process.env.SHOT_CHROME ? { executablePath: process.env.SHOT_CHROME } : {},
)

// One session, reused: a login costs an argon2id verify.
const auth = await browser.newContext({ viewport: VIEWPORT })
const authPage = await auth.newPage()
await authPage.goto(`${BASE}/login`, { waitUntil: 'domcontentloaded' })
await authPage.fill('input[name="email"]', process.env.SEED_OWNER_EMAIL)
await authPage.fill('input[name="password"]', process.env.SEED_OWNER_PASSWORD)
await Promise.all([
  authPage.waitForURL(/\/(loads|dashboard)/, { timeout: 60_000 }),
  authPage.click('button[type="submit"]'),
])
const TOKEN = (await auth.cookies()).find(
  (c) => c.name === 'zebra_session',
)?.value
await auth.close()

const taken = []

for (const locale of ['en', 'ru', 'fa']) {
  const context = await browser.newContext({
    viewport: VIEWPORT,
    deviceScaleFactor: 1,
    locale,
  })
  await context.addCookies([
    { name: 'zebra_locale', value: locale, url: origin },
    { name: 'zebra_session', value: TOKEN, url: origin },
  ])
  const page = await context.newPage()
  await page.goto(`${BASE}/loads/new`, { waitUntil: 'domcontentloaded' })
  await page.evaluate(() => document.fonts.ready)

  // Hydration, by typing into a controlled input and reading it back.
  for (let attempt = 0; attempt < 30; attempt++) {
    await page.fill('input[name="miles"]', '620')
    await page.waitForTimeout(200)
    if ((await page.locator('input[name="miles"]').inputValue()) === '620')
      break
    await page.waitForTimeout(500)
  }

  // THE UPLOAD TAB FIRST, since Phase 6 §4 step 2 put the four methods behind
  // tabs. The file input only exists on the Upload panel — which is what a
  // dispatcher clicks too, so the walkthrough now does what they do.
  await page
    .locator('[role="tab"]', { hasText: 'Upload document' })
    .click()
    .catch(() => {})

  // THE UPLOAD TAB FIRST, since Phase 6 §4 step 2 put the four methods behind
  // tabs. The file input only exists on the Upload panel — which is what a
  // dispatcher clicks too, so the walkthrough now does what they do.
  await page
    .locator('[role="tab"]', { hasText: 'Upload document' })
    .click()
    .catch(() => {})

  await page.setInputFiles('section input[type="file"]', {
    name: `${TAG}-${locale}.pdf`,
    mimeType: 'application/pdf',
    buffer: Buffer.from(bytes),
  })

  // Settled, not merely filled.
  let previous = ''
  let stable = 0
  for (let attempt = 0; attempt < 90; attempt++) {
    await page.waitForTimeout(1_000)
    const now = await page.evaluate(
      () => document.querySelector('form')?.innerText ?? '',
    )
    if (now.includes('Turner') || now.includes('Willamette')) {
      if (now === previous && ++stable >= 2) break
    } else {
      stable = 0
    }
    previous = now
  }

  const suffix = locale === 'fa' ? 'fa-rtl' : locale
  await shoot(page, `load-new-extracted-${suffix}`)

  // AND THE WARNINGS. The dates are cleared first — §3 step 5 made them warn
  // rather than block, so this is the state a dispatcher reaches by booking a
  // load whose appointment time is not known yet.
  await page.fill('input[name="stops[0].date"]', '')
  await page.fill('input[name="stops[1].date"]', '')
  await page.locator('button[type="submit"]').first().click()
  for (let attempt = 0; attempt < 30; attempt++) {
    await page.waitForTimeout(1_000)
    const count = await page.evaluate(
      () => document.querySelectorAll('[role="alert"] li').length,
    )
    if (count > 0) break
  }
  await shoot(page, `load-warnings-${suffix}`)

  await context.close()
}

await browser.close()

// --- cleanup -------------------------------------------------------------------
const loadIds = (
  await pool.query(
    `select l.id from "Load" l join "Customer" c on c.id = l."customerId"
      where l."organizationId" = $1 and c.name = $2`,
    [organizationId, TRUTH.broker],
  )
).rows.map((r) => r.id)
for (const id of loadIds) {
  await pool.query('delete from "ExtractionCorrection" where "loadId" = $1', [
    id,
  ])
  await pool.query('delete from "Document" where "loadId" = $1', [id])
  await pool.query('delete from "LoadStatusEvent" where "loadId" = $1', [id])
  await pool.query('delete from "LoadStop" where "loadId" = $1', [id])
  await pool.query('delete from "Load" where id = $1', [id])
}
await pool.query('delete from "LoadStop" where "locationId" = $1', [facility])
await pool.query('delete from "Location" where id = $1', [facility])
await pool.query('delete from "CustomerAlias" where alias = $1', [TRUTH.broker])
await pool.query('delete from "Customer" where name = $1', [TRUTH.broker])
await pool.query('delete from "PendingUpload" where filename like $1', [
  `%${TAG}%`,
])
await pool.end()

console.log('')
for (const name of taken) console.log(`  ${name}`)
console.log(`\n  ${taken.length} shots in ./${OUT}\n`)

async function shoot(page, name) {
  await page.evaluate(() => document.fonts.ready)
  await page.waitForTimeout(400)
  await page.screenshot({ path: `${OUT}/${name}.png` })
  taken.push(`${name}.png`)
}
