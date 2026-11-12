import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { retryingClient } from '../retrying-client'
import { withOrg } from '@/lib/tenancy'
import { LOAD_WRITE_TIMEOUT_MS } from '@/lib/loads'
import { createUser } from '@/lib/users'
import { linkDriverSignIn } from '@/lib/driver-link'
import {
  currentLoad,
  documentsNeeded,
  HOME_STATEMENTS,
  isOwnDocument,
  isOwnSettlement,
  ownDocuments,
  ownDriver,
  ownLoads,
  ownSettlements,
} from '@/lib/portal'
import { recordPortalStatus } from '@/lib/portal-status'
import { ownPendingUpload, uploadTargetFor } from '@/lib/portal-documents'
import { dropOrganization, seedOrganization, type OrgFixture } from './fixtures'
import type { PrismaClient } from '@/generated/prisma/client'

// ---------------------------------------------------------------------------
// THE PORTAL'S PREDICATES, AGAINST REAL POSTGRES (Phase 7 step 2; brief §3.3).
//
// TWO DRIVERS IN ONE ORGANIZATION, each linked to a sign-in. Driver A has an
// open load, a delivered load, a POD on the delivered one and a CDL copy
// filed under the person, an APPROVED settlement with a line on the
// delivered load, and a DRAFT settlement. Driver B has an open load, a
// document and a PAID settlement of their own. Every predicate answers A's
// rows and never B's — AND AT LEAST ONE OF A'S OWN, because "sees none of
// B's" is true of an empty table (AGENTS.md).
//
// THE MONEY RULES (§4.2, §4.3): the DRAFT is absent; pay on the delivered
// load appears through the APPROVED settlement's line, and the open load
// shows none.
//
// AND HOME'S BUDGET IS MEASURED: the own row plus the current load are TWO
// statements inside the transaction, counted by a client that logs every
// query it sends.
// ---------------------------------------------------------------------------

let owner: PrismaClient
let org: OrgFixture
let driverA = ''
let driverB = ''
let userA = ''
let userB = ''
let openA = ''
let deliveredA = ''
let openB = ''
/** B's load with A in the second seat (§4.5: a co-driver sees it). */
let teamB = ''
let podA = ''
let cdlA = ''
let docB = ''
let approvedA = ''
let draftA = ''
let paidB = ''

const nonce = Math.random().toString(36).slice(2, 8)
const address = (label: string) => `${label}+p${nonce}@example.test`

const inOrg = <T>(fn: Parameters<typeof withOrg<T>>[1]): Promise<T> =>
  withOrg(org.organizationId, fn, {
    attribution: { userId: org.userId, ip: null, userAgent: 'portal.test' },
    maxWaitMs: 15_000,
    timeoutMs: LOAD_WRITE_TIMEOUT_MS,
  })

async function mintDriverUser(label: string): Promise<string> {
  const outcome = await inOrg((tx) =>
    createUser(tx, org.organizationId, 'OWNER', {
      name: `${label} ${nonce}`,
      email: address(label.toLowerCase()),
      role: 'DRIVER',
      companyIds: [],
    }),
  )
  if (!outcome.ok) throw new Error(`mint ${label}: ${outcome.reason}`)
  return outcome.userId
}

async function load(
  key: string,
  driverId: string,
  status: 'DISPATCHED' | 'DELIVERED',
  stops: {
    type: 'PICKUP' | 'DELIVERY'
    city: string
    at: string
    departed?: boolean
  }[],
): Promise<string> {
  const row = await owner.load.create({
    data: {
      organizationId: org.organizationId,
      companyId: org.companyId,
      customerId: org.ids['customer']![0]!,
      loadNumber: `P-${key}-${nonce}`,
      referenceNumber: `REF-${key}-${nonce}`,
      driverId,
      operationalStatus: status,
      stops: {
        create: stops.map((stop, index) => ({
          organizationId: org.organizationId,
          sequence: index + 1,
          type: stop.type,
          name: `${stop.city} yard`,
          city: stop.city,
          state: 'TX',
          scheduledAt: new Date(stop.at),
          departedAt: stop.departed ? new Date(stop.at) : null,
        })),
      },
    },
    select: { id: true },
  })
  return row.id
}

