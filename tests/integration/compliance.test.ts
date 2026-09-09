import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { retryingClient } from '../retrying-client'
import { withOrg } from '@/lib/tenancy'
import { LOAD_WRITE_TIMEOUT_MS } from '@/lib/loads'
import {
  complianceCount,
  complianceQueue,
  describeWarnings,
  dispatchWarnings,
  documentTypeFor,
  recordRenewal,
  recordsForSubject,
} from '@/lib/compliance'
import { actionQueue } from '@/lib/dashboard'
import type { AuthorizedSession } from '@/lib/permissions'
import type { PrismaClient } from '@/generated/prisma/client'

// ---------------------------------------------------------------------------
// Compliance against real Postgres.
//
// The derivation itself is covered in tests/compliance.test.ts. What can only
// be asserted here is §4's first acceptance box, in full:
//
//   "A truck with an expiring annual inspection appears in the queue exactly
//    `leadTime` days out, and in the dashboard row, and on its own detail
//    panel — all three from one derivation"
//
// So all three are asked, about the same truck, on the same day, and made to
// agree. And the lead time comes from the authority's OWN CompanySettings
// row — the Phase 1 field nothing read until now.
// ---------------------------------------------------------------------------

let owner: PrismaClient
let organizationId = ''
let companyId = ''
let userId = ''
let truckId = ''
const nonce = Math.random().toString(36).slice(2, 8)

const inOrg = <T>(fn: Parameters<typeof withOrg<T>>[1]): Promise<T> =>
  withOrg(organizationId, fn, {
    attribution: { userId, ip: null, userAgent: 'compliance.test' },
    maxWaitMs: 20_000,
    // Prisma's 5s default cannot be met from here — see the note in
    // tests/transaction-budget.test.ts. One dial for all nineteen suites.
    timeoutMs: LOAD_WRITE_TIMEOUT_MS,
  })

const asOwner = (): AuthorizedSession => ({
  userId,
  organizationId,
  role: 'OWNER',
  companyScopes: [],
})

/** A compliance record expiring `days` from `NOW`. */
async function record(
  type: 'ANNUAL_INSPECTION' | 'REGISTRATION' | 'CDL' | 'MEDICAL_CARD',
  days: number,
  identifier?: string,
) {
  const expiresAt = new Date(NOW.getTime())
  expiresAt.setUTCDate(expiresAt.getUTCDate() + days)
  return owner.complianceItem.create({
    data: {
      organizationId,
      companyId,
      type,
      truckId,
      expiresAt,
      ...(identifier ? { identifier } : {}),
    },
    select: { id: true },
  })
}

/** A fixed "today", so a test run at 23:58 does not answer differently. */
const NOW = new Date('2026-08-06T12:00:00Z')

beforeAll(async () => {
  owner = retryingClient(process.env.DIRECT_DATABASE_URL!)

  const organization = await owner.organization.create({
    data: {
      name: `Compliance ${nonce}`,
      slug: `compliance-${nonce}`,
      maxCompanies: 5,
      companies: { create: [{ name: `Alpha ${nonce}` }] },
    },
    include: { companies: true },
  })
  organizationId = organization.id
  companyId = organization.companies[0]!.id

  // THE LEAD TIME IS THE AUTHORITY'S OWN. Fourteen, not the 30 default, so a
  // passing test cannot be explained by the constant.
  await owner.companySettings.create({
    data: { companyId, organizationId, complianceWarnDays: 14 },
  })

  const user = await owner.user.create({
    data: { email: `compliance-${nonce}@example.test`, name: 'Safety Tester' },
  })
  userId = user.id
  await owner.membership.create({
    data: { userId, organizationId, role: 'OWNER' },
  })

  truckId = (
    await owner.truck.create({
      data: { organizationId, companyId, unitNumber: `104-${nonce}` },
    })
  ).id
}, 300_000)

afterAll(async () => {
  await owner.organization
    .delete({ where: { id: organizationId } })
    .catch(() => {})
  await owner.user.delete({ where: { id: userId } }).catch(() => {})
  await owner.$disconnect()
})

