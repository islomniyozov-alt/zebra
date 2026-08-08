import { chromium } from 'playwright'
import { neonConfig, Pool } from '@neondatabase/serverless'

// ---------------------------------------------------------------------------
// ONE REAL EXTRACTION, ON THE DEPLOYED WORKER (Phase 5).
//
// `ANTHROPIC_API_KEY` lives on the workers and deliberately not on this
// machine, so the only way to prove the key works is to go through a worker —
// which is also the only way the rest of the phase will ever call it.
//
// The document is a rate confirmation this script BUILDS: a hand-written PDF in
// the same eight objects `pdf.ts` uses for invoices. §2's corpus of real broker
// documents is still owed and is what an ACCURACY claim needs; this proves the
// pipeline — key, call, parse, money-to-cents, OCR columns, cost — against a
// document whose every value is known because we wrote it.
//
// It prints what the call cost. §5: "the per-load cents are a measured fact,
// not a hope."
//
//   SHOT_CHROME=... node -r dotenv/config scripts/verify-extraction.mjs
// ---------------------------------------------------------------------------

const BASE =
  process.env.VERIFY_BASE ?? 'https://zebra-dev.tajikcargollc.workers.dev'
const TAG = `RC${Date.now().toString(36).slice(-4).toUpperCase()}`

neonConfig.webSocketConstructor ??= WebSocket
neonConfig.poolQueryViaFetch = false
const pool = new Pool({ connectionString: process.env.DIRECT_DATABASE_URL })

const results = []
const record = (label, ok, detail) => {
  results.push({ label, ok })
  console.log(`${ok ? 'ok  ' : 'FAIL'}  ${label.padEnd(52)} ${detail}`)
}

// --- the document -------------------------------------------------------------
//
// Everything on it is a value this script knows, so "did it read the document"
// is a comparison rather than an impression.
const TRUTH = {
  broker: 'Cascade Freight Partners',
  brokerReference: `CFP-${TAG}`,
  bol: `BOL-${TAG}-77`,
  commodity: 'Frozen blueberries',
  weightLbs: 41200,
  pallets: 22,
  tempF: -10,
  pickupCity: 'Salem',
  pickupState: 'OR',
  deliveryCity: 'Sacramento',
  deliveryState: 'CA',
  linehaul: '$2,450.00',
  fuel: '$387.50',
  detention: '$120.00',
  total: '$2,957.50',
}

const LINES = [
  ['F2', 16, `${TRUTH.broker}`],
  ['F1', 10, 'RATE CONFIRMATION'],
  ['F1', 10, `Load / Reference: ${TRUTH.brokerReference}`],
  ['F1', 10, `BOL: ${TRUTH.bol}`],
  ['F1', 10, ''],
  ['F2', 11, 'PICKUP'],
  ['F1', 10, 'Willamette Cold Storage'],
  ['F1', 10, '3120 Turner Road SE'],
  ['F1', 10, `${TRUTH.pickupCity}, ${TRUTH.pickupState} 97302`],
  ['F1', 10, 'Date: 08/14/2026   Time: 07:00'],
  ['F1', 10, 'PU Number: PU-99341'],
  ['F1', 10, ''],
  ['F2', 11, 'DELIVERY'],
  ['F1', 10, 'Golden State Distribution'],
  ['F1', 10, '8800 Elder Creek Road'],
  ['F1', 10, `${TRUTH.deliveryCity}, ${TRUTH.deliveryState} 95828`],
  ['F1', 10, 'Date: 08/15/2026   Time: 06:00 - 10:00'],
  ['F1', 10, 'DEL Number: DL-20551'],
  ['F1', 10, ''],
  ['F2', 11, 'FREIGHT'],
  ['F1', 10, `Commodity: ${TRUTH.commodity}`],
  ['F1', 10, `Weight: ${TRUTH.weightLbs} lbs      Pallets: ${TRUTH.pallets}`],
  ['F1', 10, `Equipment: 53' Reefer      Temp: ${TRUTH.tempF} F continuous`],
  ['F1', 10, 'Seal required at pickup. Driver must not break seal.'],
  ['F1', 10, ''],
  ['F2', 11, 'PAY'],
  ['F1', 10, `Line Haul                 ${TRUTH.linehaul}`],
  ['F1', 10, `Fuel Surcharge            ${TRUTH.fuel}`],
  ['F1', 10, `Detention (2 hrs)         ${TRUTH.detention}`],
  ['F2', 11, `TOTAL                     ${TRUTH.total}`],
]

