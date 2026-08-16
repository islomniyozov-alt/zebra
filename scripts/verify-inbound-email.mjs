import { chromium } from 'playwright'
import { neonConfig, Pool } from '@neondatabase/serverless'

// ---------------------------------------------------------------------------
// EMAIL-IN, END TO END ON THE DEPLOYED WORKER (Phase 6 §4 step 4).
//
// WHAT THIS PROVES AND WHAT IT CANNOT. Cloudflare Email Routing is an account
// setting on a domain, and until the MX records exist there is no way to make
// a real message arrive. So the delivery hop is NOT exercised here — it is the
// owner's runbook step — and everything either side of it is:
//
//   SMTP → mail worker          proven by tests/workers/email-parse.test.ts,
//                               which parses a real forwarded booking inside
//                               workerd, two MIME boundaries deep
//   → POST /api/inbound-email   ← this script starts here
//   → the reader
//   → the Incoming queue
//   → the create form, prefilled
//   → Save books the load and closes the draft
//
// THE PAYLOAD IS EXACTLY WHAT THE WORKER SENDS, field for field, so the only
// untested link is Cloudflare handing bytes to the worker.
//
//   INBOUND_EMAIL_SECRET=... SHOT_CHROME=... \
//     node -r dotenv/config scripts/verify-inbound-email.mjs
// ---------------------------------------------------------------------------

const BASE =
  process.env.VERIFY_BASE ?? 'https://zebra-dev.tajikcargollc.workers.dev'
const SECRET = process.env.INBOUND_EMAIL_SECRET
const TAG = `IE${Date.now().toString(36).slice(-5).toUpperCase()}`

if (!SECRET) {
  console.error('INBOUND_EMAIL_SECRET is required — the endpoint checks it.')
  process.exit(1)
}

// A real Relay booking, with the identifiers changed. Every quirk is the real
// one: no year on the dates, two timezone abbreviations, a U+2010 hyphen, `>`
// as the lane separator, and more boilerplate than booking.
const BODY = [
  `Load Board - Trip ${TAG} booked`,
  'Dear EXAMPLE HAULAGE LLC,',
  'You have successfully booked the following trip. Visit the Upcoming tab to view trip details.',
  `${TAG} Starts in 20h 37m`,
  'CONTRACT ‐ 00000000-1111-2222-3333-444444444444',
  'PCW1 ROSSFORD, OH >  MDW4 JOLIET, IL',
  'Fri 14 Aug 03:45 EDT > Fri 14 Aug 09:08 CDT',
  "53' Trailer |  Trailer provided  |  Solo Driver",
  'Estimated Payout  -  $551.81 ( $2.10/mi)  | 262.56mi',
  'Base Rate -  $268.07 ( $1.02/mi)  ( $41.89/hr)',
  '',
  'Note: This estimated payout is subject to change. If Amazon adds or removes',
  'one or more Routes to a booked Pre-Routed Trip, then Amazon will pay your',
  'company the per hour base rate for the new planned transit time.',
  'This trip is power only.  Trip Requirements.',
].join('\n')

// The `.eml` the worker would have kept, so §12's original is a real file.
const RAW = [
  'From: Amazon Relay <relay-noreply@amazon.com>',
  'To: loads@zebratms.com',
  `Subject: Load Board - Trip ${TAG} booked`,
  `Message-ID: <${TAG}@amazon.test>`,
  'MIME-Version: 1.0',
  'Content-Type: text/plain; charset="utf-8"',
  '',
  BODY,
  '',
].join('\r\n')

const rawBase64 = Buffer.from(RAW, 'utf8').toString('base64')

neonConfig.webSocketConstructor ??= WebSocket
neonConfig.poolQueryViaFetch = false
const pool = new Pool({ connectionString: process.env.DIRECT_DATABASE_URL })

const results = []
const record = (label, ok, detail) => {
  results.push({ label, ok })
  console.log(`${ok ? 'ok  ' : 'FAIL'}  ${label.padEnd(58)} ${detail}`)
}

// --- 1. the message arrives -------------------------------------------------
const delivered = await fetch(`${BASE}/api/inbound-email`, {
  method: 'POST',
  headers: {
    'content-type': 'application/json',
    authorization: `Bearer ${SECRET}`,
  },
  body: JSON.stringify({
    messageId: `<${TAG}@amazon.test>`,
    from: 'relay-noreply@amazon.com',
    to: 'loads@zebratms.com',
    subject: `Load Board - Trip ${TAG} booked`,
    text: BODY,
    attachments: [],
    raw: rawBase64,
    rawBytes: Buffer.byteLength(RAW, 'utf8'),
  }),
})

