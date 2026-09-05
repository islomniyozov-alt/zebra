/**
 * @vitest-environment jsdom
 */
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import {
  StatusTimeline,
  type TimelineEntry,
} from '@/app/(app)/loads/[id]/StatusTimeline'
import { StopsTable } from '@/app/(app)/loads/[id]/StopsTable'
import { PipelineStrip } from '@/app/(app)/loads/[id]/PipelineStrip'
import {
  ActivityPanel,
  humaniseField,
} from '@/app/(app)/loads/[id]/ActivityPanel'
import { activityEntries } from '@/lib/load-activity'

// ---------------------------------------------------------------------------
// TWO CLAIMS ABOUT ORDER AND PRESENCE, WHICH REVIEW CANNOT SEE.
//
// Both of these came back from live use, and both are the kind of defect that
// reads as correct in a diff. "The composer is between the heading and the
// entries" is a fact about rendered order that a component's source shows only
// if you hold the whole JSX tree in your head; "the em dash is unexplained" is
// a fact about something MISSING, which no diff can show at all.
//
// So they are asserted against a DOM. `compareDocumentPosition` is the check
// that survives restyling: it asks which element comes first in the document,
// not which class either of them carries.
// ---------------------------------------------------------------------------

afterEach(cleanup)

const timelineLabels = {
  title: 'Status history',
  manual: 'Manually',
  automatic: 'Automatically',
  driverPortal: 'Driver portal',
  integration: 'Integration',
  refused: 'Refused',
  refusedBody: 'refused',
  by: 'by',
  empty: 'Nothing yet.',
}

const statusLabels = { DELIVERED: 'Delivered' }

describe('the status history panel', () => {
  const entry: TimelineEntry = {
    kind: 'note',
    id: 'n1',
    at: '10:00',
    by: 'Islom',
    body: 'Trailer swapped at DFW7',
  }

  it('puts the note composer after the entries, not between them and the heading', () => {
    render(
      <StatusTimeline
        entries={[entry]}
        composer={<button type="button">Post note</button>}
        statusLabels={statusLabels}
        labels={timelineLabels}
      />,
    )

    const heading = screen.getByText('Status history')
    const entryText = screen.getByText('Trailer swapped at DFW7')
    const composer = screen.getByRole('button', { name: 'Post note' })

    // DOCUMENT_POSITION_FOLLOWING === 4: the argument comes after the node.
    expect(heading.compareDocumentPosition(entryText) & 4).toBeTruthy()
    expect(entryText.compareDocumentPosition(composer) & 4).toBeTruthy()
  })

  it('renders no composer for a role that may not write one', () => {
    render(
      <StatusTimeline
        entries={[entry]}
        statusLabels={statusLabels}
        labels={timelineLabels}
      />,
    )
    expect(screen.queryByRole('button')).toBeNull()
  })
})

describe('the stops table', () => {
  const labels = {
    title: 'Stops',
    position: 'Position',
    location: 'Location',
    checkedInAt: 'Checked in at',
    checkedInBy: 'Checked in by',
    checkedOutAt: 'Checked out at',
    checkedOutBy: 'Checked out by',
    scheduled: 'Schedule time',
    waiting: 'Waiting',
    empty: 'No stops on this load.',
    unattributed: 'An em dash means no recorded author.',
  }

  const stop = {
    id: 's1',
    position: '1 · PICKUP',
    location: 'DFW7',
    place: null,
    checkedInAt: '08:14',
    // WHAT THE LEGEND IS ABOUT: an imported trip stamps the clock and leaves
    // no author, so this column is dashes on every row of a correct load.
    checkedInBy: '—',
    checkedOutAt: '09:02',
    checkedOutBy: '—',
    scheduled: '08:00',
    waiting: '48m',
    address: null,
  }

  it('explains the em dash under the table when there are rows', () => {
    render(<StopsTable stops={[stop]} labels={labels} />)
    const legend = screen.getByText(labels.unattributed)
    const table = screen.getByRole('table')
    expect(table.compareDocumentPosition(legend) & 4).toBeTruthy()
  })

  it('does not explain a dash nobody can see', () => {
    // An empty table has no "by" column on screen, so the note would be
    // answering a question the reader has not been asked.
    render(<StopsTable stops={[]} labels={labels} />)
    expect(screen.queryByText(labels.unattributed)).toBeNull()
  })
})

describe('the load tracker strip', () => {
  const labels = {
    title: 'Load tracker',
    cancelled: 'Cancelled',
    upcoming: 'Upcoming',
    inTransit: 'In-Transit',
    delivered: 'Delivered',
    invoiced: 'Invoiced',
    paid: 'Paid',
  }

  it('marks exactly one stage as current', () => {
    render(
      <PipelineStrip stage="delivered" cancelled={false} labels={labels} />,
    )
    const current = document.querySelectorAll('[aria-current="step"]')
    expect(current).toHaveLength(1)
    expect(current[0]?.textContent).toContain('Delivered')
  })

  it('shows all five words on every load, in order', () => {
    render(<PipelineStrip stage="upcoming" cancelled={false} labels={labels} />)
    const items = [...document.querySelectorAll('li')].map((li) =>
      li.textContent?.trim(),
    )
    expect(items).toEqual([
      'Upcoming',
      'In-Transit',
      'Delivered',
      'Invoiced',
      'Paid',
    ])
  })

  // NOT COLOUR ALONE. The current stage must be findable without reading a
  // hue — by the ARIA marker for a screen reader, and by weight for an eye
  // that cannot tell the two blues apart.
  it('marks the current stage by something other than colour', () => {
    render(<PipelineStrip stage="paid" cancelled={false} labels={labels} />)
    const current = document.querySelector('[aria-current="step"]')
    expect(current?.querySelector('.font-medium')?.textContent).toBe('Paid')
  })

  it('claims no stage at all on a cancelled load', () => {
    render(<PipelineStrip stage="inTransit" cancelled labels={labels} />)
    expect(document.querySelector('[aria-current="step"]')).toBeNull()
    expect(screen.getByText('Cancelled')).toBeTruthy()
    // And it still shows the five words, so the strip does not vanish.
    expect(document.querySelectorAll('li')).toHaveLength(5)
  })
})

