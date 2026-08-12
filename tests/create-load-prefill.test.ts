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
        { key: 'stop-0', type: 'PICKUP', date: '' },
        { key: 'stop-1', type: 'DELIVERY', date: '' },
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
        { key: 'stop-0', type: 'PICKUP', date: '2026-01-01' },
        { key: 'stop-1', type: 'DELIVERY', date: '' },
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
        { key: 'stop-0', type: 'PICKUP', date: '' },
        { key: 'stop-1', type: 'DELIVERY', date: '' },
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
