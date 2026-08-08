import { chromium } from 'playwright'
import { neonConfig, Pool } from '@neondatabase/serverless'
import { readFileSync, readdirSync, writeFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'

// ---------------------------------------------------------------------------
// TRUTH SHEETS FOR THE CORPUS (Phase 5 §2).
//
// One sheet per document, to be corrected by hand. §2: "The owner supplies
// 8–12 real documents with hand-checked truth for each field. That golden set
// is the acceptance instrument for §5."
//
// WHAT THIS PRODUCES IS NOT TRUTH. It is the model's answer, laid out so that
// correcting it is faster than typing it — and every sheet says so at the top,
// because a draft that looks finished is a draft nobody reads carefully. Each
// field carries `extracted`, the `confidence` the model claimed, and a `truth`
// slot that starts as a copy and is the ONLY field the accuracy run reads.
//
// The bias this introduces is real and worth naming rather than engineering
// around: a reviewer shown an answer agrees with it more readily than one
// shown a blank. The mitigations are that the confidence is printed beside
// every value, that `verified` starts false and the accuracy run refuses a
// sheet that still says so, and that the two are separate keys so a correction
// never erases what the model actually said.
//
//   SHOT_CHROME=... node -r dotenv/config scripts/draft-truth-sheets.mjs
// ---------------------------------------------------------------------------

const BASE =
  process.env.VERIFY_BASE ?? 'https://zebra-dev.tajikcargollc.workers.dev'
const CORPUS = 'corpus'
const OUT = join(CORPUS, 'truth')

neonConfig.webSocketConstructor ??= WebSocket
neonConfig.poolQueryViaFetch = false
const pool = new Pool({ connectionString: process.env.DIRECT_DATABASE_URL })

const companyId = (
  await pool.query(
    `select c.id from "Company" c
       join "Membership" m on m."organizationId" = c."organizationId"
       join "User" u on u.id = m."userId"
      where u.email = $1 order by c.name asc limit 1`,
    [process.env.SEED_OWNER_EMAIL],
  )
).rows[0].id

const documents = readdirSync(CORPUS)
  .filter((name) => name.toLowerCase().endsWith('.pdf'))
  .sort()

if (documents.length === 0) {
  console.error(`No PDFs in ./${CORPUS}.`)
  process.exit(1)
}

mkdirSync(OUT, { recursive: true })
console.log(`${documents.length} documents\n`)

const browser = await chromium.launch(
  process.env.SHOT_CHROME ? { executablePath: process.env.SHOT_CHROME } : {},
)
const page = await (await browser.newContext()).newPage()

await page.goto(`${BASE}/login`, { waitUntil: 'domcontentloaded' })
await page.fill('input[name="email"]', process.env.SEED_OWNER_EMAIL)
await page.fill('input[name="password"]', process.env.SEED_OWNER_PASSWORD)
await page.click('button[type="submit"]')
await page.waitForURL(/\/(loads|dashboard)/, { timeout: 60_000 })

/** `RC CA to IL.pdf` -> `rc-ca-to-il` */
const slugOf = (name) =>
  name
    .replace(/\.pdf$/i, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')

let totalMilliCents = 0
let read = 0
const failures = []

for (const name of documents) {
  const bytes = readFileSync(join(CORPUS, name))
  process.stdout.write(`  ${name.padEnd(56)} `)

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
      const body = await extract.json().catch(() => ({}))
      return { pendingUploadId, status: extract.status, body }
    },
    { data: Array.from(bytes), filename: name, company: companyId },
  )

  if (answer.pendingUploadId) {
    await pool.query('delete from "PendingUpload" where id = $1', [
      answer.pendingUploadId,
    ])
  }

  if (answer.error || answer.status !== 200) {
    const why = answer.error ?? `${answer.body?.error}: ${answer.body?.message}`
    console.log(`FAILED  ${String(why).slice(0, 60)}`)
    failures.push({ name, why })
    // A REFUSAL IS ALSO A SHEET. A document the reader cannot read is the most
    // important row in the accuracy table, and leaving it out would make the
    // corpus look smaller and the score look better.
    writeFileSync(
      join(OUT, `${slugOf(name)}.json`),
      JSON.stringify(
        {
          document: name,
          verified: false,
          extractionFailed: String(why),
          note: 'Extraction refused this document. Fill the fields by hand; the accuracy run counts every one of them as a miss.',
          fields: {},
        },
        null,
        2,
      ) + '\n',
    )
    continue
  }

  const { extracted, money, cost } = answer.body
  totalMilliCents += cost?.milliCents ?? 0
  read += 1
  console.log(`${cost?.display ?? '?'}   ${cost?.inputTokens ?? '?'} in`)

  writeFileSync(
    join(OUT, `${slugOf(name)}.json`),
    sheet(name, extracted, money),
  )
}

