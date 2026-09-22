import type { TxClient } from './tenancy'
import { ReferenceError } from './reference'

// ---------------------------------------------------------------------------
// THE RANDOM TESTING PROGRAMME — 49 CFR 382.305.
//
// Item 15. A motor carrier must randomly test a minimum percentage of its
// driver positions each year for drugs and for alcohol, and must be able to
// show an auditor that the selections were genuinely random. Three things in
// that sentence decide the whole design.
//
// ── THE RATE IS DATA, NEVER A CONSTANT ───────────────────────────────────
//
// §382.305(b) sets a minimum annual percentage rate and the FMCSA Administrator
// ADJUSTS IT by notice in the Federal Register — it has moved between 25% and
// 50% for drugs within living memory, and it moved for 2020 and again for 2024.
// A `const DRUG_RATE = 0.5` in this file would be correct until the morning it
// silently was not, and the carrier would under-test for a year without
// anything saying so.
//
// So the rate is a row, entered by a person who read the notice, WITH THE
// CITATION beside it. `annualRate` refuses a year it has no row for rather
// than falling back to anything: "we do not know this year's rate" is a
// sentence somebody can act on, and a default is a wrong number nobody
// questions. The guard is named "a rate hardcoded".
//
// ── THE DRAW IS SEEDED, RECORDED, AND RECOMPUTABLE ───────────────────────
//
// "Random" to an auditor means "you cannot have chosen who got tested". A
// selection nobody can re-derive is indistinguishable from a list somebody
// typed, so the seed, the algorithm's name and the POOL AS IT STOOD are all
// stored on the draw — and the selection is a pure function of those three.
//
// The method is deliberately not a random-number sequence. Each member is
// scored by SHA-256(seed : memberKey) and the lowest scores are selected. That
// is independent of the order the pool arrives in, so an auditor recomputing
// it from the recorded snapshot gets the same answer whatever order they read
// the rows in — which a `shuffle(rng)` does not give you.
//
// ── A TERMINATED DRIVER IS NOT IN THE POOL ───────────────────────────────
//
// §382.305(b) is a percentage of driver POSITIONS, and §382.305(i)(3) says
// selections are made from the pool of drivers SUBJECT TO TESTING. Somebody
// who left in March is not subject to testing in June; drawing them produces
// a selection that can never be resolved and a rate that looks met and is not.
// `poolFromDrivers` filters, and the guard is named "a terminated driver
// drawn".
// ---------------------------------------------------------------------------

/** Drugs and alcohol have different rates and are drawn separately. */
export const TEST_KINDS = ['DRUG', 'ALCOHOL'] as const
export type TestKind = (typeof TEST_KINDS)[number]

/** Where the pool came from. TEXT against a code list, per migration 52. */
export const POOL_SOURCES = ['DERIVED', 'CONSORTIUM'] as const
export type PoolSource = (typeof POOL_SOURCES)[number]

/** How a selection ended. `PENDING` until somebody says. */
export const SELECTION_OUTCOMES = ['PENDING', 'TESTED', 'NOT_TESTED'] as const
export type SelectionOutcome = (typeof SELECTION_OUTCOMES)[number]

export interface AnnualRate {
  year: number
  /** Basis points. 50% is 5000 — integer, like every other percentage here. */
  drugRateBps: number
  alcoholRateBps: number
  /** The Federal Register notice this was read from. Printed, not decorative. */
  citation: string
}

/**
 * The rate for a year, or a refusal.
 *
 * NO DEFAULT, NO NEAREST YEAR, NO CARRY-FORWARD. Each of those would produce a
 * number that looks like an answer. The rate changes by notice and the only
 * honest response to a year nobody has entered is to say so and stop.
 */
export function annualRate(
  rates: readonly AnnualRate[],
  year: number,
): AnnualRate {
  const found = rates.find((rate) => rate.year === year)
  if (!found) {
    throw new ReferenceError('rate_not_recorded', { field: 'year' })
  }
  return found
}