async function document(
  key: string,
  type: 'POD' | 'CDL_COPY' | 'BOL',
  where: { loadId?: string; driverId?: string },
): Promise<string> {
  const row = await owner.document.create({
    data: {
      organizationId: org.organizationId,
      companyId: org.companyId,
      r2Key: `portal-test/${key}-${nonce}.pdf`,
      filename: `${key}.pdf`,
      mimeType: 'application/pdf',
      sizeBytes: 1234,
      type,
      ...where,
    },
    select: { id: true },
  })
  return row.id
}

async function settlement(
  key: string,
  driverId: string,
  status: 'DRAFT' | 'APPROVED' | 'PAID',
  line: { loadId: string; loadNumber: string; amountCents: number } | null,
): Promise<string> {
  const row = await owner.settlement.create({
    data: {
      organizationId: org.organizationId,
      companyId: org.companyId,
      settlementNumber: `PS-${key}-${nonce}`,
      driverId,
      periodStart: new Date('2026-11-01T00:00:00Z'),
      periodEnd: new Date('2026-11-07T00:00:00Z'),
      status,
      grossCents: 100_000,
      deductionsCents: -10_000,
      netCents: 90_000,
      paidAt: status === 'PAID' ? new Date('2026-11-10T00:00:00Z') : null,
      ...(line
        ? {
            loadLines: {
              create: {
                organizationId: org.organizationId,
                companyId: org.companyId,
                companyName: 'Authority',
                loadId: line.loadId,
                loadNumber: line.loadNumber,
                driverId,
                puPlace: 'Dallas, TX',
                delPlace: 'Houston, TX',
                puDate: new Date('2026-11-02T00:00:00Z'),
                delDate: new Date('2026-11-03T00:00:00Z'),
                grossCents: 100_000,
                milesHundredths: 24_000,
                amountCents: line.amountCents,
                settledBasis: 'percent',
              },
            },
          }
        : {}),
    },
    select: { id: true },
  })
  return row.id
}

beforeAll(async () => {
  owner = retryingClient(process.env.DIRECT_DATABASE_URL!)
  org = await seedOrganization(owner, 'portal', nonce)
  driverA = org.ids['driver']![0]!
  const second = await owner.driver.create({
    data: {
      organizationId: org.organizationId,
      companyId: org.companyId,
      firstName: 'Bravo',
      lastName: `Driver ${nonce}`,
    },
    select: { id: true },
  })
  driverB = second.id
  org.ids['driver']!.push(driverB)

  userA = await mintDriverUser('Alpha')
  userB = await mintDriverUser('Bravo')
  for (const [driverId, userId] of [
    [driverA, userA],
    [driverB, userB],
  ] as const) {
    const linked = await inOrg((tx) =>
      linkDriverSignIn(tx, org.organizationId, driverId, userId),
    )
    if (!linked.ok) throw new Error(`link: ${linked.reason}`)
  }

  openA = await load('openA', driverA, 'DISPATCHED', [
    { type: 'PICKUP', city: 'Dallas', at: '2026-11-20T14:00:00Z' },
    { type: 'DELIVERY', city: 'Houston', at: '2026-11-21T09:00:00Z' },
  ])
  deliveredA = await load('delA', driverA, 'DELIVERED', [
    {
      type: 'PICKUP',
      city: 'Austin',
      at: '2026-11-02T14:00:00Z',
      departed: true,
    },
    {
      type: 'DELIVERY',
      city: 'Waco',
      at: '2026-11-03T09:00:00Z',
      departed: true,
    },
  ])
  openB = await load('openB', driverB, 'DISPATCHED', [
    { type: 'PICKUP', city: 'Tyler', at: '2026-11-19T14:00:00Z' },
    { type: 'DELIVERY', city: 'Laredo', at: '2026-11-20T09:00:00Z' },
  ])
  // Later than openA's pickup, so A's CURRENT load stays openA while A's
  // list gains this one through the second seat.
  teamB = await load('teamB', driverB, 'DISPATCHED', [
    { type: 'PICKUP', city: 'Lubbock', at: '2026-11-25T14:00:00Z' },
    { type: 'DELIVERY', city: 'Amarillo', at: '2026-11-26T09:00:00Z' },
  ])
  await owner.load.update({
    where: { id: teamB },
    data: { coDriverId: driverA },
  })

  podA = await document('podA', 'POD', { loadId: deliveredA })
  cdlA = await document('cdlA', 'CDL_COPY', { driverId: driverA })
  docB = await document('bolB', 'BOL', { loadId: openB })

  approvedA = await settlement('apprA', driverA, 'APPROVED', {
    loadId: deliveredA,
    loadNumber: `P-delA-${nonce}`,
    amountCents: 65_000,
  })
  draftA = await settlement('draftA', driverA, 'DRAFT', {
    loadId: openA,
    loadNumber: `P-openA-${nonce}`,
    amountCents: 70_000,
  })
  paidB = await settlement('paidB', driverB, 'PAID', null)
}, 240_000)

