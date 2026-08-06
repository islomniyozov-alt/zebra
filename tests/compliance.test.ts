import { describe, expect, it } from 'vitest'
import {
  daysUntil,
  shapeRecords,
  statusFor,
  TRACKED_TYPES,
} from '@/lib/compliance'
import type { ComplianceType } from '@/generated/prisma/client'

// ---------------------------------------------------------------------------
// THE ONE DERIVATION. §4's first acceptance box asks that the queue, the
// dashboard row and the asset panel all agree — they do because they all call
// this, so this is where it has to be right.
//
// The failure that matters is a day either way: a truck grounded a day early
// annoys a dispatcher, a truck dispatched a day late is an out-of-service
// order at a scale house.
// ---------------------------------------------------------------------------

const NOON = new Date('2026-08-06T12:00:00Z')

const row = (
  over: Partial<Parameters<typeof shapeRecords>[0][number]> = {},
) => ({
  id: 'r1',
  companyId: 'c1',
  type: 'ANNUAL_INSPECTION' as ComplianceType,
  identifier: null,
  issuer: null,
  issuedAt: null,
  expiresAt: new Date('2026-09-01T00:00:00Z'),
  notes: null,
  company: { name: 'RAM Haulage' },
  truck: { id: 't1', unitNumber: '104' },
  trailer: null,
  driver: null,
  _count: { documents: 0 },
  ...over,
})

describe('how many days are left', () => {
  it('floors both ends to midnight, so the answer does not drift over lunch', () => {
    // An item expiring today reads 0 at 9am and 0 at 6pm. Without the floor it
    // would be 0 in the morning and -0.4 in the afternoon, and "expires today"
    // would flip to "expired" while somebody was at lunch.
    const today = new Date('2026-08-06T23:00:00Z')
    expect(daysUntil(today, new Date('2026-08-06T09:00:00Z'))).toBe(0)
    expect(daysUntil(today, new Date('2026-08-06T18:00:00Z'))).toBe(0)
  })

  it('counts forward and backward', () => {
    expect(daysUntil(new Date('2026-08-07T00:00:00Z'), NOON)).toBe(1)
    expect(daysUntil(new Date('2026-08-05T00:00:00Z'), NOON)).toBe(-1)
    expect(daysUntil(new Date('2026-09-05T00:00:00Z'), NOON)).toBe(30)
  })

  it('crosses a month and a year boundary without arithmetic of its own', () => {
    expect(
      daysUntil(
        new Date('2027-01-01T00:00:00Z'),
        new Date('2026-12-31T00:00:00Z'),
      ),
    ).toBe(1)
    // 2028 is a leap year: 29 February exists and the count has to include it.
    expect(
      daysUntil(
        new Date('2028-03-01T00:00:00Z'),
        new Date('2028-02-01T00:00:00Z'),
      ),
    ).toBe(29)
  })
})

describe('current, expiring, expired', () => {
  const lead = 30

  it('EXPIRES TODAY IS EXPIRING, NOT EXPIRED', () => {
    // A registration valid through the 31st is valid ON the 31st. Calling it
    // expired that morning grounds a truck a day early, and a compliance
    // screen that cries wolf is a screen people learn to click past.
    expect(statusFor(new Date('2026-08-06T00:00:00Z'), lead, NOON)).toBe(
      'expiring',
    )
  })

  it('is expired the day after', () => {
    expect(statusFor(new Date('2026-08-05T00:00:00Z'), lead, NOON)).toBe(
      'expired',
    )
  })

  it('turns expiring exactly on the lead-time boundary, not a day either side', () => {
    // §4: "appears in the queue exactly `leadTime` days out". 30 days out is
    // in; 31 is not.
    expect(statusFor(new Date('2026-09-05T00:00:00Z'), 30, NOON)).toBe(
      'expiring',
    )
    expect(statusFor(new Date('2026-09-06T00:00:00Z'), 30, NOON)).toBe(
      'current',
    )
  })

  it('honours a lead time of zero — warn only once it is due', () => {
    expect(statusFor(new Date('2026-08-06T00:00:00Z'), 0, NOON)).toBe(
      'expiring',
    )
    expect(statusFor(new Date('2026-08-07T00:00:00Z'), 0, NOON)).toBe('current')
  })
})