/**
 * How many selections a year needs, at a given rate over a given pool.
 *
 * ROUNDED UP, ALWAYS. §382.305 sets a MINIMUM annual percentage rate; 10.2
 * selections is eleven selections, and rounding to ten is under-testing by
 * rule rather than by accident.
 */
export function selectionsForYear(poolSize: number, rateBps: number): number {
  if (poolSize <= 0) return 0
  return Math.ceil((poolSize * rateBps) / 10_000)
}

/**
 * How many to draw in one quarter.
 *
 * The remainder lands in the LAST quarter that needs it rather than being
 * spread evenly, because a carrier that is behind at the end of Q3 has to
 * catch up in Q4 and a schedule that pretends otherwise is one nobody can
 * follow. `alreadyDrawn` is what the earlier draws of this year actually
 * produced, read from the rows rather than assumed.
 */
export function selectionsForQuarter(
  yearTotal: number,
  quarter: number,
  alreadyDrawn: number,
): number {
  if (quarter < 1 || quarter > 4) {
    throw new ReferenceError('invalid_year', { field: 'quarter' })
  }
  const remainingQuarters = 4 - quarter + 1
  const remaining = Math.max(0, yearTotal - alreadyDrawn)
  return Math.ceil(remaining / remainingQuarters)
}

// ── the draw ─────────────────────────────────────────────────────────────

/** The one algorithm, named and versioned, so a draw records which it used. */
export const DRAW_ALGORITHM = 'sha256-rank-v1'

/**
 * Score every member and return them in draw order, lowest score first.
 *
 * ── WHY A RANK AND NOT A SHUFFLE ─────────────────────────────────────────
 *
 * A seeded shuffle depends on the order the pool is fed in, so an auditor who
 * reads the snapshot rows in a different order recomputes a different answer
 * and concludes the draw was faked. Scoring each member independently removes
 * the input order from the result entirely: sort the snapshot however you
 * like, the same people come out.
 *
 * Ties break on the member key, which is stable and unique within a pool, so
 * there is no coin to flip.
 */
export async function drawOrder(
  seed: string,
  memberKeys: readonly string[],
): Promise<string[]> {
  const scored = await Promise.all(
    memberKeys.map(async (key) => ({ key, score: await score(seed, key) })),
  )
  return scored
    .sort((a, b) =>
      a.score < b.score ? -1 : a.score > b.score ? 1 : a.key < b.key ? -1 : 1,
    )
    .map((entry) => entry.key)
}

async function score(seed: string, key: string): Promise<string> {
  const bytes = new TextEncoder().encode(`${seed}:${key}`)
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('')
}

/**
 * Who this draw selects.
 *
 * SELECTION IS WITH REPLACEMENT ACROSS KINDS AND WITHOUT IT WITHIN ONE.
 * §382.305 runs two programmes over one pool: being drawn for drugs does not
 * exclude somebody from the alcohol draw, and cannot exclude them, or the two
 * rates would not be independent. Within one kind a person is drawn once —
 * testing the same driver twice in one quarter meets no part of the rule.
 *
 * A DIFFERENT SEED PER KIND, derived from the recorded one, so the drug list
 * and the alcohol list are not the same people in the same order.
 */
export async function selectFromPool(
  seed: string,
  memberKeys: readonly string[],
  counts: { DRUG: number; ALCOHOL: number },
): Promise<Record<TestKind, string[]>> {
  const out = {} as Record<TestKind, string[]>
  for (const kind of TEST_KINDS) {
    const order = await drawOrder(`${seed}:${kind}`, memberKeys)
    out[kind] = order.slice(0, Math.min(counts[kind], order.length))
  }
  return out
}

// ── the pool ─────────────────────────────────────────────────────────────

export interface PoolMember {
  /** Stable within the pool. A driver id, or the consortium's own line. */
  key: string
  driverId: string | null
  name: string
}

/**
 * The pool, derived from the roster.
 *
 * A CDL AND A JOB. Somebody who left is not subject to testing (§382.305(i)),
 * and somebody with no CDL on file is not a driver this rule covers — both
 * are excluded, and both exclusions are a test.
 */
