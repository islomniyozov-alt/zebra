import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  TRUCK_HEALTH_CHECKS,
  truckHealthCheckFor,
  truckHealthWhere,
} from '@/lib/data-health'

// ---------------------------------------------------------------------------
// §6.5 PART 0 — DATA HEALTH. Five counts, one definition each, used as the
// count AND as the filter the count links to.
// ---------------------------------------------------------------------------

describe('the five checks', () => {
  it("are the owner's five, in the owner's order", () => {
    expect([...TRUCK_HEALTH_CHECKS]).toEqual([
      'vin',
      'plate',
      'odometer',
      'registration',
      'inspection',
    ])
    const doc = readFileSync('TMS-DESIGN-SYSTEM.md', 'utf8')
    expect(doc).toContain(
      'missing VIN, plate, odometer, registration expiry,\nannual inspection',
    )
  })

  it('reads the URL value and ignores anything else', () => {
    expect(truckHealthCheckFor('vin')).toBe('vin')
    expect(truckHealthCheckFor('inspection')).toBe('inspection')
    expect(truckHealthCheckFor('insurance')).toBeNull()
    expect(truckHealthCheckFor(undefined)).toBeNull()
    expect(truckHealthCheckFor(['vin'])).toBeNull()
  })
})

describe('missing, not stale', () => {
  it('counts a blank column the same as a null one', () => {
    // Imported rows carry '' where a person would leave null.
    expect(truckHealthWhere('vin')).toEqual({
      OR: [{ vin: { equals: null } }, { vin: { equals: '' } }],
    })
    expect(truckHealthWhere('plate')).toEqual({
      OR: [{ plate: { equals: null } }, { plate: { equals: '' } }],
    })
    expect(truckHealthWhere('odometer')).toEqual({ currentOdometer: null })
  })

  it('calls a record missing only when no live item of the type exists', () => {
    // An EXPIRED registration is present and stale — the warnings column's
    // fact. Counting it here would make one fact two numbers.
    expect(truckHealthWhere('registration')).toEqual({
      complianceItems: { none: { type: 'REGISTRATION', deletedAt: null } },
    })
    expect(truckHealthWhere('inspection')).toEqual({
      complianceItems: { none: { type: 'ANNUAL_INSPECTION', deletedAt: null } },
    })
  })

  it('uses the same definition in the SQL the counts run', () => {
    // The count and the filter cannot be allowed to disagree; the SQL is read
    // here against the Prisma filter above, check by check.
    const source = readFileSync(join('src', 'lib', 'data-health.ts'), 'utf8')
    expect(source).toContain(`t.vin IS NULL OR btrim(t.vin) = ''`)
    expect(source).toContain(`t.plate IS NULL OR btrim(t.plate) = ''`)
    expect(source).toContain(`t."currentOdometer" IS NULL`)
    expect(source).toContain(`ci.type = 'REGISTRATION'`)
    expect(source).toContain(`ci.type = 'ANNUAL_INSPECTION'`)
    expect(source).not.toMatch(/expiresAt/)
    expect(source).toContain(`t."deletedAt" IS NULL`)
  })
})

describe('the row on the list', () => {
  const page = readFileSync(
    join('src', 'app', '(app)', 'trucks', 'page.tsx'),
    'utf8',
  )

  it('counts in the same transaction, filters by the same where, links every figure', () => {
    expect(page).toContain('countTruckHealth(tx')
    expect(page).toContain('truckHealthWhere(')
    expect(page).toContain('<DataHealthRow')
    const row = readFileSync(
      join('src', 'app', '(app)', 'trucks', 'DataHealthRow.tsx'),
      'utf8',
    )
    // Zero is shown, never hidden: no branch drops a figure for being 0, and
    // every check renders through the one list.
    expect(row).not.toMatch(/counts\[check\]\s*(>|!==)\s*0\s*\?/)
    expect(row).toContain('TRUCK_HEALTH_CHECKS.map(')
    // The link carries `missing=` through the page's own URL builder, so the
    // other filters survive the click.
    expect(page).toContain('missing: missing ?? undefined')
    expect(page).toContain('withParams({ missing: check ?? undefined })')
  })
})
