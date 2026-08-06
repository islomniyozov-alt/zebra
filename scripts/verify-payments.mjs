import { writeFileSync } from 'node:fs'
import { chromium } from 'playwright'
import { neonConfig, Pool } from '@neondatabase/serverless'
import { isProduction, requireCredentials } from './check-credentials.mjs'

// ---------------------------------------------------------------------------
// PAYMENTS, ON THE DEPLOYED WORKER.
//
// The integration suite proves the arithmetic against Postgres. What it cannot
// prove is that a person can do this: record an ACH, see the unapplied money
// as a state rather than a warning, tick the loads a weekly statement covers,
// and watch the difference stay visible instead of being tidied away.
//
// It books its OWN direct-settled freight through the forms, because the Relay
// path is the point and it needs several loads under one payer that never
// become an invoice.
//
//   SHOT_CHROME=... node -r dotenv/config scripts/verify-payments.mjs
// ---------------------------------------------------------------------------

const BASE =
  process.env.VERIFY_BASE ?? 'https://zebra-dev.tajikcargollc.workers.dev'
const TAG = `PY${Date.now().toString(36).slice(-4).toUpperCase()}`
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
  console.log(`${ok ? 'ok  ' : 'FAIL'}  ${label.padEnd(56)} ${detail}`)
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

// --- a payer that settles directly, and three loads under it ----------------
const PAYER = `Relay ${TAG}`

