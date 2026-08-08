import { chromium } from 'playwright'
import { neonConfig, Pool } from '@neondatabase/serverless'
import { rateConFixture } from './_ratecon-fixture.mjs'

// ---------------------------------------------------------------------------
// UPLOAD-FIRST CREATE, END TO END, ON THE DEPLOYED WORKER (Phase 5 §3 step 2).
//
// Driven through the screen a dispatcher uses: open /loads/new, choose the rate
// confirmation in the offer slot, watch the fields fill, press Save once, and
// then read the load and its document back out of the database.
//
// The claims, and why each is here rather than assumed:
//
//   * the OFFER does not become a gate — the form is complete and submittable
//     before anything is uploaded, which is the 6.4-second typing path the
//     brief refuses to slow down;
//   * the fields fill from the DOCUMENT, compared against values this script
//     wrote into the PDF;
//   * the date arrives in the form's own typed-date convention and does not
//     shift a day on the way;
//   * the document ATTACHES AT SAVE as RATE_CONFIRMATION (§1.5), carrying the
//     extraction across from the mint;
//   * and the pending row is gone afterwards — no orphan mint, no orphan
//     document.
//
//   SHOT_CHROME=... node -r dotenv/config scripts/verify-upload-first.mjs
// ---------------------------------------------------------------------------

const BASE =
  process.env.VERIFY_BASE ?? 'https://zebra-dev.tajikcargollc.workers.dev'
const TAG = `UF${Date.now().toString(36).slice(-4).toUpperCase()}`
const { TRUTH, bytes } = rateConFixture(TAG)

neonConfig.webSocketConstructor ??= WebSocket
neonConfig.poolQueryViaFetch = false
const pool = new Pool({ connectionString: process.env.DIRECT_DATABASE_URL })

const results = []
const record = (label, ok, detail) => {
  results.push({ label, ok })
  console.log(`${ok ? 'ok  ' : 'FAIL'}  ${label.padEnd(54)} ${detail}`)
}

const browser = await chromium.launch(
  process.env.SHOT_CHROME ? { executablePath: process.env.SHOT_CHROME } : {},
)
const context = await browser.newContext({
  viewport: { width: 1600, height: 1000 },
})
const page = await context.newPage()

await page.goto(`${BASE}/login`, { waitUntil: 'domcontentloaded' })
await page.fill('input[name="email"]', process.env.SEED_OWNER_EMAIL)
await page.fill('input[name="password"]', process.env.SEED_OWNER_PASSWORD)
await page.click('button[type="submit"]')
await page.waitForURL(/\/(loads|dashboard)/, { timeout: 60_000 })

await page.goto(`${BASE}/loads/new`, { waitUntil: 'domcontentloaded' })

// --- the offer is an offer ------------------------------------------------------
record(
  'the form is complete before anything is uploaded',
  (await page.locator('button[type="submit"]').first().isEnabled()) &&
    (await page.locator('input[name="pickup"]').isEditable()),
  'save enabled, fields editable — no gate',
)

// --- upload through the offer slot ----------------------------------------------
const before = Date.now()
await page.setInputFiles('section input[type="file"]', {
  name: `${TAG}-ratecon.pdf`,
  mimeType: 'application/pdf',
  buffer: Buffer.from(bytes),
})

// Wait for the OFFER TO SAY IT IS DONE, rather than for a clock — the model
// takes about eleven seconds and a fixed sleep would be flaky or slow.
//
// Not for an attribute selector, either: `input[value*="…"]` matches the DOM
// ATTRIBUTE, and React sets the live property. The first version of this script
// waited ninety seconds on a form that had filled correctly in twelve.
// POLL THE VALUE ITSELF. Two earlier versions waited on a selector instead:
// `input[value*="…"]` matches the DOM ATTRIBUTE while React sets the live
// property, and a `[role="status"]` text filter proved just as indirect. The
// thing this script is actually asking about is what is IN the field, so it
// reads that.
let filled = 0
for (let attempt = 0; attempt < 60; attempt++) {
  const current = await page.locator('input[name="broker"]').inputValue()
  if (current.trim() !== '') {
    filled = Date.now() - before
    break
  }
  await page.waitForTimeout(1_000)
}
if (filled === 0) {
  const said = await page.locator('[role="status"]').allInnerTexts()
  record('the offer fills the form', false, said.join(' | ').slice(0, 90))
}

if (filled > 0) {
  record('the offer fills the form', true, `${filled} ms end to end`)
}

