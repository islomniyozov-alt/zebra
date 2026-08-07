import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  INSPECTION_LEVELS,
  VIOLATION_UNITS,
  normalizeState,
  shapeInspections,
} from '@/lib/inspections'
import type { ViolationUnit } from '@/generated/prisma/client'

// ---------------------------------------------------------------------------
// The two facts an inspection screen shows that are NOT columns: whether
// anything was put out of service, and whether the inspection was clean. Both
// are read off the violations at read time, for the reason §2.2 gives about
// compliance status — a stored flag is a cache that goes stale the moment a
// violation is added.
//
// The failure that matters is a clean inspection reading as an out-of-service
// one, or the reverse. The first loses a carrier two years of CSA credit; the
// second sends a truck out that should not move.
// ---------------------------------------------------------------------------

const violation = (over: Partial<Record<string, unknown>> = {}) => ({
  id: 'v1',
  code: '393.75(a)(3)',
  description: 'Tire — flat or audible air leak',
  unit: 'VEHICLE' as ViolationUnit,
  outOfService: false,
  severityWeight: 8,
  ...over,
})

const stored = (
  over: Partial<Parameters<typeof shapeInspections>[0][number]> = {},
) =>
  ({
    id: 'i1',
    companyId: 'c1',
    inspectedAt: new Date('2026-08-03T00:00:00Z'),
    level: 'LEVEL_1' as const,
    state: 'IN',
    reportNumber: 'IN2600123456',
    location: 'Gary weigh station',
    inspectorName: null,
    notes: null,
    company: { name: 'RAM Haulage' },
    truck: { id: 't1', unitNumber: '104' },
    trailer: null,
    driver: { id: 'd1', firstName: 'Ahmad', lastName: 'Karimov' },
    violations: [],
    _count: { documents: 0 },
    ...over,
  }) as Parameters<typeof shapeInspections>[0][number]

describe('what came of an inspection', () => {
  it('with nothing written is clean and not out of service', () => {
    const [row] = shapeInspections([stored()])
    expect(row?.isClean).toBe(true)
    expect(row?.outOfService).toBe(false)
  })

  it('with a violation that grounded nothing is neither clean nor out of service', () => {
    // The middle state, and the one a boolean pair would collapse. An
    // inspection with two violations and no OOS order is a real outcome that
    // reads as its own count on the screen.
    const [row] = shapeInspections([
      stored({ violations: [violation(), violation({ id: 'v2' })] }),
    ])
    expect(row?.isClean).toBe(false)
    expect(row?.outOfService).toBe(false)
    expect(row?.violations).toHaveLength(2)
  })

  it('is out of service when ANY violation carries the flag', () => {
    // Any, not all: one OOS violation among five grounds the unit, and reading
    // it off the first violation alone would miss it whenever the officer
    // wrote the OOS one second.
    const [row] = shapeInspections([
      stored({
        violations: [
          violation(),
          violation({ id: 'v2', outOfService: true }),
          violation({ id: 'v3' }),
        ],
      }),
    ])
    expect(row?.outOfService).toBe(true)
    expect(row?.isClean).toBe(false)
  })
})

describe('who an inspection was written against', () => {
  it('carries a driver as one readable name', () => {
    const [row] = shapeInspections([stored()])
    expect(row?.driver).toEqual({ id: 'd1', name: 'Ahmad Karimov' })
  })

  it('leaves the units that were not present null rather than blank', () => {
    // A Level III has no truck on it. `null` and "" are different facts, and
    // the screens join the present ones with a separator — an empty string
    // would produce "104 ·  · Ahmad".
    const [row] = shapeInspections([stored({ truck: null, trailer: null })])
    expect(row?.truck).toBeNull()
    expect(row?.trailer).toBeNull()
    expect(row?.driver?.name).toBe('Ahmad Karimov')
  })
})

describe('the state an inspection was written in', () => {
  it('uppercases two letters', () => {
    expect(normalizeState(' in ')).toBe('IN')
    expect(normalizeState('Oh')).toBe('OH')
  })

  it('refuses everything else rather than guessing', () => {
    // "Indiana" is not a jurisdiction code, and truncating it to "IN" would be
    // right by luck — "Iowa" would become "IO", which is not a state.
    expect(normalizeState('Indiana')).toBeNull()
    expect(normalizeState('I')).toBeNull()
    expect(normalizeState('')).toBeNull()
    expect(normalizeState('I1')).toBeNull()
  })
})

describe('the enum lists the screens offer', () => {
  // Read from the SCHEMA, not from a copy kept here — the same guard shape as
  // document-targets and maintenance, catching the member somebody adds that
  // no screen offers.
  const schema = readFileSync(
    join(process.cwd(), 'prisma', 'schema.prisma'),
    'utf8',
  )
  const membersOf = (name: string) =>
    [
      ...(new RegExp(`^enum\\s+${name}\\s*\\{([\\s\\S]*?)^\\}`, 'm')
        .exec(schema)?.[1]
        ?.matchAll(/^\s{2}(\w+)\s*$/gm) ?? []),
    ].map((match) => match[1]!)

  it('found both enums at all', () => {
    // Without this the comparisons below pass vacuously if the regex breaks.
    expect(membersOf('InspectionLevel')).toHaveLength(6)
    expect(membersOf('ViolationUnit').length).toBeGreaterThan(2)
  })

  it('offers every DOT level, because a carrier does not choose which it gets', () => {
    expect([...INSPECTION_LEVELS]).toEqual(membersOf('InspectionLevel'))
  })

  it('and every unit a violation can be written against', () => {
    expect([...VIOLATION_UNITS].sort()).toEqual(
      membersOf('ViolationUnit').sort(),
    )
  })
})