describe('what a newer record supersedes', () => {
  it('marks the older record of the same type on the same asset', () => {
    // §2.1: a renewal supersedes, it does not overwrite. Both rows survive and
    // the old one is labelled — which is what makes "nothing overwritten"
    // visible rather than merely true.
    const shaped = shapeRecords(
      [
        row({ id: 'old', expiresAt: new Date('2026-08-01T00:00:00Z') }),
        row({ id: 'new', expiresAt: new Date('2027-08-01T00:00:00Z') }),
      ],
      30,
      NOON,
    )

    expect(shaped.find((r) => r.id === 'old')?.isSuperseded).toBe(true)
    expect(shaped.find((r) => r.id === 'new')?.isSuperseded).toBe(false)
    // And the old one is still expired — being superseded does not rewrite the
    // date, it only says somebody has already dealt with it.
    expect(shaped.find((r) => r.id === 'old')?.status).toBe('expired')
  })

  it('does not supersede across types', () => {
    // A new medical card does not renew a CDL. Obvious, and exactly the kind
    // of thing a key built from the wrong fields gets wrong.
    const shaped = shapeRecords(
      [
        row({
          id: 'cdl',
          type: 'CDL',
          expiresAt: new Date('2026-08-01T00:00:00Z'),
        }),
        row({
          id: 'medical',
          type: 'MEDICAL_CARD',
          expiresAt: new Date('2027-08-01T00:00:00Z'),
        }),
      ],
      30,
      NOON,
    )
    expect(shaped.every((r) => r.isSuperseded === false)).toBe(true)
  })

  it('does not supersede across assets', () => {
    // Truck 104's new inspection says nothing about truck 205.
    const shaped = shapeRecords(
      [
        row({
          id: 'a',
          truck: { id: 't1', unitNumber: '104' },
          expiresAt: new Date('2026-08-01T00:00:00Z'),
        }),
        row({
          id: 'b',
          truck: { id: 't2', unitNumber: '205' },
          expiresAt: new Date('2027-08-01T00:00:00Z'),
        }),
      ],
      30,
      NOON,
    )
    expect(shaped.every((r) => r.isSuperseded === false)).toBe(true)
  })

  it('keeps both where two records share an expiry', () => {
    // A tie is a data problem — two live registrations for one truck. Picking
    // one silently would hide it; neither is marked superseded, so both show.
    const shaped = shapeRecords(
      [
        row({ id: 'a', expiresAt: new Date('2027-01-01T00:00:00Z') }),
        row({ id: 'b', expiresAt: new Date('2027-01-01T00:00:00Z') }),
      ],
      30,
      NOON,
    )
    expect(shaped.every((r) => r.isSuperseded === false)).toBe(true)
  })
})

describe('what the row says', () => {
  it('names the subject the way a person calls it', () => {
    const [truck] = shapeRecords([row()], 30, NOON)
    expect(truck).toMatchObject({ subject: 'truck', subjectLabel: '104' })

    const [driver] = shapeRecords(
      [
        row({
          truck: null,
          driver: { id: 'd1', firstName: 'Ahmad', lastName: 'Karimov' },
        }),
      ],
      30,
      NOON,
    )
    expect(driver).toMatchObject({
      subject: 'driver',
      subjectLabel: 'Ahmad Karimov',
    })
  })

  it('drops a record attached to nothing rather than rendering a dash', () => {
    // All three subject columns are nullable, so the row can exist. It cannot
    // be shown against an asset, because there is no asset.
    expect(
      shapeRecords(
        [row({ truck: null, trailer: null, driver: null })],
        30,
        NOON,
      ),
    ).toEqual([])
  })

  it('tracks the six the owner named, and leaves the enum alone', () => {
    // §1: drug & alcohol was deliberately not selected. It is already IN the
    // enum — nothing to widen — and it is simply not one of the tracked types,
    // so no screen offers it.
    expect(TRACKED_TYPES).not.toContain('DRUG_TEST')
    expect(TRACKED_TYPES).toContain('ANNUAL_INSPECTION')
    expect(TRACKED_TYPES).toContain('CDL')
    expect(TRACKED_TYPES).toContain('MEDICAL_CARD')
  })
})
