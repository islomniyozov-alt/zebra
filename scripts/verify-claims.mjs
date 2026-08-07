import { chromium } from 'playwright'
import { neonConfig, Pool } from '@neondatabase/serverless'

// ---------------------------------------------------------------------------
// PHASE 4 §3 STEP 5, END TO END, ON THE DEPLOYED WORKER.
//
// Two runs in one script, because they are the two halves of step 5:
//
//   CLAIM   open one through the form, add a party, add a note, move it along
//           the ladder, and read the timeline back — notes and status changes
//           in one list, newest first.
//   DATAQS  §4's acceptance box, driven through the panel:
//           inspection → violation → challenge → outcome.
//
// LOCATORS, NOT BODY TEXT. Every label a client panel can render travels in
// its props, so searching the whole response for "Closed" finds the word on
// every claim regardless of its status. verify-inspections learned that the
// hard way; this reads the heading and the list items.
//
//   SHOT_CHROME=... node -r dotenv/config scripts/verify-claims.mjs
// ---------------------------------------------------------------------------

const BASE =
  process.env.VERIFY_BASE ?? 'https://zebra-dev.tajikcargollc.workers.dev'
const TAG = `CL${Date.now().toString(36).slice(-4).toUpperCase()}`

neonConfig.webSocketConstructor ??= WebSocket
neonConfig.poolQueryViaFetch = false
const pool = new Pool({ connectionString: process.env.DIRECT_DATABASE_URL })

const results = []
const record = (label, ok, detail) => {
  results.push({ label, ok })
  console.log(`${ok ? 'ok  ' : 'FAIL'}  ${label.padEnd(56)} ${detail}`)
}

const cuid = () => {
  const alphabet = 'abcdefghijklmnopqrstuvwxyz0123456789'
  let id = 'c'
  for (let index = 0; index < 24; index++) {
    id += alphabet[Math.floor(Math.random() * alphabet.length)]
  }
  return id
}

const organizationId = (
  await pool.query(
    `select m."organizationId" id from "Membership" m
       join "User" u on u.id = m."userId" where u.email = $1 limit 1`,
    [process.env.SEED_OWNER_EMAIL],
  )
).rows[0].id

const companyId = (
  await pool.query(
    'select id from "Company" where "organizationId" = $1 order by name asc limit 1',
    [organizationId],
  )
).rows[0].id

// A truck, an inspection and a violation for the DataQs half. Created in SQL
// because the inspection flow has its own walkthrough; this one is about what
// hangs off it.
const truck = (
  await pool.query(
    `insert into "Truck" (id, "organizationId", "companyId", "unitNumber", "updatedAt")
       values ($4, $1, $2, $3, now()) returning id`,
    [organizationId, companyId, `${TAG}-903`, cuid()],
  )
).rows[0]
await pool.query(
  `insert into "AssetAssignment" (id, "organizationId", "companyId", "truckId", "effectiveFrom")
     values ($1, $2, $3, $4, now())`,
  [cuid(), organizationId, companyId, truck.id],
)
const inspection = (
  await pool.query(
    `insert into "RoadsideInspection"
       (id, "organizationId", "companyId", "truckId", "inspectedAt", level, state, "reportNumber", "updatedAt")
       values ($4, $1, $2, $3, now(), 'LEVEL_1', 'IN', $5, now()) returning id`,
    [organizationId, companyId, truck.id, cuid(), `${TAG}-RPT`],
  )
).rows[0]
const violation = (
  await pool.query(
    `insert into "InspectionViolation"
       (id, "organizationId", "inspectionId", code, description, unit, "outOfService", "updatedAt")
       values ($3, $1, $2, '393.75A3', 'Tire — audible air leak', 'VEHICLE', true, now())
       returning id`,
    [organizationId, inspection.id, cuid()],
  )
).rows[0]

const browser = await chromium.launch(
  process.env.SHOT_CHROME ? { executablePath: process.env.SHOT_CHROME } : {},
)
const context = await browser.newContext({
  viewport: { width: 1920, height: 1080 },
})
const page = await context.newPage()

await page.goto(`${BASE}/login`, { waitUntil: 'domcontentloaded' })
await page.fill('input[name="email"]', process.env.SEED_OWNER_EMAIL)
await page.fill('input[name="password"]', process.env.SEED_OWNER_PASSWORD)
await page.click('button[type="submit"]')
await page.waitForURL(/\/(loads|dashboard)/, { timeout: 60_000 })

/**
 * Submit a panel form and wait for the row it should produce.
 *
 * RELOADS BEFORE LOOKING. A server action's `revalidatePath` re-renders the
 * page in place, and a person clicking Add sees the row — but how long that
 * takes is the framework's business, and the first version of this script
 * waited on it and failed intermittently on a feature that worked. Reloading
 * asks the question this script is actually asking: is the row THERE.
 */
