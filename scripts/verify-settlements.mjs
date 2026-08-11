import { writeFileSync } from 'node:fs'
import { chromium } from 'playwright'
import { neonConfig, Pool } from '@neondatabase/serverless'
import { isProduction, requireCredentials } from './check-credentials.mjs'

// ---------------------------------------------------------------------------
// SETTLEMENTS, ON THE DEPLOYED WORKER.
//
// The pay arithmetic is covered by tests/driver-pay.test.ts and the lifecycle
// by the integration suite. What only a browser can prove: that a person can
// set a pay rule, generate the week, add a deduction, approve it, open the
// PDF, and record the payment — and that the PDF that comes back down the wire
// really carries the working a driver would check.
//
// It books its OWN freight, because a settlement needs delivered loads with a
// rate under one driver in one week, and none of that exists by accident.
//
//   SHOT_CHROME=... node -r dotenv/config scripts/verify-settlements.mjs
// ---------------------------------------------------------------------------

const BASE =
  process.env.VERIFY_BASE ?? 'https://zebra-dev.tajikcargollc.workers.dev'
const TAG = `ST${Date.now().toString(36).slice(-4).toUpperCase()}`
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
  console.log(`${ok ? 'ok  ' : 'FAIL'}  ${label.padEnd(58)} ${detail}`)
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

// --- a driver, through the form ---------------------------------------------
await page.goto(`${BASE}/drivers/new`, { waitUntil: 'domcontentloaded' })
await page.waitForTimeout(2000)
await page.fill('input[name="firstName"]', 'Ahmad')
await page.fill('input[name="lastName"]', `Settle ${TAG}`)
await page.click('form button[type="submit"]')

const driver = await until(
  async () =>
    (
      await pool.query(
        'select id, "companyId" from "Driver" where "lastName" = $1',
        [`Settle ${TAG}`],
      )
    ).rows[0],
)
record(
  'a driver booked through the form',
  Boolean(driver),
  driver?.id ?? '(none)',
)
if (!driver) {
  await pool.end()
  await browser.close()
  process.exit(1)
}

// --- the pay rule -------------------------------------------------------------
await page.goto(`${BASE}/drivers/${driver.id}`, {
  waitUntil: 'domcontentloaded',
})
await page.waitForTimeout(2500)

const offered = await page
  .locator('select[name="type"] option')
  .allTextContents()
record(
  'both percentage rules are offered by name, and CUSTOM is not',
  offered.some((label) => label.includes('gross')) &&
    offered.some((label) => label.includes('linehaul')) &&
    !offered.some((label) => /custom/i.test(label)),
  offered.map((label) => label.trim()).join(' | '),
)

await page.selectOption('select[name="type"]', 'PERCENT_GROSS')
await page.fill('input[name="percent"]', '30')
await page.fill('input[name="effectiveFrom"]', '2026-01-01')
await page.locator('button:has-text("Save the rule")').click()
await page.waitForTimeout(9000)

const rule = (
  await pool.query(
    'select type, "percentBps" from "DriverPayRule" where "driverId" = $1',
    [driver.id],
  )
).rows[0]
record(
  'a rate typed as "30" is stored as 3000 basis points',
  rule?.type === 'PERCENT_GROSS' && rule?.percentBps === 3000,
  rule ? `${rule.type} ${rule.percentBps}` : '(no rule saved)',
)

// The overlap refusal, in words.
await page.fill('input[name="percent"]', '35')
await page.fill('input[name="effectiveFrom"]', '2026-06-01')
await page.locator('button:has-text("Save the rule")').click()
await page.waitForTimeout(8000)
const refusal = await page
  .locator('[role="alert"]')
  .first()
  .textContent()
  .catch(() => null)
record(
  'a rule overlapping one on file is refused in words',
  (
    await pool.query(
      'select count(*)::int c from "DriverPayRule" where "driverId" = $1',
      [driver.id],
    )
  ).rows[0].c === 1 && Boolean(refusal),
  (refusal ?? '(no message)').trim().slice(0, 70),
)
await page.screenshot({ path: 'screenshots/driver-pay-rules.png' })