async function bookDelivered(rate, pickupDay, deliveryDay) {
  await page.goto(`${BASE}/loads/new`, { waitUntil: 'domcontentloaded' })
  await page.fill('input[name="broker"]', PAYER)
  await page.fill('input[name="pickup"]', 'Chicago, IL')
  await page.fill('input[name="delivery"]', 'Dallas, TX')
  await page.fill('input[name="pickupAt"]', pickupDay)
  await page.fill('input[name="deliveryAt"]', deliveryDay)
  await page.fill('input[name="rate"]', rate)
  await page.click('form button[type="submit"]')

  const load = await until(
    async () =>
      (
        await pool.query(
          `select id, "loadNumber", "companyId", "directSettled", "billingStatus"
           from "Load"
          where "customerId" in (select id from "Customer" where name = $1)
            and "totalRevenueCents" = $2
          order by "createdAt" desc limit 1`,
          [PAYER, Number(rate) * 100],
        )
      ).rows[0],
  )
  if (!load) return null

  await page.goto(`${BASE}/loads/${load.id}`, { waitUntil: 'domcontentloaded' })
  await page.click('button:has-text("Mark delivered")')
  await page.waitForTimeout(4000)
  // `goto`, not `reload`: the action revalidates and the router may already be
  // navigating, and a reload racing that detaches the frame. One run died here
  // with ERR_ABORTED for exactly that reason.
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

// The first load creates the broker and is booked BEFORE it is marked
// direct-settled — so it stays invoice-billed for ever. That is not an
// oversight, it is the control: `directSettled` is copied onto the load at
// booking and never re-read, so a customer changing terms next year must not
// rewrite the billing history of freight already hauled.
const seed = await bookDelivered('850', '901', '903')
if (!seed) {
  record('freight booked through the screens', false, 'booking failed')
  await pool.end()
  await browser.close()
  process.exit(1)
}
await pool.query(
  'update "Customer" set "settlesDirectly" = true where name=$1',
  [PAYER],
)

const second = await bookDelivered('1200', '905', '907')
const third = await bookDelivered('975', '909', '911')
record(
  'freight booked and PODed through the screens',
  Boolean(second && third),
  second && third ? `${second.loadNumber} + ${third.loadNumber}` : '(failed)',
)
if (!second || !third) {
  await pool.end()
  await browser.close()
  process.exit(1)
}

// THE BILLING AXIS MOVED ON ITS OWN. Nobody clicked anything called "ready".
const readyRows = await pool.query(
  'select "billingStatus" s from "Load" where id = any($1)',
  [[second.id, third.id]],
)
record(
  'a POD and a rate make a load ready to bill, with no click',
  readyRows.rows.every((row) => row.s === 'READY_TO_INVOICE'),
  readyRows.rows.map((row) => row.s).join(', '),
)

// Direct-settled freight stays OUT of the invoice queue entirely.
await page.goto(`${BASE}/invoices`, { waitUntil: 'domcontentloaded' })
await page.waitForTimeout(2500)
const inQueue = await page
  .locator(`input[name="loadIds"][value="${second.id}"]`)
  .count()
record(
  'direct-settled freight is not offered for invoicing',
  inQueue === 0,
  `${inQueue} checkbox(es) in the ready queue`,
)

// --- record the weekly ACH --------------------------------------------------
// $2,150.00 against $2,175.00 of direct-settled freight: the statement is
// $25.00 short, which is exactly the case that must NOT be tidied away.
await page.goto(`${BASE}/payments/new`, { waitUntil: 'domcontentloaded' })
await page.waitForTimeout(2000)
await page.fill('input[name="amount"]', '2150')
await page.selectOption('select[name="method"]', 'ACH')
await page.fill('input[name="referenceNumber"]', `ACH-${TAG}`)
await page.selectOption('select[name="customerId"]', { label: PAYER })
await page.click('form button[type="submit"]')
// NOT /payments/[a-z0-9]+ — that also matches the /payments/new we are
// standing on, so the wait returned instantly and every assertion below read a
// payment whose id was the string "new". Exclude the literal.
await page.waitForURL(
  (url) =>
    /\/payments\/[a-z0-9]+$/.test(url.pathname) &&
    !url.pathname.endsWith('/new'),
  { timeout: 90_000 },
)

const paymentId = page.url().split('/').pop()
const recorded = (
  await pool.query(
    'select "amountCents", "unappliedCents", method from "Payment" where id=$1',
    [paymentId],
  )
).rows[0]
record(
  'a payment starts fully unapplied, and that is not an error',
  recorded?.amountCents === 215000 && recorded?.unappliedCents === 215000,
  recorded
    ? `${money(recorded.amountCents)} in, ${money(recorded.unappliedCents)} unapplied`
    : '(no payment row)',
)

// --- the statement panel ----------------------------------------------------
const offered = await page.locator('input[name="loadIds"]').count()
record(
  'the statement panel offers the direct-settled loads',
  offered === 2,
  `${offered} load(s) offered`,
)

// THE CONTROL. The first load was booked before the payer settled directly, so
// it is invoice-billed and a statement must not reach it.
const seedOffered = await page
  .locator(`input[name="loadIds"][value="${seed.id}"]`)
  .count()
record(
  'and not the load booked before the payer settled directly',
  seedOffered === 0,
  seedOffered === 0 ? `${seed.loadNumber} correctly absent` : 'offered',
)

// No invoice panel: this payer has none, and the absence is the answer.
const invoicePanel = await page.locator('select[name="invoiceId"]').count()
record(
  'and no invoice panel, because there is no invoice',
  invoicePanel === 0,
  invoicePanel === 0 ? 'absent' : 'present',
)

await page.locator('button:has-text("Fill from the oldest first")').click()
await page.waitForTimeout(1500)
await page.screenshot({ path: 'screenshots/payment-statement.png' })

// The proposal spends the whole $2,150.00: the $1,200.00 load takes all of it,
// leaving $950.00 for a load owed $975.00 — so it takes $950.00 and $25.00
// stays owed on it.
const proposed = await page
  .locator('input[name^="amount:"]')
  .evaluateAll((nodes) =>
    nodes.filter((node) => node.value !== '').map((node) => node.value),
  )
record(
  'the oldest-first proposal spends the statement and no more',
  proposed.join(',') === '1200.00,950.00',
  proposed.join(' + ') || '(nothing proposed)',
)

await page.locator('button:has-text("Apply to the ticked loads")').click()
await page.waitForTimeout(12_000)

const applied = (
  await pool.query(
    `select l."loadNumber", l."billingStatus" s, l."totalRevenueCents" rev,
            coalesce(sum(a."amountCents"), 0)::int paid
       from "Load" l
       left join "PaymentLoadApplication" a on a."loadId" = l.id
      where l.id = any($1)
      group by l.id, l."loadNumber", l."billingStatus", l."totalRevenueCents"
      order by l."loadNumber"`,
    [[second.id, third.id]],
  )
).rows

record(
  'the statement paid the loads it named',
  applied.filter((row) => row.s === 'PAID').length === 1,
  applied.map((row) => `${row.loadNumber} ${row.s}`).join(', '),
)

// THE REMAINDER. $25.00 short, left where somebody can ask about it.
const short = applied.find((row) => row.rev !== row.paid)
record(
  'the $25.00 the statement did not cover stays owed, not tidied away',
  short?.s === 'PARTIALLY_PAID' && short.rev - short.paid === 2500,
  short
    ? `${short.loadNumber}: ${money(short.paid)} of ${money(short.rev)}`
    : '(nothing outstanding — the shortfall was absorbed)',
)

const after = (
  await pool.query('select "unappliedCents" u from "Payment" where id=$1', [
    paymentId,
  ])
).rows[0]
record(
  'and the payment has nothing left on it',
  after?.u === 0,
  money(after?.u ?? -1),
)

// No invoice was created anywhere along the way — the whole point of §2.
const invoiced = (
  await pool.query(
    'select count(*)::int c from "InvoiceLine" where "loadId" = any($1)',
    [[seed.id, second.id, third.id]],
  )
).rows[0].c
record(
  'and no invoice was invented to receive the money',
  invoiced === 0,
  `${invoiced} invoice line(s)`,
)

await page.reload({ waitUntil: 'domcontentloaded' })
await page.waitForTimeout(2000)
const detail = ((await page.locator('body').textContent()) ?? '').replace(
  /\s+/g,
  ' ',
)
record(
  'the payment screen lists the loads it paid',
  applied.every((row) => detail.includes(row.loadNumber)),
  detail.includes('Fully applied') ? 'fully applied' : '(still unapplied)',
)
await page.screenshot({ path: 'screenshots/payment-applied.png' })

// --- the list ---------------------------------------------------------------
await page.goto(`${BASE}/payments`, { waitUntil: 'domcontentloaded' })
await page.waitForTimeout(2500)
const listed = await page.locator(`tr:has-text("ACH-${TAG}")`).count()
record('the payment appears in the list', listed === 1, `${listed} row(s)`)
await page.screenshot({ path: 'screenshots/payments.png', fullPage: true })

// --- the drift checks, over everything this just wrote ----------------------
const paymentDrift = (
  await pool.query(
    `select p.id
       from "Payment" p
       left join "PaymentApplication" a on a."paymentId" = p.id
       left join "PaymentLoadApplication" la on la."paymentId" = p.id
      where p."deletedAt" is null
      group by p.id, p."amountCents", p."unappliedCents"
     having p."amountCents"
            - coalesce(sum(distinct a."amountCents"), 0)
            - coalesce(sum(distinct la."amountCents"), 0) <> p."unappliedCents"`,
  )
).rows
record(
  'no payment disagrees with what it was applied to',
  paymentDrift.length === 0,
  paymentDrift.length === 0 ? 'zero rows' : `${paymentDrift.length} row(s)`,
)

await pool.end()
await browser.close()

const failed = results.filter((row) => !row.ok).length
console.log(
  `\n${results.length - failed}/${results.length} passed against ${BASE}`,
)
process.exit(failed === 0 ? 0 : 1)
