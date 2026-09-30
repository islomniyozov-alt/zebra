import { chromium } from 'playwright'

// ---------------------------------------------------------------------------
// THE INVOICES PAGE AND ITS PDF, ON THE DEPLOYED WORKER.
//
//   node -r dotenv/config scripts/verify-invoice-surface.mjs
//
// ── WHY THIS EXISTS, IN ONE SENTENCE ─────────────────────────────────────
//
// Earlier today the statement PDF was complete, tested, and reached by a
// button pointing at a different renderer — two green suites over a broken
// path. A unit test proves the renderer; only a fetch proves the ROUTE.
//
// So this signs in, opens all four tabs, and asks for real invoice PDFs the
// way the link does. A tab that 500s and a PDF that answers HTML both look
// exactly like success from inside the test suite.
// ---------------------------------------------------------------------------

const BASE =
  process.env.SHOT_BASE ?? 'https://zebra-dev.tajikcargollc.workers.dev'
const TABS = ['invoices', 'ready', 'factored', 'direct']

const browser = await chromium.launch(
  process.env.SHOT_CHROME ? { executablePath: process.env.SHOT_CHROME } : {},
)
const origin = new URL(BASE).origin
const context = await browser.newContext()
const page = await context.newPage()

await page.goto(`${BASE}/login`, { waitUntil: 'domcontentloaded' })
await page.fill('input[name="email"]', process.env.SEED_OWNER_EMAIL ?? '')
await page.fill('input[name="password"]', process.env.SEED_OWNER_PASSWORD ?? '')
await Promise.all([
  page.waitForURL(/\/(loads|dashboard)/, { timeout: 60_000 }),
  page.click('button[type="submit"]'),
])

let bad = 0

console.log('TABS')
for (const tab of TABS) {
  const response = await context.request.get(
    `${origin}/accounting/invoices?tab=${tab}`,
  )
  const ok = response.status() === 200
  if (!ok) bad += 1
  console.log(
    `  ${ok ? 'ok  ' : 'MISS'}  ${tab.padEnd(9)} ${response.status()}`,
  )
}

// The status funnel writes a query parameter; a filtered grid has to stay a
// link somebody can send, so the filtered URL is fetched too.
console.log('')
console.log('STATUS FILTER')
const filtered = await context.request.get(
  `${origin}/accounting/invoices?f.status=SENT`,
)
if (filtered.status() !== 200) bad += 1
console.log(
  `  ${filtered.status() === 200 ? 'ok  ' : 'MISS'}  ?f.status=SENT ${filtered.status()}`,
)

console.log('')
console.log('INVOICE PDF')
// ACROSS THE TABS, NOT JUST THE FIRST. The first run of this looked only at
// the default tab, found nothing, and reported the PDF unproven — while dev's
// single invoice sat on the Factored tab, correctly excluded from
// receivables by the change this script was written to check. The verifier
// was wrong; the page was right.
const ids = []
for (const tab of TABS) {
  await page.goto(`${BASE}/accounting/invoices?tab=${tab}`, {
    waitUntil: 'domcontentloaded',
  })
  await page.waitForTimeout(1200)
  const here = await page.evaluate(() =>
    [...document.querySelectorAll('a[href^="/invoices/"]')].map((a) =>
      new URL(a.href).pathname.split('/').pop(),
    ),
  )
  for (const id of here) if (id && !ids.includes(id)) ids.push(id)
  if (ids.length >= 5) break
}

if (ids.length === 0) {
  // NOT A PASS. An empty grid proves nothing about the renderer, and
  // reporting OK here is how a broken PDF ships behind an empty database.
  console.log('  NO INVOICES ON DEV — THE PDF IS UNPROVEN, NOT PROVEN.')
  await browser.close()
  process.exit(1)
}

let rendered = 0
for (const id of ids) {
  const response = await context.request.get(`${origin}/api/invoices/${id}/pdf`)
  const body = Buffer.from(await response.body())
  const isPdf = body.toString('latin1').startsWith('%PDF-')
  const ok = response.status() === 200 && isPdf
  if (ok) rendered += 1
  console.log(
    `  ${ok ? 'ok  ' : 'MISS'}  ${id}  ${response.status()}  ${body.length} bytes  pdf=${isPdf}`,
  )
}
if (rendered === 0) bad += 1

await browser.close()
console.log('')
if (bad > 0) {
  console.log(`${bad} CHECKS FAILED — NOT OK.`)
  process.exit(1)
}
console.log(`ALL TABS 200, FILTER 200, ${rendered}/${ids.length} PDFS — OK.`)
