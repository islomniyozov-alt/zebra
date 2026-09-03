import { describe, expect, it } from 'vitest'
import { newestFirst, type Timed } from '@/lib/load-timeline'

// ---------------------------------------------------------------------------
// THE ORDER, WHICH IS THE ONLY THING THAT CAN GO WRONG HERE.
//
// Item 8 merged notes into the status timeline. Every entry on the merged list
// is real and present whatever the comparator does — so a broken sort does not
// look broken. It looks like a history in a sequence nobody checked.
//
// The specific failure this is written against: sorting the RENDERED time
// strings instead of the instants. "Sep 2, 8:04 PM" against "Sep 2, 11:12 AM"
// sorts the evening first alphabetically and the morning first by clock, and
// both look like an answer.
// ---------------------------------------------------------------------------

const at = (iso: string, value: string): Timed<string> => ({
  at: new Date(iso),
  value,
})

describe('merging a load history', () => {
  it('puts the newest entry first across both groups', () => {
    const status = [
      at('2026-09-02T20:04:00Z', 'delivered'),
      at('2026-09-01T11:12:00Z', 'booked'),
    ]
    const notes = [at('2026-09-02T09:30:00Z', 'note: driver called')]

    expect(newestFirst(status, notes)).toEqual([
      'delivered',
      'note: driver called',
      'booked',
    ])
  })

  // THE TRAP, STATED AS A TEST. These two render as "8:04 PM" and "11:12 AM";
  // sorted as text the evening wins, which is also the right answer here for
  // the wrong reason — so the pair below uses times where text and chronology
  // DISAGREE.
  it('orders by the instant, not by how the time reads', () => {
    const morning = at('2026-09-02T11:12:00Z', 'later, reads earlier')
    const evening = at('2026-09-02T09:04:00Z', 'earlier, reads later')

    // "09:04" sorts after "11:12" as text descending; by clock it comes second.
    expect(newestFirst([morning, evening])).toEqual([
      'later, reads earlier',
      'earlier, reads later',
    ])
  })

  it('keeps the caller order when two entries share an instant', () => {
    const moment = '2026-09-02T20:04:00Z'
    const status = [at(moment, 'status')]
    const notes = [at(moment, 'note')]

    // A status event and the note explaining it are written in one transaction
    // and can land on the same millisecond. Whatever the answer is, it must be
    // the same on every render.
    expect(newestFirst(status, notes)).toEqual(['status', 'note'])
    expect(newestFirst(status, notes)).toEqual(['status', 'note'])
  })

  it('handles a group being empty, which is the broker screen', () => {
    const status = [at('2026-09-02T20:04:00Z', 'delivered')]
    expect(newestFirst(status, [])).toEqual(['delivered'])
    expect(newestFirst([], [])).toEqual([])
  })
})
