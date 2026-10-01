import { readFileSync } from 'node:fs'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { retryingClient } from '../retrying-client'
import { withOrg } from '@/lib/tenancy'
import { LOAD_WRITE_TIMEOUT_MS } from '@/lib/loads'
import {
  drawQuarter,
  poolFor,
  resolveSelection,
  verifyDraw,
  yearSummary,
  type AnnualRate,
} from '@/lib/random-testing'
import type { PrismaClient } from '@/generated/prisma/client'

// ---------------------------------------------------------------------------
// THE PROGRAMME AGAINST REAL ROWS.
//
// `tests/random-testing.test.ts` grades §382.305's rules against hand-built
// values. This grades what only a database can answer: that the pool is built
// from the roster as it actually stands, that a recorded draw recomputes from
// what was stored, and that the CHECKs refuse what the service layer refuses.
// ---------------------------------------------------------------------------

let owner: PrismaClient
let organizationId = ''
let companyId = ''
let userId = ''
let terminatedId = ''

const nonce = Math.random().toString(36).slice(2, 8)

const inOrg = <T>(fn: Parameters<typeof withOrg<T>>[1]): Promise<T> =>
  withOrg(organizationId, fn, {
    attribution: { userId, ip: null, userAgent: 'random-testing.test' },
    timeoutMs: LOAD_WRITE_TIMEOUT_MS,
  })

/** A driver with a CDL on file, which is what puts them in the pool. */
async function makeDriver(last: string, status = 'AVAILABLE') {
  const driver = await owner.driver.create({
    data: {
      organizationId,
      companyId,
      firstName: 'A',
      lastName: last,
      status: status as 'AVAILABLE',
    },
  })
  await owner.complianceItem.create({
    data: {
      organizationId,
      companyId,
      driverId: driver.id,
      type: 'CDL',
      expiresAt: new Date('2029-01-01'),
    },
  })
  return driver.id
}

beforeAll(async () => {
  owner = retryingClient(process.env.DIRECT_DATABASE_URL!)

  organizationId = (
    await owner.organization.create({
      data: { name: `Rt ${nonce}`, slug: `rt-${nonce}` },
    })
  ).id
  companyId = (
    await owner.company.create({
      data: {
        organizationId,
        name: `RAM ${nonce}`,
        addressLine1: '5062 Free Pike',
        city: 'Dayton',
        state: 'OH',
        postalCode: '45426',
      },
    })
  ).id
  userId = (
    await owner.user.create({
      data: { email: `rt-${nonce}@example.test`, name: 'Rt' },
    })
  ).id
  await owner.membership.create({
    data: { userId, organizationId, role: 'OWNER' },
  })

  for (const last of ['ALPHA', 'BRAVO', 'CHARLIE', 'DELTA', 'ECHO']) {
    await makeDriver(last)
  }
  terminatedId = await makeDriver('GONE', 'INACTIVE')
  // Somebody with no CDL on file at all: employed, and not a driver §382
  // covers.
  await owner.driver.create({
    data: { organizationId, companyId, firstName: 'NO', lastName: 'CDL' },
  })

  await owner.randomTestingRate.create({
    data: {
      organizationId,
      year: 2026,
      drugRateBps: 5000,
      alcoholRateBps: 1000,
      citation: 'Fixture — not a real notice',
    },
  })
})

afterAll(async () => {
  await owner?.$disconnect().catch(() => undefined)
})

// ── THE GUARD NAMED "a terminated driver drawn" ────────────────────────
describe('the derived pool', () => {
  it('is the active CDL drivers and nobody else', async () => {
    const pool = await inOrg((tx) => poolFor(tx, companyId, 2026, 'DERIVED'))
    expect(pool).toHaveLength(5)
    expect(pool.map((member) => member.driverId)).not.toContain(terminatedId)
    expect(pool.map((member) => member.name)).not.toContain('CDL, NO')
  })
})

