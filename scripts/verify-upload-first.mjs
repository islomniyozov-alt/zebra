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
    (await page.locator('input[name="stops[0].place"]').isEditable()),
  'save enabled, fields editable — no gate',
)

// --- wait for React to be listening ---------------------------------------------
//
// THE REAL CAUSE OF THE FLAKE, and it was never a race between reads.
// `setInputFiles` on a server-rendered page succeeds whether or not React has
// hydrated: the file lands in the input, no `change` handler exists yet, and
// the offer sits at "idle" forever while the script waits for fields that were
// never going to fill. Fast runs hydrated first and passed; slow ones did not.
//
// `miles` is a CONTROLLED input, so it holds a typed value only once React's
// onChange is attached. Typing into it and reading it back is therefore a
// direct question — is this page live yet — rather than a sleep that hopes so.
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
record(
  'the page is hydrated before anything is uploaded',
  hydrated,
  hydrated ? 'controlled input holds a typed value' : 'never hydrated',
)

// --- upload through the offer slot ----------------------------------------------
//
// THE UPLOAD TAB FIRST, since Phase 6 §4 step 2 put the four methods behind
// tabs. The file input only exists on the Upload panel — which is what a
// dispatcher clicks too, so the walkthrough now does what they do.
await page
  .locator('[role="tab"]', { hasText: 'Upload document' })
  .click()
  .catch(() => {})

const before = Date.now()
await page.setInputFiles('section input[type="file"]', {
  name: `${TAG}-ratecon.pdf`,
  mimeType: 'application/pdf',
  buffer: Buffer.from(bytes),
})

// And if the offer still has not moved off idle a few seconds later, the change
// event was lost anyway — so it is sent again rather than waited out. One retry,
// because a second silent failure is a bug rather than a timing accident.
await page.waitForTimeout(3_000)
const idle = await page.evaluate(() =>
  [...document.querySelectorAll('[role="status"]')].some((n) =>
    (n.textContent ?? '').includes('form fills itself'),
  ),
)
if (idle) {
  // THE UPLOAD TAB FIRST, since Phase 6 §4 step 2 put the four methods behind
  // tabs. The file input only exists on the Upload panel — which is what a
  // dispatcher clicks too, so the walkthrough now does what they do.
  await page
    .locator('[role="tab"]', { hasText: 'Upload document' })
    .click()
    .catch(() => {})

  await page.setInputFiles('section input[type="file"]', {
    name: `${TAG}-ratecon.pdf`,
    mimeType: 'application/pdf',
    buffer: Buffer.from(bytes),
  })
}

// ONE ATOMIC SNAPSHOT OF THE WHOLE FORM, and everything is asserted from it.
//
// THE RACE THIS REPLACES, because it is worth naming: the previous version
// polled `broker` until it was non-empty, then read the other six fields one
// `inputValue()` at a time. Each read is a separate round trip to the browser,
// so a re-render between any two of them — and React does several while the
// extraction lands — produced a report where the rate was "(empty)" on a form
// that then saved 245,000 cents. The feature was right every time; the script
// said 12/14, then 6/14, then 2/14.
//
// A snapshot cannot disagree with itself. `page.evaluate` runs once, in the
// page, and reads every field in the same tick.
const snapshot = async () =>
  page.evaluate(() => {
    const value = (name) =>
      document.querySelector(`input[name="${name}"]`)?.value?.trim() ?? null
    return {
      broker: value('broker'),
      pickup: value('stops[0].place'),
      delivery: value('stops[1].place'),
      pickupAt: value('stops[0].date'),
      deliveryAt: value('stops[1].date'),
      // null rather than '' when the input does not exist at all — the
      // difference between "a dispatcher has no rate field" and "the rate did
      // not fill", which are opposite outcomes.
      rate: document.querySelector('input[name="rate"]') ? value('rate') : null,
      hasRateField: Boolean(document.querySelector('input[name="rate"]')),
      marked: [...document.querySelectorAll('p')].filter((p) =>
        (p.textContent ?? '').includes('From the document'),
      ).length,
      status: [...document.querySelectorAll('[role="status"]')].map((n) =>
        (n.textContent ?? '').trim(),
      ),
    }
  })

// WAIT FOR THE FORM TO SETTLE, not for one field to appear. The extraction
// fills several fields in one commit, but "several" is the thing under test —
// so this waits until two consecutive snapshots agree, which is what "settled"
// means and what the previous version assumed without checking.
let form = await snapshot()
let filled = 0
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
  // Filled AND unchanged since the last look.
  if (same) {
    stable += 1
    if (stable >= 2) {
      filled = Date.now() - before
      break
    }
  } else {
    stable = 0
  }
}

record(
  'the offer fills the form',
  filled > 0,
  filled > 0
    ? `${filled} ms, settled`
    : `never settled — ${form.status.join(' | ').slice(0, 70)}`,
)

const field = (actual, expected, label) =>
  record(
    `fills ${label}`,
    String(actual ?? '')
      .toLowerCase()
      .includes(String(expected).toLowerCase()),
    `${actual || '(empty)'}`,
  )

field(form.broker, TRUTH.broker, 'the broker')
field(form.pickup, TRUTH.pickupCity, 'the pickup')
field(form.delivery, TRUTH.deliveryCity, 'the delivery')