const submitAndSee = async (formSelector, text) => {
  const url = page.url()
  await page.click(`${formSelector} button[type="submit"]`)
  await page.waitForTimeout(1500)

  // NAVIGATE, DO NOT RELOAD. `page.reload()` races the server action's own
  // refresh and aborts — "maybe frame was detached?" — which reads as a broken
  // feature and is a broken script. A fresh `goto` asks the question this
  // script is actually asking: is the row THERE.
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      await page.goto(url, { waitUntil: 'domcontentloaded' })
      await page.locator(`li:has-text("${text}")`).first().waitFor({
        timeout: 20_000,
      })
      return
    } catch (error) {
      if (attempt === 2) throw error
      await page.waitForTimeout(2000)
    }
  }
}

// --- open a claim -----------------------------------------------------------
await page.goto(`${BASE}/safety/claims/new`, { waitUntil: 'domcontentloaded' })
await page.selectOption('select[name="companyId"]', companyId)
await page.selectOption('select[name="type"]', 'CARGO_DAMAGE')
await page.fill('input[name="incidentAt"]', '801')
await page.fill('input[name="claimantName"]', `${TAG} Broker`)
await page.fill('input[name="claimNumber"]', `${TAG}-THEIRS`)
await page.fill('input[name="amountClaimed"]', '4,125.00')
await page.fill(
  'input[name="description"]',
  `${TAG} two pallets crushed on the trailer floor`,
)
await page.click('button[type="submit"]')

await page.waitForURL(/\/safety\/claims\/c[a-z0-9]{24}/, { timeout: 60_000 })
const claimId = page.url().split('/').pop()
record(
  'opening a claim lands on the claim, not back on the list',
  Boolean(claimId),
  page.url().replace(BASE, ''),
)

const stored = (
  await pool.query(
    'select status, "companyId", "amountClaimedCents" from "Claim" where id = $1',
    [claimId],
  )
).rows[0]
record(
  'it opens OPEN, under the authority chosen, with the typed amount in cents',
  stored?.status === 'OPEN' &&
    stored?.companyId === companyId &&
    stored?.amountClaimedCents === 412500,
  `${stored?.status} · ${stored?.amountClaimedCents} cents`,
)

/** The status badge in the page heading. Read from the heading, not the body. */
const claimBadge = async () => {
  await page.goto(`${BASE}/safety/claims/${claimId}`, {
    waitUntil: 'domcontentloaded',
  })
  return (await page.locator('h1').innerText()).trim()
}

const timelineRows = async () =>
  page.locator('section:has(ol) ol > li').allInnerTexts()

record(
  'the timeline has an opening row before anything else happens',
  (await timelineRows()).length === 1,
  'a history with a first chapter',
)

// --- a party ----------------------------------------------------------------
await page.goto(`${BASE}/safety/claims/${claimId}`, {
  waitUntil: 'domcontentloaded',
})
await page.selectOption('select[name="role"]', 'ADJUSTER')
await page.fill('input[name="name"]', `${TAG} Adjuster`)
await page.fill('input[name="reference"]', `${TAG}-ADJ`)
await submitAndSee('form:has(input[name="name"])', `${TAG}-ADJ`)

const party = (
  await pool.query(
    'select "organizationId", role from "ClaimParty" where "claimId" = $1',
    [claimId],
  )
).rows[0]
record(
  'a party lands with its organizationId derived by the trigger',
  party?.organizationId === organizationId && party?.role === 'ADJUSTER',
  'nothing came from the caller',
)

// --- a note and a move, on one timeline -------------------------------------
await page.goto(`${BASE}/safety/claims/${claimId}`, {
  waitUntil: 'domcontentloaded',
})
await page.fill('input[name="body"]', `${TAG} photographs requested`)
await submitAndSee(
  'form:has(input[name="body"])',
  `${TAG} photographs requested`,
)

await page.goto(`${BASE}/safety/claims/${claimId}`, {
  waitUntil: 'domcontentloaded',
})
await page.selectOption('select[name="to"]', 'DISPUTED')
await page.fill('input[name="note"]', `${TAG} they deny fault`)
await submitAndSee('form:has(select[name="to"])', `${TAG} they deny fault`)

const rows = await timelineRows()
record(
  'notes and status changes share one timeline, newest first',
  rows.length === 3 &&
    rows[0].includes('they deny fault') &&
    rows[1].includes('photographs requested'),
  `${rows.length} entries`,
)
record(
  'and the move reads as a movement, not just a note',
  rows[0].includes('Disputed'),
  'from → to on the row',
)