describe('the activity panel', () => {
  const labels = {
    title: 'Activity',
    empty: 'Nothing recorded on this load yet.',
    created: 'Created',
    deleted: 'Deleted',
    via: 'Integration',
    truncated: 'Older activity exists and is not shown.',
    set: 'set',
    cleared: 'cleared',
    changed: 'changed',
    field: humaniseField,
  }

  const panel = (
    entries: ReturnType<typeof activityEntries>,
    truncated = false,
  ) =>
    render(
      <ActivityPanel
        entries={entries}
        truncated={truncated}
        locale="en-US"
        timeZone="America/Chicago"
        labels={labels}
      />,
    )

  const row = (over: Record<string, unknown> = {}) => ({
    id: 'a1',
    createdAt: new Date('2026-09-05T12:00:00Z'),
    action: 'UPDATE',
    entityType: 'Load',
    entityId: 'l1',
    userAgent: null,
    user: { name: 'Islom' },
    changes: { dispatchedMiles: { from: 100, to: 420 } },
    ...over,
  })

  it('shows a field change as from and to', () => {
    panel(activityEntries([row()], { maySeeMoney: true }))
    expect(screen.getByText('Dispatched miles')).toBeTruthy()
    expect(screen.getByText('100 → 420')).toBeTruthy()
  })

  // THE WHOLE POINT OF THE PANEL'S FILTER, ASSERTED AT THE SCREEN.
  // load-activity.test.ts pins the function; this pins that the rendered
  // output of the real pipeline carries no trace of the money row.
  it('renders nothing at all from a money-only row for a reader without financials', () => {
    const entries = activityEntries(
      [row({ changes: { linehaulCents: { from: 100000, to: 250000 } } })],
      { maySeeMoney: false },
    )
    const { container } = panel(entries)
    expect(container.textContent).not.toContain('250000')
    expect(container.textContent).not.toContain('2500')
    expect(container.textContent).not.toContain('Linehaul')
    // And the row is gone entirely — not an empty "Islom updated this load".
    expect(container.textContent).not.toContain('Islom')
    expect(screen.getByText(labels.empty)).toBeTruthy()
  })

  it('says "created" instead of listing every column a new load set', () => {
    const entries = activityEntries(
      [
        row({
          action: 'CREATE',
          changes: {
            loadNumber: { from: null, to: '1010' },
            equipmentType: { from: null, to: 'DRY_VAN' },
          },
        }),
      ],
      { maySeeMoney: true },
    )
    panel(entries)
    expect(screen.getByText('Created')).toBeTruthy()
    expect(screen.queryByText('Load number')).toBeNull()
  })

  it('describes a foreign key without printing the uuid', () => {
    const entries = activityEntries(
      [
        row({
          changes: {
            truckId: {
              from: null,
              to: '8f3ac1de-0000-4000-8000-000000000000',
            },
          },
        }),
      ],
      { maySeeMoney: true },
    )
    const { container } = panel(entries)
    expect(screen.getByText('Truck')).toBeTruthy()
    expect(screen.getByText('set')).toBeTruthy()
    expect(container.textContent).not.toContain('8f3ac1de')
  })

  it('says so when the window is full, and stays quiet when it is not', () => {
    const entries = activityEntries([row()], { maySeeMoney: true })
    const full = panel(entries, true)
    expect(full.container.textContent).toContain(labels.truncated)
    cleanup()
    const partial = panel(entries, false)
    expect(partial.container.textContent).not.toContain(labels.truncated)
  })

  it('never says how an unstamped write reached us', () => {
    const { container } = panel(activityEntries([row()], { maySeeMoney: true }))
    expect(container.textContent).toContain('Islom')
    expect(container.textContent).not.toContain('Integration')
  })

  it('names the integration when it stamped itself', () => {
    const entries = activityEntries(
      [row({ userAgent: 'zebra-relay-trips-import' })],
      { maySeeMoney: true },
    )
    const { container } = panel(entries)
    expect(container.textContent).toContain('Integration')
  })
})

describe('humaniseField', () => {
  it('turns a column name into a sentence', () => {
    expect(humaniseField('operationalStatus')).toBe('Operational status')
    expect(humaniseField('arrivedAt')).toBe('Arrived at')
  })

  it('drops storage suffixes', () => {
    expect(humaniseField('linehaulCents')).toBe('Linehaul')
    expect(humaniseField('truckId')).toBe('Truck')
  })

  it('keeps a name that is entirely suffix', () => {
    expect(humaniseField('id')).toBe('Id')
  })
})
