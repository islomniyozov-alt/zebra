import { describe, expect, it } from 'vitest'
import { INTEGRATION_USER_AGENT, type ActivityRow } from '@/lib/load-activity'
import { attributionLabel, stopAttribution } from '@/lib/stop-attribution'

// ---------------------------------------------------------------------------
// THE "BY" COLUMNS, WHICH THE SCHEMA CANNOT ANSWER ON ITS OWN.
//
// `LoadStop` has no actor column. The audit log has one on every write, so
// "who checked this stop in" is a lookup rather than a migration — and it reads
// the SAME rows the Activity panel reads, so the two cannot come to different
// conclusions about the same load.
//
// The assertion that matters most is the one about not knowing. An audit row
// carries an actor and no source, so a write with an ordinary browser user
// agent tells us WHO and not HOW — and rendering that as "manually" would make
// the loads imported before the stamp existed claim a dispatcher checked in
// stops that a file wrote.
// ---------------------------------------------------------------------------

const row = (over: Partial<ActivityRow> = {}): ActivityRow => ({
  id: 'a1',
  createdAt: new Date('2026-09-03T12:00:00Z'),
  action: 'UPDATE',
  entityType: 'LoadStop',
  entityId: 'stop-1',
  userAgent: 'Mozilla/5.0',
  user: { name: 'Aziz' },
  changes: { arrivedAt: { from: null, to: '2026-08-31T13:17:00Z' } },
  ...over,
})

describe('who wrote a stop clock', () => {
  it('attributes an arrival to the person on the audit row', () => {
    const found = stopAttribution([row()])
    expect(found.get('stop-1')?.arrival).toEqual({ actor: 'Aziz', via: null })
  })

  it('keeps arrival and departure apart', () => {
    const found = stopAttribution([
      row({ id: 'a', changes: { arrivedAt: { from: null, to: 'x' } } }),
      row({
        id: 'b',
        user: { name: 'Dilshod' },
        changes: { departedAt: { from: null, to: 'y' } },
      }),
    ])
    expect(found.get('stop-1')?.arrival?.actor).toBe('Aziz')
    expect(found.get('stop-1')?.departure?.actor).toBe('Dilshod')
  })

  it('keeps stops apart', () => {
    const found = stopAttribution([
      row({ entityId: 'stop-1' }),
      row({ entityId: 'stop-2', user: { name: 'Dilshod' } }),
    ])
    expect(found.get('stop-1')?.arrival?.actor).toBe('Aziz')
    expect(found.get('stop-2')?.arrival?.actor).toBe('Dilshod')
  })

  // LAST WRITE WINS: the question is who put the value that is there NOW.
  // An earlier correction is history and belongs in the timeline.
  it('takes the newest write, whatever order the rows arrive in', () => {
    const found = stopAttribution([
      row({
        id: 'new',
        createdAt: new Date('2026-09-03T18:00:00Z'),
        user: { name: 'Later' },
      }),
      row({
        id: 'old',
        createdAt: new Date('2026-09-01T09:00:00Z'),
        user: { name: 'Earlier' },
      }),
    ])
    expect(found.get('stop-1')?.arrival?.actor).toBe('Later')
  })

  it('ignores writes to anything that is not a stop', () => {
    const found = stopAttribution([
      row({ entityType: 'Load', changes: { arrivedAt: { from: 1, to: 2 } } }),
    ])
    expect(found.size).toBe(0)
  })

  it('ignores a stop write that touched neither clock', () => {
    const found = stopAttribution([
      row({ changes: { city: { from: 'Memphis', to: 'Memphis, TN' } } }),
    ])
    expect(found.size).toBe(0)
  })
})

describe('how the write reached us', () => {
  it('names the integration only when it stamped itself', () => {
    const found = stopAttribution([row({ userAgent: INTEGRATION_USER_AGENT })])
    expect(found.get('stop-1')?.arrival?.via).toBe('integration')
  })

  // THE ONE THAT KEEPS THE COLUMN HONEST.
  it('says nothing about how for an ordinary browser write', () => {
    expect(stopAttribution([row()]).get('stop-1')?.arrival?.via).toBeNull()
  })
})

describe('what the column reads', () => {
  const labels = { via: 'via Integration', unknown: '—' }

  it('names a person plainly', () => {
    expect(attributionLabel({ actor: 'Aziz', via: null }, labels)).toBe('Aziz')
  })

  it('names a person and the integration together', () => {
    expect(
      attributionLabel({ actor: 'Aziz', via: 'integration' }, labels),
    ).toBe('Aziz via Integration')
  })

  it('names the integration alone when no user was recorded', () => {
    expect(attributionLabel({ actor: null, via: 'integration' }, labels)).toBe(
      'via Integration',
    )
  })

  // NOTHING AT ALL IS A REAL ANSWER, and the em dash is the truthful one.
  // "manually" or "system" here would be inventing a fact about a clock
  // nobody recorded the origin of.
  it('says nothing when there is nothing to say', () => {
    expect(attributionLabel(null, labels)).toBe('—')
    expect(attributionLabel(undefined, labels)).toBe('—')
    expect(attributionLabel({ actor: null, via: null }, labels)).toBe('—')
  })
})