const answer = await delivered.json().catch(() => ({}))
record(
  'the endpoint accepts a delivered booking',
  delivered.status === 200 && answer.accepted === true,
  `HTTP ${delivered.status} ${JSON.stringify(answer).slice(0, 120)}`,
)

const emailId = answer.id
if (!emailId) {
  console.log('\nNo email id — nothing further can be checked.')
  process.exit(1)
}

// --- 2. it was read, and the state came from real validation ----------------
const row = (
  await pool.query(
    `select "state", "ocrStatus", "ocrError", "rawR2Key", "rawBytes",
            "extractedJson" is not null as read
       from "InboundEmail" where id = $1`,
    [emailId],
  )
).rows[0]

record(
  'the reader read it',
  row?.ocrStatus === 'COMPLETED' && row?.read === true,
  `${row?.ocrStatus}${row?.ocrError ? ` — ${row.ocrError.slice(0, 80)}` : ''}`,
)
record(
  'and it landed in a state, not in limbo',
  ['READY', 'REVIEW', 'CONFLICT'].includes(row?.state),
  `${row?.state}`,
)

// --- 3. spec §12: the original is real --------------------------------------
record(
  'the original was kept in R2',
  typeof row?.rawR2Key === 'string' && row.rawR2Key.includes(emailId),
  `${row?.rawR2Key ?? '(none)'} · ${row?.rawBytes ?? 0} bytes`,
)

// --- 4. a dispatcher sees it, opens it, and the form is filled --------------
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

const queue = await page.goto(`${BASE}/loads/incoming`, {
  waitUntil: 'domcontentloaded',
})
const queueBody = (await queue?.text()) ?? ''
record(
  'it is on the Incoming queue',
  queue?.status() === 200 && queueBody.includes(TAG),
  `HTTP ${queue?.status()}`,
)
record(
  'and the row links to the create form, not to a second surface',
  new RegExp(`href="/loads/new\\?from=${emailId}"`).test(queueBody),
  '§1.1 — a queue of unfinished forms',
)

// The original is downloadable, which is what §12 actually asks for.
//
// FETCHED RATHER THAN NAVIGATED TO. The route sends
// `content-disposition: attachment`, deliberately — a browser told to render
// `message/rfc822` does something different in every browser — so `page.goto`
// throws "Download is starting" and proves nothing. `page.request` carries the
// same session cookie and returns the bytes.
const original = await page.request.get(
  `${BASE}/api/inbound-email/${emailId}/original`,
)
const originalText = await original.text()
record(
  'the dispatcher can open the original message',
  original.status() === 200 && originalText.includes(`Message-ID: <${TAG}@`),
  `HTTP ${original.status()} · ${originalText.length} bytes · ${
    original.headers()['content-disposition'] ?? 'no disposition'
  }`,
)

// --- 5. opening the draft prefills the ordinary form ------------------------
await page.goto(`${BASE}/loads/new?from=${emailId}`, {
  waitUntil: 'domcontentloaded',
})

const snapshot = () =>
  page.evaluate(() => {
    const value = (name) =>
      document.querySelector(`input[name="${name}"]`)?.value?.trim() ?? null
    return {
      broker: value('broker'),
      fromEmail: value('fromEmail'),
      places: [...document.querySelectorAll('input[name$=".place"]')].map((n) =>
        n.value.trim(),
      ),
      // THE STATE-BACKED FIELDS, which is where the bug lived. The three
      // above are uncontrolled inputs reading the prefill directly; these
      // are React state, and `?from=` never applied the prefill to them.
      // Asserting only the first three is how 15/15 was reported for a form
      // that had filled half of itself.
      dates: [...document.querySelectorAll('input[name$=".scheduledAt"]')].map(
        (n) => n.value.trim(),
      ),
      rate: value('rate'),
      miles: value('miles'),
    }
  })

let form = await snapshot()
for (let attempt = 0; attempt < 40 && !form.broker; attempt++) {
  await page.waitForTimeout(500)
  form = await snapshot()
}