await browser.close()
await pool.end()

console.log('')
console.log('  ' + '='.repeat(64))
console.log(`  ${read} of ${documents.length} read`)
console.log(
  `  total ${(totalMilliCents / 1000).toFixed(1)}¢   average ${
    read ? (totalMilliCents / read / 1000).toFixed(3) : '—'
  }¢ per document`,
)
if (failures.length) {
  console.log('')
  for (const f of failures) console.log(`  REFUSED  ${f.name}`)
}
console.log('')
console.log(`  Sheets in ./${OUT}. Correct the "truth" values; leave`)
console.log(
  '  "extracted" alone — the run reports the difference between them.',
)
console.log('  Set "verified": true on each sheet you have finished.')
console.log('  ' + '='.repeat(64))

/**
 * One document's sheet.
 *
 * Flat and ordered: a reviewer reads top to bottom once. Stops are numbered
 * rather than nested because a nested structure is a structure to navigate,
 * and the point of this file is that every line is a line.
 */
function sheet(name, extracted, money) {
  const fields = {}

  const put = (key, field) => {
    fields[key] = {
      extracted: field ? field.value : null,
      confidence: field ? field.confidence : null,
      // Starts as a copy, and is the ONLY thing the accuracy run reads. A
      // field the document does not carry is null here too — "absent" is an
      // answer and the run scores it.
      truth: field ? field.value : null,
    }
  }

  for (const key of [
    'brokerName',
    'brokerReference',
    'bolNumber',
    'poNumber',
    'commodity',
    'weightLbs',
    'pieces',
    'pallets',
    'equipmentType',
    'tempF',
    'isHazmat',
    'isTeam',
    'sealNumber',
  ]) {
    put(key, extracted[key])
  }

  for (const [index, stop] of (extracted.stops ?? []).entries()) {
    for (const key of [
      'type',
      'name',
      'addressLine1',
      'city',
      'state',
      'postalCode',
      'scheduledAt',
      'windowStart',
      'windowEnd',
      'referenceNumber',
    ]) {
      put(`stops[${index}].${key}`, stop[key])
    }
  }

  // MONEY AS CENTS, because that is what the system stores and therefore what
  // an accuracy claim about money has to be about. The printed string is kept
  // beside it so a reviewer can check the parse without opening the PDF.
  const cents = (label, value, printed) => {
    fields[label] = { extracted: value, printed: printed ?? null, truth: value }
  }
  cents(
    'money.linehaulCents',
    money?.linehaulCents ?? null,
    extracted.money?.linehaul?.value,
  )
  cents(
    'money.fuelSurchargeCents',
    money?.fuelSurchargeCents ?? null,
    extracted.money?.fuelSurcharge?.value,
  )
  cents(
    'money.totalCents',
    money?.totalCents ?? null,
    extracted.money?.total?.value,
  )

  return (
    JSON.stringify(
      {
        document: name,
        // FLIPPED BY HAND, and the accuracy run refuses a sheet that still
        // says false — so an uncorrected draft cannot quietly become a score.
        verified: false,
        note: 'These values are the MODEL’S ANSWER, not truth. Correct every "truth" line; leave "extracted" alone. A field the document does not carry is null.',
        stopCount: (extracted.stops ?? []).length,
        moneyAgrees: money?.totalAgrees ?? null,
        unreadableMoney: money?.unreadable ?? [],
        fields,
      },
      null,
      2,
    ) + '\n'
  )
}