const valueOf = async (name) =>
  (await page.locator(`input[name="${name}"]`).inputValue()).trim()

const field = async (name, expected, label) => {
  const actual = await valueOf(name)
  record(
    `fills ${label}`,
    actual.toLowerCase().includes(String(expected).toLowerCase()),
    `${actual || '(empty)'}${actual.toLowerCase().includes(String(expected).toLowerCase()) ? '' : `  != ${expected}`}`,
  )
}

await field('broker', TRUTH.broker, 'the broker')
await field('pickup', TRUTH.pickupCity, 'the pickup')
await field('delivery', TRUTH.deliveryCity, 'the delivery')

// THE DATE, in the form's own convention and not a day out. The document says
// 08/14/2026; a Date object built from it in a browser west of UTC would show
// the 13th, which is why the conversion is a slice rather than a parse.
const pickupAt = await valueOf('pickupAt')
record(
  'fills the pickup date, in the typed-date convention, on the right day',
  pickupAt === '2026-08-14',
  `${pickupAt || '(empty)'}${pickupAt === '2026-08-14' ? '' : '  != 2026-08-14'}`,
)
const deliveryAt = await valueOf('deliveryAt')
record(
  'and the delivery date from the window START, not the appointment',
  deliveryAt === '2026-08-15',
  `${deliveryAt || '(empty)'}`,
)

// The rate, for an owner, through money.ts: "$2,450.00" -> "2450.00".
const rate = await valueOf('rate')
record(
  'fills the rate as a plain decimal, parsed through money.ts',
  rate === '2450.00',
  `${rate || '(empty)'}`,
)

// The provenance is on the screen, not only in the payload.
const hints = await page.locator('p:text-matches("From the document")').count()
record(
  'and says which fields came from the document',
  hints > 0,
  `${hints} fields marked`,
)

// --- save once -------------------------------------------------------------------
await page.fill('input[name="miles"]', '620')
await page.locator('button[type="submit"]').first().click()

let load = null
for (let attempt = 0; attempt < 20; attempt++) {
  load = (
    await pool.query(
      `select l.id, l."linehaulCents", c.name broker
         from "Load" l join "Customer" c on c.id = l."customerId"
        where c.name = $1 order by l."createdAt" desc limit 1`,
      [TRUTH.broker],
    )
  ).rows[0]
  if (load) break
  await page.waitForTimeout(1000)
}

record(
  'saving books the load with the broker from the document',
  Boolean(load),
  load?.id ?? '(not saved)',
)
record(
  'and the rate reaches cents',
  load?.linehaulCents === 245000,
  `${load?.linehaulCents} cents`,
)

// --- the document attached at save (§1.5) -----------------------------------------
let document = null
for (let attempt = 0; attempt < 20; attempt++) {
  document = (
    await pool.query(
      `select id, type, "ocrStatus", "extractedJson" is not null carried
         from "Document" where "loadId" = $1 order by "uploadedAt" desc limit 1`,
      [load?.id ?? ''],
    )
  ).rows[0]
  if (document) break
  await page.waitForTimeout(1000)
}

record(
  'the rate confirmation attached to the load it created',
  document?.type === 'RATE_CONFIRMATION',
  `${document?.type ?? '(none)'}`,
)
record(
  'carrying its extraction across from the mint',
  document?.ocrStatus === 'COMPLETED' && document?.carried === true,
  `${document?.ocrStatus}, extractedJson ${document?.carried ? 'present' : 'MISSING'}`,
)

const orphans = (
  await pool.query(
    `select count(*)::int n from "PendingUpload" where "filename" like $1`,
    [`%${TAG}%`],
  )
).rows[0].n
record(
  'and the mint is gone — no orphan pending row',
  orphans === 0,
  `${orphans} left behind`,
)

await browser.close()

// --- cleanup ---------------------------------------------------------------------
if (load) {
  await pool.query('delete from "Document" where "loadId" = $1', [load.id])
  await pool.query('delete from "LoadStatusEvent" where "loadId" = $1', [
    load.id,
  ])
  await pool.query('delete from "LoadStop" where "loadId" = $1', [load.id])
  await pool.query('delete from "Load" where id = $1', [load.id])
}
await pool.query('delete from "Customer" where name = $1', [TRUTH.broker])
await pool.query('delete from "PendingUpload" where filename like $1', [
  `%${TAG}%`,
])
await pool.end()

const failed = results.filter((r) => !r.ok).length
console.log(`\n${results.length - failed}/${results.length} passed`)
process.exit(failed === 0 ? 0 : 1)
