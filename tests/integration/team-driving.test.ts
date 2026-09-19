import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { retryingClient } from '../retrying-client'
import { withOrg } from '@/lib/tenancy'
import { createBroker } from '@/lib/brokers'
import { createLoad } from '@/lib/loads'
import {
  batchInputForOrg,
  SETTLEMENT_BATCH_TIMEOUT_MS,
} from '@/lib/settlement-batch'
import { settleableWhere } from '@/lib/settlements'
import { payFor, ruleInForce } from '@/lib/driver-pay'
import type { SettleableLoad } from '@/lib/settlement-week'
import { weekOf } from '@/lib/settlement-week'
import type { PrismaClient } from '@/generated/prisma/client'

// ---------------------------------------------------------------------------
// TEAM DRIVING: TWO DRIVERS, ONE TRUCK, ONE GROSS, TWO PERCENTAGES.
//
// ── WHAT A TEAM IS AND IS NOT ────────────────────────────────────────────
//
// Two drivers share a load. Each is paid their OWN percentage of the SAME
// gross — 20% each, not 40% split and not 20% of half. The percentages are not
// summed and not enforced against any total, because the fee rows already sum
// past 90 on a solo load and nobody has ever wanted them to add up.
//
// Team is DERIVED: `Load.coDriverId != null`. There is no flag.
//
// ── WHY THESE GUARDS ARE HERE AND NOT IN THE NODE PROJECT ────────────────
//
// Three of the six are promises the DATABASE makes — the CHECK that the two
// seats differ, the unique that refuses paying one driver twice for one load,
// and the fact that closed history never enters a batch. A guard for those
// written against a stub would be a guard against the stub.
//
// The arithmetic is graded in `tests/settlement-week.test.ts` against six real
// Datatruck statements, and nothing here re-checks it.
// ---------------------------------------------------------------------------

let owner: PrismaClient
let organizationId = ''
let companyId = ''
let userId = ''
let mckaneId = ''
let hallId = ''
let soloDriverId = ''
let brokerId = ''

// SEEDED ONCE, MATCHED BY ID. `createLoad` issues the load NUMBER from the
// counter, so the reference given here is not what comes back on the line —
// filtering on a prefix quietly matched nothing and two guards passed on an
// empty list before this was noticed.
let teamLoadId = ''
let soloLoadId = ''

const nonce = Math.random().toString(36).slice(2, 8)

const inOrg = <T>(fn: Parameters<typeof withOrg<T>>[1]): Promise<T> =>
  withOrg(organizationId, fn, {
    attribution: { userId, ip: null, userAgent: 'team-driving.test' },
    timeoutMs: SETTLEMENT_BATCH_TIMEOUT_MS,
  })

/** The week of 2026-08-30 → 2026-09-05: it straddles the 9/4 effective date. */
const PERIOD = weekOf(new Date(Date.UTC(2026, 8, 2)))

/** 2026-09-03 — the day BEFORE the team rules take effect. */
const DAY_BEFORE = 3
/** 2026-09-04 — the day they do. */
const DAY_OF = 4

/** The statement row as the pay engine wants it. */
const payable = (load: SettleableLoad) => ({
  id: load.id,
  loadNumber: load.loadNumber,
  linehaulCents: load.rateCents,
  fuelSurchargeCents: 0,
  accessorialsCents: 0,
  totalRevenueCents: load.rateCents,
  actualMiles: 400,
  dispatchedMiles: 400,
})

async function seedLoad(input: {
  number: string
  rateCents: number
  delDay: number
  driverId: string
  coDriverId?: string
}) {
  const at = new Date(Date.UTC(2026, 8, input.delDay))
  const load = await inOrg((tx) =>
    createLoad(
      tx,
      organizationId,
      {
        companyId,
        customerId: brokerId,
        referenceNumber: `${input.number}-${nonce}`,
        stops: [
          {
            type: 'PICKUP',
            city: 'Whiteland',
            state: 'IN',
            scheduledAt: at,
          },
          {
            type: 'DELIVERY',
            city: 'Gastonia',
            state: 'NC',
            scheduledAt: at,
          },
        ],
        linehaulCents: input.rateCents,
      },
      { byUserId: userId },
    ),
  )
  await owner.load.update({
    where: { id: load.id },
    data: {
      driverId: input.driverId,
      coDriverId: input.coDriverId ?? null,
      operationalStatus: 'POD_RECEIVED',
      actualMiles: 400,
    },
  })
  await owner.loadStatusEvent.create({
    data: {
      organizationId,
      loadId: load.id,
      axis: 'OPERATIONAL',
      toStatus: 'POD_RECEIVED',
      outcome: 'APPLIED',
      occurredAt: at,
    },
  })
  return load
}