record(
  'opening the draft prefills the broker',
  (form.broker ?? '').length > 0,
  `${form.broker || '(empty)'}`,
)
record(
  'and both stops, from a message that was never a document',
  form.places.filter(Boolean).length >= 2,
  form.places.join(' · ') || '(none)',
)
record(
  'and the form knows which draft it came from',
  form.fromEmail === emailId,
  `${form.fromEmail ?? '(none)'}`,
)

record(
  'and the times the reading carried, rendered to the minute',
  form.dates.filter(Boolean).length >= 2,
  form.dates.join(' · ') || '(none)',
)
record(
  'and the rate, so nobody books freight for an unknown number',
  (form.rate ?? '').length > 0,
  form.rate || '(empty)',
)

// --- 6. Save books the load AND closes the draft ----------------------------
//
// `miles` IS NOT FILLED BEFORE IT IS ASSERTED ANY MORE. The earlier version
// typed 262 in here, which is how the one state-backed field this script
// touched stopped being a witness: it was blank because of the prefill bug,
// and the script supplied the value and moved on.
await page.fill('input[name="miles"]', '262')
await page.click('button[type="submit"]')

// THE WARN-AND-CONFIRM GATE IS PART OF THE PATH, not an obstacle to it. §3
// step 5: a booking with no dates warns in words in front of a button that
// books it anyway, and a Relay email carries times without a year — so this
// draft reaches Save with something worth saying. Confirming is what a
// dispatcher does, and the point of routing drafts through the ordinary form
// is that they meet exactly these checks.
for (let attempt = 0; attempt < 20; attempt++) {
  await page.waitForTimeout(500)
  const anyway = page.locator('button', { hasText: 'Book it anyway' })
  if ((await anyway.count()) > 0) {
    const warned = await page
      .locator('[role="alert"], .text-warning, li')
      .allTextContents()
    record(
      'the draft meets the same warnings a typed load would',
      true,
      warned
        .filter((w) => w.trim())
        .slice(0, 2)
        .join(' · ')
        .slice(0, 90) || 'warned before booking',
    )
    await anyway.first().click()
    break
  }
}

let closed = null
for (let attempt = 0; attempt < 40; attempt++) {
  await page.waitForTimeout(1_000)
  closed = (
    await pool.query(
      `select "state", "loadId", "confirmedAt", "handledByUserId"
         from "InboundEmail" where id = $1`,
      [emailId],
    )
  ).rows[0]
  if (closed?.state === 'CONFIRMED') break
}

record(
  'saving the form books the load and CONFIRMS the draft',
  closed?.state === 'CONFIRMED' && closed?.loadId !== null,
  `${closed?.state} · load ${closed?.loadId ?? '(none)'}`,
)
record(
  'and the confirmation is attributed to the person who pressed it',
  closed?.handledByUserId !== null && closed?.confirmedAt !== null,
  'a human booked it; a mail server delivered it',
)

const booked = closed?.loadId
  ? (
      await pool.query(
        'select "loadNumber", "referenceNumber" from "Load" where id = $1',
        [closed.loadId],
      )
    ).rows[0]
  : null
record(
  'the load is a real load with a real number',
  typeof booked?.loadNumber === 'string' && booked.loadNumber.length > 0,
  `#${booked?.loadNumber ?? '?'} ref ${booked?.referenceNumber ?? '—'}`,
)

// --- 7. and it leaves the queue --------------------------------------------
const after = await page.goto(`${BASE}/loads/incoming`, {
  waitUntil: 'domcontentloaded',
})
record(
  'a confirmed draft leaves the queue',
  after?.status() === 200 && !((await after?.text()) ?? '').includes(TAG),
  'handled mail does not come back',
)

await browser.close()

// --- cleanup ----------------------------------------------------------------
if (closed?.loadId) {
  await pool.query('update "InboundEmail" set "loadId" = null where id = $1', [
    emailId,
  ])
  await pool.query('delete from "LoadStop" where "loadId" = $1', [
    closed.loadId,
  ])
  await pool.query('delete from "LoadStatusEvent" where "loadId" = $1', [
    closed.loadId,
  ])
  await pool.query('delete from "Load" where id = $1', [closed.loadId])
}
await pool.query('delete from "InboundEmail" where id = $1', [emailId])
await pool.end()

const failed = results.filter((r) => !r.ok).length
console.log(`\n${results.length - failed}/${results.length} passed`)
process.exit(failed === 0 ? 0 : 1)