describe('§4: the queue, the dashboard and the panel agree', () => {
  it('shows up in all three exactly at the lead time, and not a day early', async () => {
    // 15 days out, against a 14-day lead time: NOT yet.
    const item = await record('ANNUAL_INSPECTION', 15, `AI-${nonce}`)

    const early = await inOrg((tx) => complianceQueue(tx, {}, {}, NOW))
    expect(early.leadDays).toBe(14)
    expect(early.rows.map((row) => row.id)).not.toContain(item.id)

    // Move it one day closer. Fourteen days out is exactly the boundary.
    const at = new Date(NOW.getTime())
    at.setUTCDate(at.getUTCDate() + 14)
    await owner.complianceItem.update({
      where: { id: item.id },
      data: { expiresAt: at },
    })

    // 1 — THE QUEUE.
    const queue = await inOrg((tx) => complianceQueue(tx, {}, {}, NOW))
    const queued = queue.rows.find((row) => row.id === item.id)
    expect(queued, 'not in the queue at exactly leadTime days').toBeDefined()
    expect(queued).toMatchObject({
      status: 'expiring',
      daysLeft: 14,
      subject: 'truck',
      isSuperseded: false,
    })

    // 2 — THE DASHBOARD ROW. Counted through the same function.
    const counted = await inOrg((tx) => complianceCount(tx, {}, NOW))
    expect(counted.count).toBe(queue.rows.length)

    const rows = await inOrg((tx) => actionQueue(tx, asOwner(), {}))
    expect(rows.find((row) => row.key === 'compliance')?.count).toBe(
      queue.rows.length,
    )

    // 3 — THE ASSET PANEL.
    const panel = await inOrg((tx) =>
      recordsForSubject(tx, 'truck', truckId, NOW),
    )
    const onPanel = panel.find((row) => row.id === item.id)
    expect(onPanel).toMatchObject({ status: 'expiring', daysLeft: 14 })

    // All three, from one derivation.
    expect(onPanel?.status).toBe(queued?.status)
  }, 300_000)

  it('reads the lead time per authority, not from a constant', async () => {
    // Same record, a different policy: widen the window and the answer moves.
    await owner.companySettings.update({
      where: { companyId },
      data: { complianceWarnDays: 60 },
    })
    const wide = await inOrg((tx) => complianceQueue(tx, {}, {}, NOW))
    expect(wide.leadDays).toBe(60)

    await owner.companySettings.update({
      where: { companyId },
      data: { complianceWarnDays: 14 },
    })
  }, 300_000)
})

describe('a renewal supersedes without overwriting', () => {
  it('keeps the lapsed record, marks it, and takes it out of the queue', async () => {
    const lapsed = await record('REGISTRATION', -40, `REG-OLD-${nonce}`)

    // Expired and in the queue — nobody has renewed it yet.
    const before = await inOrg((tx) => complianceQueue(tx, {}, {}, NOW))
    expect(before.rows.find((row) => row.id === lapsed.id)).toMatchObject({
      status: 'expired',
      isSuperseded: false,
    })

    // Renew: a NEW record, nothing updated.
    const renewed = await record('REGISTRATION', 300, `REG-NEW-${nonce}`)

    const after = await inOrg((tx) => complianceQueue(tx, {}, {}, NOW))
    // OUT of the queue: a red row for a truck that is entirely legal teaches
    // people to ignore red.
    expect(after.rows.map((row) => row.id)).not.toContain(lapsed.id)

    // But STILL THERE, and marked — §2.1's whole point.
    const panel = await inOrg((tx) =>
      recordsForSubject(tx, 'truck', truckId, NOW),
    )
    expect(panel.find((row) => row.id === lapsed.id)).toMatchObject({
      status: 'expired',
      isSuperseded: true,
      identifier: `REG-OLD-${nonce}`,
    })
    expect(panel.find((row) => row.id === renewed.id)).toMatchObject({
      status: 'current',
      isSuperseded: false,
    })

    // Nothing was overwritten: the old row's own columns are untouched.
    const stored = await owner.complianceItem.findUnique({
      where: { id: lapsed.id },
      select: { identifier: true, deletedAt: true },
    })
    expect(stored).toMatchObject({
      identifier: `REG-OLD-${nonce}`,
      deletedAt: null,
    })
  }, 300_000)
})

