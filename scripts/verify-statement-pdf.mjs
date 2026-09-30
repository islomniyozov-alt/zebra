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

// The labels off `corpus/datatruck/ST-005562.pdf`. Present on BOTH documents
// or the deployed sheet is not the layout the owner asked for — a draft is
// missing its number and nothing else.
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

await page.goto(`${BASE}/payroll/statements`, { waitUntil: 'domcontentloaded' })
await page.waitForTimeout(1500)
const candidates = await page.evaluate(() =>
  [...document.querySelectorAll('a[href^="/settlements/"]')]
    .map((a) => new URL(a.href).pathname.split('/').pop())
    .filter((id, index, all) => id && all.indexOf(id) === index)
    .slice(0, 12),
)

// ── ONE FINALISED AND ONE DRAFT (owner's ruling, 2026-09-30) ────────────
//
// Both, because they are different claims. The finalised one proves the
// document renders with its number; the draft proves the route no longer
// refuses, that the watermark is on it, and that the placeholder id is NOT.
// Checking only the first would leave the whole ruling unverified.
const fetched = []
const refusals = []
for (const id of candidates) {
  const response = await context.request.get(
    `${origin}/api/settlements/statement/${id}`,
  )
  if (response.status() !== 200) {
    // WHY, NOT JUST "NO". A run reporting "nothing to fetch" cannot tell an
    // empty database from a route refusing everything.
    refusals.push(`${id} -> ${response.status()}`)
    continue
  }
  const body = Buffer.from(await response.body())
  const drawnHere = [
    ...body.toString('latin1').matchAll(/\(((?:\\.|[^\\()])*)\)\s*Tj/g),
  ].map((hit) => hit[1].replace(/\\([()\\])/g, '$1'))
  fetched.push({ id, body, text: drawnHere.join('\n') })
  if (fetched.length >= 12) break
}

const finalised = fetched.find((row) => !row.text.includes('DRAFT'))
const draft = fetched.find((row) => row.text.includes('DRAFT'))

if (!finalised || !draft) {
  console.error(
    `NEED ONE FINALISED AND ONE DRAFT. fetched ${fetched.length}, ` +
      `finalised ${finalised ? 'yes' : 'no'}, draft ${draft ? 'yes' : 'no'}.`,
  )
  for (const line of refusals) console.error(`  refused ${line}`)
  await browser.close()
  process.exit(1)
}

let bad = 0

for (const [label, row] of [
  ['FINALISED', finalised],
  ['DRAFT    ', draft],
]) {
  const isDraft = label.trim() === 'DRAFT'
  console.log('')
  console.log(`${label}  ${row.id}   ${row.body.length} bytes`)
  const checks = [
    ['is a PDF', row.body.toString('latin1').startsWith('%PDF-')],
    ['has the watermark', row.text.includes('DRAFT') === isDraft],
    ['no placeholder id on the page', !/DRAFT-[a-z0-9]{4}/.test(row.text)],
    ...REQUIRED.map((label_) => [label_, row.text.includes(label_)]),
  ]
  for (const [what, ok] of checks) {
    if (!ok) bad += 1
    console.log(`  ${ok ? 'ok  ' : 'MISS'}  ${what}`)
  }
}

console.log('')
if (bad > 0) {
  console.log(`${bad} CHECKS FAILED — NOT OK.`)
  await browser.close()
  process.exit(1)
}
console.log('BOTH DOCUMENTS PASS EVERY CHECK — OK.')
await browser.close()