export function poolFromDrivers(
  drivers: readonly {
    id: string
    firstName: string
    lastName: string
    status: string
    deletedAt: Date | null
    hasCdl: boolean
  }[],
): PoolMember[] {
  return drivers
    .filter(
      (driver) =>
        driver.deletedAt === null &&
        driver.status !== 'INACTIVE' &&
        driver.hasCdl,
    )
    .map((driver) => ({
      key: driver.id,
      driverId: driver.id,
      name: `${driver.lastName}, ${driver.firstName}`,
    }))
}

// ── the year-end summary ─────────────────────────────────────────────────

export interface YearSummary {
  year: number
  poolSize: number
  citation: string
  kinds: Record<
    TestKind,
    {
      rateBps: number
      required: number
      selected: number
      tested: number
      notTested: number
      pending: number
      /** Did the carrier actually test enough? Derived, never stored. */
      met: boolean
    }
  >
}

/**
 * Selections against the rate, for the year.
 *
 * MET IS COUNTED ON TESTS COMPLETED, NOT ON SELECTIONS MADE. A carrier that
 * drew twenty names and tested eleven of them has tested eleven people;
 * §382.305 is a rate of tests conducted. Counting selections would let a
 * programme meet its rate on paper by drawing names nobody chased, which is
 * the exact failure the excused-selection reason exists to make visible.
 */
export function yearSummary(
  rate: AnnualRate,
  poolSize: number,
  selections: readonly { kind: TestKind; outcome: SelectionOutcome }[],
): YearSummary {
  const kinds = {} as YearSummary['kinds']
  for (const kind of TEST_KINDS) {
    const mine = selections.filter((selection) => selection.kind === kind)
    const rateBps = kind === 'DRUG' ? rate.drugRateBps : rate.alcoholRateBps
    const required = selectionsForYear(poolSize, rateBps)
    const tested = mine.filter((s) => s.outcome === 'TESTED').length
    kinds[kind] = {
      rateBps,
      required,
      selected: mine.length,
      tested,
      notTested: mine.filter((s) => s.outcome === 'NOT_TESTED').length,
      pending: mine.filter((s) => s.outcome === 'PENDING').length,
      met: tested >= required,
    }
  }
  return { year: rate.year, poolSize, citation: rate.citation, kinds }
}

// ── resolving one selection ──────────────────────────────────────────────

/**
 * A selection ends TESTED or NOT_TESTED, and the second needs a reason.
 *
 * §382.305(j)(3): a driver selected who is unavailable — on leave, off duty,
 * no longer employed — may be excused, but the carrier has to be able to say
 * WHY for each one. "Not tested" with no reason is the line an auditor stops
 * on, so the refusal is here rather than in a form somebody can bypass.
 */
export function assertResolvable(
  outcome: SelectionOutcome,
  reason: string | null,
): void {
  if (outcome === 'NOT_TESTED' && (reason === null || reason.trim() === '')) {
    throw new ReferenceError('required', { field: 'reason' })
  }
}

// ── the service layer ────────────────────────────────────────────────────

/**
 * The pool for one company and year, from whichever source applies.
 *
 * TWO SOURCES, ONE SHAPE. A carrier running its own programme is tested from
 * its roster; one in a consortium is tested from the consortium's list. Both
 * come back as `PoolMember[]` so the draw has nothing to branch on — which is
 * what stops the consortium path quietly skipping the checks the derived one
 * has.
 */
