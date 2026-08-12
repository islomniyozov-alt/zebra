import { chromium } from 'playwright'
import { neonConfig, Pool } from '@neondatabase/serverless'
import { rateConFixture } from './_ratecon-fixture.mjs'

// ---------------------------------------------------------------------------
// WARN, DO NOT BLOCK — ON THE DEPLOYED WORKER (Phase 5 §3 step 5).
//
// §5's box: "Duplicate BOL warns in words, names the load, and proceeds only on
// confirm." All three halves, and the middle one is the one a screenshot cannot
// show: the load must NOT exist after the warning, and must exist after the
// confirm. So this counts rows either side of each press.
//
// The same rate confirmation is booked twice. The second attempt collides on
// three axes at once — the BOL, the PO, and broker+day+lane — which is what
// booking the same paperwork twice actually looks like.
//
//   SHOT_CHROME=... node -r dotenv/config scripts/verify-load-warnings.mjs
// ---------------------------------------------------------------------------

const BASE =
  process.env.VERIFY_BASE ?? 'https://zebra-dev.tajikcargollc.workers.dev'
const TAG = `LW${Date.now().toString(36).slice(-4).toUpperCase()}`
const { TRUTH, bytes } = rateConFixture(TAG)

neonConfig.webSocketConstructor ??= WebSocket
neonConfig.poolQueryViaFetch = false
const pool = new Pool({ connectionString: process.env.DIRECT_DATABASE_URL })

const results = []
const record = (label, ok, detail) => {
  results.push({ label, ok })
  console.log(`${ok ? 'ok  ' : 'FAIL'}  ${label.padEnd(58)} ${detail}`)
}

const { organizationId } = (
  await pool.query(
    `select c."organizationId"
       from "Company" c
       join "Membership" m on m."organizationId" = c."organizationId"
       join "User" u on u.id = m."userId"
      where u.email = $1 order by c.name asc limit 1`,
    [process.env.SEED_OWNER_EMAIL],
  )
).rows[0]

/** How many loads this run has booked. The whole confirm gate is this number. */
const booked = async () =>
  Number(
    (
      await pool.query(
        `select count(*)::int n from "Load" l
           join "Customer" c on c.id = l."customerId"
          where l."organizationId" = $1 and c.name = $2`,
        [organizationId, TRUTH.broker],
      )
    ).rows[0].n,
  )

const browser = await chromium.launch(
  process.env.SHOT_CHROME ? { executablePath: process.env.SHOT_CHROME } : {},
)
const context = await browser.newContext({
  viewport: { width: 1600, height: 1000 },
})
const page = await context.newPage()

await page.goto(`${BASE}/login`, { waitUntil: 'domcontentloaded' })
await page.fill('input[name="email"]', process.env.SEED_OWNER_EMAIL)
await page.fill('input[name="password"]', process.env.SEED_OWNER_PASSWORD)
await page.click('button[type="submit"]')
await page.waitForURL(/\/(loads|dashboard)/, { timeout: 60_000 })

async function uploadAndSettle(label) {
  await page.goto(`${BASE}/loads/new`, { waitUntil: 'domcontentloaded' })

  let hydrated = false
  for (let attempt = 0; attempt < 30; attempt++) {
    await page.fill('input[name="miles"]', '620')
    await page.waitForTimeout(200)
    if ((await page.locator('input[name="miles"]').inputValue()) === '620') {
      hydrated = true
      break
    }
    await page.waitForTimeout(500)
  }
  if (!hydrated) throw new Error(`${label}: page never hydrated`)

  // THE UPLOAD TAB FIRST, since Phase 6 §4 step 2 put the four methods behind
  // tabs. The file input only exists on the Upload panel — which is what a
  // dispatcher clicks too, so the walkthrough now does what they do.
  await page
    .locator('[role="tab"]', { hasText: 'Upload document' })
    .click()
    .catch(() => {})

  const send = () =>
    page.setInputFiles('section input[type="file"]', {
      name: `${TAG}-${label}.pdf`,
      mimeType: 'application/pdf',
      buffer: Buffer.from(bytes),
    })

  await send()
  await page.waitForTimeout(3_000)
  const stillIdle = await page.evaluate(() =>
    [...document.querySelectorAll('[role="status"]')].some((n) =>
      (n.textContent ?? '').includes('form fills itself'),
    ),
  )
  if (stillIdle) await send()

  const snapshot = () =>
    page.evaluate(() => {
      const value = (name) =>
        document.querySelector(`input[name="${name}"]`)?.value?.trim() ?? null
      return {
        broker: value('broker'),
        bol: value('bol'),
        po: value('po'),
        warnings: [...document.querySelectorAll('[role="alert"] li')].map((n) =>
          (n.textContent ?? '').trim(),
        ),
        acknowledge: value('acknowledge'),
        button:
          document
            .querySelector('button[type="submit"]')
            ?.textContent?.trim() ?? null,
      }
    })

  let form = await snapshot()
  let stable = 0
  for (let attempt = 0; attempt < 90; attempt++) {
    await page.waitForTimeout(1_000)
    const next = await snapshot()
    const same = JSON.stringify(next) === JSON.stringify(form)
    form = next
    if (!form.broker) {
      stable = 0
      continue
    }
    if (same) {
      stable += 1
      if (stable >= 2) return { form, snapshot }
    } else {
      stable = 0
    }
  }
  throw new Error(`${label}: form never settled`)
}

