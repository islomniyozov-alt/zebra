import { readFileSync, readdirSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { matchByKeys, plateKey } from '@/lib/ordered-match'
import { crewSeatFor, crewNameKey, plateIndex } from '@/lib/trips-crew'
import { crewRefusalLine } from '@/lib/trips-preview'
import {
  keyFor,
  keysOfUnit,
  previewRemittance,
  type FreightRef,
} from '@/lib/amazon/remittance-preview'
import { readRemittance, type RemittanceReading } from '@/lib/amazon/remittance'

// ---------------------------------------------------------------------------
// ONE MATCHER, AN ORDERED LIST OF KEYS (MONEY-DESIGN §2, 2026-11-17).
// ---------------------------------------------------------------------------

describe('matchByKeys', () => {
  const keys = [
    {
      key: 'unit' as const,
      idsFor: (v: string) => ({ '1024': ['a'] })[v] ?? [],
    },
    {
      key: 'plate' as const,
      idsFor: (v: string) =>
        ({ P1: ['b'], P2: ['c', 'd'], '1024': ['z'] })[v] ?? [],
    },
  ]

  it('the first key that finds anything decides, and says which it was', () => {
    expect(matchByKeys('1024', keys)).toEqual({
      kind: 'one',
      id: 'a',
      key: 'unit',
    })
    expect(matchByKeys('P1', keys)).toEqual({
      kind: 'one',
      id: 'b',
      key: 'plate',
    })
  })

  it('two on a key is ambiguous, with both, and never passed to the next key', () => {
    expect(matchByKeys('P2', keys)).toEqual({
      kind: 'ambiguous',
      ids: ['c', 'd'],
      key: 'plate',
    })
    const tie = [
      { key: 'unit' as const, idsFor: () => ['x', 'y'] },
      { key: 'plate' as const, idsFor: () => ['x'] },
    ]
    expect(matchByKeys('anything', tie).kind).toBe('ambiguous')
  })

  it('nothing on any key is none', () => {
    expect(matchByKeys('nope', keys)).toEqual({ kind: 'none' })
  })

  it('normalises a plate: upper case, no spaces, no dashes', () => {
    expect(plateKey('p1-270 468')).toBe('P1270468')
    expect(plateKey(' ab-c  12 ')).toBe('ABC12')
  })
})

describe('the truck seat: unit, then plate', () => {
  const trucks = [
    { id: 'trk_1', unitNumber: '2146', plate: 'P1-270468' },
    { id: 'trk_2', unitNumber: '2150', plate: 'ZP 33494' },
    { id: 'trk_3', unitNumber: '2151', plate: 'NEW1' },
  ]
  const history = [
    // trk_3 used to carry P1173229; trk_1 used to carry DUP; trk_2 carries DUP's
    // twin now through its own history.
    { id: 'trk_3', from: 'P1173229', to: 'NEW1' },
    { id: 'trk_1', from: 'DUP-9', to: 'P1-270468' },
    { id: 'trk_2', from: 'dup 9', to: 'ZP 33494' },
  ]
  const plates = plateIndex(trucks, history)
  const units = new Map(trucks.map((t) => [crewNameKey(t.unitNumber), [t.id]]))
  const resolve = {
    driverIdsFor: () => [],
    truckIdsFor: (unit: string) => units.get(crewNameKey(unit)) ?? [],
    truckIdsByPlate: (plate: string) => plates.get(plateKey(plate)) ?? [],
    truckUnitOf: (id: string) =>
      trucks.find((t) => t.id === id)?.unitNumber ?? id,
  }
  const seat = (tractor: string) =>
    crewSeatFor({ driverNames: [], tractorIds: [tractor] }, resolve)

  it('a unit number seats by unit, as before', () => {
    expect(seat('2146')).toEqual({
      kind: 'seated',
      driverId: null,
      truckId: 'trk_1',
      truckKey: 'unit',
    })
  })

  it('a current plate seats by plate, whatever its spacing and dashes', () => {
    expect(seat('P1270468')).toMatchObject({
      truckId: 'trk_1',
      truckKey: 'plate',
    })
    expect(seat('zp33494')).toMatchObject({
      truckId: 'trk_2',
      truckKey: 'plate',
    })
  })

  it('a plate the truck used to carry seats it, from the history', () => {
    expect(seat('P1173229')).toMatchObject({
      truckId: 'trk_3',
      truckKey: 'plate',
    })
  })

  it('a plate on two trucks is ambiguous — refused with both units named', () => {
    const refused = seat('DUP9')
    expect(refused.kind).toBe('refused')
    if (refused.kind !== 'refused') return
    expect(refused.reasons).toEqual([
      {
        column: 'truck',
        value: 'DUP9',
        why: 'matches_two',
        key: 'plate',
        candidates: ['2146', '2150'],
      },
    ])
    expect(
      crewRefusalLine(refused.reasons[0]!, {
        driver: 'Driver',
        truck: 'Truck',
        matchesNobody: 'matches nobody',
        matchesTwo: 'matches two rows',
        fileDisagrees: 'the file names two',
        byPlate: 'by plate',
      }),
    ).toBe('Truck “DUP9”: matches two rows (by plate: 2146, 2150)')
  })

  it('nothing by unit or plate still matches nobody', () => {
    expect(seat('Q999')).toEqual({
      kind: 'refused',
      reasons: [{ column: 'truck', value: 'Q999', why: 'matches_nobody' }],
    })
  })

  it('a resolver without plates behaves exactly as the unit-only rule did', () => {
    const unitOnly = {
      driverIdsFor: resolve.driverIdsFor,
      truckIdsFor: resolve.truckIdsFor,
    }
    expect(
      crewSeatFor({ driverNames: [], tractorIds: ['P1270468'] }, unitOnly).kind,
    ).toBe('refused')
  })

  it('the resolver reads plate history only for tractors no unit matched, and never seats a removed truck', () => {
    const writer = readFileSync('src/lib/trips-writer.ts', 'utf8')
    expect(writer).toMatch(/unmatched\.length === 0\s*\?\s*\[\]/)
    expect(writer).toMatch(/history\.filter\(\(change\) => trucks\.some/)
  })
})

// ── THE REMITTANCE: ONE MATCHER, AND NO MATCH CHANGES ────────────────────

const reading = (
  rows: {
    tripId: string | null
    loadId: string | null
    scope: 'TOUR' | 'LOAD'
  }[],
): RemittanceReading =>
  ({
    summary: {},
    rows: rows.map((row, index) => ({
      at: index + 2,
      invoiceNumber: 'AZNG-T',
      tripId: row.tripId,
      loadId: row.loadId,
      itemType: row.scope === 'TOUR' ? 'TOUR - COMPLETED' : 'LOAD - COMPLETED',
      item: { scope: row.scope, outcome: 'COMPLETED' },
      money: {},
      grossCents: 10000,
      startDate: '',
      endDate: '',
      route: '',
    })),
  }) as unknown as RemittanceReading

const freight = (references: readonly string[]) =>
  new Map<string, FreightRef[]>(
    references.map((reference, index) => [
      reference,
      [
        {
          id: `load-${index}`,
          loadNumber: `L${index}`,
          reference,
          totalRevenueCents: 10000,
          closedHistory: false,
        },
      ],
    ]),
  )

/** THE RULE BEFORE, stated independently: a trip's reference, or a single load's. */
const beforeMatched = (r: RemittanceReading, f: ReadonlyMap<string, unknown>) =>
  new Set(
    r.rows
      .map((row) => keyFor(row))
      .map((key) =>
        key.branch === 'tour' || key.branch === 'load_under_trip'
          ? key.tripId
          : key.branch === 'single_load'
            ? key.loadId
            : null,
      )
      .filter((ref): ref is string => ref !== null && f.has(ref)),
  )

const afterMatched = (
  r: RemittanceReading,
  f: ReadonlyMap<string, FreightRef[]>,
) =>
  new Set(
    previewRemittance(r, f)
      .lines.filter((line) => line.matchedBy !== null)
      .map((line) =>
        line.key.branch === 'single_load'
          ? line.key.loadId
          : line.key.branch === 'unkeyable'
            ? ''
            : line.key.tripId,
      ),
  )

describe('the remittance through the ordered keys', () => {
  it('records which key hit: a trip by trip_id, a single load by load_id', () => {
    const r = reading([
      { tripId: 'T-1', loadId: null, scope: 'TOUR' },
      { tripId: 'T-1', loadId: 'L-A', scope: 'LOAD' },
      { tripId: null, loadId: 'L-S', scope: 'LOAD' },
      { tripId: 'T-9', loadId: null, scope: 'TOUR' },
    ])
    const lines = previewRemittance(r, freight(['T-1', 'L-S'])).lines
    // T-1's tour and leg are one unit; L-S is a single load; T-9 is unknown.
    expect(lines.map((line) => line.matchedBy)).toEqual([
      'trip_id',
      'load_id',
      null,
    ])
    expect(lines[2]!.outcome).toBe('unmatched')
    expect(keysOfUnit({ branch: 'unkeyable' })).toEqual([])
  })

  it('a leg under an unknown trip is NOT pulled out by its Load ID', () => {
    // The freight carries the leg's Load ID and not its trip. Before and
    // after, the trip is unmatched: the line's loads are where money goes.
    const r = reading([
      { tripId: 'T-2', loadId: null, scope: 'TOUR' },
      { tripId: 'T-2', loadId: 'L-B', scope: 'LOAD' },
    ])
    const lines = previewRemittance(r, freight(['L-B'])).lines
    expect(lines).toHaveLength(1)
    expect(lines[0]!.outcome).toBe('unmatched')
    expect(lines[0]!.matchedBy).toBeNull()
  })
})

// ── BEFORE → AFTER ON THE SIX-WEEK WORKBOOKS, WHEN THEY ARE PRESENT ──────
//
// The freight is built to TEMPT a change: every single load's reference, every
// other trip's, AND every leg's own Load ID — so a Load-ID fallback added under
// a trip would show up here as new matches, listed by name.
const DIR = 'corpus/amazon'
const files = (() => {
  try {
    return readdirSync(DIR).filter((name) => name.endsWith('.xlsx'))
  } catch {
    return []
  }
})()

describe.skipIf(files.length === 0)(
  'before → after, the six-week remittances',
  () => {
    it('lines matched before = after; new matches listed by name (none)', async () => {
      let before = 0
      let after = 0
      const added: string[] = []
      const lost: string[] = []
      for (const name of files) {
        const outcome = await readRemittance(
          new Uint8Array(readFileSync(`${DIR}/${name}`)),
        )
        if (!outcome.ok) continue
        const r = outcome.reading
        const trips = [
          ...new Set(r.rows.map((row) => row.tripId).filter(Boolean)),
        ] as string[]
        const references = [
          ...trips.filter((_, index) => index % 2 === 0),
          ...r.rows
            .map((row) => row.loadId)
            .filter((id): id is string => Boolean(id)),
        ]
        const f = freight(references)
        const b = beforeMatched(r, f)
        const a = afterMatched(r, f)
        before += b.size
        after += a.size
        for (const ref of a) if (!b.has(ref)) added.push(`${name}: ${ref}`)
        for (const ref of b) if (!a.has(ref)) lost.push(`${name}: ${ref}`)
      }
      console.log(
        `REMITTANCE before ${before} → after ${after}; new ${added.length}`,
      )
      expect(added).toEqual([])
      expect(lost).toEqual([])
      expect(before).toBeGreaterThan(0)
      expect(after).toBe(before)
    })
  },
)
