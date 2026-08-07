import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { retryingClient } from '../retrying-client'
import { withOrg } from '@/lib/tenancy'
import {
  addClaimNote,
  addClaimParty,
  claimById,
  claimList,
  moveClaim,
  openClaim,
  removeClaimParty,
} from '@/lib/claims'
import {
  challengesForInspection,
  moveChallenge,
  openChallenge,
} from '@/lib/dataqs'
import { addViolation, recordInspection } from '@/lib/inspections'
import type { PrismaClient } from '@/generated/prisma/client'

// ---------------------------------------------------------------------------
// Claims and DataQs against real Postgres.
//
// The ladders are covered in tests/claims.test.ts. What can only be asserted
// here:
//
//   * §4's acceptance box, end to end — a challenge TRACES
//     inspection → violation → challenge → outcome;
//   * the trigger that refuses a challenge pointing at a violation from a
//     DIFFERENT inspection, which is the one way that trace can silently lead
//     somewhere else;
//   * the CHECK that keeps status and outcome in step, asserted by going around
//     the service;
//   * the set_org trigger deriving a party's and a note's organizationId from
//     their claim;
//   * the timeline carrying notes and status moves in one list, with the
//     opening row present — a history whose first chapter is silent is not a
//     history.
// ---------------------------------------------------------------------------

let owner: PrismaClient
let organizationId = ''
let companyId = ''
let otherCompanyId = ''
let userId = ''
let loadId = ''
let otherLoadId = ''
let inspectionId = ''
let violationId = ''
let otherInspectionId = ''
let otherViolationId = ''
const nonce = Math.random().toString(36).slice(2, 8)

const inOrg = <T>(fn: Parameters<typeof withOrg<T>>[1]): Promise<T> =>
  withOrg(organizationId, fn, {
    attribution: { userId, ip: null, userAgent: 'claims.test' },
    maxWaitMs: 20_000,
  })

const DAY = (iso: string) => new Date(`${iso}T00:00:00Z`)

beforeAll(async () => {
  owner = retryingClient(process.env.DIRECT_DATABASE_URL!)

  const organization = await owner.organization.create({
    data: {
      name: `Claims ${nonce}`,
      slug: `claims-${nonce}`,
      maxCompanies: 5,
      companies: {
        create: [{ name: `Alpha ${nonce}` }, { name: `Beta ${nonce}` }],
      },
    },
    include: { companies: true },
  })
  organizationId = organization.id
  companyId = organization.companies[0]!.id
  otherCompanyId = organization.companies[1]!.id

  const user = await owner.user.create({
    data: { email: `claims-${nonce}@example.test`, name: 'Safety Tester' },
  })
  userId = user.id
  await owner.membership.create({
    data: { userId, organizationId, role: 'OWNER' },
  })

  const customer = await owner.customer.create({
    data: { organizationId, name: `Broker ${nonce}` },
  })

  loadId = (
    await owner.load.create({
      data: {
        organizationId,
        companyId,
        customerId: customer.id,
        loadNumber: `L-${nonce}-1`,
      },
    })
  ).id
  // Same tenant, the OTHER authority — for the cross-authority refusal.
  otherLoadId = (
    await owner.load.create({
      data: {
        organizationId,
        companyId: otherCompanyId,
        customerId: customer.id,
        loadNumber: `L-${nonce}-2`,
      },
    })
  ).id

  const truck = await owner.truck.create({
    data: { organizationId, companyId, unitNumber: `104-${nonce}` },
  })

  const first = await inOrg((tx) =>
    recordInspection(tx, {
      truckId: truck.id,
      inspectedAt: DAY('2026-08-03'),
      level: 'LEVEL_1',
      state: 'IN',
      reportNumber: `IN26${nonce}`,
    }),
  )
  inspectionId = first.ok ? first.inspectionId : ''
  const violation = await inOrg((tx) =>
    addViolation(tx, {
      inspectionId,
      code: '393.75A3',
      unit: 'VEHICLE',
      outOfService: true,
      severityWeight: 8,
    }),
  )
  violationId = violation.ok ? violation.violationId : ''

  const second = await inOrg((tx) =>
    recordInspection(tx, {
      truckId: truck.id,
      inspectedAt: DAY('2026-07-01'),
      level: 'LEVEL_2',
      state: 'OH',
    }),
  )
  otherInspectionId = second.ok ? second.inspectionId : ''
  const otherViolation = await inOrg((tx) =>
    addViolation(tx, {
      inspectionId: otherInspectionId,
      code: '392.2C',
      unit: 'DRIVER',
      outOfService: false,
    }),
  )
  otherViolationId = otherViolation.ok ? otherViolation.violationId : ''
}, 300_000)