describe('a quarter is drawn and recorded', () => {
  it('records the seed, the method and the pool as it stood', async () => {
    const draw = await inOrg((tx) =>
      drawQuarter(
        tx,
        organizationId,
        {
          companyId,
          year: 2026,
          quarter: 1,
          source: 'DERIVED',
          seed: `seed-${nonce}`,
        },
        { byUserId: userId },
      ),
    )

    expect(draw.seed).toBe(`seed-${nonce}`)
    expect(draw.algorithm).toBe('sha256-rank-v1')
    expect(draw.poolSize).toBe(5)
    expect(Array.isArray(draw.poolSnapshot)).toBe(true)

    // Five drivers at 50% is three for the year (ceil 2.5), one in Q1 (ceil
    // 3/4). Alcohol at 10% is one for the year, one in Q1.
    const drug = draw.selections.filter((s) => s.kind === 'DRUG')
    const alcohol = draw.selections.filter((s) => s.kind === 'ALCOHOL')
    expect(drug).toHaveLength(1)
    expect(alcohol).toHaveLength(1)
  })

  // ── THE GUARD NAMED "selection outside the pool" ─────────────────────
  it('selects only people who were in the snapshot', async () => {
    const draw = await owner.randomDraw.findFirstOrThrow({
      where: { companyId, year: 2026, quarter: 1 },
      include: { selections: true },
    })
    const keys = (draw.poolSnapshot as { key: string }[]).map((m) => m.key)
    for (const selection of draw.selections) {
      expect(keys).toContain(selection.memberKey)
    }
  })

  it('RECOMPUTES from what was recorded, which is the audit', async () => {
    // The auditor's question is "show me you did not choose these people".
    // This is the answer: re-run the recorded seed over the recorded
    // snapshot, reading nothing live.
    const draw = await owner.randomDraw.findFirstOrThrow({
      where: { companyId, year: 2026, quarter: 1 },
      include: { selections: true },
    })
    const verdict = await verifyDraw(draw)
    expect(verdict).toEqual({ ok: true, reason: null })
  })

  it('stops recomputing if the recorded selections are edited', async () => {
    // The verification has to be able to FAIL, or it proves nothing.
    const draw = await owner.randomDraw.findFirstOrThrow({
      where: { companyId, year: 2026, quarter: 1 },
      include: { selections: true },
    })
    const tampered = {
      ...draw,
      selections: draw.selections.map((selection) => ({
        ...selection,
        memberKey: 'somebody-else',
      })),
    }
    const verdict = await verifyDraw(tampered)
    expect(verdict.ok).toBe(false)
  })

  it('refuses a second draw for the same quarter', async () => {
    // Two sets of names for one quarter is a rate that can be read two ways.
    await expect(
      inOrg((tx) =>
        drawQuarter(
          tx,
          organizationId,
          {
            companyId,
            year: 2026,
            quarter: 1,
            source: 'DERIVED',
            seed: 'another',
          },
          { byUserId: userId },
        ),
      ),
    ).rejects.toThrow()
  })

  // ── THE GUARD NAMED "a rate hardcoded" ───────────────────────────────
  it('refuses a year with no recorded rate', async () => {
    await expect(
      inOrg((tx) =>
        drawQuarter(
          tx,
          organizationId,
          {
            companyId,
            year: 2027,
            quarter: 1,
            source: 'DERIVED',
            seed: 'x',
          },
          { byUserId: userId },
        ),
      ),
    ).rejects.toMatchObject({ code: 'rate_not_recorded' })
  })
})

// ── THE GUARD NAMED "a draw not recorded" ──────────────────────────────
describe('the database refuses an unrecordable draw', () => {
  it('will not take a draw with an empty seed', async () => {
    await expect(
      owner.randomDraw.create({
        data: {
          organizationId,
          companyId,
          year: 2026,
          quarter: 3,
          source: 'DERIVED',
          seed: '',
          algorithm: 'sha256-rank-v1',
          poolSnapshot: [],
          poolSize: 0,
        },
      }),
    ).rejects.toThrow(/RandomDraw_is_recomputable|violates check/i)
  })

  it('will not take a snapshot that disagrees with the pool size', async () => {
    await expect(
      owner.randomDraw.create({
        data: {
          organizationId,
          companyId,
          year: 2026,
          quarter: 3,
          source: 'DERIVED',
          seed: 'seed',
          algorithm: 'sha256-rank-v1',
          poolSnapshot: [{ key: 'a' }],
          poolSize: 9,
        },
      }),
    ).rejects.toThrow(/RandomDraw_is_recomputable|violates check/i)
  })
})