afterAll(async () => {
  await owner.user.deleteMany({ where: { email: { contains: `+p${nonce}@` } } })
  await dropOrganization(owner, org)
  await owner.$disconnect()
})

describe('the own row', () => {
  it('resolves from the session, and is nobody for an unlinked sign-in', async () => {
    const mine = await inOrg((tx) => ownDriver(tx, { userId: userA }))
    expect(mine?.id).toBe(driverA)
    expect(mine?.timezone).toBe('America/Chicago')
    const nobody = await inOrg((tx) => ownDriver(tx, { userId: org.userId }))
    expect(nobody).toBeNull()
  })
})

describe('Home — the current load', () => {
  it('is the open load on the driver’s seat, with stops and document types', async () => {
    const current = await inOrg((tx) => currentLoad(tx, driverA))
    expect(current?.id).toBe(openA)
    expect(current?.stops.map((stop) => stop.city)).toEqual([
      'Dallas',
      'Houston',
    ])
    expect(current?.documents).toEqual([])
    // The delivered load without a POD would need one; the open one needs
    // nothing yet — no pickup left, not delivered.
    expect(documentsNeeded(current!)).toEqual([])
  })

  it('and never the other driver’s', async () => {
    const theirs = await inOrg((tx) => currentLoad(tx, driverB))
    expect(theirs?.id).toBe(openB)
    expect(theirs?.id).not.toBe(openA)
  })

  it(`costs ${HOME_STATEMENTS} statements inside the transaction — the budget`, async () => {
    const { PrismaClient } = await import('@/generated/prisma/client')
    const { PrismaNeon } = await import('@prisma/adapter-neon')
    const counting = new PrismaClient({
      adapter: new PrismaNeon({
        connectionString: process.env.DIRECT_DATABASE_URL!,
      }),
      log: [{ emit: 'event', level: 'query' }],
    })
    const statements: string[] = []
    counting.$on('query', (event) => void statements.push(event.query))
    // Warm the socket OUTSIDE the transaction, as this-week-timing does.
    await counting.$queryRaw`select 1`
    await counting.$transaction(
      async (tx) => {
        await tx.$executeRawUnsafe(
          `SELECT set_config('app.current_org_id', $1, true)`,
          org.organizationId,
        )
        const driver = await ownDriver(tx as never, { userId: userA })
        await currentLoad(tx as never, driver!.id)
      },
      { timeout: LOAD_WRITE_TIMEOUT_MS },
    )
    await counting.$disconnect()
    // Minus the warm-up, BEGIN, set_config and COMMIT — the harness's own
    // four — what is left is the screen's cost. Listed by name on failure.
    const own = statements.filter(
      (sql) =>
        !/^(BEGIN|COMMIT|ROLLBACK)/i.test(sql) &&
        !/set_config/.test(sql) &&
        !/^select 1$/i.test(sql.trim()),
    )
    expect(own, own.join('\n')).toHaveLength(HOME_STATEMENTS)
  })
})