function buildPdf() {
  const escape = (value) => value.replace(/[\\()]/g, (c) => `\\${c}`)
  let content = 'BT\n1 0 0 1 56 736 Tm\n'
  let first = true
  for (const [font, size, text] of LINES) {
    content += `/${font} ${size} Tf\n`
    content += first ? '' : '0 -18 Td\n'
    content += `(${escape(text)}) Tj\n`
    first = false
  }
  content += 'ET'

  const encoder = new TextEncoder()
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] ' +
      '/Resources << /Font << /F1 5 0 R /F2 6 0 R >> >> /Contents 4 0 R >>',
    `<< /Length ${encoder.encode(content).length} >>\nstream\n${content}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>',
  ]

  let pdf = '%PDF-1.4\n'
  const offsets = []
  for (const [index, object] of objects.entries()) {
    offsets.push(encoder.encode(pdf).length)
    pdf += `${index + 1} 0 obj\n${object}\nendobj\n`
  }
  const xrefOffset = encoder.encode(pdf).length
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`
  for (const offset of offsets) {
    pdf += `${String(offset).padStart(10, '0')} 00000 n \n`
  }
  pdf +=
    `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\n` +
    `startxref\n${xrefOffset}\n%%EOF\n`
  return encoder.encode(pdf)
}

const pdfBytes = buildPdf()
console.log(`document: ${pdfBytes.length} bytes, ${LINES.length} lines\n`)

const browser = await chromium.launch(
  process.env.SHOT_CHROME ? { executablePath: process.env.SHOT_CHROME } : {},
)
const context = await browser.newContext({
  viewport: { width: 1600, height: 900 },
})
const page = await context.newPage()

await page.goto(`${BASE}/login`, { waitUntil: 'domcontentloaded' })
await page.fill('input[name="email"]', process.env.SEED_OWNER_EMAIL)
await page.fill('input[name="password"]', process.env.SEED_OWNER_PASSWORD)
await page.click('button[type="submit"]')
await page.waitForURL(/\/(loads|dashboard)/, { timeout: 60_000 })

// --- upload it through the ordinary pipeline ----------------------------------
//
// Mint, PUT, confirm — the same three moments every document in this system
// goes through. Extraction is not a side door.
const load = (
  await pool.query(
    `select id from "Load" where "deletedAt" is null order by "createdAt" desc limit 1`,
  )
).rows[0]

const documentId = await page.evaluate(
  async ({ bytes, loadId, filename }) => {
    const data = new Uint8Array(bytes)
    const digest = await crypto.subtle.digest('SHA-256', data)
    const sha256 = btoa(String.fromCharCode(...new Uint8Array(digest)))

    const minted = await fetch('/api/documents/upload-url', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        entity: 'load',
        entityId: loadId,
        filename,
        mimeType: 'application/pdf',
        sizeBytes: data.byteLength,
        sha256,
        documentType: 'RATE_CONFIRMATION',
      }),
    })
    if (!minted.ok) throw new Error(`mint ${minted.status}`)
    const { pendingUploadId, url, headers } = await minted.json()

    const put = await fetch(url, { method: 'PUT', headers, body: data })
    if (!put.ok) throw new Error(`put ${put.status}`)

    const confirmed = await fetch('/api/documents/confirm', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ pendingUploadId }),
    })
    if (!confirmed.ok) throw new Error(`confirm ${confirmed.status}`)
    return (await confirmed.json()).documentId
  },
  {
    bytes: Array.from(pdfBytes),
    loadId: load.id,
    filename: `${TAG}-ratecon.pdf`,
  },
)