// --- freight, delivered and PODed --------------------------------------------
async function bookDelivered(rate, pickupDay, deliveryDay) {
  await page.goto(`${BASE}/loads/new`, { waitUntil: 'domcontentloaded' })
  await page.fill('input[name="broker"]', `Settle Broker ${TAG}`)
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
          `select id, "loadNumber" from "Load"
          where "customerId" in (select id from "Customer" where name = $1)
            and "totalRevenueCents" = $2
          order by "createdAt" desc limit 1`,
          [`Settle Broker ${TAG}`, Number(rate) * 100],
        )
      ).rows[0],
  )
  if (!load) return null

  // THE ONE STEP THIS SCRIPT DOES NOT DO THROUGH THE SCREEN. Assigning a
  // driver goes through the dispatch board, which has its own walkthrough
  // (verify-board.mjs) and its own assertions; driving it here would test the
  // board rather than the settlement. Stated rather than left to look like a
  // UI step — the assertions that matter below all read the database anyway.
  await pool.query('update "Load" set "driverId" = $1 where id = $2', [
    driver.id,
    load.id,
  ])

  await page
    .goto(`${BASE}/loads/${load.id}`, { waitUntil: 'domcontentloaded' })
    .catch(() => {})
  await page.click('button:has-text("Mark delivered")')
  await page.waitForTimeout(4000)
  await page
    .goto(`${BASE}/loads/${load.id}`, { waitUntil: 'domcontentloaded' })
    .catch(() => {})
  await page.waitForTimeout(1500)
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
  'two delivered loads under that driver',
  Boolean(first && second),
  first && second ? `${first.loadNumber} + ${second.loadNumber}` : '(failed)',
)
if (!first || !second) {
  await pool.end()
  await browser.close()
  process.exit(1)
}

// The POD events land at "now", so the settlement week is this week.
const today = new Date()
const from = new Date(today.getTime() - 3 * 86_400_000)
  .toISOString()
  .slice(0, 10)
const to = new Date(today.getTime() + 3 * 86_400_000).toISOString().slice(0, 10)

// --- generate ------------------------------------------------------------------
await page.goto(`${BASE}/settlements`, { waitUntil: 'domcontentloaded' })
await page.waitForTimeout(2500)
await page.selectOption('select[name="driverId"]', {
  label: `Settle ${TAG}, Ahmad`,
})
await page.fill('input[name="periodStart"]', from)
await page.fill('input[name="periodEnd"]', to)
await page.locator('button:has-text("Generate a settlement")').last().click()
await page.waitForURL(
  (url) =>
    /\/settlements\/[a-z0-9]+$/.test(url.pathname) &&
    !url.pathname.endsWith('/settlements'),
  { timeout: 90_000 },
)

const settlementId = page.url().split('/').pop()
const generated = (
  await pool.query(
    'select "settlementNumber", "grossCents", "netCents", status from "Settlement" where id = $1',
    [settlementId],
  )
).rows[0]
// 30% of ($2,450.00 + $1,900.00) = 30% of $4,350.00 = $1,305.00
record(
  'the week generates at 30% of gross',
  generated?.grossCents === 130500 && generated?.status === 'DRAFT',
  generated
    ? `${generated.settlementNumber} ${money(generated.grossCents)}`
    : '(no settlement)',
)

const working = await page.locator('body').textContent()
record(
  'and every line shows the working a driver would check',
  (working ?? '').includes('30% of $2,450.00 gross') &&
    (working ?? '').includes('30% of $1,900.00 gross'),
  (working ?? '').includes('30% of') ? 'basis shown per line' : '(no working)',
)

// --- a deduction ----------------------------------------------------------------
await page.selectOption('select[name="type"]', 'DEDUCTION_FUEL')
await page.fill('input[name="description"]', 'Fuel advance')
// Typed POSITIVE. The sign comes from the type.
await page.fill('input[name="amount"]', '250')
await page.locator('button:has-text("Add it")').click()
await page.waitForTimeout(10_000)

const deducted = (
  await pool.query(
    `select s."deductionsCents", s."netCents",
            (select l."amountCents" from "SettlementLine" l
              where l."settlementId" = s.id and l.type = 'DEDUCTION_FUEL') line
       from "Settlement" s where s.id = $1`,
    [settlementId],
  )
).rows[0]
record(
  'a deduction typed positive is stored negative and subtracted',
  deducted?.line === -25000 &&
    deducted?.deductionsCents === 25000 &&
    deducted?.netCents === 105500,
  deducted
    ? `line ${money(deducted.line)}, net ${money(deducted.netCents)}`
    : '(not applied)',
)
await page.screenshot({ path: 'screenshots/settlement-draft.png' })

