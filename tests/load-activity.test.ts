import { describe, expect, it } from 'vitest'
import {
  activityEntries,
  INTEGRATION_USER_AGENT,
  type ActivityRow,
} from '@/lib/load-activity'

// ---------------------------------------------------------------------------
// AUDIT ROWS, READ BY SOMEBODY WHO WAS NEVER MEANT TO SEE ALL OF THEM.
//
// The Activity panel is the first thing to display `AuditLog.changes`, and the
// rows were written without regard to who would read them. A dispatcher cannot
// open the Rate panel; the timeline beside it must not narrate the rate.
//
// THE RULE IS OMISSION, NOT MASKING. "Linehaul: hidden" is the leak with a
// costume on — it says money changed, when, and by whom. So is "Owner updated
// this load" with an empty body.
// ---------------------------------------------------------------------------

const row = (over: Partial<ActivityRow> = {}): ActivityRow => ({
  id: 'a1',
  createdAt: new Date('2026-09-03T12:00:00Z'),
  action: 'UPDATE',
  entityType: 'Load',
  userAgent: 'Mozilla/5.0',
  user: { name: 'Aziz' },
  changes: { dispatchedMiles: { from: 681, to: 4 } },
  ...over,
})

const OWNER = { maySeeMoney: true }
const DISPATCHER = { maySeeMoney: false }

describe('what a dispatcher is shown', () => {
  it('keeps the operational fields', () => {
    const [entry] = activityEntries([row()], DISPATCHER)
    expect(entry?.diffs).toEqual([
      { field: 'dispatchedMiles', from: 681, to: 4 },
    ])
  })

  // THE ASSERTION THIS FILE EXISTS FOR.
  it('omits a money field entirely rather than masking it', () => {
    const [entry] = activityEntries(
      [
        row({
          changes: {
            dispatchedMiles: { from: 681, to: 4 },
            linehaulCents: { from: 100_000, to: 150_000 },
          },
        }),
      ],
      DISPATCHER,
    )

    expect(entry?.diffs.map((diff) => diff.field)).toEqual(['dispatchedMiles'])
    // Not the value, and not the NAME either — "linehaul changed" is the leak.
    expect(JSON.stringify(entry)).not.toContain('linehaul')
    expect(JSON.stringify(entry)).not.toContain('150000')
  })

  // A ROW THAT LOSES EVERYTHING GOES. Otherwise the panel says money moved,
  // when, and who moved it, and withholds only the amount.
  it('drops a row whose every field was money', () => {
    expect(
      activityEntries(
        [row({ changes: { linehaulCents: { from: 1, to: 2 } } })],
        DISPATCHER,
      ),
    ).toEqual([])
  })

  it('shows the owner the same row in full', () => {
    const [entry] = activityEntries(
      [row({ changes: { linehaulCents: { from: 100_000, to: 150_000 } } })],
      OWNER,
    )
    expect(entry?.diffs).toEqual([
      { field: 'linehaulCents', from: 100_000, to: 150_000 },
    ])
  })
})

describe('how the write reached us', () => {
  // NEVER CLAIM A HUMAN DID IT. An audit row carries an actor and no source.
  // The ~13 loads imported before the stamp existed would otherwise read as a
  // dispatcher having checked in stops that a file wrote.
  it('says nothing about how when it does not know', () => {
    const [entry] = activityEntries([row({ userAgent: 'Mozilla/5.0' })], OWNER)
    expect(entry?.actor).toBe('Aziz')
    expect(entry?.via).toBeNull()
  })

  it('says nothing about how when there is no user agent at all', () => {
    const [entry] = activityEntries([row({ userAgent: null })], OWNER)
    expect(entry?.via).toBeNull()
  })

  it('names the integration when the importer stamped it', () => {
    const [entry] = activityEntries(
      [row({ userAgent: INTEGRATION_USER_AGENT })],
      OWNER,
    )
    expect(entry?.via).toBe('integration')
  })

  it('carries a null actor rather than inventing one', () => {
    const [entry] = activityEntries([row({ user: null })], OWNER)
    expect(entry?.actor).toBeNull()
  })
})

describe('the shape of the list', () => {
  it('is newest first regardless of how the query returned it', () => {
    const older = row({
      id: 'old',
      createdAt: new Date('2026-09-01T09:00:00Z'),
    })
    const newer = row({
      id: 'new',
      createdAt: new Date('2026-09-03T18:00:00Z'),
    })
    expect(activityEntries([older, newer], OWNER).map((e) => e.id)).toEqual([
      'new',
      'old',
    ])
  })

  it('drops the fields that change on every write and mean nothing', () => {
    const [entry] = activityEntries(
      [
        row({
          changes: {
            updatedAt: { from: 'a', to: 'b' },
            dispatchedMiles: { from: 1, to: 2 },
          },
        }),
      ],
      OWNER,
    )
    expect(entry?.diffs.map((diff) => diff.field)).toEqual(['dispatchedMiles'])
  })

  it('survives a row whose changes are absent or malformed', () => {
    expect(activityEntries([row({ changes: null })], OWNER)).toEqual([])
    expect(activityEntries([row({ changes: 'nonsense' })], OWNER)).toEqual([])
    expect(
      activityEntries([row({ changes: { field: 'not a pair' } })], OWNER),
    ).toEqual([])
  })
})