// THE DATE, in the form's own convention and not a day out. The document says
// 08/14/2026; a Date object built from it in a browser west of UTC would show
// the 13th, which is why the conversion is a slice rather than a parse.
record(
  'fills the pickup date, in the typed-date convention, on the right day',
  form.pickupAt === '2026-08-14',
  `${form.pickupAt || '(empty)'}`,
)
record(
  'and the delivery date from the window START, not the appointment',
  form.deliveryAt === '2026-08-15',
  `${form.deliveryAt || '(empty)'}`,
)

// The rate, for an owner, through money.ts: "$2,450.00" -> "2450.00".
record(
  'this role has a rate field at all',
  form.hasRateField === true,
  'owner — §1.3 gives a dispatcher none',
)
record(
  'fills the rate as a plain decimal, parsed through money.ts',
  form.rate === '2450.00',
  `${form.rate ?? '(no field)'}`,
)

// The provenance is on the screen, not only in the payload.
record(
  'and says which fields came from the document',
  form.marked > 0,
  `${form.marked} fields marked`,
)

// --- save once -------------------------------------------------------------------
await page.locator('button[type="submit"]').first().click()

// ONE QUERY FOR THE WHOLE OUTCOME, polled until the load exists.
//
// The previous version polled the Load, then separately polled the Document —
// so a run could see the load and miss the attachment that had not landed yet,
// and report the attach as broken. The attach happens in the same request as
// the save; asking about both in one query asks the question that has one
// answer.
const outcome = async () =>
  (
    await pool.query(
      `select l.id,
              l."linehaulCents",
              d.id                        "documentId",
              d.type                      "documentType",
              d."ocrStatus"               "documentStatus",
              d."extractedJson" is not null carried,
              (select to_char(s."windowStart" at time zone 'UTC', 'HH24:MI')
                 from "LoadStop" s where s."loadId" = l.id and s.sequence = 2) "winFrom",
              (select to_char(s."windowEnd" at time zone 'UTC', 'HH24:MI')
                 from "LoadStop" s where s."loadId" = l.id and s.sequence = 2) "winTo",
              (select count(*)::int from "PendingUpload" p
                where p.filename like $2)  pending
         from "Load" l
         join "Customer" c on c.id = l."customerId"
         left join "Document" d on d."loadId" = l.id
        where c.name = $1
        order by l."createdAt" desc limit 1`,
      [TRUTH.broker, `%${TAG}%`],
    )
  ).rows[0] ?? null

let saved = null
for (let attempt = 0; attempt < 30; attempt++) {
  saved = await outcome()
  // Wait for the DOCUMENT too, not only the load: the attach is the claim.
  if (saved?.documentId) break
  await page.waitForTimeout(1_000)
}

record(
  'saving books the load with the broker from the document',
  Boolean(saved?.id),
  saved?.id ?? '(not saved)',
)
record(
  'and the rate reaches cents',
  saved?.linehaulCents === 245000,
  `${saved?.linehaulCents ?? '(none)'} cents`,
)

// --- the document attached at save (§1.5) -----------------------------------------
record(
  'the rate confirmation attached to the load it created',
  saved?.documentType === 'RATE_CONFIRMATION',
  `${saved?.documentType ?? '(none)'}`,
)
record(
  'carrying its extraction across from the mint',
  saved?.documentStatus === 'COMPLETED' && saved?.carried === true,
  `${saved?.documentStatus ?? '(none)'}, extractedJson ${saved?.carried ? 'present' : 'MISSING'}`,
)
// THE WINDOW REACHES ITS COLUMNS (Phase 6, the window gap). The fixture's
// delivery prints `06:00 - 10:00`; `LoadStop.windowStart`/`windowEnd` have
// existed since Phase 1 and nothing ever wrote them from this form. Stored as
// an instant in the STOP's zone, so this reads them back in UTC and asserts
// the pair rather than the clock face.
record(
  'the printed delivery window is saved, not dropped',
  Boolean(saved?.winFrom) && Boolean(saved?.winTo),
  `${saved?.winFrom ?? '(none)'} - ${saved?.winTo ?? '(none)'} UTC`,
)
record(
  'and it is a real window — two DIFFERENT ends',
  Boolean(saved?.winFrom) && saved?.winFrom !== saved?.winTo,
  `${saved?.winFrom} vs ${saved?.winTo}`,
)

record(
  'and the mint is gone — no orphan pending row',
  saved?.pending === 0,
  `${saved?.pending ?? '?'} left behind`,
)

const load = saved

await browser.close()

// --- cleanup ---------------------------------------------------------------------
//
// KEEP=1 LEAVES THE LOAD BEHIND, for the one case where the artefact is the
// point: a ruling about what the rate field means needs a load somebody can open
// on dev and read. Everything this script asserts has already been asserted by
// the time we get here, so keeping changes no verdict — and dev data is
// disposable by the checklist's own rule.
if (process.env.KEEP) {
  console.log('')
  console.log(
    `KEEPING ${load?.loadNumber ?? '(nothing saved)'} — id ${load?.id ?? '—'}`,
  )
  console.log(
    `  broker "${TRUTH.broker}", linehaulCents ${load?.linehaulCents ?? '—'}`,
  )
  console.log(
    '  Nothing was deleted. Remove it by hand when the ruling is made.',
  )
  await pool.end()
  const kept = results.filter((r) => !r.ok).length
  console.log(`
${results.length - kept}/${results.length} passed`)
  process.exit(kept === 0 ? 0 : 1)
}

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