describe('what the queue filters', () => {
  it('narrows by subject and by type', async () => {
    const bySubject = await inOrg((tx) =>
      complianceQueue(tx, {}, { subject: 'driver' }, NOW),
    )
    // Every record in this fixture is on a truck.
    expect(bySubject.rows).toEqual([])

    const byType = await inOrg((tx) =>
      complianceQueue(tx, {}, { type: 'ANNUAL_INSPECTION' }, NOW),
    )
    expect(byType.rows.every((row) => row.type === 'ANNUAL_INSPECTION')).toBe(
      true,
    )
    expect(byType.rows.length).toBeGreaterThan(0)
  }, 300_000)

  it('leaves current records out — it is a queue, not an inventory', async () => {
    const far = await record('CDL', 900)
    const queue = await inOrg((tx) => complianceQueue(tx, {}, {}, NOW))
    expect(queue.rows.map((row) => row.id)).not.toContain(far.id)

    // The panel has it, because the panel IS the inventory.
    const panel = await inOrg((tx) =>
      recordsForSubject(tx, 'truck', truckId, NOW),
    )
    expect(panel.map((row) => row.id)).toContain(far.id)
  }, 300_000)

  it('can be asked for the superseded ones explicitly', async () => {
    const withHistory = await inOrg((tx) =>
      complianceQueue(tx, {}, { includeSuperseded: true }, NOW),
    )
    expect(withHistory.rows.some((row) => row.isSuperseded)).toBe(true)
  }, 300_000)
})

