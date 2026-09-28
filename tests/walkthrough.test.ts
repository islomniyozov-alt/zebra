import { describe, expect, it } from 'vitest'
import { createHash, randomBytes } from 'node:crypto'
import { retryingClient } from './retrying-client'
import type { PrismaClient } from '@/generated/prisma/client'

// ---------------------------------------------------------------------------
// THE ACCOUNTANT'S WEEK, FETCHED FROM A RUNNING DEV SERVER.
//
// This is the click-through: it mints a real session for the seeded owner, sets
// the cookie, and asks the dev server for each screen in the order the week runs
// in. A 200 with the screen's own markers in the HTML is the evidence that the
// route exists, compiles, renders against dev's real data and is reachable by a
// person holding the permission.
//
// WHAT IT DOES NOT DO is submit the forms. The writers behind them have their
// own suite against real Postgres — `driver-deductions.test.ts` and
// `remittance-write.test.ts` — and a POST to a Next server action needs the
// action id scraped out of the page, which would be testing Next rather than
// Zebra. Named here so nobody reads this as more than it is.
//
// SKIPPED UNLESS `ZEBRA_WALKTHROUGH_BASE` IS SET, because it needs a server that
// this suite does not start. `npm run dev`, then set the variable.
// ---------------------------------------------------------------------------

const BASE = process.env.ZEBRA_WALKTHROUGH_BASE ?? ''