record(
  'the rate confirmation uploads and confirms',
  Boolean(documentId),
  documentId,
)

// --- extract ------------------------------------------------------------------
const started = Date.now()
const answer = await page.evaluate(async (id) => {
  const response = await fetch(`/api/documents/${id}/extract`, {
    method: 'POST',
  })
  return { status: response.status, body: await response.json() }
}, documentId)
const elapsed = Date.now() - started

if (answer.status !== 200) {
  record('the extraction call succeeds', false, JSON.stringify(answer.body))
} else {
  record('the extraction call succeeds', true, `${elapsed} ms`)
}

const got = answer.body?.extracted ?? {}
const money = answer.body?.money ?? {}
const value = (field) => field?.value ?? null

// --- did it read the document -------------------------------------------------
const field = (label, actual, expected) =>
  record(
    `reads ${label}`,
    String(actual ?? '').toLowerCase() === String(expected).toLowerCase(),
    `${actual ?? '(null)'}${String(actual ?? '').toLowerCase() === String(expected).toLowerCase() ? '' : `  != ${expected}`}`,
  )

field('the broker', value(got.brokerName), TRUTH.broker)
field('the BOL', value(got.bolNumber), TRUTH.bol)
field('the commodity', value(got.commodity), TRUTH.commodity)
field('the weight', value(got.weightLbs), TRUTH.weightLbs)
field('the temperature', value(got.tempF), TRUTH.tempF)
field('the equipment', value(got.equipmentType), 'REEFER')

const stops = got.stops ?? []
record(
  'reads both stops, in order',
  stops.length === 2 &&
    value(stops[0]?.type) === 'PICKUP' &&
    value(stops[1]?.type) === 'DELIVERY',
  `${stops.length} stops`,
)
field('the pickup city', value(stops[0]?.city), TRUTH.pickupCity)
field('the delivery city', value(stops[1]?.city), TRUTH.deliveryCity)

// --- money, through money.ts ---------------------------------------------------
record(
  'the linehaul reaches cents',
  money.linehaulCents === 245000,
  `${money.linehaulCents} cents from ${TRUTH.linehaul}`,
)
record(
  'the fuel surcharge reaches cents',
  money.fuelSurchargeCents === 38750,
  `${money.fuelSurchargeCents} cents from ${TRUTH.fuel}`,
)
record(
  'the parts add to the printed total',
  money.totalCents === 295750 && money.totalAgrees === true,
  `${money.totalCents} cents, agrees=${money.totalAgrees}`,
)

// --- the columns ----------------------------------------------------------------
const stored = (
  await pool.query(
    'select "ocrStatus", "ocrText", "ocrError", "extractedJson" from "Document" where id = $1',
    [documentId],
  )
).rows[0]
record(
  'the OCR columns are written',
  stored.ocrStatus === 'COMPLETED' &&
    stored.ocrError === null &&
    Boolean(stored.ocrText) &&
    Boolean(stored.extractedJson),
  `${stored.ocrStatus}, ${stored.ocrText?.length ?? 0} chars of raw text`,
)

// --- what it cost ----------------------------------------------------------------
const cost = answer.body?.cost
console.log('')
console.log('  ' + '='.repeat(66))
console.log('  ONE DOCUMENT, MEASURED')
console.log(`    model            ${cost?.model}`)
console.log(`    input tokens     ${cost?.inputTokens}`)
console.log(`    output tokens    ${cost?.outputTokens}`)
console.log(`    cost             ${cost?.display}`)
console.log(`    wall time        ${elapsed} ms`)
console.log('')
console.log('    Computed from the price list recorded in claude.ts on')
console.log('    2026-08-07. It is a calculation from a constant, not a bill.')
console.log('  ' + '='.repeat(66))

await browser.close()

await pool.query('delete from "Document" where id = $1', [documentId])
await pool.end()

const failed = results.filter((r) => !r.ok).length
console.log(`\n${results.length - failed}/${results.length} passed`)
process.exit(failed === 0 ? 0 : 1)