afterAll(async () => {
  await owner.organization
    .delete({ where: { id: organizationId } })
    .catch(() => {})
  await owner.user.delete({ where: { id: userId } }).catch(() => {})
  await owner.$disconnect()
})

describe('opening a claim', () => {
  let claimId = ''

  it('records it against the authority that hauled the load', async () => {
    const outcome = await inOrg((tx) =>
      openClaim(tx, {
        companyId,
        type: 'CARGO_DAMAGE',
        loadId,
        claimantName: `Broker ${nonce}`,
        claimNumber: `THEIRS-${nonce}`,
        incidentAt: DAY('2026-08-01'),
        amountClaimedCents: 412_500,
        description: 'Two pallets crushed on the trailer floor.',
        userId,
      }),
    )
    expect(outcome.ok).toBe(true)
    claimId = outcome.ok ? outcome.claimId : ''

    const stored = await owner.claim.findUniqueOrThrow({
      where: { id: claimId },
      select: {
        organizationId: true,
        companyId: true,
        status: true,
        loadId: true,
        amountClaimedCents: true,
      },
    })
    expect(stored).toMatchObject({
      organizationId,
      companyId,
      status: 'OPEN',
      loadId,
      amountClaimedCents: 412_500,
    })
  }, 300_000)

  it('opens the timeline with a row, so the history has a first chapter', async () => {
    // Without this, a claim's history would begin at its first status CHANGE
    // and the opening would be silent.
    const claim = await inOrg((tx) => claimById(tx, claimId))
    expect(claim?.timeline).toHaveLength(1)
    expect(claim?.timeline[0]).toMatchObject({
      fromStatus: null,
      toStatus: 'OPEN',
    })
    expect(claim?.timeline[0]?.authorName).toBe('Safety Tester')
  }, 300_000)

  it('refuses a load belonging to the other authority', async () => {
    // A cargo claim filed against RAM's load under Dolphins' authority puts
    // the loss on the wrong carrier's record.
    const outcome = await inOrg((tx) =>
      openClaim(tx, {
        companyId,
        type: 'CARGO_DAMAGE',
        loadId: otherLoadId,
        description: 'Wrong authority.',
      }),
    )
    expect(outcome).toEqual({ ok: false, reason: 'load_not_found' })
  }, 300_000)

  it('refuses a claim with nothing written on it', async () => {
    const outcome = await inOrg((tx) =>
      openClaim(tx, { companyId, type: 'ACCIDENT', description: '   ' }),
    )
    expect(outcome).toEqual({ ok: false, reason: 'no_description' })
  }, 300_000)

  it('opens one with no load at all', async () => {
    // §3 step 5 says the load link is optional, and an accident on a bobtail
    // has none.
    const outcome = await inOrg((tx) =>
      openClaim(tx, {
        companyId,
        type: 'ACCIDENT',
        description: 'Backed into a dock plate, empty.',
      }),
    )
    expect(outcome.ok).toBe(true)
  }, 300_000)
})