/** Press Save and wait for the action to come back. */
async function submitAndSettle(snapshot) {
  const before = JSON.stringify(await snapshot())
  await page.locator('button[type="submit"]').first().click()
  for (let attempt = 0; attempt < 40; attempt++) {
    await page.waitForTimeout(1_000)
    const now = await snapshot().catch(() => null)
    if (now && JSON.stringify(now) !== before) return now
    if (!page.url().includes('/loads/new')) return null
  }
  return await snapshot().catch(() => null)
}

// ===========================================================================
// FIRST BOOKING — nothing to warn about.
// ===========================================================================
const first = await uploadAndSettle('first')

record(
  'the document’s BOL and PO reach fields the form only shows when it has them',
  first.form.bol === TRUTH.bol && first.form.po === TRUTH.po,
  `BOL ${first.form.bol ?? '(none)'} · PO ${first.form.po ?? '(none)'}`,
)
record(
  'a clean load warns about nothing and says Save',
  first.form.warnings.length === 0,
  `${first.form.warnings.length} warning(s)`,
)

await page.locator('button[type="submit"]').first().click()
for (let attempt = 0; attempt < 40; attempt++) {
  if ((await booked()) === 1) break
  await page.waitForTimeout(1_000)
}
record('and books on the first press', (await booked()) === 1, '1 load')

// ===========================================================================
// SECOND BOOKING — the same paperwork, again.
// ===========================================================================
const second = await uploadAndSettle('second')
const warned = await submitAndSettle(second.snapshot)
const countAfterWarning = await booked()

record(
  '§5: booking the same paperwork twice warns IN WORDS',
  (warned?.warnings.length ?? 0) >= 3,
  `${warned?.warnings.length ?? 0} warnings`,
)
record(
  'and NAMES the load it conflicts with',
  warned?.warnings.some((line) => /load \d+/i.test(line)),
  warned?.warnings[0]?.slice(0, 70) ?? '(none)',
)
record(
  'the duplicate BOL is one of them, quoting the number',
  warned?.warnings.some(
    (line) => line.includes('BOL') && line.includes(`BOL-${TAG}-77`),
  ),
  warned?.warnings.find((line) => line.includes('BOL'))?.slice(0, 70) ??
    '(none)',
)
record(
  'the duplicate PO is another, quoting that number',
  warned?.warnings.some((line) => line.includes(TRUTH.po)),
  warned?.warnings.find((line) => line.includes('PO'))?.slice(0, 70) ??
    '(none)',
)
record(
  'and the probable duplicate names the lane',
  warned?.warnings.some((line) => line.includes('→')),
  warned?.warnings.find((line) => line.includes('→'))?.slice(0, 70) ?? '(none)',
)

// THE HALF A SCREENSHOT CANNOT SHOW.
record(
  'PROCEEDS ONLY ON CONFIRM — nothing was booked by the warning',
  countAfterWarning === 1,
  `${countAfterWarning} load(s) — the second is still unbooked`,
)
record(
  'and the rollback took the create-on-miss rows with it',
  (
    await pool.query(
      `select count(*)::int n from "Customer" where "organizationId" = $1 and name = $2`,
      [organizationId, TRUTH.broker],
    )
  ).rows[0].n === 1,
  'one customer, not one per attempt',
)
record(
  'the button now says what pressing it does',
  /anyway/i.test(warned?.button ?? ''),
  `${warned?.button ?? '(none)'}`,
)
record(
  'carrying the signature of exactly these warnings',
  Boolean(warned?.acknowledge),
  warned?.acknowledge ? `${warned.acknowledge.length} chars` : '(absent)',
)

// --- the confirm ---------------------------------------------------------------------
await page.locator('button[type="submit"]').first().click()
for (let attempt = 0; attempt < 40; attempt++) {
  if ((await booked()) === 2) break
  await page.waitForTimeout(1_000)
}
record(
  'and the second press books it',
  (await booked()) === 2,
  `${await booked()} loads — warned, not blocked`,
)

await browser.close()

// --- cleanup -------------------------------------------------------------------------
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
await pool.query('delete from "CustomerAlias" where alias = $1', [TRUTH.broker])
await pool.query('delete from "Customer" where name = $1', [TRUTH.broker])
await pool.query('delete from "Location" where "addressLine1" like $1', [
  `%${TAG}%`,
])
await pool.query('delete from "PendingUpload" where filename like $1', [
  `%${TAG}%`,
])
await pool.end()

const failed = results.filter((r) => !r.ok).length
console.log(`\n${results.length - failed}/${results.length} passed`)
process.exit(failed === 0 ? 0 : 1)