// --- approve --------------------------------------------------------------------
await page.locator('button:has-text("Approve")').click()
await page.waitForTimeout(10_000)
await page.goto(`${BASE}/settlements/${settlementId}`, {
  waitUntil: 'domcontentloaded',
})
await page.waitForTimeout(2000)

const approved = (
  await pool.query('select status from "Settlement" where id = $1', [
    settlementId,
  ])
).rows[0]
record(
  'approving moves it out of draft',
  approved?.status === 'APPROVED',
  approved?.status,
)

// And the add-line control is gone, not merely disabled.
record(
  'and the deduction control is gone, not greyed out',
  (await page.locator('select[name="type"]').count()) === 0,
  `${await page.locator('select[name="type"]').count()} control(s)`,
)

// --- the PDF, down the wire -----------------------------------------------------
const pdf = await page.request.get(
  `${BASE}/api/settlements/${settlementId}/pdf`,
)
const bytes = Buffer.from(await pdf.body())
const asText = bytes.toString('latin1')
record(
  'the PDF is a real file the browser will open',
  pdf.status() === 200 &&
    pdf.headers()['content-type'] === 'application/pdf' &&
    asText.startsWith('%PDF-1.4') &&
    asText.trimEnd().endsWith('%%EOF'),
  `${pdf.status()} · ${bytes.length} bytes`,
)
record(
  'and it carries the working, the deduction and the net',
  asText.includes('30% of $2,450.00 gross') &&
    asText.includes('-$250.00') &&
    asText.includes('$1,055.00'),
  asText.includes('DRIVER SETTLEMENT') ? 'all three present' : '(missing)',
)

// --- mark paid ------------------------------------------------------------------
await page.fill('input[name="reference"]', `ACH-${TAG}`)
await page.locator('button:has-text("Record as paid")').last().click()
await page.waitForTimeout(10_000)

const paid = (
  await pool.query(
    'select status, "paidAt", "paymentReference" from "Settlement" where id = $1',
    [settlementId],
  )
).rows[0]
record(
  'recording the payment stamps how and when',
  paid?.status === 'PAID' &&
    paid?.paidAt !== null &&
    paid?.paymentReference === `ACH-${TAG}`,
  paid ? `${paid.status} ${paid.paymentReference}` : '(not paid)',
)
await page.screenshot({ path: 'screenshots/settlement-paid.png' })

// --- the loads cannot be settled twice -------------------------------------------
await page.goto(`${BASE}/settlements`, { waitUntil: 'domcontentloaded' })
await page.waitForTimeout(2500)
await page.selectOption('select[name="driverId"]', {
  label: `Settle ${TAG}, Ahmad`,
})
await page.fill('input[name="periodStart"]', from)
await page.fill('input[name="periodEnd"]', to)
await page.locator('button:has-text("Generate a settlement")').last().click()
await page.waitForTimeout(9000)

const again = await page
  .locator('[role="alert"]')
  .first()
  .textContent()
  .catch(() => null)
record(
  'the same week refuses rather than paying the loads twice',
  (
    await pool.query(
      'select count(*)::int c from "Settlement" where "driverId" = $1',
      [driver.id],
    )
  ).rows[0].c === 1 && Boolean(again),
  (again ?? '(no message)').trim().slice(0, 60),
)

// --- the drift check, over everything this just wrote ----------------------------
const drift = (
  await pool.query(
    `select s."settlementNumber"
       from "Settlement" s
       join "SettlementLine" l on l."settlementId" = s.id
      where s."deletedAt" is null and s.status <> 'VOID'
      group by s.id, s."settlementNumber", s."grossCents", s."netCents"
     having sum(l."amountCents") <> s."netCents"`,
  )
).rows
record(
  'no settlement net disagrees with the lines under it',
  drift.length === 0,
  drift.length === 0
    ? 'zero rows'
    : drift.map((r) => r.settlementNumber).join(', '),
)

await pool.end()
await browser.close()

const failed = results.filter((row) => !row.ok).length
console.log(
  `\n${results.length - failed}/${results.length} passed against ${BASE}`,
)
process.exit(failed === 0 ? 0 : 1)
