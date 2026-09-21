import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  agingDaysFrom,
  FLEET_STATUSES,
  FUEL_TYPES,
  isFleetStatus,
  isFuelType,
  readFleetStatus,
  readFuelType,
} from '@/lib/fleet-codes'
import {
  REQUIRED_TRUCK_DOCUMENTS,
  truckWarnings,
  type Warning,
} from '@/lib/warnings'
import { ReferenceError } from '@/lib/reference'

// ---------------------------------------------------------------------------
// ITEM 12 — THE SMALL FIELDS, AND THE TWO THINGS THAT MUST STAY DERIVED.
//
// The columns themselves need no rules. The two vocabularies do, the aging
// number does, and the plate expiry does — because the first can be written
// past, the second can be stored, and the third already has a home that warns.
// ---------------------------------------------------------------------------

const NOW = new Date(Date.UTC(2026, 8, 21, 12, 0, 0))
const days = (n: number) => new Date(NOW.getTime() + n * 86_400_000)

describe('the two code lists', () => {
  it('are the values the ruling named, spelled as they are shown', () => {
    expect([...FLEET_STATUSES]).toEqual([
      'In service',
      'Out of service',
      'In shop',
    ])
    expect([...FUEL_TYPES]).toEqual(['Diesel', 'Gas', 'Electric', 'Other'])
  })

  it('REFUSE a value outside the list rather than storing it', () => {
    // THE GUARD NAMED "fleetStatus outside the list". The column is TEXT by
    // ruling, so Postgres will take anything — this is the whole of what makes
    // the list mean something.
    for (const bad of ['Broken', 'IN_SERVICE', 'in service', 'Petrol']) {
      let caught: unknown
      try {
        readFleetStatus(bad)
      } catch (error) {
        caught = error
      }
      expect(caught).toBeInstanceOf(ReferenceError)
      expect((caught as ReferenceError).code).toBe('not_in_code_list')
      expect((caught as ReferenceError).field).toBe('fleetStatus')
    }
  })

  it('does not normalise case, because the mismatch is the finding', () => {
    // "in shop" arriving where "In shop" belongs means something upstream is
    // not reading fleet-codes.ts. Title-casing it hides exactly that.
    expect(isFleetStatus('In shop')).toBe(true)
    expect(isFleetStatus('in shop')).toBe(false)
    expect(isFuelType('Diesel')).toBe(true)
    expect(isFuelType('diesel')).toBe(false)
  })

  it('treats absent and blank as nothing said, not as an error', () => {
    // Every item 12 field is optional. A truck nobody has classified is the
    // normal state of an import, not a form to refuse.
    for (const empty of [null, undefined, '', '   ']) {
      expect(readFleetStatus(empty)).toBeNull()
      expect(readFuelType(empty)).toBeNull()
    }
  })
})

describe('aging', () => {
  it('is NULL when nothing has ever changed the status, not zero', () => {
    // Zero days reads as "changed today", which is the one thing it cannot
    // mean. `createdAt` would answer with the day of the Datatruck import for
    // 49 units that were on the road years before it.
    expect(agingDaysFrom(null, NOW)).toBeNull()
  })

  it('counts whole days since the last change', () => {
    expect(agingDaysFrom(days(-1), NOW)).toBe(1)
    expect(agingDaysFrom(days(-30), NOW)).toBe(30)
    // Less than a day is zero days, which here genuinely does mean today.
    expect(agingDaysFrom(new Date(NOW.getTime() - 3_600_000), NOW)).toBe(0)
  })

  it('is NOT STORED — there is no aging column and there must not be', () => {
    // THE GUARD NAMED "aging stored". Datatruck ships `Aging days` as a
    // column: a number that was true on the day it was written and has been
    // wrong every day since unless something recalculated it.
    const schema = readFileSync('prisma/schema.prisma', 'utf8')
    expect(schema).not.toMatch(/agingDays\s+Int/)
    expect(schema).not.toMatch(/aging\s+Int/)
    expect(schema).not.toMatch(/fleetStatusChangedAt\s+/)

    // And the derivation reads the audit log rather than a column beside it.
    const lib = readFileSync('src/lib/fleet-codes.ts', 'utf8')
    expect(lib).toContain('"AuditLog"')
    expect(lib).toContain('jsonb_exists(a."changes", \'fleetStatus\')')
  })
})

describe('plate expiry', () => {
  const names = (warnings: readonly Warning[]) => warnings.map((w) => w.name)

  it('IS warned — through the REGISTRATION compliance item', () => {
    // THE GUARD NAMED "plate expiry not warned".
    //
    // A plate and its registration expire on one date, and that date already
    // lives on a `ComplianceItem` of type REGISTRATION — which the Datatruck
    // import writes from `Registration expiry date` and which item 9 already
    // warns on. See the flag in PHASE-5-BRIEF §7: no `Truck.plateExpiresAt`
    // column was added, because a second copy of a date that raises an alarm
    // is free to disagree with the one that raises it.
    const expired = truckWarnings(
      { compliance: [{ type: 'REGISTRATION', expiresAt: days(-1) }] },
      NOW,
    )
    expect(names(expired)).toContain('compliance_expired')
    expect(expired.find((w) => w.name === 'compliance_expired')?.detail).toBe(
      'REGISTRATION',
    )

    const soon = truckWarnings(
      { compliance: [{ type: 'REGISTRATION', expiresAt: days(10) }] },
      NOW,
    )
    expect(names(soon)).toContain('compliance_expiring')
  })

  it('is a REQUIRED truck document, so its absence warns too', () => {
    // Missing is not expired: a truck with no registration on file has
    // nothing to renew and somebody has to go and get it.
    expect([...REQUIRED_TRUCK_DOCUMENTS]).toContain('REGISTRATION')
    const none = truckWarnings({ compliance: [] }, NOW)
    expect(
      none.some(
        (w) => w.name === 'document_missing' && w.detail === 'REGISTRATION',
      ),
    ).toBe(true)
  })

  it('has no second home on the truck row', () => {
    const schema = readFileSync('prisma/schema.prisma', 'utf8')
    expect(schema).not.toMatch(/plateExpiresAt\s+DateTime/)
  })
})

describe('one trailer, one driver', () => {
  it('is a partial unique index, live rows only', () => {
    // THE GUARD NAMED "trailer on two drivers". The index is the guarantee;
    // `pairedTrailer` is the sentence, and it names the driver already holding
    // it. Both are exercised against real rows in the integration suite.
    const migration = readFileSync(
      'prisma/migrations/20260921210000_fleet_small_fields/migration.sql',
      'utf8',
    )
    expect(migration).toContain('CREATE UNIQUE INDEX "driver_trailer_once"')
    expect(migration).toContain('WHERE "assignedTrailerId" IS NOT NULL')
    expect(migration).toContain('"deletedAt" IS NULL')

    const fleet = readFileSync('src/lib/fleet.ts', 'utf8')
    expect(fleet).toContain('trailer_already_paired')
  })

  it('does NOT constrain the truck, which carries a team', () => {
    const schema = readFileSync('prisma/schema.prisma', 'utf8')
    expect(schema).not.toMatch(/@@unique\(\[assignedTruckId\]\)/)
  })
})
