import { chromium } from 'playwright'
import { neonConfig, Pool } from '@neondatabase/serverless'

// ---------------------------------------------------------------------------
// PASTE TEXT, END TO END ON THE DEPLOYED WORKER (Phase 6 §4 step 2).
//
// The brief's §1.2: "an Excel sheet, a pasted prompt, and a PDF are all just
// documents. One extraction contract, one parser discipline." So this asserts
// the paste is not a side path: it mints, it stores, it extracts through the
// same endpoint, it prefills the same form, and the words are KEPT — which is
// what spec §19's audit trail asks for.
//
//   SHOT_CHROME=... node -r dotenv/config scripts/verify-paste-text.mjs
// ---------------------------------------------------------------------------

const BASE =
  process.env.VERIFY_BASE ?? 'https://zebra-dev.tajikcargollc.workers.dev'
const TAG = `PT${Date.now().toString(36).slice(-4).toUpperCase()}`

// A booking as a dispatcher would paste it out of an email — no letterhead,
// no layout, just the words. Three stops, so the multi-stop form is exercised
// by something that never was a PDF.
const PASTED = [
  `Load ${TAG} — Meridian Freight Group`,
  '',
  'Pick up 08/20/2026 at Kalmbach Feeds, 5968 State Highway 199, Carey, OH 43316',
  'Then pick up 08/20/2026 at Stoughton, 302 23rd St, Brodhead, WI 53520',
  'Deliver 08/22/2026 to Chewy ACS, 600 New Commerce Blvd, Wilkes Barre, PA 18706',
  '',
  `BOL ${TAG}-BOL   PO ${TAG}-PO`,
  'Commodity: pet food, 38,000 lbs, dry van',
  'Rate: $3,100.00 all in',
].join('\n')

neonConfig.webSocketConstructor ??= WebSocket
neonConfig.poolQueryViaFetch = false
const pool = new Pool({ connectionString: process.env.DIRECT_DATABASE_URL })

const results = []
const record = (label, ok, detail) => {
  results.push({ label, ok })
  console.log(`${ok ? 'ok  ' : 'FAIL'}  ${label.padEnd(56)} ${detail}`)
}

const browser = await chromium.launch(
  process.env.SHOT_CHROME ? { executablePath: process.env.SHOT_CHROME } : {},
)
const page = await (
  await browser.newContext({ viewport: { width: 1600, height: 1100 } })
).newPage()

await page.goto(`${BASE}/login`, { waitUntil: 'domcontentloaded' })
await page.fill('input[name="email"]', process.env.SEED_OWNER_EMAIL)
await page.fill('input[name="password"]', process.env.SEED_OWNER_PASSWORD)
await page.click('button[type="submit"]')
await page.waitForURL(/\/(loads|dashboard)/, { timeout: 60_000 })

await page.goto(`${BASE}/loads/new`, { waitUntil: 'domcontentloaded' })

// Hydration, by typing into a controlled input and reading it back — the same
// gate every walkthrough since Phase 5 flag 7 uses.
let hydrated = false
for (let attempt = 0; attempt < 30; attempt++) {
  await page.fill('input[name="miles"]', '760')
  await page.waitForTimeout(200)
  if ((await page.locator('input[name="miles"]').inputValue()) === '760') {
    hydrated = true
    break
  }
  await page.waitForTimeout(500)
}
record('the page is hydrated before anything is pasted', hydrated, '')

// --- the chooser ------------------------------------------------------------
record(
  'the four methods are on the same surface',
  (await page.locator('[role="tab"]').count()) === 4,
  `${await page.locator('[role="tab"]').count()} tabs`,
)
record(
  'and Manual is the one selected, so the typed path is not a fallback',
  (await page
    .locator('[role="tab"][aria-selected="true"]')
    .first()
    .textContent()) === 'Manual',
  'Manual selected',
)

await page.locator('[role="tab"]', { hasText: 'Paste text' }).click()
await page.fill('textarea', PASTED)
await page.locator('button', { hasText: 'Read this text' }).click()

// --- settle ------------------------------------------------------------------
const snapshot = () =>
  page.evaluate(() => {
    const value = (name) =>
      document.querySelector(`input[name="${name}"]`)?.value?.trim() ?? null
    return {
      broker: value('broker'),
      places: [...document.querySelectorAll('input[name$=".place"]')].map((n) =>
        n.value.trim(),
      ),
      types: [...document.querySelectorAll('select[name$=".type"]')].map(
        (n) => n.value,
      ),
      dates: [...document.querySelectorAll('input[name$=".date"]')].map((n) =>
        n.value.trim(),
      ),
      bol: value('bol'),
      rate: value('rate'),
      pendingUploadId:
        document.querySelector('input[name="pendingUploadId"]')?.value ?? null,
    }
  })

let form = await snapshot()
let stable = 0
for (let attempt = 0; attempt < 90; attempt++) {
  await page.waitForTimeout(1_000)
  const next = await snapshot()
  const same = JSON.stringify(next) === JSON.stringify(form)
  form = next
  if (!form.broker) {
    stable = 0
    continue
  }
  if (same && ++stable >= 2) break
  if (!same) stable = 0
}

record(
  'pasted words fill the broker',
  form.broker?.toLowerCase().includes('meridian'),
  `${form.broker || '(empty)'}`,
)
record(
  'THREE stops, from text that was never a document',
  form.places.length === 3,
  `${form.places.length} stops: ${form.places.join(' · ')}`,
)
record(
  'and the types are the ones the words said — pick, pick, deliver',
  form.types.join(',') === 'PICKUP,PICKUP,DELIVERY',
  form.types.join(', ') || '(none)',
)
record(
  'every stop carries its own date',
  form.dates.filter(Boolean).length === 3,
  form.dates.join(' · '),
)
record(
  'the BOL rides through the same fields a PDF uses',
  (form.bol ?? '').includes(TAG),
  `${form.bol || '(empty)'}`,
)
record(
  'the rate reaches the form as a plain decimal',
  form.rate === '3100.00',
  `${form.rate ?? '(no field)'}`,
)

// --- the paste is a DOCUMENT, and the words are kept -------------------------
const stored = form.pendingUploadId
  ? (
      await pool.query(
        `select "mimeType", "ocrStatus", "ocrText" from "PendingUpload" where id = $1`,
        [form.pendingUploadId],
      )
    ).rows[0]
  : null

record(
  'it minted a real document rather than a side path',
  stored?.mimeType === 'text/plain',
  `${stored?.mimeType ?? '(no mint)'}`,
)
record(
  'and KEPT the pasted words, which is what the audit trail is for',
  (stored?.ocrText ?? '').includes(TAG),
  `${stored?.ocrStatus}, ${(stored?.ocrText ?? '').length} chars`,
)

await browser.close()
if (form.pendingUploadId) {
  await pool.query('delete from "PendingUpload" where id = $1', [
    form.pendingUploadId,
  ])
}
await pool.end()

const failed = results.filter((r) => !r.ok).length
console.log(`\n${results.length - failed}/${results.length} passed`)
process.exit(failed === 0 ? 0 : 1)