describe('§4: recording a renewal (step 2)', () => {
  it('creates a new record and never touches the old one', async () => {
    // MEDICAL_CARD, used by no other test in this file. The first version used
    // CDL and the renewal came back superseded — correctly, because an earlier
    // test had already filed a CDL 900 days out. The code was right and the
    // fixture collided; a type of its own keeps the two apart.
    const before = await record('MEDICAL_CARD', -5, `MED-OLD-${nonce}`)
    const stampedBefore = await owner.complianceItem.findUniqueOrThrow({
      where: { id: before.id },
      select: { updatedAt: true, expiresAt: true },
    })

    const expiresAt = new Date(NOW.getTime())
    expiresAt.setUTCDate(expiresAt.getUTCDate() + 700)

    const outcome = await inOrg((tx) =>
      recordRenewal(tx, {
        subject: 'truck',
        subjectId: truckId,
        type: 'MEDICAL_CARD',
        expiresAt,
        identifier: `MED-NEW-${nonce}`,
      }),
    )
    expect(outcome).toMatchObject({ ok: true })
    if (!outcome.ok) return

    // THE OLD ROW IS BYTE-FOR-BYTE WHERE IT WAS. `updatedAt` moves on any
    // write, so an unchanged timestamp is the strongest available proof that
    // §2.1's "never overwrite" is what actually happened.
    const stampedAfter = await owner.complianceItem.findUniqueOrThrow({
      where: { id: before.id },
      select: { updatedAt: true, expiresAt: true },
    })
    expect(stampedAfter.updatedAt.getTime()).toBe(
      stampedBefore.updatedAt.getTime(),
    )
    expect(stampedAfter.expiresAt.getTime()).toBe(
      stampedBefore.expiresAt.getTime(),
    )

    // And the panel shows both, the old one marked.
    const panel = await inOrg((tx) =>
      recordsForSubject(tx, 'truck', truckId, NOW),
    )
    expect(panel.find((row) => row.id === before.id)?.isSuperseded).toBe(true)
    expect(panel.find((row) => row.id === outcome.recordId)).toMatchObject({
      status: 'current',
      isSuperseded: false,
      identifier: `MED-NEW-${nonce}`,
    })
  }, 300_000)

  it('takes the tenant and the authority from the asset, not the caller', async () => {
    const expiresAt = new Date(NOW.getTime())
    expiresAt.setUTCDate(expiresAt.getUTCDate() + 400)

    const outcome = await inOrg((tx) =>
      recordRenewal(tx, {
        subject: 'truck',
        subjectId: truckId,
        type: 'DOT_INSPECTION',
        expiresAt,
      }),
    )
    expect(outcome).toMatchObject({ ok: true })
    if (!outcome.ok) return

    const stored = await owner.complianceItem.findUniqueOrThrow({
      where: { id: outcome.recordId },
      select: { organizationId: true, companyId: true, truckId: true },
    })
    expect(stored).toMatchObject({ organizationId, companyId, truckId })
  }, 300_000)

  it('refuses an id that is not in this tenant', async () => {
    // Row-level security hides the other organization's truck, so the lookup
    // finds nothing and the write never happens — a forged id lands on air.
    expect(
      await inOrg((tx) =>
        recordRenewal(tx, {
          subject: 'truck',
          subjectId: 'cmnotarealtruckidatall000',
          type: 'REGISTRATION',
          expiresAt: new Date('2030-01-01T00:00:00Z'),
        }),
      ),
    ).toMatchObject({ ok: false, reason: 'subject_not_found' })
  }, 300_000)

  it('refuses an issue date after the expiry, and a duplicate expiry', async () => {
    const expiresAt = new Date('2029-06-01T00:00:00Z')

    expect(
      await inOrg((tx) =>
        recordRenewal(tx, {
          subject: 'truck',
          subjectId: truckId,
          type: 'REGISTRATION',
          issuedAt: new Date('2029-07-01T00:00:00Z'),
          expiresAt,
        }),
      ),
    ).toMatchObject({ ok: false, reason: 'bad_dates' })

    const first = await inOrg((tx) =>
      recordRenewal(tx, {
        subject: 'truck',
        subjectId: truckId,
        type: 'REGISTRATION',
        expiresAt,
      }),
    )
    expect(first).toMatchObject({ ok: true })

    // The same renewal submitted twice. Two live registrations for one truck
    // is the data problem `shapeRecords` deliberately shows rather than
    // resolves — better to refuse the double-submit that causes it.
    expect(
      await inOrg((tx) =>
        recordRenewal(tx, {
          subject: 'truck',
          subjectId: truckId,
          type: 'REGISTRATION',
          expiresAt,
        }),
      ),
    ).toMatchObject({ ok: false, reason: 'duplicate' })
  }, 300_000)

  it('files each compliance type under the right document type', () => {
    // The upload control on a registration row offers "Registration" rather
    // than making somebody pick from eighteen.
    expect(documentTypeFor('REGISTRATION')).toBe('REGISTRATION')
    expect(documentTypeFor('ANNUAL_INSPECTION')).toBe('INSPECTION_REPORT')
    expect(documentTypeFor('INSURANCE_LIABILITY')).toBe('INSURANCE_CERT')
    expect(documentTypeFor('CDL')).toBe('CDL_COPY')
    // Anything unmapped still uploads, under OTHER.
    expect(documentTypeFor('PERMIT')).toBe('OTHER')
  })
})

