import { chromium } from 'playwright'
import { neonConfig, Pool } from '@neondatabase/serverless'
import { rateConFixture } from './_ratecon-fixture.mjs'

// ---------------------------------------------------------------------------
// FACILITY MEMORY, END TO END, ON THE DEPLOYED WORKER (Phase 5 §3 step 4).
//
// The same two-document shape as the correction-memory walkthrough, because it
// is the same claim: writing something down is a table, and READING IT BACK on
// the next document is a memory.
//
//   first upload   the dock is new — the form OFFERS to save it, unticked
//   the office     somebody ticks the box, and later writes the gate code down
//                  after a driver calls from the gate (which is the only way a
//                  gate code ever arrives — no rate confirmation prints one)
//   second upload  the same dock, printed by a different template: "Rd" for
//                  "Road" and no zip. The gate code is on the screen.
//
//   SHOT_CHROME=... node -r dotenv/config scripts/verify-facility-memory.mjs
// ---------------------------------------------------------------------------

const BASE =
  process.env.VERIFY_BASE ?? 'https://zebra-dev.tajikcargollc.workers.dev'
const TAG = `FM${Date.now().toString(36).slice(-4).toUpperCase()}`

// TWO DOCUMENTS, ONE DOCK. The second spells the street the other way and
// leaves the zip off, which is what two brokers' templates actually differ by.
const first = rateConFixture(TAG)
const second = rateConFixture(TAG, {
  pickupStreet: `3120 Turner Rd SE ${TAG}`,
  pickupZip: '',
})

const GATE_CODE = `#${TAG}`
const DOCK_NOTE = 'Dock 4 only — back in from Elder Creek.'

neonConfig.webSocketConstructor ??= WebSocket
neonConfig.poolQueryViaFetch = false
const pool = new Pool({ connectionString: process.env.DIRECT_DATABASE_URL })

const results = []
const record = (label, ok, detail) => {
  results.push({ label, ok })
  console.log(`${ok ? 'ok  ' : 'FAIL'}  ${label.padEnd(58)} ${detail}`)
}

const { organizationId } = (
  await pool.query(
    `select c."organizationId"
       from "Company" c
       join "Membership" m on m."organizationId" = c."organizationId"
       join "User" u on u.id = m."userId"
      where u.email = $1 order by c.name asc limit 1`,
    [process.env.SEED_OWNER_EMAIL],
  )
).rows[0]

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

/** Open a fresh create screen, upload, and wait for the form to settle. */
async function uploadAndSettle(bytes, label) {
  await page.goto(`${BASE}/loads/new`, { waitUntil: 'domcontentloaded' })

  let hydrated = false
  for (let attempt = 0; attempt < 30; attempt++) {
    await page.fill('input[name="miles"]', '620')
    await page.waitForTimeout(200)
    if ((await page.locator('input[name="miles"]').inputValue()) === '620') {
      hydrated = true
      break
    }
    await page.waitForTimeout(500)
  }
  if (!hydrated) throw new Error(`${label}: page never hydrated`)

  // THE UPLOAD TAB FIRST, since Phase 6 §4 step 2 put the four methods behind
  // tabs. The file input only exists on the Upload panel — which is what a
  // dispatcher clicks too, so the walkthrough now does what they do.
  await page
    .locator('[role="tab"]', { hasText: 'Upload document' })
    .click()
    .catch(() => {})

  const send = () =>
    page.setInputFiles('section input[type="file"]', {
      name: `${TAG}-${label}.pdf`,
      mimeType: 'application/pdf',
      buffer: Buffer.from(bytes),
    })

  await send()
  await page.waitForTimeout(3_000)
  const stillIdle = await page.evaluate(() =>
    [...document.querySelectorAll('[role="status"]')].some((n) =>
      (n.textContent ?? '').includes('form fills itself'),
    ),
  )
  if (stillIdle) await send()

  const snapshot = () =>
    page.evaluate(() => ({
      pickup:
        document.querySelector('input[name="stops[0].place"]')?.value?.trim() ??
        null,
      // The offer to save, and whether it is ticked. Its presence is the claim
      // for a new dock; its ABSENCE is the claim for a known one.
      offers: [...document.querySelectorAll('input[type="checkbox"]')]
        .filter((box) => box.name.startsWith('saveFacility'))
        .map((box) => ({ name: box.name, checked: box.checked })),
      text: document.querySelector('form')?.innerText ?? '',
    }))

  let form = await snapshot()
  let stable = 0
  for (let attempt = 0; attempt < 90; attempt++) {
    await page.waitForTimeout(1_000)
    const next = await snapshot()
    const same = JSON.stringify(next) === JSON.stringify(form)
    form = next
    if (!form.pickup) {
      stable = 0
      continue
    }
    if (same) {
      stable += 1
      if (stable >= 2) return form
    } else {
      stable = 0
    }
  }
  throw new Error(`${label}: form never settled`)
}