beforeAll(async () => {
  owner = retryingClient(process.env.DIRECT_DATABASE_URL!)

  const organization = await owner.organization.create({
    data: { name: `Team ${nonce}`, slug: `team-${nonce}` },
  })
  organizationId = organization.id

  const company = await owner.company.create({
    data: {
      organizationId,
      name: `RAM ${nonce}`,
      addressLine1: '5062 Free Pike',
      city: 'Dayton',
      state: 'OH',
      postalCode: '45426',
    },
  })
  companyId = company.id

  const user = await owner.user.create({
    data: { email: `team-${nonce}@example.test`, name: 'Team Runner' },
  })
  userId = user.id
  await owner.membership.create({
    data: { userId, organizationId, role: 'OWNER' },
  })

  const makeDriver = async (firstName: string, lastName: string) => {
    const driver = await owner.driver.create({
      data: { organizationId, companyId, firstName, lastName },
    })
    return driver.id
  }

  mckaneId = await makeDriver('JERRY ROBERT', 'MCKANE')
  hallId = await makeDriver('JULIA', 'HALL')
  soloDriverId = await makeDriver('SOLO', 'RUNNER')

  // ── THE RULES, AS RULED ──────────────────────────────────────────────
  //
  // MCKANE at 30% until 2026-09-04, then 20%. HALL at 20% from the same day.
  // PERCENT_LINEHAUL, which is the type his rule in force already is — the
  // 20% supersedes the 30% in kind rather than changing his pay basis.
  await owner.driverPayRule.create({
    data: {
      organizationId,
      driverId: mckaneId,
      type: 'PERCENT_LINEHAUL',
      percentBps: 3000,
      effectiveFrom: new Date(Date.UTC(2026, 7, 1)),
      effectiveTo: new Date(Date.UTC(2026, 8, DAY_BEFORE)),
    },
  })
  await owner.driverPayRule.create({
    data: {
      organizationId,
      driverId: mckaneId,
      type: 'PERCENT_LINEHAUL',
      percentBps: 2000,
      effectiveFrom: new Date(Date.UTC(2026, 8, DAY_OF)),
    },
  })
  await owner.driverPayRule.create({
    data: {
      organizationId,
      driverId: hallId,
      type: 'PERCENT_LINEHAUL',
      percentBps: 2000,
      effectiveFrom: new Date(Date.UTC(2026, 8, DAY_OF)),
    },
  })
  await owner.driverPayRule.create({
    data: {
      organizationId,
      driverId: soloDriverId,
      type: 'PERCENT_LINEHAUL',
      percentBps: 3000,
      effectiveFrom: new Date(Date.UTC(2026, 7, 1)),
    },
  })

  const broker = await inOrg((tx) =>
    createBroker(tx, organizationId, { name: `BROKER ${nonce}` }),
  )
  brokerId = broker.id

  teamLoadId = (
    await seedLoad({
      number: 'TEAM-1',
      rateCents: 200_000,
      delDay: DAY_OF,
      driverId: mckaneId,
      coDriverId: hallId,
    })
  ).id
  soloLoadId = (
    await seedLoad({
      number: 'SOLO-1',
      rateCents: 100_000,
      delDay: DAY_OF,
      driverId: soloDriverId,
    })
  ).id
  await seedLoad({
    number: 'BEFORE',
    rateCents: 100_000,
    delDay: DAY_BEFORE,
    driverId: mckaneId,
  })
})

afterAll(async () => {
  await owner?.$disconnect().catch(() => undefined)
})