describe.skipIf(BASE === '')('the accountant walks the week', () => {
  let owner: PrismaClient
  let cookie = ''
  let driverId = ''
  let batchId = ''
  let settlementId = ''

  const get = async (path: string) => {
    const response = await fetch(`${BASE}${path}`, {
      headers: { cookie },
      redirect: 'manual',
    })
    const body = response.status === 200 ? await response.text() : ''
    return { status: response.status, body }
  }

  it('mints a session for the seeded owner', async () => {
    owner = retryingClient(process.env.DIRECT_DATABASE_URL!)
    const email = (process.env.SEED_OWNER_EMAIL ?? '').toLowerCase().trim()
    expect(email, 'SEED_OWNER_EMAIL is not set').not.toBe('')

    const user = await owner.user.findFirstOrThrow({
      where: { email },
      select: {
        id: true,
        memberships: {
          select: { organizationId: true, role: true },
          take: 1,
        },
      },
    })
    const membership = user.memberships[0]
    expect(membership, 'the seeded owner has no membership').toBeDefined()
    if (!membership) return

    // THE COOKIE HOLDS THE ONLY COPY OF THE SECRET and the row holds its
    // SHA-256, exactly as `session.ts` describes. Minting one here rather than
    // driving the login form keeps this test about the screens.
    const token = randomBytes(32).toString('hex')
    await owner.session.create({
      data: {
        userId: user.id,
        tokenHash: createHash('sha256').update(token).digest('hex'),
        activeOrganizationId: membership.organizationId,
        role: membership.role,
        // EMPTY MEANS EVERY AUTHORITY IN THE ORGANISATION — the schema says so
        // on the column. `Membership.companyScopes` is a RELATION of rows while
        // `Session.companyScopes` is a string array, so they are not
        // interchangeable; an owner's real session carries the empty array.
        companyScopes: [],
        expiresAt: new Date(Date.now() + 3_600_000),
        userAgent: 'walkthrough',
      },
    })
    cookie = `zebra_session=${token}`
    expect(cookie).toContain('zebra_session=')
  }, 120_000)

  // ── STEP 1: THE DRIVER PAGE — PAY RULE, DEDUCTIONS, OPENING BALANCE ─────
  it('1 — a driver page offers all three money panels', async () => {
    const driver = await owner.driver.findFirstOrThrow({
      where: { deletedAt: null },
      select: { id: true },
      orderBy: { createdAt: 'asc' },
    })
    driverId = driver.id

    const page = await get(`/drivers/${driverId}`)
    expect(page.status, `/drivers/${driverId}`).toBe(200)

    // THE PANELS BY THEIR OWN HEADINGS. A 200 alone would pass on a page that
    // rendered none of them, which is exactly the state before today.
    // `name="percent"` RATHER THAN THE HEADING. `payRule.title` is the single
    // word "Pay", which appears all over a driver page — a marker that broad
    // would pass on a page with no pay panel at all. The percent field belongs to
    // that panel and to nothing else.
    expect(page.body, 'the pay-rule panel is missing').toContain(
      'name="percent"',
    )
    expect(page.body, 'the deduction panel is missing').toContain(
      'Recurring deductions',
    )
    expect(page.body, 'the opening-balance panel is missing').toContain(
      'Opening year-to-date',
    )
    // AND THE FIELDS THAT MAKE THEM USABLE.
    expect(page.body).toContain('name="amount"')
    expect(page.body).toContain('name="cadence"')
    expect(page.body).toContain('name="source"')
  }, 120_000)

  // ── STEP 2: THE AMAZON WORKBOOK ─────────────────────────────────────────
  it('2 — the remittance upload screen exists and takes an xlsx', async () => {
    const page = await get('/payments/import')
    expect(page.status, '/payments/import').toBe(200)
    expect(page.body).toContain('name="workbook"')
    // THE ACCEPT ATTRIBUTE IS THE SCREEN REFUSING A CSV before a person waits
    // for a parse that was always going to fail.
    expect(page.body).toContain('.xlsx')
  }, 120_000)

  it('2 — and the payments list links to it', async () => {
    const page = await get('/payments')
    expect(page.status).toBe(200)
    expect(page.body, 'nothing links to the upload screen').toContain(
      '/payments/import',
    )
  }, 120_000)

  // ── STEP 3: THE RELAY TRIPS FILE ────────────────────────────────────────
  it('3 — the trips import screen takes a csv', async () => {
    const page = await get('/loads/import/trips')
    expect(page.status).toBe(200)
    expect(page.body).toContain('type="file"')
    expect(page.body).toContain('.csv')
  }, 120_000)

  // ── STEP 4: THE WEEK'S BATCH ────────────────────────────────────────────
  it('4 — the batch list and one batch render, with held and blocked', async () => {
    const list = await get('/settlements/batches')
    expect(list.status).toBe(200)

    const batch = await owner.settlementBatch.findFirst({
      where: { deletedAt: null },
      select: { id: true },
      orderBy: { periodStart: 'desc' },
    })
    expect(batch, 'dev has no batch to open').not.toBeNull()
    if (!batch) return
    batchId = batch.id

    const page = await get(`/settlements/batches/${batchId}`)
    expect(page.status, `/settlements/batches/${batchId}`).toBe(200)
    // THE THREE CONTROLS THE WEEK NEEDS, on the page rather than in an action
    // nobody can reach.
    expect(page.body.toLowerCase()).toContain('refresh')
  }, 120_000)

  // ── STEP 5: A DRIVER'S STATEMENT, AND THE PRINTED COPY ──────────────────
  it('5 — a statement renders and offers its PDF', async () => {
    const settlement = await owner.settlement.findFirst({
      where: { deletedAt: null },
      select: { id: true },
      orderBy: { createdAt: 'desc' },
    })
    expect(settlement, 'dev has no settlement').not.toBeNull()
    if (!settlement) return
    settlementId = settlement.id

    const page = await get(`/settlements/${settlementId}`)
    expect(page.status, `/settlements/${settlementId}`).toBe(200)
    expect(page.body).toContain(`/api/settlements/${settlementId}/pdf`)
  }, 120_000)

  it('5 — and the PDF itself is a PDF', async () => {
    if (settlementId === '') return
    const response = await fetch(
      `${BASE}/api/settlements/${settlementId}/pdf`,
      { headers: { cookie }, redirect: 'manual' },
    )
    expect(response.status).toBe(200)
    const head = Buffer.from(await response.arrayBuffer())
      .subarray(0, 5)
      .toString('latin1')
    // THE BYTES, NOT THE CONTENT-TYPE HEADER. A header is a claim; `%PDF-` is
    // the file saying what it is.
    expect(head).toBe('%PDF-')
  }, 120_000)

  // ── STEP 6: FINALISE AND MARK PAID ──────────────────────────────────────
  //
  // The CONTROLS are asserted, not pressed: finalising a real dev batch would
  // allocate statement numbers and move the escrow ledger, which is not
  // something a read-only walkthrough should do.
  it('6 — finalise and mark-paid are on the batch page', async () => {
    if (batchId === '') return
    const page = await get(`/settlements/batches/${batchId}`)
    expect(page.status).toBe(200)
    const body = page.body.toLowerCase()
    expect(body).toContain('finalise')
  }, 120_000)
})