describe('§4: an expired truck warns at dispatch and does not block', () => {
  // §2.4, and the box Phase 4's acceptance run found nobody had built: "An
  // expired truck/driver warns at dispatch, doesn't block. The assignment flow
  // surfaces the expiry in words next to the confirm; the dispatcher proceeds
  // if the business says so; the audit row records that the warning was shown."
  //
  // The derivation is asserted here; the screen and the acknowledgement round
  // trip are asserted in scripts/verify-dispatch-warning.mjs on the deployed
  // worker, because a warning nobody sees is not a warning.

  it('names an expired insurance policy on the truck being assigned', async () => {
    const lapsed = new Date(NOW.getTime())
    lapsed.setUTCDate(lapsed.getUTCDate() - 40)
    const item = await owner.complianceItem.create({
      data: {
        organizationId,
        companyId,
        type: 'INSURANCE_LIABILITY',
        truckId,
        expiresAt: lapsed,
        identifier: `POL-${nonce}`,
      },
      select: { id: true },
    })

    const warnings = await inOrg((tx) => dispatchWarnings(tx, { truckId }, NOW))
    const insurance = warnings.find(
      (warning) => warning.type === 'INSURANCE_LIABILITY',
    )
    expect(insurance).toMatchObject({
      subject: 'truck',
      status: 'expired',
      daysLeft: -40,
    })

    // WORST FIRST. A dispatcher reads the top line and acts on it, so the
    // thing that has been wrong longest has to be there.
    expect(warnings[0]?.daysLeft).toBeLessThanOrEqual(
      warnings[warnings.length - 1]!.daysLeft,
    )

    await owner.complianceItem.delete({ where: { id: item.id } })
  }, 300_000)

  it('says nothing about a truck whose paperwork is in date', async () => {
    // The pair. A warning that fires on everything is a warning nobody reads,
    // and the whole mechanism would be noise within a week.
    const clean = await owner.truck.create({
      data: { organizationId, companyId, unitNumber: `clean-${nonce}` },
      select: { id: true },
    })
    const future = new Date(NOW.getTime())
    future.setUTCDate(future.getUTCDate() + 300)
    await owner.complianceItem.create({
      data: {
        organizationId,
        companyId,
        type: 'REGISTRATION',
        truckId: clean.id,
        expiresAt: future,
      },
    })

    expect(
      await inOrg((tx) => dispatchWarnings(tx, { truckId: clean.id }, NOW)),
    ).toEqual([])
  }, 300_000)

  it('and nothing about a lapsed record a renewal has superseded', async () => {
    // §2.1 keeps the old registration visible as history. Warning on it at
    // dispatch would ground a truck that was renewed last week — the exact
    // failure the supersession rule exists to prevent, one screen over.
    const renewed = await owner.truck.create({
      data: { organizationId, companyId, unitNumber: `renewed-${nonce}` },
      select: { id: true },
    })
    const past = new Date(NOW.getTime())
    past.setUTCDate(past.getUTCDate() - 30)
    const ahead = new Date(NOW.getTime())
    ahead.setUTCDate(ahead.getUTCDate() + 335)

    await owner.complianceItem.create({
      data: {
        organizationId,
        companyId,
        type: 'REGISTRATION',
        truckId: renewed.id,
        expiresAt: past,
      },
    })
    await owner.complianceItem.create({
      data: {
        organizationId,
        companyId,
        type: 'REGISTRATION',
        truckId: renewed.id,
        expiresAt: ahead,
      },
    })

    expect(
      await inOrg((tx) => dispatchWarnings(tx, { truckId: renewed.id }, NOW)),
    ).toEqual([])
  }, 300_000)

  it('describes them for the audit row in one line', () => {
    // What lands in `LoadAssignment.reason`, which IS the audit row — the
    // extension diffs it field by field like every other write.
    const line = describeWarnings([
      {
        subject: 'truck',
        subjectLabel: '104',
        type: 'INSURANCE_LIABILITY',
        status: 'expired',
        daysLeft: -40,
        expiresAt: new Date('2026-06-27T00:00:00Z'),
      },
    ])
    expect(line).toBe('truck 104 INSURANCE_LIABILITY expired 2026-06-27')
  })
})