export async function poolFor(
  tx: TxClient,
  companyId: string,
  year: number,
  source: PoolSource,
): Promise<PoolMember[]> {
  if (source === 'CONSORTIUM') {
    const entries = await tx.randomPoolEntry.findMany({
      where: { companyId, year },
      orderBy: { name: 'asc' },
      select: { id: true, driverId: true, name: true },
    })
    // THE ENTRY ID IS THE KEY, not the driver id: a consortium line may name
    // somebody who has no row here at all, and the key has to exist for
    // everybody in the pool or the snapshot cannot record them.
    return entries.map((entry) => ({
      key: entry.id,
      driverId: entry.driverId,
      name: entry.name,
    }))
  }

  const drivers = await tx.driver.findMany({
    where: { companyId },
    orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }],
    select: {
      id: true,
      firstName: true,
      lastName: true,
      status: true,
      deletedAt: true,
      complianceItems: {
        where: { type: 'CDL', deletedAt: null },
        take: 1,
        select: { id: true },
      },
    },
  })

  return poolFromDrivers(
    drivers.map((driver) => ({
      id: driver.id,
      firstName: driver.firstName,
      lastName: driver.lastName,
      status: driver.status,
      deletedAt: driver.deletedAt,
      hasCdl: driver.complianceItems.length > 0,
    })),
  )
}

export interface DrawInput {
  companyId: string
  year: number
  quarter: number
  source: PoolSource
  /**
   * The seed. Supplied so a draw can be re-run and verified, and RECORDED so
   * it can be shown — a seed the system invented and threw away is a seed
   * nobody can check the draw against.
   */
  seed: string
}

/**
 * Draw one quarter, and record everything needed to recompute it.
 *
 * THE ORDER OF OPERATIONS IS THE AUDIT. The rate is read first and refuses a
 * year nobody entered; the pool is snapshotted as it stands; the selection is
 * a pure function of the seed and that snapshot; and all of it is written in
 * one transaction, so there is no state where a draw exists without the pool
 * it drew from.
 */
export async function drawQuarter(
  tx: TxClient,
  organizationId: string,
  input: DrawInput,
  options: { byUserId?: string | null } = {},
) {
  const rates = await tx.randomTestingRate.findMany({
    where: { year: input.year },
    select: {
      year: true,
      drugRateBps: true,
      alcoholRateBps: true,
      citation: true,
    },
  })
  // REFUSES A YEAR NOBODY ENTERED. No default, no carry-forward.
  const rate = annualRate(rates, input.year)

  const pool = await poolFor(tx, input.companyId, input.year, input.source)

  // WHAT THE EARLIER QUARTERS ACTUALLY PRODUCED, read from the rows rather
  // than assumed from the schedule. A carrier that missed Q1 is behind, and
  // the arithmetic has to know it.
  const earlier = await tx.randomSelection.findMany({
    where: {
      draw: {
        companyId: input.companyId,
        year: input.year,
        quarter: { lt: input.quarter },
      },
    },
    select: { kind: true },
  })

  const counts = {} as Record<TestKind, number>
  for (const kind of TEST_KINDS) {
    const rateBps = kind === 'DRUG' ? rate.drugRateBps : rate.alcoholRateBps
    const yearTotal = selectionsForYear(pool.length, rateBps)
    const already = earlier.filter((row) => row.kind === kind).length
    counts[kind] = selectionsForQuarter(yearTotal, input.quarter, already)
  }

  const byKind = await selectFromPool(
    input.seed,
    pool.map((member) => member.key),
    counts,
  )

  const byKey = new Map(pool.map((member) => [member.key, member]))

  return tx.randomDraw.create({
    data: {
      organizationId,
      companyId: input.companyId,
      year: input.year,
      quarter: input.quarter,
      source: input.source,
      seed: input.seed,
      algorithm: DRAW_ALGORITHM,
      // THE POOL AS IT STOOD, in full. A count would not let anybody
      // recompute; a reference to the query would answer differently in
      // December than it did in April.
      poolSnapshot: pool.map((member) => ({
        key: member.key,
        driverId: member.driverId,
        name: member.name,
      })),
      poolSize: pool.length,
      drawnByUserId: options.byUserId ?? null,
      selections: {
        create: TEST_KINDS.flatMap((kind) =>
          byKind[kind].map((key) => ({
            organizationId,
            kind,
            memberKey: key,
            driverId: byKey.get(key)?.driverId ?? null,
            name: byKey.get(key)?.name ?? key,
          })),
        ),
      },
    },
    include: { selections: true },
  })
}

