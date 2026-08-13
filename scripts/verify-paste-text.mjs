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

// --- A RELAY BOOKING EMAIL, WHICH IS WHAT BROKE IN PRODUCTION ---------------
//
// The owner pasted one of these and got a bare 500. The cause was the model
// call sitting inside a 60-second interactive transaction: Gemini was slow,
// the transaction expired, and the Prisma error escaped every handler into an
// empty response. So this case is not about the words — it is about the SHAPE
// of a booking email surviving a slow read.
//
// SYNTHETIC, AND THE SAME SHAPE. The real one names the owner's own company, a
// live trip and a contract UUID, and `corpus-amazon/` is gitignored for that
// reason. Everything below is invented and every QUIRK is real: no year on the
// dates, two different timezone abbreviations, a U+2010 HYPHEN rather than a
// hyphen-minus, `>` as the lane separator, money in three shapes on two lines,
// and a paragraph of legal boilerplate longer than the booking itself.
const RELAY = [
  `Load Board - Trip ${TAG}X9 booked`,
  'Dear EXAMPLE HAULAGE LLC,',
  'You have successfully booked the following trip. Visit the Upcoming tab to view trip details.',
  `${TAG}X9 Starts in 20h 37m`,
  'CONTRACT \u2010 00000000-1111-2222-3333-444444444444',
  'AAA1 SPRINGFIELD, OH >  BBB2 FRANKLIN, IL',
  'Fri 14 Aug 03:45 EDT > Fri 14 Aug 09:08 CDT',
  "53' Trailer |  Trailer provided  |  Solo Driver",
  'Estimated Payout  -  $551.81 ( $2.10/mi)  | 262.56mi',
  'Base Rate -  $268.07 ( $1.02/mi)  ( $41.89/hr)',
  '',
  'Note: This estimated payout is subject to change. If Amazon adds or',
  'removes one or more Routes to a booked Pre-Routed Trip, then Amazon',
  'will pay your company the per hour base rate for the new planned',
  'transit time of the modified trip, plus any applicable Accessorial',
  'charges; provided, that such modification was solely for reasons',
  "related to changes in Amazon's planning or network needs.",
  'This trip is power only.  Trip Requirements.',
].join('\n')

await page.goto(`${BASE}/loads/new`, { waitUntil: 'domcontentloaded' })
for (let attempt = 0; attempt < 30; attempt++) {
  await page.fill('input[name="miles"]', '262')
  await page.waitForTimeout(200)
  if ((await page.locator('input[name="miles"]').inputValue()) === '262') break
  await page.waitForTimeout(500)
}

await page.locator('[role="tab"]', { hasText: 'Paste text' }).click()
await page.fill('textarea', RELAY)
await page.locator('button', { hasText: 'Read this text' }).click()

// GENEROUS ON PURPOSE. A real Relay read has been measured at 38–53 seconds
// against a busy model, and the whole point of the fix is that slow is no
// longer the same as broken.
let relay = await snapshot()
let relayStable = 0
for (let attempt = 0; attempt < 150; attempt++) {
  await page.waitForTimeout(1_000)
  const next = await snapshot()
  const same = JSON.stringify(next) === JSON.stringify(relay)
  relay = next
  if (!relay.places.some(Boolean)) {
    relayStable = 0
    continue
  }
  if (same && ++relayStable >= 2) break
  if (!same) relayStable = 0
}

const caption =
  (await page.locator('[role="status"]').first().textContent())?.trim() ?? ''

// THE DEFECT ITSELF. A bare 500 reaches the dispatcher as "Request failed
// (500)" — no sentence, nothing to do. Whatever else happens, that string must
// never be on this screen again, and neither must a vendor's raw JSON.
record(
  'a Relay booking never answers with a bare status code',
  !/Request failed \(\d+\)/.test(caption),
  caption || '(no caption)',
)
record(
  'nor with the upstream API’s own words',
  !/Gemini returned|Claude returned|"status":|UNAVAILABLE/i.test(caption),
  'no vendor JSON on a dispatcher’s screen',
)

record(
  'the Relay lane fills both stops',
  relay.places.length >= 2 &&
    relay.places[0]?.toUpperCase().includes('SPRINGFIELD') &&
    relay.places[relay.places.length - 1]?.toUpperCase().includes('FRANKLIN'),
  relay.places.join(' · ') || '(none)',
)

// The trip id is the broker's reference, and it is the duplicate key a second
// paste of the same email would warn on.
const relayStored = relay.pendingUploadId
  ? (
      await pool.query(
        `select "ocrStatus", "ocrError" from "PendingUpload" where id = $1`,
        [relay.pendingUploadId],
      )
    ).rows[0]
  : null

record(
  'and the mint lands COMPLETED rather than FAILED',
  relayStored?.ocrStatus === 'COMPLETED',
  `${relayStored?.ocrStatus ?? '(no mint)'}${
    relayStored?.ocrError ? ` — ${relayStored.ocrError.slice(0, 90)}` : ''
  }`,
)

await browser.close()
for (const id of [form.pendingUploadId, relay.pendingUploadId]) {
  if (id) await pool.query('delete from "PendingUpload" where id = $1', [id])
}
await pool.end()

const failed = results.filter((r) => !r.ok).length
console.log(`\n${results.length - failed}/${results.length} passed`)
process.exit(failed === 0 ? 0 : 1)