// --- the ladder refuses what it should --------------------------------------
await page.goto(`${BASE}/safety/claims/${claimId}`, {
  waitUntil: 'domcontentloaded',
})
const offered = await page.locator('select[name="to"] option').allInnerTexts()
record(
  'the select offers only the moves the service would accept',
  // From DISPUTED: under review, resolved, denied, closed. Never Disputed
  // itself, and never Open — a claim does not un-dispute.
  offered.length === 4 && !offered.includes('Open'),
  offered.join(', '),
)

await page.selectOption('select[name="to"]', 'RESOLVED')
await page.fill('input[name="amountPaid"]', '2,000.00')
await page.fill('input[name="resolution"]', `${TAG} split the difference`)
await page.click('form:has(select[name="to"]) button[type="submit"]')
await page.waitForTimeout(2500)

const settled = (
  await pool.query(
    'select status, "amountPaidCents" from "Claim" where id = $1',
    [claimId],
  )
).rows[0]
record(
  'settling records the amount paid in cents',
  settled?.status === 'RESOLVED' && settled?.amountPaidCents === 200000,
  `${settled?.status} · ${settled?.amountPaidCents} cents`,
)

record(
  'and the heading badge follows the claim',
  (await claimBadge()).includes('Resolved'),
  'status on the heading',
)

// --- §4: the trace ----------------------------------------------------------
await page.goto(`${BASE}/safety/inspections/${inspection.id}`, {
  waitUntil: 'domcontentloaded',
})
await page.selectOption('select[name="violationId"]', violation.id)
await page.fill(
  'input[name="basis"]',
  `${TAG} the tire was on a trailer we had already dropped`,
)
await page.fill('input[name="referenceNumber"]', `${TAG}-RDR`)
await submitAndSee('form:has(input[name="basis"])', `${TAG}-RDR`)

const challengeId = (
  await pool.query(
    'select id from "DataQsChallenge" where "inspectionId" = $1',
    [inspection.id],
  )
).rows[0]?.id
record(
  'a challenge is written against the violation it names',
  Boolean(challengeId),
  `${TAG}-RDR`,
)

// File it, then answer it. Two moves, because status and outcome are two facts.
const moveChallenge = async (to, outcome) => {
  await page.goto(`${BASE}/safety/inspections/${inspection.id}`, {
    waitUntil: 'domcontentloaded',
  })
  const form = page.locator('form:has(select[name="to"])').first()
  await form.locator('select[name="to"]').selectOption(to)
  if (outcome)
    await form.locator('select[name="outcome"]').selectOption(outcome)
  await form.locator('button[type="submit"]').click()
  await page.waitForTimeout(2500)
}

await moveChallenge('SUBMITTED', '')
await moveChallenge('CLOSED', 'ACCEPTED')

const traced = (
  await pool.query(
    `select c.status, c.outcome, c."submittedAt", c."decidedAt",
            v.code, i."reportNumber"
       from "DataQsChallenge" c
       join "InspectionViolation" v on v.id = c."violationId"
       join "RoadsideInspection" i on i.id = c."inspectionId"
      where c.id = $1`,
    [challengeId],
  )
).rows[0]
record(
  'inspection → violation → challenge → outcome, in one query',
  traced?.reportNumber === `${TAG}-RPT` &&
    traced?.code === '393.75A3' &&
    traced?.status === 'CLOSED' &&
    traced?.outcome === 'ACCEPTED',
  `${traced?.reportNumber} → ${traced?.code} → ${traced?.status} → ${traced?.outcome}`,
)
record(
  'with both dates stamped by the moves rather than typed',
  traced?.submittedAt !== null && traced?.decidedAt !== null,
  'submittedAt and decidedAt',
)

// A closed challenge has no move control at all — the ladder is empty.
await page.goto(`${BASE}/safety/inspections/${inspection.id}`, {
  waitUntil: 'domcontentloaded',
})
record(
  'and a closed challenge offers no way onward',
  (await page.locator('form:has(select[name="to"])').count()) === 0,
  'no control, not a disabled one',
)

await browser.close()

// --- cleanup ----------------------------------------------------------------
await pool.query('delete from "ClaimNote" where "claimId" = $1', [claimId])
await pool.query('delete from "ClaimParty" where "claimId" = $1', [claimId])
await pool.query('delete from "Claim" where id = $1', [claimId])
await pool.query('delete from "DataQsChallenge" where "inspectionId" = $1', [
  inspection.id,
])
await pool.query(
  'delete from "InspectionViolation" where "inspectionId" = $1',
  [inspection.id],
)
await pool.query('delete from "RoadsideInspection" where id = $1', [
  inspection.id,
])
await pool.query('delete from "AssetAssignment" where "truckId" = $1', [
  truck.id,
])
await pool.query('delete from "Truck" where id = $1', [truck.id])
await pool.end()

const failed = results.filter((r) => !r.ok).length
console.log(`${results.length - failed}/${results.length} passed`)
process.exit(failed === 0 ? 0 : 1)