describe('My loads', () => {
  it('lists the driver’s own, open first, pay only through a finalised settlement', async () => {
    const rows = await inOrg((tx) =>
      ownLoads(tx, driverA, new Date('2026-11-12T12:00:00Z')),
    )
    const ids = rows.map((row) => row.id)
    // THE FIXTURE'S OWN LOADS ARE A'S TOO (seedOrganization puts its loads
    // on the first driver), so the list is asserted by membership and by
    // name, not by an exact set the fixture would have to be read for.
    expect(ids).toContain(openA)
    expect(ids).toContain(deliveredA)
    // THE SECOND SEAT COUNTS (§4.5): B's team load is on A's list…
    expect(ids).toContain(teamB)
    // …and B's solo load is not.
    expect(ids).not.toContain(openB)
    // Open ones first, every open row before every finished one.
    const firstFinished = rows.findIndex((row) => !row.isOpen)
    expect(rows.slice(0, firstFinished).every((row) => row.isOpen)).toBe(true)
    expect(rows.slice(firstFinished).every((row) => !row.isOpen)).toBe(true)
    const open = rows.find((row) => row.id === openA)!
    const delivered = rows.find((row) => row.id === deliveredA)!
    expect(open.isOpen).toBe(true)
    // THE DRAFT'S LINE DOES NOT SHOW: no projected pay (§4.3).
    expect(open.payCents).toBeNull()
    // The APPROVED settlement's line does.
    expect(delivered.payCents).toBe(65_000)
    expect(delivered.from).toBe('Austin, TX')
    expect(delivered.to).toBe('Waco, TX')
  })

  it('and the other driver sees only theirs — the fixture’s loads are A’s', async () => {
    const rows = await inOrg((tx) =>
      ownLoads(tx, driverB, new Date('2026-11-12T12:00:00Z')),
    )
    expect(rows.map((row) => row.id).sort()).toEqual([openB, teamB].sort())
  })
})

describe('Documents', () => {
  it('are on the driver’s loads or filed under the driver, never the other’s', async () => {
    const mine = await inOrg((tx) => ownDocuments(tx, driverA))
    const ids = mine.map((row) => row.id)
    // By membership: the fixture files a document on its own load, which is
    // A's load, so an exact set would be a claim about the fixture.
    expect(ids).toContain(cdlA)
    expect(ids).toContain(podA)
    expect(ids).not.toContain(docB)
    // EVERY row is on A's loads or under A — the predicate, read back.
    const where = await inOrg((tx) =>
      tx.document.findMany({
        where: { id: { in: ids } },
        select: {
          driverId: true,
          load: { select: { driverId: true, coDriverId: true } },
        },
      }),
    )
    for (const row of where) {
      expect(
        row.driverId === driverA ||
          row.load?.driverId === driverA ||
          row.load?.coDriverId === driverA,
      ).toBe(true)
    }
    const theirs = await inOrg((tx) => ownDocuments(tx, driverB))
    expect(theirs.map((row) => row.id)).toEqual([docB])
  })

  it('the download gate answers by the same predicate', async () => {
    expect(await inOrg((tx) => isOwnDocument(tx, driverA, podA))).toBe(true)
    expect(await inOrg((tx) => isOwnDocument(tx, driverA, docB))).toBe(false)
    expect(await inOrg((tx) => isOwnDocument(tx, driverB, docB))).toBe(true)
  })
})