describe('the ladder, against the database', () => {
  let claimId = ''

  beforeAll(async () => {
    const outcome = await inOrg((tx) =>
      openClaim(tx, {
        companyId,
        type: 'CARGO_SHORTAGE',
        description: 'Six cases short at delivery.',
        amountClaimedCents: 90_000,
        userId,
      }),
    )
    claimId = outcome.ok ? outcome.claimId : ''
  }, 300_000)

  it('writes one timeline row per move and none for a repeat', async () => {
    expect(
      await inOrg((tx) =>
        moveClaim(tx, { claimId, to: 'UNDER_REVIEW', userId }),
      ),
    ).toMatchObject({ result: 'moved', from: 'OPEN', to: 'UNDER_REVIEW' })

    // Idempotent: a double-clicked button must not write the same row twice
    // onto a timeline somebody reads as a story.
    expect(
      await inOrg((tx) =>
        moveClaim(tx, { claimId, to: 'UNDER_REVIEW', userId }),
      ),
    ).toMatchObject({ result: 'unchanged', at: 'UNDER_REVIEW' })

    const claim = await inOrg((tx) => claimById(tx, claimId))
    // The opening row plus exactly one move.
    expect(claim?.timeline).toHaveLength(2)
    expect(claim?.timeline[0]).toMatchObject({
      fromStatus: 'OPEN',
      toStatus: 'UNDER_REVIEW',
    })
  }, 300_000)

  it('refuses a move the ladder does not allow, and writes nothing', async () => {
    const before = await inOrg((tx) => claimById(tx, claimId))

    await inOrg((tx) => moveClaim(tx, { claimId, to: 'CLOSED', userId }))
    // CLOSED is terminal, so anything after it must be refused.
    const refused = await inOrg((tx) =>
      moveClaim(tx, { claimId, to: 'DISPUTED', userId }),
    )
    expect(refused).toMatchObject({ result: 'refused', at: 'CLOSED' })

    const after = await inOrg((tx) => claimById(tx, claimId))
    expect(after?.status).toBe('CLOSED')
    // One row for the close, and nothing for the refusal.
    expect(after?.timeline.length).toBe((before?.timeline.length ?? 0) + 1)
  }, 300_000)

  it('records the amount paid on the move that settles it', async () => {
    const outcome = await inOrg((tx) =>
      openClaim(tx, {
        companyId,
        type: 'CARGO_DAMAGE',
        description: 'Settled at half.',
        amountClaimedCents: 100_000,
        userId,
      }),
    )
    const settled = outcome.ok ? outcome.claimId : ''

    await inOrg((tx) =>
      moveClaim(tx, {
        claimId: settled,
        to: 'RESOLVED',
        amountPaidCents: 50_000,
        resolution: 'Split the difference.',
        note: 'Agreed on the phone.',
        userId,
      }),
    )

    const claim = await inOrg((tx) => claimById(tx, settled))
    expect(claim?.amountPaidCents).toBe(50_000)
    expect(claim?.resolution).toBe('Split the difference.')
    expect(claim?.timeline[0]?.body).toBe('Agreed on the phone.')
  }, 300_000)
})

