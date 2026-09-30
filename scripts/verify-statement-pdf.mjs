import { chromium } from 'playwright'

// ---------------------------------------------------------------------------
// FETCH A REAL STATEMENT PDF FROM THE DEPLOYED WORKER AND READ IT BACK.
//
//   node -r dotenv/config scripts/verify-statement-pdf.mjs
//
// ── WHY THIS EXISTS WHEN THE UNIT TEST ALREADY PASSES ────────────────────
//
// `tests/statement-pdf.test.ts` renders a FIXTURE through the renderer and
// asserts every figure. That proves the renderer. It cannot prove the ROUTE —
// which settlement it reads, whether it refuses, whether the thing the button
// links actually returns a document at all. The bug this session fixed was
// exactly that gap: a complete renderer behind a link that went somewhere
// else, with a green suite over both.
//
// So this asks the deployed worker for the bytes the button would fetch, and
// reports what is in them. `%PDF-` or it is not a PDF; the labels the artefact
// prints or it is not the Datatruck layout.
// ---------------------------------------------------------------------------

const BASE =
  process.env.SHOT_BASE ?? 'https://zebra-dev.tajikcargollc.workers.dev'

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

// A settlement that is NOT a draft — the route refuses a draft by ruling, so
// a draft would prove only that the refusal works.
await page.goto(`${BASE}/payroll/statements`, { waitUntil: 'domcontentloaded' })
await page.waitForTimeout(1500)
const candidates = await page.evaluate(() =>
  [...document.querySelectorAll('a[href^="/settlements/"]')]
    .map((a) => new URL(a.href).pathname.split('/').pop())
    .filter((id, index, all) => id && all.indexOf(id) === index)
    .slice(0, 12),
)

let found = null
const refusals = []
for (const id of candidates) {
  const response = await context.request.get(
    `${origin}/api/settlements/statement/${id}`,
  )
  if (response.status() === 200) {
    found = { id, body: Buffer.from(await response.body()) }
    break
  }
  // WHY, NOT JUST "NO". A run that reports "nothing to fetch" leaves the
  // reader unable to tell an empty database from a route refusing everything,
  // and those are different problems.
  refusals.push(`${id} -> ${response.status()}`)
}

if (!found) {
  console.error(`NO STATEMENT PDF AVAILABLE. ${refusals.length} tried:`)
  for (const line of refusals) console.error(`  ${line}`)
  await browser.close()
  process.exit(1)
}

const raw = found.body.toString('latin1')
const drawn = [...raw.matchAll(/\(((?:\\.|[^\\()])*)\)\s*Tj/g)].map((hit) =>
  hit[1].replace(/\\([()\\])/g, '$1'),
)
const text = drawn.join('\n')

console.log(`settlement ${found.id}`)
console.log(`bytes      ${found.body.length}`)
console.log(`is a PDF   ${raw.startsWith('%PDF-')}`)
console.log(`strings    ${drawn.length}\n`)

// The labels off `corpus/datatruck/ST-005562.pdf`. Present or the deployed
// document is not the layout the owner asked for.
const REQUIRED = [
  'Statement Date:',
  'Period Start:',
  'Period End:',
  'Check Date:',
  'Driver Pay Settlement',
  'Settlement:',
  'Batch ID:',
  'Driver:',
  'Unit Number:',
  'Payment tariff:',
  'Earnings',
  'Load number',
  'Load gross',
  'Total miles',
  'Total amount',
  'Net Pay:',
  'YTD Earnings:',
  'YTD Net Pay:',
]

let missing = 0
for (const label of REQUIRED) {
  const ok = text.includes(label)
  if (!ok) missing += 1
  console.log(`  ${ok ? 'ok  ' : 'MISS'}  ${label}`)
}

console.log('')
if (!raw.startsWith('%PDF-') || missing > 0) {
  console.log(`${missing} OF ${REQUIRED.length} LABELS MISSING — NOT OK.`)
  await browser.close()
  process.exit(1)
}
console.log(`ALL ${REQUIRED.length} LABELS PRESENT IN THE DEPLOYED PDF — OK.`)
await browser.close()
