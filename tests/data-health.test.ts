import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  DRIVER_HEALTH_CHECKS,
  driverHealthBase,
  driverHealthCheckFor,
  driverHealthWhere,
  TRUCK_HEALTH_CHECKS,
  truckHealthCheckFor,
  truckHealthWhere,
} from '@/lib/data-health'
import { WORKING_STATUSES } from '@/lib/driver-list'
import { ruleInForce } from '@/lib/driver-pay'
import { companyScopeFilter } from '@/lib/tenancy'

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

  it('reads an empty scope as every company, as the rest of the app does (item 20 (3))', () => {
    // THE OWNER'S SCOPE IS `[]`. `companyScopeFilter` reads that as unscoped;
    // the first cut of the counts read it as "no company" and both footers
    // said 0 while the grid showed the gaps. One rule, through one helper,
    // for both subjects.
    expect(companyScopeFilter([])).toEqual({})
    const source = readFileSync(join('src', 'lib', 'data-health.ts'), 'utf8')
    expect(source).toContain(
      'return companyIds && companyIds.length > 0 ? companyIds : null',
    )
    expect(
      source.match(/const ids = scopeIds\(scope\.companyIds\)/g)?.length,
    ).toBe(2)
    expect(source).not.toMatch(/scope\.companyIds \?\? null/)
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
      join('src', 'app', '(app)', '_grid', 'DataHealthRow.tsx'),
      'utf8',
    )
    // Zero is shown, never hidden: no branch drops a figure for being 0, and
    // every check renders through the one list — the component is generic
    // over the check list, shared by trucks and drivers rather than copied.
    expect(row).not.toMatch(/counts\[check\]\s*(>|!==)\s*0\s*\?/)
    expect(row).toContain('checks.map(')
    expect(row).not.toMatch(/TRUCK_HEALTH_CHECKS|DRIVER_HEALTH_CHECKS/)
    // The link carries `missing=` through the page's own URL builder, so the
    // other filters survive the click.
    expect(page).toContain('missing: missing ?? undefined')
    expect(page).toContain('withParams({ missing: check ?? undefined })')
  })
})

// ---------------------------------------------------------------------------
// §6.5 PART 0b — THE SAME FOR DRIVERS, by the owner's five.
// ---------------------------------------------------------------------------

describe('the five driver checks (part 0b)', () => {
  const now = new Date('2026-10-07T12:00:00.000Z')

  it("are the owner's five, in the owner's order", () => {
    expect([...DRIVER_HEALTH_CHECKS]).toEqual([
      'cdl',
      'medical',
      'phone',
      'payRule',
      'truck',
    ])
    const queue = readFileSync('docs/QUEUE.md', 'utf8')
    expect(queue).toContain(
      'no CDL on file, no medical card, no phone, no pay rule, no\ntruck (active drivers only)',
    )
    expect(driverHealthCheckFor('payRule')).toBe('payRule')
    expect(driverHealthCheckFor('vin')).toBeNull()
  })

  it('counts active people only — the Active tab, minus referral payees', () => {
    expect(driverHealthBase()).toEqual({
      deletedAt: null,
      status: { in: [...WORKING_STATUSES] },
      kind: { not: 'PAYEE' },
    })
  })

  it('calls a licence or a card missing only when no live record exists', () => {
    expect(driverHealthWhere('cdl', now)).toEqual({
      complianceItems: { none: { type: 'CDL', deletedAt: null } },
    })
    expect(driverHealthWhere('medical', now)).toEqual({
      complianceItems: { none: { type: 'MEDICAL_CARD', deletedAt: null } },
    })
  })

  it("counts no pay rule by ruleInForce's own test, on the day asked", () => {
    expect(driverHealthWhere('payRule', now)).toEqual({
      payRules: {
        none: {
          effectiveFrom: { lte: now },
          OR: [{ effectiveTo: null }, { effectiveTo: { gte: now } }],
        },
      },
    })
    // The test the engine applies, restated so the two cannot drift: a rule
    // dated to start tomorrow is not in force today.
    const rules = [
      {
        effectiveFrom: new Date('2026-10-08T00:00:00.000Z'),
        effectiveTo: null,
      },
    ]
    expect(ruleInForce(rules as never, now)).toBeNull()
  })

  it('counts a blank phone, and no truck', () => {
    expect(driverHealthWhere('phone', now)).toEqual({
      OR: [{ phone: { equals: null } }, { phone: { equals: '' } }],
    })
    expect(driverHealthWhere('truck', now)).toEqual({ assignedTruckId: null })
  })

  it('uses the same definitions in the SQL the counts run', () => {
    const source = readFileSync(join('src', 'lib', 'data-health.ts'), 'utf8')
    expect(source).toContain(`ci.type = 'CDL'`)
    expect(source).toContain(`ci.type = 'MEDICAL_CARD'`)
    expect(source).toContain(`d.phone IS NULL OR btrim(d.phone) = ''`)
    expect(source).toContain(`r."effectiveFrom" <= \${now}`)
    expect(source).toContain(
      `(r."effectiveTo" IS NULL OR r."effectiveTo" >= \${now})`,
    )
    expect(source).toContain(`d."assignedTruckId" IS NULL`)
    expect(source).toContain(`d.kind <> 'PAYEE'`)
    expect(source).toContain(
      `d.status IN ('AVAILABLE', 'DISPATCHED', 'ON_ROUTE', 'OFF_DUTY')`,
    )
  })

  it('sits under the Drivers grid with the same row, filter and links', () => {
    const page = readFileSync(
      join('src', 'app', '(app)', 'drivers', 'page.tsx'),
      'utf8',
    )
    expect(page).toMatch(/countDriverHealth\(\s*tx,/)
    expect(page).toContain('driverHealthWhere(')
    expect(page).toContain('driverHealthBase()')
    expect(page).toContain('<DataHealthRow')
    expect(page).toContain("from '../_grid/DataHealthRow'")
  })
})
