import { chromium } from 'playwright'
import { neonConfig, Pool } from '@neondatabase/serverless'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import {
  accuracyTable,
  flatten,
  INVOICE_FIELDS,
  invoiceTotals,
  scoreDocument,
  scoreRefusal,
} from './_accuracy-score.mjs'

// ---------------------------------------------------------------------------
// THE GOLDEN SET RUN (Phase 5 §5, first box).
//
// "Golden set: per-field accuracy printed as a table; every money figure that
// reached cents did so through money.ts."
//
// Every document in ./corpus is uploaded and read exactly as a dispatcher's
// browser would read it, and each field is compared against the `truth` value
// on its sheet. What is printed is a table, per field, across the corpus —
// because "94% accurate" is a number nobody can act on and "brokerName 13/13,
// stops[1].scheduledAt 6/13" is a list of what to fix.
//
// IT REFUSES AN UNVERIFIED SHEET, BY NAME. A draft sheet's `truth` is a copy of
// the model's own answer, so scoring against it produces 100% and means
// nothing. That refusal is the most important line in this file: it is what
// stops the acceptance instrument from certifying itself.
//
//   SHOT_CHROME=... node -r dotenv/config scripts/accuracy-run.mjs
// ---------------------------------------------------------------------------

const BASE =
  process.env.VERIFY_BASE ?? 'https://zebra-dev.tajikcargollc.workers.dev'
const CORPUS = 'corpus'
const SHEETS = join(CORPUS, 'truth')

neonConfig.webSocketConstructor ??= WebSocket
neonConfig.poolQueryViaFetch = false
const pool = new Pool({ connectionString: process.env.DIRECT_DATABASE_URL })

const slugOf = (name) =>
  name
    .replace(/\.pdf$/i, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')

const documents = readdirSync(CORPUS)
  .filter((name) => name.toLowerCase().endsWith('.pdf'))
  .sort()

// --- the gate -------------------------------------------------------------------
//
// Read every sheet BEFORE spending a cent on extraction. A run that reads
// thirteen documents and then discovers it cannot score them has spent the
// money for nothing.
const sheets = []
const unverified = []

for (const name of documents) {
  const path = join(SHEETS, `${slugOf(name)}.json`)
  let sheet
  try {
    sheet = JSON.parse(readFileSync(path, 'utf8'))
  } catch {
    unverified.push(`${name} — no sheet at ${path}`)
    continue
  }
  if (sheet.verified !== true) {
    unverified.push(`${name} — "verified": false`)
    continue
  }
  sheets.push({ name, sheet })
}

if (unverified.length > 0) {
  console.log('')
  console.log('  ' + '='.repeat(68))
  console.log('  THE GOLDEN SET IS NOT VERIFIED. NOTHING WAS EXTRACTED.')
  console.log('  ' + '='.repeat(68))
  console.log('')
  console.log(
    '  A drafted sheet’s "truth" is a COPY of the model’s own answer.',
  )
  console.log('  Scoring against it returns 100% and measures nothing at all —')
  console.log('  which is the one result this run must never be able to print.')
  console.log('')
  for (const line of unverified) console.log(`    ${line}`)
  console.log('')
  console.log(
    `  ${unverified.length} of ${documents.length} sheet(s) are not ready.`,
  )
  console.log('')
  console.log(
    '  Correct every "truth" line in ./corpus/truth, leave "extracted"',
  )
  console.log(
    '  alone, and set "verified": true on each sheet you have finished.',
  )
  console.log('  Then run this again.')
  console.log('')
  await pool.end()
  process.exit(2)
}

// --- the run --------------------------------------------------------------------
const companyId = (
  await pool.query(
    `select c.id from "Company" c
       join "Membership" m on m."organizationId" = c."organizationId"
       join "User" u on u.id = m."userId"
      where u.email = $1 order by c.name asc limit 1`,
    [process.env.SEED_OWNER_EMAIL],
  )
).rows[0].id

const browser = await chromium.launch(
  process.env.SHOT_CHROME ? { executablePath: process.env.SHOT_CHROME } : {},
)
const page = await (await browser.newContext()).newPage()

await page.goto(`${BASE}/login`, { waitUntil: 'domcontentloaded' })
await page.fill('input[name="email"]', process.env.SEED_OWNER_EMAIL)
await page.fill('input[name="password"]', process.env.SEED_OWNER_PASSWORD)
await page.click('button[type="submit"]')
await page.waitForURL(/\/(loads|dashboard)/, { timeout: 60_000 })

/** Every [field, outcome] pair the whole corpus produced. */
const outcomes = []

let totalMilliCents = 0
let read = 0
const refused = []
const worst = []

for (const { name, sheet } of sheets) {
  const bytes = readFileSync(join(CORPUS, name))
  process.stdout.write(`  ${name.padEnd(52)} `)

  const answer = await page.evaluate(
    async ({ data, filename, company }) => {
      const file = new Uint8Array(data)
      const digest = await crypto.subtle.digest('SHA-256', file)
      const sha256 = btoa(String.fromCharCode(...new Uint8Array(digest)))
      const minted = await fetch('/api/documents/upload-url', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          companyId: company,
          filename,
          mimeType: 'application/pdf',
          sizeBytes: file.byteLength,
          sha256,
          documentType: 'RATE_CONFIRMATION',
        }),
      })
      if (!minted.ok) return { error: `mint ${minted.status}` }
      const { pendingUploadId, url, headers } = await minted.json()
      const put = await fetch(url, { method: 'PUT', headers, body: file })
      if (!put.ok) return { error: `put ${put.status}` }
      const extract = await fetch(`/api/documents/${pendingUploadId}/extract`, {
        method: 'POST',
      })
      return {
        pendingUploadId,
        status: extract.status,
        body: await extract.json().catch(() => ({})),
      }
    },
    { data: Array.from(bytes), filename: name, company: companyId },
  )

  if (answer.pendingUploadId) {
    await pool.query('delete from "PendingUpload" where id = $1', [
      answer.pendingUploadId,
    ])
  }

  if (answer.error || answer.status !== 200) {
    // THE REASON, not just the fact. A refusal counts every field on the sheet
    // as missed, so it moves the headline by several points — and a run that
    // prints only "REFUSED" cannot tell a transient API failure from a
    // document the reader genuinely cannot handle. One of these was transient
    // and cost a re-run to find out.
    const why =
      answer.error ??
      `${answer.body?.error ?? answer.status}: ${answer.body?.message ?? ''}`
    console.log(`REFUSED  ${String(why).slice(0, 60)}`)
    refused.push({ name, why: String(why) })
    // A REFUSED DOCUMENT SCORES ZERO ON EVERY FIELD IT SHOULD HAVE HAD. Leaving
    // it out would make the corpus smaller and the number better, which is the
    // most comfortable way to publish a wrong one.
    outcomes.push(...scoreRefusal(sheet.fields))
    continue
  }

  read += 1
  totalMilliCents += answer.body.cost?.milliCents ?? 0

  const scored = scoreDocument(
    sheet.fields,
    flatten(answer.body.extracted, answer.body.money),
  )
  outcomes.push(...scored)
  const wrongHere = scored.filter(([, outcome]) => outcome !== 'right').length

  console.log(`${answer.body.cost?.display ?? '?'}   ${wrongHere} field(s) off`)
  worst.push({ name, wrongHere })
}

