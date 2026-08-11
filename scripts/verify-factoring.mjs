import { writeFileSync } from 'node:fs'
import { chromium } from 'playwright'
import { neonConfig, Pool } from '@neondatabase/serverless'
import { isProduction, requireCredentials } from './check-credentials.mjs'

// ---------------------------------------------------------------------------
// FACTORING, ON THE DEPLOYED WORKER.
//
// The integration suite proves the arithmetic against Postgres. What it cannot
// prove is that a person can reach it: that a rate typed as "97" saves, that
// the invoice screen offers the right factor and no other, and that selling an
// invoice moves it out of the aging a person actually reads — not merely out of
// a function a test calls.
//
// It books its OWN freight through the forms rather than hunting for something
// suitable, because the apportionment is the point and it needs an invoice
// covering MORE THAN ONE load. A run against a database somebody has been using
// would otherwise find a single-load invoice and quietly prove nothing.
//
// Row-level assertions read the database directly: "the screen shows $4,874.25"
// and "the column holds 487425" are different claims, and only the second one
// survives the next render.
//
//   SHOT_CHROME=... node -r dotenv/config scripts/verify-factoring.mjs
// ---------------------------------------------------------------------------

const BASE =
  process.env.VERIFY_BASE ?? 'https://zebra-dev.tajikcargollc.workers.dev'
const TAG = `FC${Date.now().toString(36).slice(-4).toUpperCase()}`
const PDF = `${process.env.TEMP ?? '/tmp'}/${TAG}.pdf`

writeFileSync(
  PDF,
  '%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[]/Count 0>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n',
)

neonConfig.webSocketConstructor ??= WebSocket
neonConfig.poolQueryViaFetch = false
const pool = new Pool({
  connectionString: isProduction(BASE)
    ? process.env.PROD_DIRECT_DATABASE_URL
    : process.env.DIRECT_DATABASE_URL,
})

const results = []
const record = (label, ok, detail) => {
  results.push({ label, ok })
  console.log(`${ok ? 'ok  ' : 'FAIL'}  ${label.padEnd(54)} ${detail}`)
}

const money = (cents) =>
  `$${(cents / 100).toLocaleString('en-US', { minimumFractionDigits: 2 })}`

const until = async (probe, ms = 120_000) => {
  const deadline = Date.now() + ms
  for (;;) {
    const value = await probe()
    if (value) return value
    if (Date.now() > deadline) return null
  }
}

const browser = await chromium.launch(
  process.env.SHOT_CHROME ? { executablePath: process.env.SHOT_CHROME } : {},
)

const CREDENTIALS = requireCredentials(BASE)
const context = await browser.newContext({
  viewport: { width: 1920, height: 1080 },
})
const page = await context.newPage()
await page.goto(`${BASE}/login`, { waitUntil: 'domcontentloaded' })
await page.fill('input[name="email"]', CREDENTIALS.email)
await page.fill('input[name="password"]', CREDENTIALS.password)
await Promise.all([
  page.waitForURL(/\/(loads|dashboard)/, { timeout: 90_000 }),
  page.click('button[type="submit"]'),
])

// --- freight, through the forms --------------------------------------------
// Two loads at $2,450.00 and $1,900.00, so the invoice is $4,350.00 and its
// 3% fee — 13050 — has to land on both.
async function bookDelivered(rate, pickupDay, deliveryDay) {
  await page.goto(`${BASE}/loads/new`, { waitUntil: 'domcontentloaded' })
  await page.fill('input[name="broker"]', `Factor Broker ${TAG}`)
  await page.fill('input[name="stops[0].place"]', 'Chicago, IL')
  await page.fill('input[name="stops[1].place"]', 'Dallas, TX')
  await page.fill('input[name="stops[0].date"]', pickupDay)
  await page.fill('input[name="stops[1].date"]', deliveryDay)
  await page.fill('input[name="rate"]', rate)
  await page.click('form button[type="submit"]')

  const load = await until(
    async () =>
      (
        await pool.query(
          `select id, "loadNumber", "companyId", "totalRevenueCents" from "Load"
          where "customerId" in (select id from "Customer" where name = $1)
            and "totalRevenueCents" = $2
          order by "createdAt" desc limit 1`,
          [`Factor Broker ${TAG}`, Number(rate) * 100],
        )
      ).rows[0],
  )
  if (!load) return null

  await page.goto(`${BASE}/loads/${load.id}`, { waitUntil: 'domcontentloaded' })
  await page.click('button:has-text("Mark delivered")')
  await page.waitForTimeout(4000)
  await page.reload({ waitUntil: 'domcontentloaded' })
  await page
    .locator('div:has(> div > h3:text-is("POD")) input[type="file"]')
    .first()
    .setInputFiles(PDF)

  const ready = await until(
    async () =>
      (
        await pool.query(
          'select "operationalStatus" s from "Load" where id = $1',
          [load.id],
        )
      ).rows[0]?.s === 'POD_RECEIVED',
  )
  return ready ? load : null
}