// ---------------------------------------------------------------------------
// THE QUEUE IS WHAT SOMEBODY CAN ACT ON.
//
// Added with the all-trucks import, which writes compliance rows from the
// registration, inspection and insurance dates on EVERY truck — 67 expired
// registrations and 25 expired insurance dates among them, most on trucks that
// left the fleet. Without this narrowing the safety queue fills with renewals
// nobody can perform, and a work list that cannot be worked stops being read.
//
// BOTH BRANCHES ARE WATCHED HERE. A test that only ever sees the row excluded
// would pass just as happily against a filter that excluded everything.
// ---------------------------------------------------------------------------
describe('the queue shows only what somebody can act on', () => {
  // ITS OWN TRUCK, NOT THE FIXTURE'S. The shared truck already carries a
  // RENEWED registration, and a second one dated earlier is superseded by
  // design — which is correct behaviour and would have hidden this filter
  // behind an unrelated rule. Found by the test failing.
  async function ownTruck(label: string) {
    const truck = await owner.truck.create({
      data: {
        organizationId,
        companyId,
        unitNumber: `Q-${label}-${nonce}`,
      },
    })
    const item = await owner.complianceItem.create({
      data: {
        organizationId,
        companyId,
        type: 'REGISTRATION',
        truckId: truck.id,
        expiresAt: new Date(NOW.getTime() - 30 * 24 * 60 * 60 * 1000),
      },
    })
    return { truckId: truck.id, item }
  }

  it('drops a truck taken out of service, and brings it back when it returns', async () => {
    const { truckId, item } = await ownTruck('oos')

    const live = await inOrg((tx) => complianceQueue(tx, {}, {}, NOW))
    expect(live.rows.map((row) => row.id)).toContain(item.id)

    await owner.truck.update({
      where: { id: truckId },
      data: { status: 'OUT_OF_SERVICE' },
    })
    const parked = await inOrg((tx) => complianceQueue(tx, {}, {}, NOW))
    expect(parked.rows.map((row) => row.id)).not.toContain(item.id)

    // AND THE ROW IS STILL THERE. Only the queue is narrowed; the truck's own
    // page is the history and must keep showing what the vehicle carried.
    const panel = await inOrg((tx) =>
      recordsForSubject(tx, 'truck', truckId, NOW),
    )
    expect(panel.map((row) => row.id)).toContain(item.id)

    await owner.truck.update({
      where: { id: truckId },
      data: { status: 'AVAILABLE' },
    })
    const back = await inOrg((tx) => complianceQueue(tx, {}, {}, NOW))
    expect(back.rows.map((row) => row.id)).toContain(item.id)
  }, 300_000)

  it('drops an inactive driver the same way', async () => {
    const driver = await owner.driver.create({
      data: {
        organizationId,
        companyId,
        firstName: 'Queue',
        lastName: `Tester ${nonce}`,
      },
    })
    const item = await owner.complianceItem.create({
      data: {
        organizationId,
        companyId,
        type: 'CDL',
        driverId: driver.id,
        expiresAt: new Date(NOW.getTime() - 30 * 24 * 60 * 60 * 1000),
      },
    })

    const live = await inOrg((tx) => complianceQueue(tx, {}, {}, NOW))
    expect(live.rows.map((row) => row.id)).toContain(item.id)

    await owner.driver.update({
      where: { id: driver.id },
      data: { status: 'INACTIVE' },
    })
    const gone = await inOrg((tx) => complianceQueue(tx, {}, {}, NOW))
    expect(gone.rows.map((row) => row.id)).not.toContain(item.id)
  }, 300_000)

  // A truck in the shop is coming back this week and its registration still
  // has to be current — the same line `ASSIGNABLE_TRUCK` draws.
  it('keeps a truck that is only in for maintenance', async () => {
    const { truckId, item } = await ownTruck('maint')
    await owner.truck.update({
      where: { id: truckId },
      data: { status: 'MAINTENANCE' },
    })
    const queue = await inOrg((tx) => complianceQueue(tx, {}, {}, NOW))
    expect(queue.rows.map((row) => row.id)).toContain(item.id)

    await owner.truck.update({
      where: { id: truckId },
      data: { status: 'AVAILABLE' },
    })
  }, 300_000)
})