describe('Settlements', () => {
  it('are the driver’s own and FINALISED only — the draft is absent', async () => {
    const mine = await inOrg((tx) => ownSettlements(tx, driverA))
    expect(mine.map((row) => row.id)).toEqual([approvedA])
    expect(mine[0]!.status).toBe('APPROVED')
    expect(mine[0]!.netCents).toBe(90_000)
    expect(mine.map((row) => row.id)).not.toContain(draftA)
    expect(mine.map((row) => row.id)).not.toContain(paidB)
    const theirs = await inOrg((tx) => ownSettlements(tx, driverB))
    expect(theirs.map((row) => row.id)).toEqual([paidB])
    expect(theirs[0]!.status).toBe('PAID')
  })

  it('the PDF gate answers by the same predicate: own and finalised', async () => {
    expect(await inOrg((tx) => isOwnSettlement(tx, driverA, approvedA))).toBe(
      true,
    )
    expect(await inOrg((tx) => isOwnSettlement(tx, driverA, draftA))).toBe(
      false,
    )
    expect(await inOrg((tx) => isOwnSettlement(tx, driverA, paidB))).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// THE ONE WRITE: ONE FORWARD STEP (Phase 7 step 4; §4.4 and §4.5).
// ---------------------------------------------------------------------------

describe('the driver’s status step', () => {
  // The DRIVER'S sign-in is the actor: the event row names them.
  const asDriver = <T>(
    userId: string,
    fn: Parameters<typeof withOrg<T>>[1],
  ): Promise<T> =>
    withOrg(org.organizationId, fn, {
      attribution: { userId, ip: null, userAgent: 'portal.test' },
      maxWaitMs: 15_000,
      timeoutMs: LOAD_WRITE_TIMEOUT_MS,
    })

  it('moves the own open load one rung, source DRIVER_PORTAL, the driver named', async () => {
    const outcome = await asDriver(userA, (tx) =>
      recordPortalStatus(tx, { userId: userA }, openA, 'AT_PICKUP'),
    )
    expect(outcome).toMatchObject({
      ok: true,
      from: 'DISPATCHED',
      to: 'AT_PICKUP',
    })
    const load = await owner.load.findUniqueOrThrow({
      where: { id: openA },
      select: { operationalStatus: true },
    })
    expect(load.operationalStatus).toBe('AT_PICKUP')
    const event = await owner.loadStatusEvent.findFirst({
      where: { loadId: openA, toStatus: 'AT_PICKUP' },
      orderBy: { occurredAt: 'desc' },
    })
    expect(event?.source).toBe('DRIVER_PORTAL')
    expect(event?.changedByUserId).toBe(userA)
    expect(event?.outcome).toBe('APPLIED')
    expect(event?.fromStatus).toBe('DISPATCHED')
  })

  it('refuses a step that is not the next one — a stale tap is never a jump', async () => {
    // The screen offered AT_PICKUP; the load is already there. The engine
    // would have said "unchanged"; the portal says the step moved on.
    expect(
      await asDriver(userA, (tx) =>
        recordPortalStatus(tx, { userId: userA }, openA, 'IN_TRANSIT'),
      ),
    ).toEqual({ ok: false, reason: 'not_the_next_step', at: 'AT_PICKUP' })
    // Backwards is refused the same way, and nothing is written by the
    // portal for it — the engine's REFUSED_STALE row is for the office's
    // late click, not for a screen that offered the wrong rung.
    expect(
      await asDriver(userA, (tx) =>
        recordPortalStatus(tx, { userId: userA }, openA, 'DISPATCHED'),
      ),
    ).toEqual({ ok: false, reason: 'not_the_next_step', at: 'AT_PICKUP' })
    const events = await owner.loadStatusEvent.count({
      where: { loadId: openA, source: 'DRIVER_PORTAL' },
    })
    expect(events).toBe(1)
  })

  it('a double tap on the real next rung lands once', async () => {
    const first = await asDriver(userA, (tx) =>
      recordPortalStatus(tx, { userId: userA }, openA, 'LOADED'),
    )
    expect(first).toMatchObject({ ok: true, from: 'AT_PICKUP', to: 'LOADED' })
    const second = await asDriver(userA, (tx) =>
      recordPortalStatus(tx, { userId: userA }, openA, 'LOADED'),
    )
    expect(second).toEqual({
      ok: false,
      reason: 'not_the_next_step',
      at: 'LOADED',
    })
    const events = await owner.loadStatusEvent.count({
      where: { loadId: openA, source: 'DRIVER_PORTAL' },
    })
    expect(events).toBe(2)
  })

  it('a co-driver is refused by name, and the other driver’s load is not theirs', async () => {
    expect(
      await asDriver(userA, (tx) =>
        recordPortalStatus(tx, { userId: userA }, teamB, 'AT_PICKUP'),
      ),
    ).toEqual({ ok: false, reason: 'co_driver', at: 'DISPATCHED' })
    expect(
      await asDriver(userA, (tx) =>
        recordPortalStatus(tx, { userId: userA }, openB, 'AT_PICKUP'),
      ),
    ).toEqual({ ok: false, reason: 'not_own_load' })
    // And B, the driver of record on the team load, moves it.
    expect(
      await asDriver(userB, (tx) =>
        recordPortalStatus(tx, { userId: userB }, teamB, 'AT_PICKUP'),
      ),
    ).toMatchObject({ ok: true, from: 'DISPATCHED', to: 'AT_PICKUP' })
  })

  it('a delivered load has no next step; an unlinked sign-in has no row', async () => {
    expect(
      await asDriver(userA, (tx) =>
        recordPortalStatus(tx, { userId: userA }, deliveredA, 'DELIVERED'),
      ),
    ).toEqual({ ok: false, reason: 'no_next_step', at: 'DELIVERED' })
    expect(
      await inOrg((tx) =>
        recordPortalStatus(tx, { userId: org.userId }, openA, 'IN_TRANSIT'),
      ),
    ).toEqual({ ok: false, reason: 'no_driver_row' })
  })
})

// ---------------------------------------------------------------------------
// THE TAP IS THE STOP'S CHECK-IN (flag 8, ruled 2026-11-12) — read after the
// taps above moved openA to LOADED.
// ---------------------------------------------------------------------------

describe('the tap is the stop’s check-in', () => {
  const asDriver = <T>(
    userId: string,
    fn: Parameters<typeof withOrg<T>>[1],
  ): Promise<T> =>
    withOrg(org.organizationId, fn, {
      attribution: { userId, ip: null, userAgent: 'portal.test' },
      maxWaitMs: 15_000,
      timeoutMs: LOAD_WRITE_TIMEOUT_MS,
    })
  const stopsOf = (loadId: string) =>
    owner.loadStop.findMany({
      where: { loadId },
      orderBy: { sequence: 'asc' },
      select: { id: true, type: true, arrivedAt: true, departedAt: true },
    })

  it('At pickup stamped the pickup’s arrival and Loaded its departure; delivery untouched', async () => {
    const [pickup, delivery] = await stopsOf(openA)
    expect(pickup!.type).toBe('PICKUP')
    expect(pickup!.arrivedAt).not.toBeNull()
    expect(pickup!.departedAt).not.toBeNull()
    expect(delivery!.arrivedAt).toBeNull()
    expect(delivery!.departedAt).toBeNull()
    // AND THE AUDIT ROW NAMES THE DRIVER: the stop's check-in is attributed
    // to the sign-in that tapped, which is what the office's stop table reads.
    const audit = await owner.auditLog.findFirst({
      where: { entityType: 'LoadStop', entityId: pickup!.id, userId: userA },
      orderBy: { createdAt: 'desc' },
    })
    expect(audit).not.toBeNull()
    expect(JSON.stringify(audit!.changes)).toContain('departedAt')
  })

  it('the office’s own value stands: a clock already set is not overwritten', async () => {
    const [, delivery] = await stopsOf(openA)
    const officeArrival = new Date('2026-11-21T08:30:00Z')
    await owner.loadStop.update({
      where: { id: delivery!.id },
      data: { arrivedAt: officeArrival },
    })
    // IN_TRANSIT stamps nothing; AT_DELIVERY would stamp the delivery's
    // arrival, but the office already has it.
    const transit = await asDriver(userA, (tx) =>
      recordPortalStatus(tx, { userId: userA }, openA, 'IN_TRANSIT'),
    )
    expect(transit).toMatchObject({ ok: true, to: 'IN_TRANSIT', stamped: null })
    const arrived = await asDriver(userA, (tx) =>
      recordPortalStatus(tx, { userId: userA }, openA, 'AT_DELIVERY'),
    )
    expect(arrived).toMatchObject({
      ok: true,
      to: 'AT_DELIVERY',
      stamped: null,
    })
    const [, after] = await stopsOf(openA)
    expect(after!.arrivedAt?.toISOString()).toBe(officeArrival.toISOString())
    expect(after!.departedAt).toBeNull()
  })

  it('Delivered stamps the delivery’s departure', async () => {
    const delivered = await asDriver(userA, (tx) =>
      recordPortalStatus(tx, { userId: userA }, openA, 'DELIVERED'),
    )
    expect(delivered).toMatchObject({
      ok: true,
      to: 'DELIVERED',
      stamped: { clock: 'departedAt' },
    })
    const [, after] = await stopsOf(openA)
    expect(after!.departedAt).not.toBeNull()
  })
})

// ---------------------------------------------------------------------------
// THE DRIVER'S UPLOAD (step 5): the predicates the two portal routes ask.
// ---------------------------------------------------------------------------

describe('the driver’s upload target', () => {
  it('an upload lands only on a load the driver is on — either seat', async () => {
    expect(
      await inOrg((tx) => uploadTargetFor(tx, { userId: userA }, openA)),
    ).toMatchObject({ ok: true, driverId: driverA })
    // The second seat may upload (§4.5), though it never sets the status.
    expect(
      await inOrg((tx) => uploadTargetFor(tx, { userId: userA }, teamB)),
    ).toMatchObject({ ok: true, driverId: driverA })
    expect(
      await inOrg((tx) => uploadTargetFor(tx, { userId: userA }, openB)),
    ).toEqual({ ok: false, reason: 'not_own_load' })
    expect(
      await inOrg((tx) => uploadTargetFor(tx, { userId: org.userId }, openA)),
    ).toEqual({ ok: false, reason: 'no_driver_row' })
  })

  it('a pending upload confirms only onto the driver’s own load, and only a portal type', async () => {
    const mine = await owner.pendingUpload.create({
      data: {
        organizationId: org.organizationId,
        companyId: org.companyId,
        r2Key: `portal-test/pending-${nonce}.jpg`,
        filename: 'pod.jpg',
        mimeType: 'image/jpeg',
        sizeBytes: 100,
        sha256: 'x'.repeat(44),
        type: 'POD',
        targetEntity: 'load',
        targetId: openA,
        expiresAt: new Date(Date.now() + 300_000),
      },
      select: { id: true },
    })
    const theirs = await owner.pendingUpload.create({
      data: {
        organizationId: org.organizationId,
        companyId: org.companyId,
        r2Key: `portal-test/pending-b-${nonce}.jpg`,
        filename: 'bol.jpg',
        mimeType: 'image/jpeg',
        sizeBytes: 100,
        sha256: 'x'.repeat(44),
        type: 'BOL',
        targetEntity: 'load',
        targetId: openB,
        expiresAt: new Date(Date.now() + 300_000),
      },
      select: { id: true },
    })
    const officeType = await owner.pendingUpload.create({
      data: {
        organizationId: org.organizationId,
        companyId: org.companyId,
        r2Key: `portal-test/pending-rc-${nonce}.pdf`,
        filename: 'rc.pdf',
        mimeType: 'application/pdf',
        sizeBytes: 100,
        sha256: 'x'.repeat(44),
        type: 'RATE_CONFIRMATION',
        targetEntity: 'load',
        targetId: openA,
        expiresAt: new Date(Date.now() + 300_000),
      },
      select: { id: true },
    })
    expect(
      await inOrg((tx) => ownPendingUpload(tx, { userId: userA }, mine.id)),
    ).toBe(true)
    expect(
      await inOrg((tx) => ownPendingUpload(tx, { userId: userA }, theirs.id)),
    ).toBe(false)
    expect(
      await inOrg((tx) =>
        ownPendingUpload(tx, { userId: userA }, officeType.id),
      ),
    ).toBe(false)
    expect(
      await inOrg((tx) => ownPendingUpload(tx, { userId: userB }, theirs.id)),
    ).toBe(true)
    await owner.pendingUpload.deleteMany({
      where: { id: { in: [mine.id, theirs.id, officeType.id] } },
    })
  })
})
