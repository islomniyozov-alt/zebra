import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { stopRowsFrom } from '@/app/(app)/loads/new/prefill'
import type { Prefill } from '@/app/(app)/loads/new/RateConOffer'

// ---------------------------------------------------------------------------
// AN APPOINTMENT SURVIVES THE FORM.
//
// A reading with `scheduledAt` and NO window used to arrive as a bare date.
// Two things conspired, and each looked correct alone:
//
//   `typedDateFrom` sliced the first ten characters — the day, never the clock
//   `timeFrom` read windowStart/windowEnd only, which Relay does not print
//
// So "08/14 03:45" reached a date box and two empty clock boxes. And because
// `stopDate` returned midnight regardless, the load SAVED with a stop time of
// 00:00 — the appointment discarded by a form that had no field for it.
//
// IT WAS FLAGGED ONCE AND CAME BACK, because the visible symptom was two empty
// boxes and the obvious fix fills them in. Filling them in would have written
// the appointment into `windowStart` and left `scheduledAt` at midnight: a
// form that looks right over a board that still sorts wrong.
//
// SO THIS TESTS THE ROUND TRIP, NOT THE RENDER. A reading goes in; the value
// the SAVE would receive comes out. That is the claim nobody had written down,
// and the only one that would have caught this before it shipped twice.
// ---------------------------------------------------------------------------

const field = (value: unknown) => ({ value, confidence: 'high' as const })

/** A reading shaped like the real T-112WMNZCX booking: appointment, no window. */
function reading(over: Record<string, unknown> = {}): Prefill {
  return {
    pendingUploadId: '',
    lowConfidence: [],
    cost: '',
    extracted: {
      stops: [
        {
          type: field('PICKUP'),
          city: field('ROSSFORD'),
          state: field('OH'),
          scheduledAt: field('2026-08-14T03:45'),
          windowStart: null,
          windowEnd: null,
          ...over,
        },
        {
          type: field('DELIVERY'),
          city: field('JOLIET'),
          state: field('IL'),
          scheduledAt: field('2026-08-14T09:08'),
          windowStart: null,
          windowEnd: null,
        },
      ],
    },
  } as unknown as Prefill
}

const blank = [
  { key: 'stop-0', type: 'PICKUP' as const, date: '', from: '', to: '' },
  { key: 'stop-1', type: 'DELIVERY' as const, date: '', from: '', to: '' },
]

const rows = (prefill: Prefill) =>
  stopRowsFrom(prefill, blank, () => 'stop-x') ?? []

describe('what the form receives from a reading with no window', () => {
  it('puts the appointment clock in the From field', () => {
    // THE BUG, AS ONE ASSERTION. This was '' for as long as the field existed.
    expect(rows(reading())[0]?.from).toBe('03:45')
    expect(rows(reading())[1]?.from).toBe('09:08')
  })

  it('still carries the date', () => {
    expect(rows(reading())[0]?.date).toBe('2026-08-14')
  })

  it('leaves To empty, because one time is not a window', () => {
    // Rule 1 of the extraction contract: a window needs two DIFFERENT ends, so
    // the reader does not invent one and neither does this.
    expect(rows(reading())[0]?.to).toBe('')
  })

  it('prefers a printed window over the appointment', () => {
    const withWindow = reading({
      windowStart: field('2026-08-14T08:00'),
      windowEnd: field('2026-08-14T10:00'),
    })
    expect(rows(withWindow)[0]?.from).toBe('08:00')
    expect(rows(withWindow)[0]?.to).toBe('10:00')
  })

  it('never overwrites a clock the dispatcher already typed', () => {
    const typed = [{ ...blank[0]!, from: '06:30' }, blank[1]!]
    const kept = stopRowsFrom(reading(), typed, () => 'stop-x') ?? []
    expect(kept[0]?.from).toBe('06:30')
  })
})

describe('and what the SAVE does with it — the half that was missing', () => {
  const actions = readFileSync('src/app/(app)/loads/new/actions.ts', 'utf8')

  it('builds scheduledAt from the date AND the clock', () => {
    // `stopDate(stop.date, place)` returned midnight and ignored the time, so
    // every load booked from a Relay draft had a 00:00 stop on the board.
    expect(actions).toMatch(
      /scheduledAt: stopDate\(stop\.date, places\[index\]!, stop\.from\)/,
    )
  })

  it('keeps midnight for a date with no clock', () => {
    // The ordinary typed load. Inventing 09:00 for a bare date would be a
    // number about freight that nobody wrote down.
    const fn = actions.slice(
      actions.indexOf('function stopDate('),
      actions.indexOf('const COMPANY_FALLBACK_ZONE'),
    )
    expect(fn).toContain('return zoneMidnight(iso, zone)')
    expect(fn).toMatch(/if \(typed !== null\)/)
  })

  it('still writes the window to its own columns', () => {
    // scheduledAt learning the clock must not cost the window its home.
    expect(actions).toMatch(
      /windowStart: stopMoment\(stop\.date, stop\.from, places\[index\]!\)/,
    )
  })
})
