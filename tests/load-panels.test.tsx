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