const first = await bookDelivered('2450', '901', '903')
const second = await bookDelivered('1900', '905', '907')
record(
  'two delivered loads, booked and PODed through the screens',
  Boolean(first && second),
  first && second
    ? `${first.loadNumber} + ${second.loadNumber}`
    : '(booking failed — nothing below can be trusted)',
)
if (!first || !second) {
  await pool.end()
  await browser.close()
  process.exit(1)
}

// --- setup: a rate typed as a percentage -----------------------------------
// The factor is created for the authority the LOADS landed under, so the
// arrangement matches the freight rather than the other way round.
const carrier = (
  await pool.query('select name from "Company" where id = $1', [
    first.companyId,
  ])
).rows[0].name

await page.goto(`${BASE}/receivables/factoring`, {
  waitUntil: 'domcontentloaded',
})
await page.waitForTimeout(2500)

const authorities = await page
  .locator('select[name="companyId"] option')
  .allTextContents()
record(
  'the setup form offers the authorities this session may use',
  authorities.some((label) => label.trim() === carrier),
  authorities
    .map((label) => label.trim())
    .filter(Boolean)
    .join(', ') || '(none)',
)

await page.fill('input[name="name"]', `Triumph ${TAG}`)
await page.selectOption('select[name="companyId"]', { label: carrier })
await page.fill('input[name="advanceRate"]', '97')
await page.fill('input[name="feeRate"]', '3')
await page.click('form button[type="submit"]')
await page.waitForTimeout(10_000)

const saved = (
  await pool.query(
    'select id, "advanceRateBps", "feeBps", "companyId" from "FactoringCompany" where name = $1',
    [`Triumph ${TAG}`],
  )
).rows[0]
record(
  'a rate typed as "97" is stored as 9700 basis points',
  saved?.advanceRateBps === 9700 && saved?.feeBps === 300,
  saved
    ? `advance ${saved.advanceRateBps}, fee ${saved.feeBps}`
    : '(no row saved)',
)
record(
  'and the row carries the authority it was negotiated for',
  saved?.companyId === first.companyId,
  saved?.companyId ? carrier : '(null — unusable by markFactored)',
)

// --- the refusal, in words -------------------------------------------------
await page.goto(`${BASE}/receivables/factoring`, {
  waitUntil: 'domcontentloaded',
})
await page.waitForTimeout(2000)
await page.fill('input[name="name"]', `Impossible ${TAG}`)
await page.selectOption('select[name="companyId"]', { label: carrier })
await page.fill('input[name="advanceRate"]', '97')
await page.fill('input[name="feeRate"]', '4')
await page.click('form button[type="submit"]')
await page.waitForTimeout(8000)

const refusal = await page
  .locator('[role="alert"]')
  .first()
  .textContent()
  .catch(() => null)
const impossible = (
  await pool.query('select id from "FactoringCompany" where name = $1', [
    `Impossible ${TAG}`,
  ])
).rows
record(
  '101% of an invoice is refused in words, not saved',
  impossible.length === 0 && Boolean(refusal),
  (refusal ?? '(no message)').trim().slice(0, 74),
)

await page.screenshot({ path: 'screenshots/factoring-setup.png' })

// --- invoice the two loads, and record it as sent --------------------------
await page.goto(`${BASE}/invoices`, { waitUntil: 'domcontentloaded' })
await page.waitForTimeout(3000)
for (const load of [first, second]) {
  await page.locator(`input[name="loadIds"][value="${load.id}"]`).check()
}
await page.locator('button:has-text("Create invoice")').first().click()
await page.waitForURL(/\/invoices\/[a-z0-9]+/, { timeout: 90_000 })

const invoice = (
  await pool.query(
    `select id, "invoiceNumber", "totalCents" from "Invoice"
      where id = $1`,
    [page.url().split('/').pop()],
  )
).rows[0]
record(
  'one invoice covers both loads',
  invoice?.totalCents === 435000,
  invoice
    ? `${invoice.invoiceNumber} ${money(invoice.totalCents)}`
    : '(no invoice)',
)

await page.fill('input[name="channel"]', 'email')
await page
  .locator('form:has(input[name="channel"]) button[type="submit"]')
  .click()
await page.waitForTimeout(10_000)

// --- selling it -------------------------------------------------------------
await page.reload({ waitUntil: 'domcontentloaded' })
await page.waitForTimeout(2500)

const offered = await page
  .locator('select[name="factoringCompanyId"] option')
  .allTextContents()