/**
 * Recompute a recorded draw and say whether it still comes out the same.
 *
 * THIS IS THE FEATURE, not a test helper. An auditor's question is "show me
 * that you did not choose these people", and the answer is a button that
 * re-runs the recorded seed over the recorded snapshot in front of them. It
 * reads nothing live — a draw from April must verify in December, and a pool
 * that has changed since must not affect the answer.
 */
export async function verifyDraw(draw: {
  seed: string
  algorithm: string
  poolSnapshot: unknown
  selections: readonly { kind: string; memberKey: string }[]
}): Promise<{ ok: boolean; reason: string | null }> {
  if (draw.algorithm !== DRAW_ALGORITHM) {
    return { ok: false, reason: `unknown algorithm ${draw.algorithm}` }
  }
  const snapshot = Array.isArray(draw.poolSnapshot)
    ? (draw.poolSnapshot as { key: string }[])
    : []
  const keys = snapshot.map((member) => member.key)

  for (const kind of TEST_KINDS) {
    const recorded = draw.selections
      .filter((selection) => selection.kind === kind)
      .map((selection) => selection.memberKey)
      .sort()
    const order = await drawOrder(`${draw.seed}:${kind}`, keys)
    const expected = order.slice(0, recorded.length).sort()
    if (recorded.join(',') !== expected.join(',')) {
      return { ok: false, reason: `${kind} selections do not recompute` }
    }
  }
  return { ok: true, reason: null }
}

export interface ResolveInput {
  outcome: SelectionOutcome
  reason?: unknown
  testedAt?: unknown
}

/**
 * Record what happened to one selection.
 *
 * A COMPLETED DRUG TEST BECOMES A ComplianceItem, which is where the rest of
 * this system already looks for a driver's records. Alcohol does not, and that
 * is not an oversight: `ComplianceType` has `DRUG_TEST` and nothing for
 * alcohol, and inventing a type was not in this item's ruling. Flagged.
 *
 * `expiresAt` IS THE TEST DATE, because a random test is an EVENT and not a
 * credential — nothing about it lapses, and §382 sets no per-driver expiry.
 * The column is NOT NULL, so the honest value is the day it happened rather
 * than a year invented to fill it. `warnings.ts` excludes DRUG_TEST from the
 * expiry warnings for the same reason; without that, every driver tested this
 * quarter would raise "compliance expired" the same evening.
 */
export async function resolveSelection(
  tx: TxClient,
  id: string,
  input: ResolveInput,
) {
  const reason =
    input.reason === null || input.reason === undefined
      ? null
      : String(input.reason).trim() || null
  assertResolvable(input.outcome, reason)

  const selection = await tx.randomSelection.findUnique({
    where: { id },
    select: {
      id: true,
      kind: true,
      driverId: true,
      organizationId: true,
      draw: { select: { companyId: true } },
    },
  })
  if (!selection) throw new ReferenceError('not_found')

  const testedAt =
    input.outcome === 'TESTED'
      ? input.testedAt
        ? new Date(String(input.testedAt))
        : new Date()
      : null

  let complianceItemId: string | null = null
  if (
    input.outcome === 'TESTED' &&
    selection.kind === 'DRUG' &&
    selection.driverId !== null &&
    testedAt !== null
  ) {
    const item = await tx.complianceItem.create({
      data: {
        organizationId: selection.organizationId,
        companyId: selection.draw.companyId,
        driverId: selection.driverId,
        type: 'DRUG_TEST',
        issuedAt: testedAt,
        expiresAt: testedAt,
        notes: 'Random selection, 49 CFR 382.305',
      },
      select: { id: true },
    })
    complianceItemId = item.id
  }

  return tx.randomSelection.update({
    where: { id },
    data: {
      outcome: input.outcome,
      reason,
      testedAt,
      ...(complianceItemId ? { complianceItemId } : {}),
    },
  })
}
