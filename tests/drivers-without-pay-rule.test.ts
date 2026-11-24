import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { driversWithoutPayRule } from '@/lib/batch-preview'

// ---------------------------------------------------------------------------
// "DRIVERS WITHOUT A PAY RULE" IN CREATE BATCH (TMS §6.2.10 part 8, owner's
// ruling 2026-11-23, Uktam item 3). The red banner on the Batches page named
// one driver once per trip — "ROSARIO SANTOS RODOLFO — no pay rule in force"
// thirty times. Create batch now says each driver once, with the link that
// fixes it, and the batch is still created without their trips.
// ---------------------------------------------------------------------------

describe('one entry per driver', () => {
  it('folds a driver’s trips into one entry with the count, by name', () => {
    const trip = (driverId: string | null, driverName: string | null) => ({
      driverId,
      driverName,
    })
    expect(
      driversWithoutPayRule([
        trip('d-rosario', 'Rosario Santos Rodolfo'),
        trip('d-ilkhom', 'Ilkhomzhon Gafurov'),
        trip('d-rosario', 'Rosario Santos Rodolfo'),
        trip('d-rosario', 'Rosario Santos Rodolfo'),
        // A trip with no driver is "No driver", never this group.
        trip(null, null),
      ]),
    ).toEqual([
      { driverId: 'd-ilkhom', driverName: 'Ilkhomzhon Gafurov', trips: 1 },
      { driverId: 'd-rosario', driverName: 'Rosario Santos Rodolfo', trips: 3 },
    ])
  })

  it('is empty when every driver has a rule', () => {
    expect(driversWithoutPayRule([])).toEqual([])
  })
})

describe('Create batch renders it', () => {
  const page = readFileSync(
    'src/app/(app)/payroll/batches/new/page.tsx',
    'utf8',
  )

  it('from the noRule trips, with a Set pay rule link to the Accounting tab', () => {
    expect(page).toContain(
      'driversWithoutPayRule(data.preview.unavailable.noRule)',
    )
    expect(page).toContain(
      'href={`/drivers/${driver.driverId}?tab=accounting`}',
    )
    expect(page).toContain("t('preview.setPayRule')")
  })

  it('and Create is not gated on it — the batch goes without them', () => {
    // The disabled condition names authority, range and overlap, and nothing
    // about drivers without a rule.
    const disabled = page.match(/disabled=\{([^}]*)\}/)?.[1] ?? ''
    expect(disabled).toContain('companyId === null')
    expect(disabled).not.toMatch(/noRule/)
  })
})