const label = offered.find((text) => text.includes(`Triumph ${TAG}`))
record(
  'the invoice offers the factor with its terms in the label',
  Boolean(label) && label.includes('97') && label.includes('3%'),
  offered
    .map((text) => text.trim())
    .join(' | ')
    .slice(0, 74),
)
record(
  'and offers no factor belonging to another authority',
  offered.filter((text) => text.trim() !== '—').length ===
    (
      await pool.query(
        'select count(*)::int c from "FactoringCompany" where "companyId" = $1 and "deletedAt" is null',
        [first.companyId],
      )
    ).rows[0].c,
  `${offered.length - 1} offered`,
)

await page.selectOption('select[name="factoringCompanyId"]', {
  label: label.trim(),
})
await page
  .locator('form:has(select[name="factoringCompanyId"]) button[type="submit"]')
  .click()
await page.waitForTimeout(12_000)

const sold = (
  await pool.query(
    `select "isFactored", "advanceCents", "factoringFeeCents", "totalCents"
       from "Invoice" where id = $1`,
    [invoice.id],
  )
).rows[0]

// $4,350.00 at 97/3: advance 4219.50, fee 130.50, reserve 0.
record(
  'selling it records the advance and the fee',
  sold.isFactored &&
    sold.advanceCents === 421950 &&
    sold.factoringFeeCents === 13050,
  `${money(sold.totalCents)} -> advance ${money(sold.advanceCents)}, fee ${money(sold.factoringFeeCents)}`,
)

// THE APPORTIONMENT: 2450/4350 and 1900/4350 of 13050 are 7350 and 5700, both
// exact. Asked of the database rather than of the screen.
const shares = (
  await pool.query(
    'select id, "factoringFeeCents" f from "Load" where id = any($1) order by "totalRevenueCents" desc',
    [[first.id, second.id]],
  )
).rows
record(
  'the fee lands on both loads in proportion',
  shares[0]?.f === 7350 && shares[1]?.f === 5700,
  shares.map((row) => money(row.f)).join(' + '),
)
record(
  'and sums exactly back to the invoice',
  shares.reduce((sum, row) => sum + row.f, 0) === sold.factoringFeeCents,
  `${money(shares.reduce((sum, row) => sum + row.f, 0))} vs ${money(sold.factoringFeeCents)}`,
)

await page.reload({ waitUntil: 'domcontentloaded' })
await page.waitForTimeout(2000)
const panel = ((await page.locator('body').textContent()) ?? '').replace(
  /\s+/g,
  ' ',
)
record(
  'the invoice screen states what the factor advanced',
  panel.includes(money(sold.advanceCents)),
  panel.includes('Sold to a factor') ? 'panel rendered' : '(no factored panel)',
)
await page.screenshot({ path: 'screenshots/invoice-factored.png' })

// --- and it leaves aging ----------------------------------------------------
await page.goto(`${BASE}/receivables`, { waitUntil: 'domcontentloaded' })
await page.waitForTimeout(3000)

const agingRows = await page
  .locator(`table >> nth=0 >> tr:has-text("${invoice.invoiceNumber}")`)
  .count()
record(
  'a sold invoice is gone from "owed to us"',
  agingRows === 0,
  `${agingRows} row(s) in the aging table`,
)

const factoredRows = await page
  .locator(`table >> nth=1 >> tr:has-text("${invoice.invoiceNumber}")`)
  .count()
record(
  'and present in "sold to a factor"',
  factoredRows === 1,
  `${factoredRows} row(s) in the factored table`,
)

await page.screenshot({ path: 'screenshots/receivables.png', fullPage: true })

// --- the drift check, over everything this just wrote -----------------------
const drift = (
  await pool.query(
    `select i."invoiceNumber", i."factoringFeeCents",
            coalesce(sum(l."factoringFeeCents"), 0)::int as loads
       from "Invoice" i
       left join "InvoiceLine" il on il."invoiceId" = i.id
       left join "Load" l on l.id = il."loadId"
      where i."isFactored" = true and i."deletedAt" is null
      group by i.id, i."invoiceNumber", i."factoringFeeCents"
     having coalesce(sum(l."factoringFeeCents"), 0)::int <> i."factoringFeeCents"`,
  )
).rows
record(
  'no factored invoice disagrees with its own loads',
  drift.length === 0,
  drift.length === 0
    ? 'zero rows'
    : drift.map((row) => row.invoiceNumber).join(', '),
)

await pool.end()
await browser.close()

const failed = results.filter((row) => !row.ok).length
console.log(
  `\n${results.length - failed}/${results.length} passed against ${BASE}`,
)
process.exit(failed === 0 ? 0 : 1)