// ---------------------------------------------------------------------------
// LIABILITY AND CARGO BELONG TO THE CARRIER.
//
// Production held 25 per-truck insurance rows that were really 5 policies — 17
// Dolphins trucks and 5 RAM trucks all expiring 2025-10-21. A fleet policy is
// a ComplianceItem with no asset link, which the schema always allowed and
// `shapeRecords` used to DROP as malformed.
//
// Every assertion here is about a silent failure: a policy that renders
// nowhere, a truck that looks uninsured, or one carrier's renewal marking
// another carrier's live policy as history.
// ---------------------------------------------------------------------------
describe('a fleet policy belongs to the carrier', () => {
  async function policy(
    days: number,
    type: 'INSURANCE_LIABILITY' = 'INSURANCE_LIABILITY',
  ) {
    const expiresAt = new Date(NOW.getTime())
    expiresAt.setUTCDate(expiresAt.getUTCDate() + days)
    return owner.complianceItem.create({
      data: { organizationId, companyId, type, expiresAt },
    })
  }

  it('appears in the queue, attached to nothing, under the carrier', async () => {
    const item = await policy(-10)
    const queue = await inOrg((tx) => complianceQueue(tx, {}, {}, NOW))
    const row = queue.rows.find((r) => r.id === item.id)
    expect(row).toBeDefined()
    expect(row?.subject).toBe('company')
    // The carrier's own name, not a unit number and not an em-dash.
    expect(row?.subjectLabel).toBeTruthy()
  }, 300_000)

  it('is reachable by the company subject filter', async () => {
    const item = await policy(-11)
    const narrowed = await inOrg((tx) =>
      complianceQueue(tx, {}, { subject: 'company' }, NOW),
    )
    expect(narrowed.rows.map((r) => r.id)).toContain(item.id)
    expect(narrowed.rows.every((r) => r.subject === 'company')).toBe(true)
  }, 300_000)

  // THE INHERITANCE. A truck's page must still answer "is this insured", and
  // the answer now lives on its carrier rather than on twenty-two copies.
  it('shows on a truck of that carrier without being stored there', async () => {
    const item = await policy(-12)
    const panel = await inOrg((tx) =>
      recordsForSubject(tx, 'truck', truckId, NOW),
    )
    const row = panel.find((r) => r.id === item.id)
    expect(row).toBeDefined()
    expect(row?.subject).toBe('company')

    // And it really is not on the truck: the row carries no truckId.
    const stored = await owner.complianceItem.findUniqueOrThrow({
      where: { id: item.id },
      select: { truckId: true },
    })
    expect(stored.truckId).toBeNull()
  }, 300_000)

  // ONE CARRIER'S RENEWAL MUST NOT AGE ANOTHER'S POLICY. Before the supersede
  // key learned about companies, every unattached liability row shared the key
  // `:INSURANCE_LIABILITY`.
  it('does not let one carrier supersede another', async () => {
    const other = await owner.company.create({
      data: { organizationId, name: `Second carrier ${nonce}` },
    })
    const mine = await policy(-13)
    const expiresAt = new Date(NOW.getTime())
    expiresAt.setUTCDate(expiresAt.getUTCDate() + 300)
    await owner.complianceItem.create({
      data: {
        organizationId,
        companyId: other.id,
        type: 'INSURANCE_LIABILITY',
        expiresAt,
      },
    })

    const queue = await inOrg((tx) => complianceQueue(tx, {}, {}, NOW))
    const row = queue.rows.find((r) => r.id === mine.id)
    expect(row).toBeDefined()
    expect(row?.isSuperseded).toBe(false)
  }, 300_000)

  // A ROW ATTACHED TO NOTHING IS ONLY A POLICY IF ITS TYPE SAYS SO. An
  // unattached CDL is malformed and stays dropped, exactly as before.
  it('still drops an unattached record that is not a fleet obligation', async () => {
    const expiresAt = new Date(NOW.getTime())
    expiresAt.setUTCDate(expiresAt.getUTCDate() - 5)
    const orphan = await owner.complianceItem.create({
      data: { organizationId, companyId, type: 'CDL', expiresAt },
    })
    const queue = await inOrg((tx) => complianceQueue(tx, {}, {}, NOW))
    expect(queue.rows.map((r) => r.id)).not.toContain(orphan.id)
  }, 300_000)
})
