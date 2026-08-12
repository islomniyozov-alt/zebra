import { describe, expect, it } from 'vitest'
import {
  stopRowsFrom,
  stopTypeFrom,
  typedDateFrom,
} from '@/app/(app)/loads/new/prefill'
import type { Prefill } from '@/app/(app)/loads/new/RateConOffer'

// ---------------------------------------------------------------------------
// WHAT THE PREFILL READS OUT OF AN EXTRACTION (Phase 6 §4 steps 1-2).
//
// The paste walkthrough filled three stops with the right types and NO DATES,
// and no amount of reading the code found it. These are the two functions
// between the extraction and the form.
// ---------------------------------------------------------------------------

const prefill = (stops: unknown[]): Prefill =>
  ({
    pendingUploadId: 'pu_1',
    extracted: { stops },
    lowConfidence: [],
    cost: '1.4¢',
  }) as unknown as Prefill

describe('the date a stop starts with', () => {
  it('reads a bare date, which is what a pasted email gives', () => {
    // The extraction returns "2026-08-20" when the words carry no clock time.
    expect(
      typedDateFrom(
        prefill([{ scheduledAt: { value: '2026-08-20', confidence: 'high' } }]),
        'stops[0]',
      ),
    ).toBe('2026-08-20')
  })

  it('and a local ISO instant, which is what a rate confirmation gives', () => {
    expect(
      typedDateFrom(
        prefill([
          { scheduledAt: { value: '2026-08-20T07:00', confidence: 'high' } },
        ]),
        'stops[0]',
      ),
    ).toBe('2026-08-20')
  })

  it('prefers a real window start over the appointment', () => {
    expect(
      typedDateFrom(
        prefill([
          {
            scheduledAt: { value: '2026-08-21T07:00', confidence: 'high' },
            windowStart: { value: '2026-08-20T06:00', confidence: 'high' },
          },
        ]),
        'stops[0]',
      ),
    ).toBe('2026-08-20')
  })

  it('and is not defeated by a windowStart the model sent as EMPTY', () => {
    // THE SUSPECT. `windowStart?.value ?? scheduledAt?.value` falls through on
    // null and undefined — and NOT on an empty string, which slices to "" and
    // normalises to null. A stop with a printed date would then arrive dateless.
    expect(
      typedDateFrom(
        prefill([
          {
            scheduledAt: { value: '2026-08-20', confidence: 'high' },
            windowStart: { value: '', confidence: 'low' },
          },
        ]),
        'stops[0]',
      ),
    ).toBe('2026-08-20')
  })

  it('says nothing when the document carried no date at all', () => {
    expect(
      typedDateFrom(prefill([{ city: { value: 'Carey' } }]), 'stops[0]'),
    ).toBeNull()
  })
})

describe('the type a stop starts with', () => {
  it('is the one the document said', () => {
    expect(stopTypeFrom(prefill([{ type: { value: 'PICKUP' } }]), 0)).toBe(
      'PICKUP',
    )
  })

  it('and null for anything that is not a stop type', () => {
    expect(
      stopTypeFrom(prefill([{ type: { value: 'LOADING' } }]), 0),
    ).toBeNull()
    expect(stopTypeFrom(prefill([{}]), 0)).toBeNull()
  })
})