await browser.close()
await pool.end()

// --- the table ------------------------------------------------------------------
const rows = accuracyTable(outcomes)

console.log('')
console.log('  ' + '='.repeat(78))
console.log(`  PER-FIELD ACCURACY — ${read} of ${sheets.length} documents read`)
console.log('  ' + '='.repeat(78))
console.log(
  `  ${'field'.padEnd(30)} ${'right'.padStart(6)} ${'wrong'.padStart(6)} ` +
    `${'missed'.padStart(7)} ${'made up'.padStart(8)} ${'rate'.padStart(6)}`,
)
console.log('  ' + '-'.repeat(78))
for (const row of rows) {
  console.log(
    `  ${row.field.padEnd(30)} ${String(row.right).padStart(6)} ` +
      `${String(row.wrong).padStart(6)} ${String(row.missed).padStart(7)} ` +
      `${String(row.invented).padStart(8)} ` +
      `${(row.rate * 100).toFixed(0).padStart(5)}%`,
  )
}

const totals = rows.reduce(
  (sum, row) => ({
    right: sum.right + row.right,
    total: sum.total + row.total,
  }),
  { right: 0, total: 0 },
)
// THE INVOICE-MAKING FIELDS, BROKEN OUT (owner's ruling). Judged first,
// printed first among the totals, because a corpus that reads `pallets`
// perfectly and `stops[1].referenceNumber` badly is worse at the only job the
// extraction has.
const invoice = invoiceTotals(outcomes)
console.log('  ' + '-'.repeat(78))
console.log(
  `  ${'INVOICE-MAKING FIELDS'.padEnd(30)} ${String(invoice.right).padStart(6)} ` +
    `${String(invoice.wrong).padStart(6)} ${String(invoice.missed).padStart(7)} ` +
    `${String(invoice.invented).padStart(8)} ` +
    `${(invoice.rate * 100).toFixed(1).padStart(5)}%`,
)
console.log(
  `  ${`  ${INVOICE_FIELDS.length} fields: who to bill, their load`.padEnd(30)}`,
)
console.log(`  ${'  number, the rate, both stops'.padEnd(30)}`)
console.log('  ' + '-'.repeat(78))
console.log(
  `  ${'ALL FIELDS'.padEnd(30)} ${String(totals.right).padStart(6)} ` +
    `${' '.repeat(23)}${((totals.right / totals.total) * 100)
      .toFixed(1)
      .padStart(5)}%`,
)

console.log('')
console.log(
  `  COST   ${(totalMilliCents / 1000).toFixed(1)}¢ total, ` +
    `${read ? (totalMilliCents / read / 1000).toFixed(3) : '—'}¢ per document`,
)
console.log(
  '         computed from PRICE_CENTS_PER_MTOK in src/lib/claude.ts, which is',
)
console.log('         a constant recorded on a date — not a reading of a bill.')

if (refused.length) {
  console.log('')
  for (const entry of refused) {
    console.log(
      `  REFUSED  ${entry.name} — every field on its sheet counted missed`,
    )
    console.log(`           ${entry.why.slice(0, 70)}`)
  }
}

console.log('')
console.log('  Worst documents:')
for (const doc of worst.sort((a, b) => b.wrongHere - a.wrongHere).slice(0, 3)) {
  console.log(`    ${doc.wrongHere} off   ${doc.name}`)
}
console.log('')
