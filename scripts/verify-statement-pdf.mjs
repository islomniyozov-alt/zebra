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
  'Earnings',
  'Load number',
  'Load gross',
  'Total miles',
  'Total amount',
  'Net Pay:',
]

// ── TWO LABELS THAT ARE CONDITIONAL BY DESIGN ──────────────────────────
//
// The first version of this list demanded both unconditionally and reported
// three failures against two documents that were correct. The instrument had
// inherited an assumption from the corpus — every Datatruck statement in
// `corpus/` happens to have a tariff and a full year behind it — which is
// the "count the thing you are claiming" trap with a checklist instead of a
// query.
//
//   `Payment tariff:` is drawn only when there IS one. A bold label with
//   nothing after it is worse than its absence.
//
//   The YTD column is headed `YTD Earnings:` only when an opening balance
//   backs the year. Without one it reads `Earnings since 08/09:`, because
//   printing YTD over a partial figure would be a claim about a year that
//   the number is not. Finalising SB-000001 is what moved one of these
//   documents from the first form to the second.
const ytdLabel = (word, text) =>
  text.includes(`YTD ${word}:`) || new RegExp(`${word} since `).test(text)

// ── BOTH ENDS OF THE LIST, NOT THE FIRST PAGE ──────────────────────────
//
// The statements grid opens on the newest period, fifty to a page, and every
// recent batch is a draft — so scanning page one found fifty drafts and
// reported that dev had no finalised statement, minutes after one had been
// finalised. The finalised week is the OLDEST one.
//
// So the run reads the list sorted both ways and merges. It is the same grid
// and the same filter, addressed by URL, which is the property §7.4 gives
// these pages and the reason this needs no new endpoint.
const idsFrom = async (query) => {
  await page.goto(`${BASE}/payroll/statements${query}`, {
    waitUntil: 'domcontentloaded',
  })
  await page.waitForTimeout(1500)
  return page.evaluate(() =>
    [...document.querySelectorAll('a[href^="/settlements/"]')]
      .map((a) => new URL(a.href).pathname.split('/').pop())
      .filter((id, index, all) => id && all.indexOf(id) === index),
  )
}

const oldestFirst = await idsFrom('?sort=period&dir=asc')
const newestFirst = await idsFrom('')
const candidates = [...oldestFirst, ...newestFirst]
  .filter((id, index, all) => all.indexOf(id) === index)
  .slice(0, 60)

// ── ONE FINALISED AND ONE DRAFT (owner's ruling, 2026-09-30) ────────────
//
// Both, because they are different claims. The finalised one proves the
// document renders with its number; the draft proves the route no longer
// refuses, that the watermark is on it, and that the placeholder id is NOT.
// Checking only the first would leave the whole ruling unverified.
// THE CELL AFTER THE `Total amount` HEADER is the first load's Load number;
// with an empty Earnings table that cell is the `Total:` row instead. Defined
// here because both the scan and the selection need it, and a scan whose exit
// test disagrees with the selection stops before it has what it needs.
const firstLoadCell = (text) => {
  const lines = text.split(String.fromCharCode(10))
  const cell = lines[lines.indexOf('Total amount') + 1]
  return cell === undefined || cell === 'Total:' ? null : cell
}
const hasLoadRows = (text) => firstLoadCell(text) !== null

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
  // STOP WHEN BOTH KINDS ARE IN HAND, not after a fixed count. The statements
  // list opens on the newest period and every recent batch is a draft, so a
  // twelve-row scan found twelve drafts and reported no finalised statement
  // on dev — four minutes after one had been finalised.
  // THE SAME CONDITION THE SELECTION USES, or the loop stops before it has
  // what the selection needs. It stopped at five documents, none of which had
  // earnings rows, and then reported that none did — a scan whose exit test
  // disagrees with its purpose.
  const usable = (wantDraft) =>
    fetched.some(
      (r) => r.text.includes('DRAFT') === wantDraft && hasLoadRows(r.text),
    )
  if (usable(true) && usable(false)) break
}

// ── BOTH DOCUMENTS MUST HAVE EARNINGS ROWS ──────────────────────────────
//
// The first pass of this picked two statements with NO load lines — an old
// per-driver STL- row and a batch-less draft — and reported every check
// green. It was green over nothing: a statement with an empty Earnings table
// cannot demonstrate the Load number column, which is the thing the ruling of
// 2026-09-30 changed.
//
// A DOCUMENT IS ONLY EVIDENCE FOR WHAT IT ACTUALLY SHOWS. The cell after the
// `Total amount` header is the first load's Load number; when the table is
// empty that cell is the `Total:` row instead, which is how this is told.
const withLoads = fetched.filter((row) => hasLoadRows(row.text))
const finalised = withLoads.find((row) => !row.text.includes('DRAFT'))
const draft = withLoads.find((row) => row.text.includes('DRAFT'))

if (!finalised || !draft) {
  console.error(
    `NEED ONE FINALISED AND ONE DRAFT, EACH WITH EARNINGS ROWS. ` +
      `fetched ${fetched.length}, with load lines ${withLoads.length}, ` +
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
  // THE NUMBER AND THE FIRST LOAD CELL, so the report reads as evidence
  // rather than as a row of ticks somebody has to take on trust.
  const numbered = row.text.match(/\b(?:ST|STL)-\d+\b/)
  console.log(
    `${label}  ${row.id}   ${row.body.length} bytes   ` +
      `number ${numbered ? numbered[0] : '(none)'}   ` +
      `first load cell ${JSON.stringify(firstLoadCell(row.text))}`,
  )
  const checks = [
    ['is a PDF', row.body.toString('latin1').startsWith('%PDF-')],
    ['has the watermark', row.text.includes('DRAFT') === isDraft],
    ['no placeholder id on the page', !/DRAFT-[a-z0-9]{4}/.test(row.text)],
    ...REQUIRED.map((label_) => [label_, row.text.includes(label_)]),
    ['YTD or since-date Earnings', ytdLabel('Earnings', row.text)],
    ['YTD or since-date Net Pay', ytdLabel('Net Pay', row.text)],
    // THE RULING ITSELF, not a proxy for it. A finalised sheet carries an
    // issued number; a draft's Settlement line is empty and the watermark
    // explains why.
    [
      isDraft ? 'no number on the draft' : 'carries an issued number',
      // BOTH ISSUED SERIES, which is the allowlist `settlement-number.ts`
      // already defines: `ST-` is the organization-wide one and `STL-` is the
      // older per-driver path that still owns two paid rows on dev. The first
      // version demanded `ST-\d{6}` and failed against STL-1001 — a correct
      // document with a legitimately issued number, reported as missing one.
      // Third time an instrument in this file has been narrower than the
      // thing it measures.
      isDraft
        ? !/\b(ST|STL)-\d+\b/.test(row.text)
        : /\b(ST|STL)-\d+\b/.test(row.text),
    ],
  ]
  let missedHere = 0
  for (const [what, ok] of checks) {
    if (!ok) {
      bad += 1
      missedHere += 1
    }
    console.log(`  ${ok ? 'ok  ' : 'MISS'}  ${what}`)
  }
  // ON A MISS, SHOW THE SHEET. A checklist that says what is absent and not
  // what IS there sends the reader back to fetch the document by hand, which
  // is the step this script exists to remove.
  if (missedHere > 0) {
    console.log('  --- first 30 strings drawn ---')
    for (const line of row.text.split(String.fromCharCode(10)).slice(0, 30)) {
      console.log(`      ${JSON.stringify(line)}`)
    }
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