describe('the rows a prefill produces', () => {
  const mint = () => 'minted'

  it('gives every stop its date, which the paste walkthrough found it did not', () => {
    const rows = stopRowsFrom(
      prefill([
        { type: { value: 'PICKUP' }, scheduledAt: { value: '2026-08-20' } },
        { type: { value: 'PICKUP' }, scheduledAt: { value: '2026-08-20' } },
        { type: { value: 'DELIVERY' }, scheduledAt: { value: '2026-08-22' } },
      ]),
      [
        { key: 'stop-0', type: 'PICKUP', date: '', from: '', to: '' },
        { key: 'stop-1', type: 'DELIVERY', date: '', from: '', to: '' },
      ],
      mint,
    )
    expect(rows?.map((row) => row.date)).toEqual([
      '2026-08-20',
      '2026-08-20',
      '2026-08-22',
    ])
    expect(rows?.map((row) => row.type)).toEqual([
      'PICKUP',
      'PICKUP',
      'DELIVERY',
    ])
  })

  it('keeps a date the dispatcher already typed', () => {
    const rows = stopRowsFrom(
      prefill([
        { scheduledAt: { value: '2026-08-20' } },
        { scheduledAt: { value: '2026-08-22' } },
      ]),
      [
        { key: 'stop-0', type: 'PICKUP', date: '2026-01-01', from: '', to: '' },
        { key: 'stop-1', type: 'DELIVERY', date: '', from: '', to: '' },
      ],
      mint,
    )
    expect(rows?.[0]?.date).toBe('2026-01-01')
    expect(rows?.[1]?.date).toBe('2026-08-22')
  })

  it('reuses the keys of rows already on screen, so inputs are not remounted', () => {
    const rows = stopRowsFrom(
      prefill([
        { city: { value: 'A' } },
        { city: { value: 'B' } },
        { city: { value: 'C' } },
      ]),
      [
        { key: 'stop-0', type: 'PICKUP', date: '', from: '', to: '' },
        { key: 'stop-1', type: 'DELIVERY', date: '', from: '', to: '' },
      ],
      mint,
    )
    expect(rows?.map((row) => row.key)).toEqual(['stop-0', 'stop-1', 'minted'])
  })

  it('and leaves the form alone when the document had fewer than two stops', () => {
    expect(
      stopRowsFrom(prefill([{ city: { value: 'A' } }]), [], mint),
    ).toBeNull()
  })
})

describe('the window, which the columns have waited for since Phase 1', () => {
  const mint = () => 'minted'

  it('fills both ends when the document printed a real window', () => {
    const rows = stopRowsFrom(
      prefill([
        {
          scheduledAt: { value: '2026-08-20T08:00' },
          windowStart: { value: '2026-08-20T08:00' },
          windowEnd: { value: '2026-08-20T10:00' },
        },
        {
          scheduledAt: { value: '2026-08-22T13:00' },
          windowStart: { value: '2026-08-22T13:00' },
          windowEnd: { value: '2026-08-22T17:30' },
        },
      ]),
      [],
      mint,
    )
    expect(rows?.map((row) => [row.date, row.from, row.to])).toEqual([
      ['2026-08-20', '08:00', '10:00'],
      ['2026-08-22', '13:00', '17:30'],
    ])
  })

  it('and leaves it EMPTY for an appointment, which is most stops', () => {
    // Rule 1 of EXTRACTION-CONTRACT.md: one printed time is an appointment,
    // and the reader returns no window at all. The form must not invent one
    // from the appointment either — a window 08:00-08:00 is not a window.
    const rows = stopRowsFrom(
      prefill([
        { scheduledAt: { value: '2026-08-20T11:00' } },
        { scheduledAt: { value: '2026-08-22T23:59' } },
      ]),
      [],
      mint,
    )
    expect(rows?.map((row) => [row.date, row.from, row.to])).toEqual([
      ['2026-08-20', '', ''],
      ['2026-08-22', '', ''],
    ])
  })

  it('keeps a window the dispatcher already typed', () => {
    const rows = stopRowsFrom(
      prefill([
        {
          windowStart: { value: '2026-08-20T08:00' },
          windowEnd: { value: '2026-08-20T10:00' },
        },
        {
          windowStart: { value: '2026-08-22T13:00' },
          windowEnd: { value: '2026-08-22T17:00' },
        },
      ]),
      [
        { key: 'stop-0', type: 'PICKUP', date: '', from: '06:00', to: '' },
        { key: 'stop-1', type: 'DELIVERY', date: '', from: '', to: '' },
      ],
      mint,
    )
    expect(rows?.[0]?.from).toBe('06:00')
    expect(rows?.[0]?.to).toBe('10:00')
  })

  it('reads a date-only value as no time at all', () => {
    // A pasted email gives "2026-08-20" with no clock. The date lands; the
    // window stays empty rather than becoming midnight.
    const rows = stopRowsFrom(
      prefill([
        { windowStart: { value: '2026-08-20' } },
        { windowStart: { value: '2026-08-22' } },
      ]),
      [],
      mint,
    )
    expect(rows?.map((row) => [row.date, row.from])).toEqual([
      ['2026-08-20', ''],
      ['2026-08-22', ''],
    ])
  })
})