describe('resolving a selection', () => {
  it('records the test ON THE SELECTION and writes no compliance item', async () => {
    // Owner's ruling, 2026-09-22: a random test outcome is an event on the
    // selection, drug and alcohol alike. The selection already carries when
    // it happened and whether it did; a second row in another table would
    // be a copy free to disagree with the draw it came from.
    const selection = await owner.randomSelection.findFirstOrThrow({
      where: { draw: { companyId, year: 2026 }, kind: 'DRUG' },
      select: { id: true, driverId: true },
    })

    const before = await owner.complianceItem.count({
      where: { driverId: selection.driverId, type: 'DRUG_TEST' },
    })

    const resolved = await inOrg((tx) =>
      resolveSelection(tx, selection.id, {
        outcome: 'TESTED',
        testedAt: '2026-03-02',
      }),
    )
    expect(resolved.outcome).toBe('TESTED')
    expect(resolved.testedAt).toEqual(new Date('2026-03-02'))
    // THE COLUMN IS GONE — dropped in migration 61, 2026-10-01, because it
    // was null on every row in every environment and nothing read it. The
    // assertion that it was null went with it, and this comment already
    // said that assertion was the weaker half:
    //
    // NOTHING APPEARED IN ComplianceItem. Counting before and after is the
    // check; asserting a null column alone would have passed if the row had
    // been written and simply not linked.
    const after = await owner.complianceItem.count({
      where: { driverId: selection.driverId, type: 'DRUG_TEST' },
    })
    expect(after).toBe(before)
  })

  it('leaves DRUG_TEST meaning the pre-employment credential', async () => {
    // §382.301. It keeps a real expiry and warns like any other compliance
    // record — which is only true because nothing writes a dateless one.
    const item = await owner.complianceItem.create({
      data: {
        organizationId,
        companyId,
        type: 'DRUG_TEST',
        expiresAt: new Date('2027-06-01'),
      },
      select: { expiresAt: true },
    })
    expect(item.expiresAt).toEqual(new Date('2027-06-01'))

    const warnings = readFileSync('src/lib/warnings.ts', 'utf8')
    expect(warnings).not.toContain('EVENT_TYPES')
  })

  it('refuses NOT_TESTED with no reason, in the database too', async () => {
    const selection = await owner.randomSelection.findFirstOrThrow({
      where: { draw: { companyId, year: 2026 }, kind: 'ALCOHOL' },
      select: { id: true },
    })
    await expect(
      inOrg((tx) =>
        resolveSelection(tx, selection.id, { outcome: 'NOT_TESTED' }),
      ),
    ).rejects.toMatchObject({ code: 'required', field: 'reason' })

    await expect(
      owner.randomSelection.update({
        where: { id: selection.id },
        data: { outcome: 'NOT_TESTED' },
      }),
    ).rejects.toThrow(/not_tested_needs_reason|violates check/i)
  })

  it('takes NOT_TESTED with a reason', async () => {
    const selection = await owner.randomSelection.findFirstOrThrow({
      where: { draw: { companyId, year: 2026 }, kind: 'ALCOHOL' },
      select: { id: true },
    })
    const resolved = await inOrg((tx) =>
      resolveSelection(tx, selection.id, {
        outcome: 'NOT_TESTED',
        reason: 'On leave, 382.305(j)(3)',
      }),
    )
    expect(resolved.outcome).toBe('NOT_TESTED')
    expect(resolved.reason).toContain('On leave')
  })
})

describe('the year-end summary', () => {
  it('counts tests conducted against the recorded rate', async () => {
    const rate = await owner.randomTestingRate.findFirstOrThrow({
      where: { organizationId, year: 2026 },
      select: {
        year: true,
        drugRateBps: true,
        alcoholRateBps: true,
        citation: true,
      },
    })
    const selections = await owner.randomSelection.findMany({
      where: { draw: { companyId, year: 2026 } },
      select: { kind: true, outcome: true },
    })

    const summary = yearSummary(
      rate as AnnualRate,
      5,
      selections as { kind: 'DRUG' | 'ALCOHOL'; outcome: 'TESTED' }[],
    )
    // Three drug tests required for the year over five drivers at 50%; one
    // has been conducted, so the rate is not met and the screen says so.
    expect(summary.kinds.DRUG.required).toBe(3)
    expect(summary.kinds.DRUG.tested).toBe(1)
    expect(summary.kinds.DRUG.met).toBe(false)
    // The alcohol selection was excused, so nothing was conducted.
    expect(summary.kinds.ALCOHOL.tested).toBe(0)
    expect(summary.citation).toBe('Fixture — not a real notice')
  })
})
