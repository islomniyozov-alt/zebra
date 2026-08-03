import { chromium } from 'playwright'
import { writeFileSync, unlinkSync } from 'node:fs'

// ---------------------------------------------------------------------------
// A DOCUMENT UPLOAD, END TO END, AGAINST ANY DEPLOYED WORKER.
//
// §9's upload path is browser → R2 with a presigned URL; the Worker never sees
// the bytes. That makes three separate things able to break it, each silently
// and each somewhere different:
//
//   the bucket's CORS rule      a missing origin fails the PUT in the browser
//                               with "network error" and nothing server-side
//   the R2 key pair             a token scoped to the wrong bucket signs a
//                               URL that R2 then refuses
//   the confirm round trip      the object lands and the row never appears
//
// So this proves all three in one pass: upload through the interface, reload,
// and then FOLLOW THE DOWNLOAD LINK — a presigned GET that only answers if the
// object is genuinely in the bucket. A row in the table proves the confirm
// call; the bytes coming back prove R2 has the file.
//
// UI ONLY, no database connection. It runs against production, where the
// direct connection string is not something to have lying around.
//
// IT WILL NOT CREATE A LOAD. Pass one that already exists:
//
//   SHOT_CHROME=... node -r dotenv/config scripts/verify-upload.mjs \
//     --base https://zebra.tajikcargollc.workers.dev --load 1001
//
// The reason is §10 and it is not fussiness. Load numbers come from a counter
// that only goes forward, so a load booked to be deleted afterwards leaves a
// permanent hole in a per-authority sequence that the acceptance criteria
// require to be contiguous. In production, ride this on a real load — the
// first one a dispatcher books is ideal, since it needs a rate confirmation
// anyway.
// ---------------------------------------------------------------------------

const args = process.argv.slice(2)
const flag = (name, fallback) => {
  const index = args.indexOf(`--${name}`)
  return index === -1 ? fallback : args[index + 1]
}

const BASE = flag('base', process.env.VERIFY_BASE)
const LOAD = flag('load')
const SLOT = flag('slot', 'Rate confirmation')

if (!BASE || !LOAD) {
  console.error(
    'Usage: verify-upload.mjs --base <url> --load <loadNumber> [--slot "POD"]',
  )
  process.exit(1)
}

const TAG = `UP${Date.now().toString(36).slice(-4).toUpperCase()}`
const PDF = `${process.env.TEMP ?? '/tmp'}/${TAG}.pdf`
const BYTES =
  '%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n' +
  '2 0 obj<</Type/Pages/Kids[]/Count 0>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n'
writeFileSync(PDF, BYTES)

const results = []
const record = (label, ok, detail) => {
  results.push({ label, ok })
  console.log(`${ok ? 'ok  ' : 'FAIL'}  ${label.padEnd(52)} ${detail}`)
}

const browser = await chromium.launch(
  process.env.SHOT_CHROME ? { executablePath: process.env.SHOT_CHROME } : {},
)
const context = await browser.newContext({
  viewport: { width: 1920, height: 1080 },
})
const page = await context.newPage()

// The browser's own PUT to R2. Watched, because when CORS is wrong this is the
// only place the failure exists — the Worker's log stays clean.
const puts = []
page.on('requestfailed', (request) => {
  if (request.method() === 'PUT') {
    puts.push(`FAILED ${request.failure()?.errorText ?? 'unknown'}`)
  }
})
page.on('response', (response) => {
  if (response.request().method() === 'PUT') {
    puts.push(`${response.status()}`)
  }
})

await page.goto(`${BASE}/login`, { waitUntil: 'domcontentloaded' })
await page.fill('input[name="email"]', process.env.SEED_OWNER_EMAIL)
await page.fill('input[name="password"]', process.env.SEED_OWNER_PASSWORD)
await Promise.all([
  page.waitForURL(/\/loads/, { timeout: 90_000 }),
  page.click('button[type="submit"]'),
])

// Find the load by its number, through the list, the way a person would.
await page.goto(`${BASE}/loads`, { waitUntil: 'domcontentloaded' })
await page.waitForTimeout(2000)
const link = page.locator(`a:has-text("${LOAD}")`).first()
if ((await link.count()) === 0) {
  console.error(`Load ${LOAD} is not on the loads list. Nothing was uploaded.`)
  await browser.close()
  unlinkSync(PDF)
  process.exit(1)
}
await Promise.all([
  page.waitForURL(/\/loads\/[^/]+$/, { timeout: 60_000 }),
  link.click(),
])
record('the load opens', true, page.url().replace(BASE, ''))

const before = await page.locator('a:has-text(".pdf")').count()

// The named slot's own file input. Hydration matters: setting files before
// React has attached the change handler uploads nothing and reports nothing.
await page.waitForTimeout(3000)
const input = page
  .locator(`div:has(> div > h3:text-is("${SLOT}")) input[type="file"]`)
  .first()
if ((await input.count()) === 0) {
  console.error(`No "${SLOT}" slot on this load. Check --slot.`)
  await browser.close()
  unlinkSync(PDF)
  process.exit(1)
}
await input.setInputFiles(PDF)

// §9 wants Preparing and Uploading visibly distinct; either may be gone in a
// blink on a small file, so this waits for the outcome rather than the states.
const deadline = Date.now() + 120_000
let after = before
while (after <= before && Date.now() < deadline) {
  await page.waitForTimeout(3000)
  after = await page.locator('a:has-text(".pdf")').count()
}

record(
  'the browser PUT reached R2',
  puts.some((entry) => entry === '200'),
  puts.length > 0 ? puts.join(', ') : 'NO PUT WAS MADE',
)
record(
  'the document row appears on the load',
  after > before,
  `${before} → ${after} document(s)`,
)

// Survives a reload: the confirm call wrote a row, not just client state.
await page.reload({ waitUntil: 'domcontentloaded' })
await page.waitForTimeout(3000)
const persisted = await page.locator('a:has-text(".pdf")').count()
record('and survives a reload', persisted > before, `${persisted} document(s)`)

// The proof that R2 actually holds it: follow the download link, which is a
// presigned GET. A row with no object behind it fails exactly here.
const download = page.locator('a:has-text(".pdf")').last()
const href = await download.getAttribute('href')
const fetched = await page.evaluate(async (url) => {
  const response = await fetch(url, { redirect: 'follow' })
  return { status: response.status, length: (await response.text()).length }
}, href)
record(
  'the bytes come back from R2',
  fetched.status === 200 && fetched.length >= BYTES.length - 8,
  `HTTP ${fetched.status}, ${fetched.length} bytes (sent ${BYTES.length})`,
)

await page.screenshot({ path: 'screenshots/verify-upload.png' })
await browser.close()
unlinkSync(PDF)

console.log(
  '\nThe uploaded document is left in place — it belongs to a real load.',
)
const failed = results.filter((r) => !r.ok).length
console.log(`${results.length - failed}/${results.length} passed`)
process.exit(failed === 0 ? 0 : 1)