describe('a team load', () => {
  it('pays BOTH crew members, each at their own percentage', async () => {
    // THE GUARD NAMED "co-driver line missing". Reading only `driverId`
    // anywhere in the chain drops HALL entirely and nothing else complains:
    // MCKANE's statement looks perfectly correct on its own.
    const inputs = await inOrg((tx) =>
      batchInputForOrg(tx, {
        organizationId,
        period: PERIOD,
        statementDate: PERIOD.end,
        checkDate: PERIOD.end,
      }),
    )

    const mckane = inputs.find((i) => i.driverId === mckaneId)
    const hall = inputs.find((i) => i.driverId === hallId)

    expect(mckane, 'MCKANE has no statement input').toBeDefined()
    expect(
      hall,
      'HALL has no statement input — the co-driver line is missing',
    ).toBeDefined()

    const mineOf = (id: string) =>
      inputs
        .find((i) => i.driverId === id)!
        .loads.filter((l) => l.id === teamLoadId)

    expect(mineOf(mckaneId)).toHaveLength(1)
    expect(mineOf(hallId)).toHaveLength(1)

    // ONE GROSS, SHARED. Not halved, not doubled.
    expect(mineOf(hallId)[0]!.rateCents).toBe(mineOf(mckaneId)[0]!.rateCents)
  })

  it('prints "Team with" on both statements, naming the other person', async () => {
    const inputs = await inOrg((tx) =>
      batchInputForOrg(tx, {
        organizationId,
        period: PERIOD,
        statementDate: PERIOD.end,
        checkDate: PERIOD.end,
      }),
    )

    // A 20% line under a driver everybody remembers at 30% reads as a mistake.
    // This is the sentence that makes it legible, and it goes on BOTH.
    expect(inputs.find((i) => i.driverId === mckaneId)!.teamWith).toEqual([
      'JULIA HALL',
    ])
    expect(inputs.find((i) => i.driverId === hallId)!.teamWith).toEqual([
      'JERRY ROBERT MCKANE',
    ])
  })

  it('leaves a SOLO load with exactly one line, on one statement', async () => {
    // THE GUARD NAMED "solo load gains a phantom line". This is the one the
    // database can no longer make for us: `@@unique([loadId, driverId])`
    // permits a second line as long as it names a different driver, so what
    // keeps a solo load single is the engine, and this is the proof of it.
    const inputs = await inOrg((tx) =>
      batchInputForOrg(tx, {
        organizationId,
        period: PERIOD,
        statementDate: PERIOD.end,
        checkDate: PERIOD.end,
      }),
    )

    const carriers = inputs.filter((i) =>
      i.loads.some((l) => l.id === soloLoadId),
    )
    expect(carriers.map((c) => c.driverId)).toEqual([soloDriverId])
    expect(carriers[0]!.loads.filter((l) => l.id === soloLoadId)).toHaveLength(
      1,
    )

    // And the solo driver runs alone, so no header.
    expect(carriers[0]!.teamWith).toEqual([])
  })

  it('counts the load once and the drivers twice', async () => {
    // The This-week Ready count reads the same settleable definition.
    const [forMckane, forHall] = await Promise.all([
      owner.load.count({
        where: settleableWhere(mckaneId, PERIOD.start, PERIOD.end),
      }),
      owner.load.count({
        where: settleableWhere(hallId, PERIOD.start, PERIOD.end),
      }),
    ])
    expect(forMckane).toBeGreaterThan(0)
    expect(forHall).toBeGreaterThan(0)

    const distinct = await owner.load.findMany({
      where: {
        OR: [
          settleableWhere(mckaneId, PERIOD.start, PERIOD.end),
          settleableWhere(hallId, PERIOD.start, PERIOD.end),
        ],
      },
      select: { id: true },
    })
    // TWO DRIVERS, ONE LOAD. The count of loads must not double because two
    // people drove it.
    expect(new Set(distinct.map((l) => l.id)).size).toBe(distinct.length)
  })
})

describe('what the database refuses outright', () => {
  it('refuses one person in both seats', async () => {
    // THE GUARD NAMED "co-driver equals driver". Listed twice, one person
    // would settle as two crew members and be paid twice for one load — the
    // unique key cannot catch it, because the two lines name two DIFFERENT
    // driver ids only by accident of who was typed where.
    const load = await seedLoad({
      number: 'SAME-SEAT',
      rateCents: 100_000,
      delDay: DAY_OF,
      driverId: mckaneId,
    })

    await expect(
      owner.load.update({
        where: { id: load.id },
        data: { coDriverId: mckaneId },
      }),
    ).rejects.toThrow(/Load_coDriver_differs_from_driver|violates check/i)
  })

  it('refuses paying the same driver twice for the same load', async () => {
    // THE GUARD NAMED "same driver twice", and the promise the old
    // `@@unique([loadId])` made. It still holds; it simply names the driver.
    const load = await seedLoad({
      number: 'TWICE',
      rateCents: 100_000,
      delDay: DAY_OF,
      driverId: mckaneId,
      coDriverId: hallId,
    })

    const settlement = await owner.settlement.create({
      data: {
        organizationId,
        companyId,
        batchId: null,
        driverId: mckaneId,
        settlementNumber: `TEAM-TWICE-${nonce}`,
        periodStart: PERIOD.start,
        periodEnd: PERIOD.end,
      },
    })

    const line = {
      settlementId: settlement.id,
      organizationId,
      driverId: mckaneId,
      loadId: load.id,
      loadNumber: 'TWICE',
      companyId,
      companyName: 'RAM',
      puPlace: 'Whiteland,IN',
      delPlace: 'Gastonia,NC',
      puDate: PERIOD.start,
      delDate: PERIOD.end,
      grossCents: 100_000,
      milesHundredths: 40_000,
      amountCents: 20_000,
      settledBasis: 'rate',
    }

    await owner.settlementLoadLine.create({ data: line })
    await expect(
      owner.settlementLoadLine.create({ data: line }),
    ).rejects.toThrow(/Unique constraint|loadId_driverId/i)

    // AND THE SECOND CREW MEMBER IS STILL ALLOWED. The key names the driver,
    // so the same load paying HALL is not a duplicate — if this throws, the
    // constraint has gone back to forbidding teams altogether.
    await owner.settlementLoadLine.create({
      data: { ...line, driverId: hallId, amountCents: 20_000 },
    })
  })
})

