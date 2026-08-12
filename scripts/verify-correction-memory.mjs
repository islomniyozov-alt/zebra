import { chromium } from 'playwright'
import { neonConfig, Pool } from '@neondatabase/serverless'
import { rateConFixture } from './_ratecon-fixture.mjs'

// ---------------------------------------------------------------------------
// CORRECTION MEMORY, END TO END, ON THE DEPLOYED WORKER (Phase 5 §3 step 3).
//
// §5's box, in one sentence: "A corrected broker match is applied on the next
// upload of the same string; the correction row records both."
//
// It has two halves and only the second one is interesting. Writing a row when
// somebody types over a name is a table. READING IT BACK on the next document
// is a memory — so this script uploads the SAME rate confirmation twice, with a
// correction in between, and asserts the second upload arrives already right.
//
// The document prints `Cascade Freight Partners`. The carrier's actual customer
// is `Pacific Ridge Brokerage`, which is the ordinary case: brokers put their
// legal or DBA name on paper and the office knows them by another one.
//
//   SHOT_CHROME=... node -r dotenv/config scripts/verify-correction-memory.mjs
// ---------------------------------------------------------------------------

const BASE =
  process.env.VERIFY_BASE ?? 'https://zebra-dev.tajikcargollc.workers.dev'
const TAG = `CM${Date.now().toString(36).slice(-4).toUpperCase()}`
const { TRUTH, bytes } = rateConFixture(TAG)

/** What the paperwork says. */
const PRINTED = TRUTH.broker
/** What the office calls them. */
const REAL = `Pacific Ridge Brokerage ${TAG}`

neonConfig.webSocketConstructor ??= WebSocket
neonConfig.poolQueryViaFetch = false
const pool = new Pool({ connectionString: process.env.DIRECT_DATABASE_URL })

const results = []
const record = (label, ok, detail) => {
  results.push({ label, ok })
  console.log(`${ok ? 'ok  ' : 'FAIL'}  ${label.padEnd(58)} ${detail}`)
}

// --- the customer the correction points at --------------------------------------
//
// Created up front rather than by create-on-miss, because the case that matters
// is a dispatcher picking a broker THEY ALREADY HAVE — the alias is the bridge
// between a printed string and an existing customer, not a way to make one.
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

const customerId = (
  await pool.query(
    `insert into "Customer" ("id", "organizationId", "name", "updatedAt")
     values (gen_random_uuid(), $1, $2, now()) returning id`,
    [organizationId, REAL],
  )
).rows[0].id

console.log(`  document prints  ${PRINTED}`)
console.log(`  office calls it  ${REAL}\n`)

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

/**
 * Open a fresh create screen, upload the document, and wait for the form to
 * settle. Lifted whole from the upload-first walkthrough, including the reason:
 * `setInputFiles` succeeds on an unhydrated page and the change handler never
 * fires, and per-field reads disagree with each other across a re-render.
 */