describe('parties and notes', () => {
  let claimId = ''

  beforeAll(async () => {
    const outcome = await inOrg((tx) =>
      openClaim(tx, {
        companyId,
        type: 'ACCIDENT',
        description: 'Rear-ended at a light.',
        userId,
      }),
    )
    claimId = outcome.ok ? outcome.claimId : ''
  }, 300_000)

  it('derive their organizationId from the claim, not from the caller', async () => {
    const party = await inOrg((tx) =>
      addClaimParty(tx, {
        claimId,
        role: 'ADJUSTER',
        name: `Adjuster ${nonce}`,
        reference: `ADJ-${nonce}`,
      }),
    )
    expect(party.ok).toBe(true)

    // The service passes an empty string; the trigger overwrites it. If the
    // trigger were dropped, this row would carry '' and the policy would hide
    // it from everyone — safe, and still a bug.
    const stored = await owner.claimParty.findUniqueOrThrow({
      where: { id: party.ok ? party.partyId : '' },
      select: { organizationId: true, reference: true },
    })
    expect(stored).toMatchObject({
      organizationId,
      reference: `ADJ-${nonce}`,
    })

    const notes = await owner.claimNote.findMany({
      where: { claimId },
      select: { organizationId: true },
    })
    expect(notes.every((n) => n.organizationId === organizationId)).toBe(true)
  }, 300_000)

  it('put a note and a status change on ONE timeline', async () => {
    await inOrg((tx) =>
      addClaimNote(tx, claimId, 'Police report requested.', userId),
    )
    await inOrg((tx) =>
      moveClaim(tx, {
        claimId,
        to: 'DISPUTED',
        note: 'They deny fault.',
        userId,
      }),
    )

    const claim = await inOrg((tx) => claimById(tx, claimId))
    // Opening, the note, the move — newest first, in one list.
    expect(claim?.timeline).toHaveLength(3)
    expect(claim?.timeline[0]).toMatchObject({
      fromStatus: 'OPEN',
      toStatus: 'DISPUTED',
      body: 'They deny fault.',
    })
    expect(claim?.timeline[1]).toMatchObject({
      fromStatus: null,
      toStatus: null,
      body: 'Police report requested.',
    })
  }, 300_000)

  it('removes a party added in error without touching the timeline', async () => {
    const party = await inOrg((tx) =>
      addClaimParty(tx, { claimId, role: 'WITNESS', name: 'Typo' }),
    )
    const before = await inOrg((tx) => claimById(tx, claimId))

    expect(
      await inOrg((tx) => removeClaimParty(tx, party.ok ? party.partyId : '')),
    ).toBe(true)

    const after = await inOrg((tx) => claimById(tx, claimId))
    expect(after?.parties.map((p) => p.name)).not.toContain('Typo')
    expect(after?.timeline.length).toBe(before?.timeline.length)
  }, 300_000)

  it('refuses an empty note rather than writing a blank row', async () => {
    expect(await inOrg((tx) => addClaimNote(tx, claimId, '   ', userId))).toBe(
      false,
    )
  }, 300_000)
})