// ===========================================================================
// FIRST DOCUMENT — a dock nobody has been to.
// ===========================================================================
const one = await uploadAndSettle(first.bytes, 'first')

record(
  'a dock nobody has saved is OFFERED, not saved',
  one.offers.length > 0 && one.offers.every((offer) => !offer.checked),
  `${one.offers.length} offer(s), none ticked — §3 says offered`,
)
record(
  'and the offer names the address so a person can tell which dock it is',
  one.text.includes('Turner') && one.text.includes('Save this facility'),
  one.text.includes('Turner') ? 'street shown' : 'address missing',
)
record(
  'the stop still reads as the town, which is what the field is for',
  one.pickup?.includes(first.TRUTH.pickupCity),
  `${one.pickup}`,
)

// --- tick it and save --------------------------------------------------------------
await page.check('input[name="saveFacility0"]')
await page.locator('button[type="submit"]').first().click()

const savedFacility = async () =>
  (
    await pool.query(
      `select id, name, "addressLine1", "postalCode", "normalizedAddress",
              "gateCode", instructions
         from "Location"
        where "organizationId" = $1 and "addressLine1" like $2
        limit 1`,
      [organizationId, `%${TAG}%`],
    )
  ).rows[0] ?? null

let facility = null
for (let attempt = 0; attempt < 40; attempt++) {
  facility = await savedFacility()
  if (facility) break
  await page.waitForTimeout(1_000)
}

record(
  'ticking the box saves the facility with the document’s own address',
  Boolean(facility) && facility.postalCode === '97302',
  facility ? `${facility.name} — ${facility.addressLine1}` : '(not saved)',
)
record(
  'and does NOT invent a gate code from a rate confirmation',
  facility?.gateCode === null,
  'gateCode null — §1.4: learning is data, not guessing',
)

const load = (
  await pool.query(
    `select l.id, s."locationId", s.name
       from "Load" l
       join "LoadStop" s on s."loadId" = l.id and s.sequence = 1
      where l."organizationId" = $1
      order by l."createdAt" desc limit 1`,
    [organizationId],
  )
).rows[0]

record(
  'the stop points at the facility, not at a second row named after the town',
  load?.locationId === facility?.id,
  `${load?.name ?? '(no stop)'}`,
)

// --- what the office learns by going -----------------------------------------------
//
// No document prints a gate code. It arrives when a driver calls from the gate
// and somebody writes it down — and arriving WITH THE ADDRESS next time is the
// entire feature.
await pool.query(
  'update "Location" set "gateCode" = $2, "dockNotes" = $3 where id = $1',
  [facility.id, GATE_CODE, DOCK_NOTE],
)

// ===========================================================================
// SECOND DOCUMENT — the same dock, printed by a different template.
// ===========================================================================
const two = await uploadAndSettle(second.bytes, 'second')

record(
  '§3.4: the same dock spelled "Rd" with no zip is recognised',
  two.text.includes('Known facility'),
  two.text.includes('Known facility') ? 'matched' : 'NOT matched',
)
record(
  'and what the office wrote down arrives with the address',
  two.text.includes(GATE_CODE) && two.text.includes('Dock 4 only'),
  two.text.includes(GATE_CODE) ? `gate code ${GATE_CODE} on screen` : 'absent',
)
// THE PICKUP's offer, specifically. The delivery dock on this document is
// still new and is still offered — which is right, and which an assertion
// written as "no offers at all" got wrong on the first run: it would have
// forced the feature to stop offering a dock nobody has saved.
record(
  'the offer for THAT dock is gone — it is already saved',
  !two.offers.some((offer) => offer.name === 'saveFacility0'),
  two.offers.map((offer) => offer.name).join(', ') || '(none)',
)

// --- THE PAIR: a role that pays for the extraction and may not read the dock --
//
// ACCOUNTING holds `document:create` — it uploads and reads paperwork at
// billing time — and does NOT hold `location.manage:read`. So it is the exact
// role the payload gate exists for, and the assertion is that the `facilities`
// key is ABSENT from its answer rather than present and empty: a field the role
// cannot see is left out, and hiding it in CSS is the same bug as not checking.
const PASSWORD = 'fixture-passphrase-not-a-secret'
const PASSWORD_HASH =
  '$argon2id$v=19$m=19456,t=2,p=1$QWPZfjPNHX7SzkzEhN7lmA$cIktCmqh5BDzNiX/oDLSz2ZjmT/QWflqP2N5X2XR+hg'
const ACCOUNTANT = `accounting-${TAG.toLowerCase()}@example.test`
// A cuid-SHAPED id. `assertUserId` in src/lib/tenancy.ts requires
// /^c[a-z0-9]{24}$/ — a shorter one signs in and then dies inside the audit
// attribution with the login page showing nothing at all. The same trap
// verify-dispatcher documents, walked into again from twenty lines away and
// found the same way: wrangler tail.
const cuid = () => {
  const alphabet = 'abcdefghijklmnopqrstuvwxyz0123456789'
  let id = 'c'
  for (let index = 0; index < 24; index++) {
    id += alphabet[Math.floor(Math.random() * alphabet.length)]
  }
  return id
}

