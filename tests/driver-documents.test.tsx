/**
 * @vitest-environment jsdom
 */
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { DriverDocuments } from '@/app/(app)/_reference/DriverDocuments'

// ---------------------------------------------------------------------------
// A PARKED CARD IS VISIBLE, IN WORDS (owner's ruling, 2026-09-12).
//
// The rotation step refuses to read a card nobody turned upright, and the
// cancel path keeps the file rather than dropping it — because dropping it
// trades a wrong reading for a silent non-event, where a dispatcher
// photographs a card, cancels, and the driver's compliance is as stale as
// before with nothing anywhere saying so.
//
// KEEPING IT ONLY HELPS IF IT SHOWS. A file that exists and appears on no
// screen is worse than one that was never kept: it is storage nobody is going
// to act on. So this asserts the words, not the row count.
// ---------------------------------------------------------------------------

const LABELS = {
  heading: 'Documents',
  none: 'No documents on this driver.',
  needsRotation: 'not read — needs rotation',
}

const at = (iso: string) => new Date(`${iso}T00:00:00.000Z`)

afterEach(cleanup)

describe('the driver document list', () => {
  it('says a parked card needs rotation, in words', () => {
    render(
      <DriverDocuments
        documents={[
          {
            id: 'a',
            filename: 'med-card.jpg',
            needsRotation: true,
            uploadedAt: at('2026-09-12'),
          },
        ]}
        labels={LABELS}
      />,
    )
    expect(screen.getByText('med-card.jpg')).toBeTruthy()
    // THE WORDS, not a missing tick. A row that merely lacked a badge would
    // read as "fine" at a glance, which is the opposite of what it is.
    expect(screen.getByText(LABELS.needsRotation)).toBeTruthy()
  })

  it('does not label a document that was read', () => {
    render(
      <DriverDocuments
        documents={[
          {
            id: 'b',
            filename: 'read-fine.jpg',
            needsRotation: false,
            uploadedAt: at('2026-09-11'),
          },
        ]}
        labels={LABELS}
      />,
    )
    expect(screen.getByText('read-fine.jpg')).toBeTruthy()
    expect(screen.queryByText(LABELS.needsRotation)).toBeNull()
  })

  it('says the list is empty rather than rendering nothing', () => {
    // An empty state says what is absent — the standing rule. A panel that
    // vanished when a driver had no documents would look like a missing
    // feature rather than like an answer.
    render(<DriverDocuments documents={[]} labels={LABELS} />)
    expect(screen.getByText(LABELS.none)).toBeTruthy()
  })

  it('shows a parked card among read ones, not instead of them', () => {
    render(
      <DriverDocuments
        documents={[
          {
            id: 'a',
            filename: 'parked.jpg',
            needsRotation: true,
            uploadedAt: at('2026-09-12'),
          },
          {
            id: 'b',
            filename: 'fine.jpg',
            needsRotation: false,
            uploadedAt: at('2026-09-11'),
          },
        ]}
        labels={LABELS}
      />,
    )
    expect(screen.getByText('parked.jpg')).toBeTruthy()
    expect(screen.getByText('fine.jpg')).toBeTruthy()
    expect(screen.getAllByText(LABELS.needsRotation)).toHaveLength(1)
  })
})