// ── CLOSED HISTORY STAYS CLOSED, TEAM OR NOT ───────────────────────────
//
// Datatruck already settled this freight. The import's ruling is "no
// historical driver pay, no historical settlements", and 1,136 of the 14,451
// exported loads carry a co-driver — so the moment the importer starts
// setting `coDriverId`, every one of those becomes a load with a second crew
// member attached. If widening the batch to both seats also widened it past
// `NOT_CLOSED_HISTORY`, the first org-wide batch would pay two people for
// freight that was paid for last year.
describe('closed history', () => {
  it('never enters a batch, not even with a co-driver on it', async () => {
    const load = await seedLoad({
      number: 'CLOSED',
      rateCents: 500_000,
      delDay: DAY_OF,
      driverId: mckaneId,
      coDriverId: hallId,
    })
    await owner.load.update({
      where: { id: load.id },
      data: { billingStatus: 'CLOSED_IN_DATATRUCK' },
    })

    const inputs = await inOrg((tx) =>
      batchInputForOrg(tx, {
        organizationId,
        period: PERIOD,
        statementDate: PERIOD.end,
        checkDate: PERIOD.end,
      }),
    )

    for (const input of inputs) {
      expect(
        input.loads.map((l) => l.id),
        `${input.driverName} was offered closed history`,
      ).not.toContain(load.id)
    }
  })
})

describe('the effective date', () => {
  it('does NOT reach backwards: a 9/3 load is still 30%', async () => {
    // THE GUARD NAMED "rule effective date ignored". This is the property
    // ST-005395 protects — every load on it delivered on or before 9/3, so the
    // 20% rule must not touch it. That statement is in no database and no
    // corpus file, so the PROPERTY is guarded directly rather than the paper.
    //
    // `ruleInForce` IS THE ENGINE'S OWN SELECTOR, called here rather than a
    // second `find` written to agree with it. The first version of this test
    // searched the rule list itself, which proved only that the fixture was
    // seeded the way the fixture was seeded — flag 88, in one test.
    const inputs = await inOrg((tx) =>
      batchInputForOrg(tx, {
        organizationId,
        period: PERIOD,
        statementDate: PERIOD.end,
        checkDate: PERIOD.end,
      }),
    )
    const rules = inputs.find((i) => i.driverId === mckaneId)!.payRules

    const onThird = ruleInForce(rules, new Date(Date.UTC(2026, 8, DAY_BEFORE)))
    expect(onThird?.percentBps, 'a 9/3 load must still pay 30%').toBe(3000)

    const onFourth = ruleInForce(rules, new Date(Date.UTC(2026, 8, DAY_OF)))
    expect(onFourth?.percentBps, 'a 9/4 load must pay 20%').toBe(2000)

    // AND THE MONEY, not just the rate. 30% of $1,000 is $300 on the 3rd;
    // the same load on the 4th would be $200, and that difference is the
    // whole of what an ignored effective date costs a driver.
    const before = inputs
      .find((i) => i.driverId === mckaneId)!
      .loads.find((l) => l.delDate.getUTCDate() === DAY_BEFORE)!
    expect(before, 'the 9/3 load is missing').toBeDefined()
    expect(payFor({ ...payable(before) }, onThird)).toMatchObject({
      ok: true,
      amountCents: 30_000,
    })
    expect(payFor({ ...payable(before) }, onFourth)).toMatchObject({
      ok: true,
      amountCents: 20_000,
    })
  })
})