const accountantId = (
  await pool.query(
    `insert into "User" (id, email, name, "passwordHash", "isActive", "updatedAt")
       values ($4, $1, $2, $3, true, now()) returning id`,
    [ACCOUNTANT, `Accounting ${TAG}`, PASSWORD_HASH, cuid()],
  )
).rows[0].id
await pool.query(
  `insert into "Membership" (id, "userId", "organizationId", role, "updatedAt")
     values ($3, $1, $2, 'ACCOUNTING', now())`,
  [accountantId, organizationId, cuid()],
)

const accounting = await context.browser().newContext()
const accountingPage = await accounting.newPage()
await accountingPage.goto(`${BASE}/login`, { waitUntil: 'domcontentloaded' })
await accountingPage.fill('input[name="email"]', ACCOUNTANT)
await accountingPage.fill('input[name="password"]', PASSWORD)
await accountingPage.click('button[type="submit"]')
// Wherever accounting's shell lands — the role's first screen is not
// necessarily /loads, and asserting a path here would be asserting navigation
// rather than the payload this section is about.
await accountingPage
  .waitForURL((url) => !url.pathname.startsWith('/login'), { timeout: 60_000 })
  .catch(async () => {
    const said = await accountingPage
      .locator('[role="alert"], p.text-danger')
      .first()
      .textContent()
      .catch(() => null)
    throw new Error(`login as accounting failed: ${said ?? '(no message)'}`)
  })

const companyId = (
  await pool.query(
    'select id from "Company" where "organizationId" = $1 order by name asc limit 1',
    [organizationId],
  )
).rows[0].id

const asAccounting = await accountingPage.evaluate(
  async ({ data, company }) => {
    const file = new Uint8Array(data)
    const digest = await crypto.subtle.digest('SHA-256', file)
    const sha256 = btoa(String.fromCharCode(...new Uint8Array(digest)))
    const minted = await fetch('/api/documents/upload-url', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        companyId: company,
        filename: 'accounting-check.pdf',
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
    const read = await fetch(`/api/documents/${pendingUploadId}/extract`, {
      method: 'POST',
    })
    return {
      pendingUploadId,
      status: read.status,
      body: await read.json().catch(() => ({})),
    }
  },
  { data: Array.from(second.bytes), company: companyId },
)

if (asAccounting.pendingUploadId) {
  await pool.query('delete from "PendingUpload" where id = $1', [
    asAccounting.pendingUploadId,
  ])
}

record(
  'accounting may pay for an extraction — that is `document:create`',
  asAccounting.status === 200,
  `${asAccounting.status ?? asAccounting.error}`,
)
record(
  'and the facilities key is ABSENT from its answer, not empty',
  asAccounting.status === 200 && !('facilities' in (asAccounting.body ?? {})),
  'facilities' in (asAccounting.body ?? {})
    ? 'PRESENT — a gate code reached a role without location.manage:read'
    : 'left out of the payload',
)

await browser.close()

// --- cleanup -------------------------------------------------------------------------
// EVERY load this run could have made, by either handle. Cleaning up by the
// facility alone left a load hanging off the customer, and the customer delete
// then failed on its foreign key — which is a cleanup that reports a passing
// run as a crash.
const loadIds = (
  await pool.query(
    `select distinct l.id from "Load" l
       left join "LoadStop" s on s."loadId" = l.id
       left join "Customer" c on c.id = l."customerId"
      where s."locationId" = $1 or c.name = $2`,
    [facility.id, first.TRUTH.broker],
  )
).rows.map((r) => r.id)

for (const id of loadIds) {
  await pool.query('delete from "ExtractionCorrection" where "loadId" = $1', [
    id,
  ])
  await pool.query('delete from "Document" where "loadId" = $1', [id])
  await pool.query('delete from "LoadStatusEvent" where "loadId" = $1', [id])
  await pool.query('delete from "LoadStop" where "loadId" = $1', [id])
  await pool.query('delete from "Load" where id = $1', [id])
}
await pool.query('delete from "Location" where id = $1', [facility.id])
await pool.query('delete from "Customer" where name = $1', [first.TRUTH.broker])
await pool.query('delete from "CustomerAlias" where alias = $1', [
  first.TRUTH.broker,
])
await pool.query('delete from "PendingUpload" where filename like $1', [
  `%${TAG}%`,
])
await pool.query('delete from "Membership" where "userId" = $1', [accountantId])
await pool.query('delete from "LoginAttempt" where email = $1', [ACCOUNTANT])
await pool.query('delete from "User" where id = $1', [accountantId])
await pool.end()

const failed = results.filter((r) => !r.ok).length
console.log(`\n${results.length - failed}/${results.length} passed`)
process.exit(failed === 0 ? 0 : 1)