describe('§4: a DataQs challenge traces', () => {
  it('inspection → violation → challenge → outcome', async () => {
    const opened = await inOrg((tx) =>
      openChallenge(tx, {
        inspectionId,
        violationId,
        basis: 'The tire was on the trailer we dropped, not ours.',
        referenceNumber: `RDR-${nonce}`,
      }),
    )
    expect(opened.ok).toBe(true)
    const challengeId = opened.ok ? opened.challengeId : ''

    // Filed, then answered.
    expect(
      await inOrg((tx) => moveChallenge(tx, { challengeId, to: 'SUBMITTED' })),
    ).toMatchObject({ result: 'moved', to: 'SUBMITTED' })
    expect(
      await inOrg((tx) =>
        moveChallenge(tx, {
          challengeId,
          to: 'CLOSED',
          outcome: 'ACCEPTED',
          outcomeNote: 'Violation removed from the record.',
        }),
      ),
    ).toMatchObject({ result: 'moved', to: 'CLOSED' })

    // THE WHOLE TRACE, read back in one query from the inspection end.
    const rows = await inOrg((tx) => challengesForInspection(tx, inspectionId))
    const challenge = rows.find((row) => row.id === challengeId)
    expect(challenge).toMatchObject({
      inspectionId,
      status: 'CLOSED',
      outcome: 'ACCEPTED',
    })
    expect(challenge?.violation?.code).toBe('393.75A3')
    expect(challenge?.violation?.outOfService).toBe(true)
    expect(challenge?.submittedAt).not.toBeNull()
    expect(challenge?.decidedAt).not.toBeNull()
  }, 300_000)

  it('refuses a violation from a different inspection', async () => {
    // The one way the trace could silently lead somewhere else.
    const outcome = await inOrg((tx) =>
      openChallenge(tx, {
        inspectionId,
        violationId: otherViolationId,
        basis: 'Wrong parent.',
      }),
    )
    expect(outcome).toEqual({
      ok: false,
      reason: 'violation_not_on_inspection',
    })
  }, 300_000)

  it('and the database refuses it too, if the service ever stops', async () => {
    // The trigger under the sentence above, asserted by going around the
    // service — this is the write a future caller that forgets would make.
    await expect(
      owner.dataQsChallenge.create({
        data: {
          organizationId,
          companyId,
          inspectionId,
          violationId: otherViolationId,
          basis: 'Straight to the table.',
        },
      }),
    ).rejects.toThrow(/belongs to inspection/)
  }, 300_000)

  it('challenges the inspection itself when no violation is named', async () => {
    // Wrong carrier, wrong unit, duplicate filing — a real and common
    // challenge with no particular code at issue.
    const outcome = await inOrg((tx) =>
      openChallenge(tx, {
        inspectionId: otherInspectionId,
        basis: 'This inspection is filed against the wrong DOT number.',
      }),
    )
    expect(outcome.ok).toBe(true)

    const rows = await inOrg((tx) =>
      challengesForInspection(tx, otherInspectionId),
    )
    expect(rows[0]?.violation).toBeNull()
  }, 300_000)

  it('refuses to close without an outcome', async () => {
    // Otherwise "closed" would not say whether the violation came off the
    // record, which is the only thing anybody files a DataQs to find out.
    const opened = await inOrg((tx) =>
      openChallenge(tx, { inspectionId, basis: 'Needs an answer.' }),
    )
    const challengeId = opened.ok ? opened.challengeId : ''

    expect(
      await inOrg((tx) => moveChallenge(tx, { challengeId, to: 'CLOSED' })),
    ).toEqual({ result: 'needs_outcome' })

    // And nothing moved.
    const rows = await inOrg((tx) => challengesForInspection(tx, inspectionId))
    expect(rows.find((row) => row.id === challengeId)?.status).toBe('DRAFT')
  }, 300_000)

  it('and the CHECK refuses an outcome on an open one', async () => {
    const opened = await inOrg((tx) =>
      openChallenge(tx, { inspectionId, basis: 'Straight to the table.' }),
    )
    await expect(
      owner.dataQsChallenge.update({
        where: { id: opened.ok ? opened.challengeId : '' },
        data: { outcome: 'REJECTED' },
      }),
    ).rejects.toThrow(/dataqs_outcome_matches_status/)
  }, 300_000)

  it('leaves submittedAt null on a challenge withdrawn before filing', async () => {
    // DRAFT → CLOSED is a real move: written up, thought better of. A stamped
    // submittedAt would claim a filing that never happened.
    const opened = await inOrg((tx) =>
      openChallenge(tx, { inspectionId, basis: 'Thought better of it.' }),
    )
    const challengeId = opened.ok ? opened.challengeId : ''

    await inOrg((tx) =>
      moveChallenge(tx, {
        challengeId,
        to: 'CLOSED',
        outcome: 'WITHDRAWN',
      }),
    )

    const rows = await inOrg((tx) => challengesForInspection(tx, inspectionId))
    const row = rows.find((r) => r.id === challengeId)
    expect(row?.submittedAt).toBeNull()
    expect(row?.decidedAt).not.toBeNull()
    expect(row?.outcome).toBe('WITHDRAWN')
  }, 300_000)
})

describe('the claim list', () => {
  it('honours the authority scope', async () => {
    const beta = await inOrg((tx) =>
      claimList(tx, { companyId: { in: [otherCompanyId] } }),
    )
    expect(beta).toEqual([])
  }, 300_000)

  it('has a working set that excludes closed claims', async () => {
    const all = await inOrg((tx) => claimList(tx, {}))
    const working = await inOrg((tx) => claimList(tx, {}, { openOnly: true }))

    expect(all.length).toBeGreaterThan(working.length)
    expect(working.every((row) => row.status !== 'CLOSED')).toBe(true)
  }, 300_000)
})