async function uploadAndSettle(label) {
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
      name: `${TAG}-ratecon.pdf`,
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
    page.evaluate(() => {
      const value = (name) =>
        document.querySelector(`input[name="${name}"]`)?.value?.trim() ?? null
      return {
        broker: value('broker'),
        pickup: value('stops[0].place'),
        delivery: value('stops[1].place'),
        pendingUploadId:
          document.querySelector('input[name="pendingUploadId"]')?.value ??
          null,
        // The offer says where a name came from. "we have seen this broker
        // before" is a different sentence from "the document says".
        notes: [...document.querySelectorAll('p, [role="status"]')]
          .map((n) => (n.textContent ?? '').trim())
          .filter(Boolean),
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
// FIRST UPLOAD — nothing has been taught yet.
// ===========================================================================
const first = await uploadAndSettle('first upload')

record(
  'the first upload fills the broker with what the DOCUMENT prints',
  first.broker === PRINTED,
  `${first.broker || '(empty)'}`,
)
record(
  'and does not guess at the customer it half-resembles',
  first.broker !== REAL,
  'no near-match offered as an answer',
)

// --- the correction --------------------------------------------------------------
await page.fill('input[name="broker"]', REAL)
await page.locator('button[type="submit"]').first().click()

const outcome = async () =>
  (
    await pool.query(
      `select l.id,
              l."customerId",
              (select count(*)::int from "CustomerAlias" a
                where a."organizationId" = $2 and a.normalized = $3) aliases,
              (select count(*)::int from "ExtractionCorrection" e
                where e."loadId" = l.id) corrections
         from "Load" l
        where l."customerId" = $1
        order by l."createdAt" desc limit 1`,
      [customerId, organizationId, PRINTED.toUpperCase()],
    )
  ).rows[0] ?? null

let saved = null
for (let attempt = 0; attempt < 40; attempt++) {
  saved = await outcome()
  if (saved?.aliases > 0) break
  await page.waitForTimeout(1_000)
}

record(
  'saving books the load against the customer the dispatcher chose',
  saved?.customerId === customerId,
  saved?.id ?? '(not saved)',
)

// --- the correction row records BOTH sides ---------------------------------------
const correction = (
  await pool.query(
    `select field, "extractedValue", "correctedValue", confidence,
            "correctedByUserId" is not null attributed
       from "ExtractionCorrection"
      where "loadId" = $1 and field = 'brokerName' limit 1`,
    [saved?.id ?? '00000000-0000-0000-0000-000000000000'],
  )
).rows[0]

record(
  'the correction row records what the model SAID',
  correction?.extractedValue === PRINTED,
  `${correction?.extractedValue ?? '(no row)'}`,
)
record(
  'and what it was changed TO',
  correction?.correctedValue === REAL,
  `${correction?.correctedValue ?? '(no row)'}`,
)
record(
  'with the confidence the model claimed when it was wrong',
  Boolean(correction?.confidence),
  `${correction?.confidence ?? '(none)'} — the number that decides if the signal is worth anything`,
)
record(
  'attributed to the person who made it',
  correction?.attributed === true,
  correction?.attributed ? 'correctedByUserId set' : 'anonymous',
)
// EXACTLY ONE ROW, and the exactness is the assertion. This script's first run
// wrote three: the broker, plus both stops — because the form holds "Salem, OR"
// in one field and the diff was comparing it against the extracted city alone.
// A range would have passed and the accuracy table would have counted every
// unedited load as two mistakes.
record(
  'and the fields nobody touched are NOT logged as corrections',
  saved?.corrections === 1,
  `${saved?.corrections ?? '?'} row(s) — only the broker was typed over`,
)

// --- the alias ---------------------------------------------------------------------
const alias = (
  await pool.query(
    `select alias, normalized, "customerId", "timesApplied",
            "learnedByUserId" is not null attributed
       from "CustomerAlias"
      where "organizationId" = $1 and normalized = $2 limit 1`,
    [organizationId, PRINTED.toUpperCase()],
  )
).rows[0]

record(
  'the printed string is remembered against the chosen customer',
  alias?.customerId === customerId,
  `${alias?.alias ?? '(no alias)'} -> ${REAL}`,
)
record(
  'not yet applied to anything',
  alias?.timesApplied === 0,
  `timesApplied ${alias?.timesApplied ?? '?'}`,
)

// ===========================================================================
// SECOND UPLOAD — THE HALF THAT MAKES IT A MEMORY.
//
// Same document, same printed string, a page that has never seen it. The
// broker field must arrive carrying the name the office uses.
// ===========================================================================
const second = await uploadAndSettle('second upload')

record(
  '§5: the corrected match is applied on the NEXT upload of the same string',
  second.broker === REAL,
  `${second.broker || '(empty)'}`,
)
record(
  'the rest of the document still reads the same',
  second.pickup?.toLowerCase().includes(TRUTH.pickupCity.toLowerCase()) &&
    second.delivery?.toLowerCase().includes(TRUTH.deliveryCity.toLowerCase()),
  `${second.pickup} -> ${second.delivery}`,
)
// AND IT SAYS SO. A field showing a name the document does not contain, under a
// hint reading "From the document", is a false statement — on the one field
// where being quietly wrong sends an invoice to the wrong company. The hint
// names the printed string, so the substitution can be seen and undone.
const disclosure = second.notes.find((n) => /past correction/i.test(n))
record(
  'and the screen says so, naming the string the document printed',
  Boolean(disclosure) && disclosure.includes(PRINTED),
  disclosure?.slice(0, 60) ?? '(no provenance line)',
)

const applied = (
  await pool.query(
    `select "timesApplied" from "CustomerAlias"
      where "organizationId" = $1 and normalized = $2 limit 1`,
    [organizationId, PRINTED.toUpperCase()],
  )
).rows[0]

record(
  'the use is counted',
  applied?.timesApplied >= 1,
  `timesApplied ${applied?.timesApplied ?? '?'}`,
)

// --- and it did not learn a second time from an agreement --------------------------
const aliasCount = (
  await pool.query(
    `select count(*)::int n from "CustomerAlias"
      where "organizationId" = $1 and normalized = $2`,
    [organizationId, PRINTED.toUpperCase()],
  )
).rows[0].n

record(
  'one row per printed string, however many times it is seen',
  aliasCount === 1,
  `${aliasCount} row(s)`,
)

await browser.close()

// --- cleanup -------------------------------------------------------------------------
const loadIds = (
  await pool.query(`select id from "Load" where "customerId" = $1`, [
    customerId,
  ])
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
await pool.query('delete from "CustomerAlias" where "customerId" = $1', [
  customerId,
])
await pool.query('delete from "Customer" where id = $1', [customerId])
await pool.query('delete from "PendingUpload" where filename like $1', [
  `%${TAG}%`,
])
await pool.end()

const failed = results.filter((r) => !r.ok).length
console.log(`\n${results.length - failed}/${results.length} passed`)
process.exit(failed === 0 ? 0 : 1)
