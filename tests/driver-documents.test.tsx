/**
 * @vitest-environment jsdom
 */
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
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
  rotateAndRead: 'Rotate and read',
  working: 'Reading…',
  readOk: 'Read from a turned copy.',
  readFailed: 'That card could not be read',
  upright: {
    title: 'Which way up is this card?',
    hint: 'Turn it upright, then read it.',
    rotateLeft: 'Rotate left',
    rotateRight: 'Rotate right',
    read: 'It is upright — read it',
    cancel: 'Choose another photo',
  },
}

/** The panel as the driver page renders it, for somebody who may file. */
const panel = (
  documents: Parameters<typeof DriverDocuments>[0]['documents'],
) => (
  <DriverDocuments
    documents={documents}
    driverId="driver-1"
    mayRead
    labels={LABELS}
  />
)

const at = (iso: string) => new Date(`${iso}T00:00:00.000Z`)

afterEach(cleanup)

describe('the driver document list', () => {
  it('says a parked card needs rotation, in words', () => {
    render(
      panel([
        {
          id: 'a',
          filename: 'med-card.jpg',
          needsRotation: true,
          uploadedAt: at('2026-09-12'),
        },
      ]),
    )
    expect(screen.getByText('med-card.jpg')).toBeTruthy()
    // THE WORDS, not a missing tick. A row that merely lacked a badge would
    // read as "fine" at a glance, which is the opposite of what it is.
    expect(screen.getByText(LABELS.needsRotation)).toBeTruthy()
  })

  it('does not label a document that was read', () => {
    render(
      panel([
        {
          id: 'b',
          filename: 'read-fine.jpg',
          needsRotation: false,
          uploadedAt: at('2026-09-11'),
        },
      ]),
    )
    expect(screen.getByText('read-fine.jpg')).toBeTruthy()
    expect(screen.queryByText(LABELS.needsRotation)).toBeNull()
  })

  it('says the list is empty rather than rendering nothing', () => {
    // An empty state says what is absent — the standing rule. A panel that
    // vanished when a driver had no documents would look like a missing
    // feature rather than like an answer.
    render(panel([]))
    expect(screen.getByText(LABELS.none)).toBeTruthy()
  })

  // ── THE ROTATE-AND-READ CONTROL ───────────────────────────────────────
  //
  // Keeping a parked card only helps if somebody can act on it without
  // photographing the card again — which is the trip the whole feature exists
  // to save. The button is the way out of the state the list reports.
  it('offers rotate-and-read on a parked card', () => {
    render(
      panel([
        {
          id: 'a',
          filename: 'parked.jpg',
          needsRotation: true,
          uploadedAt: at('2026-09-12'),
        },
      ]),
    )
    expect(screen.getByText(LABELS.rotateAndRead)).toBeTruthy()
  })

  it('offers nothing on a card that was already read', () => {
    // A card that was read needs no rotating, and a button on every row would
    // invite somebody to make a second copy of a document for no reason.
    render(
      panel([
        {
          id: 'b',
          filename: 'fine.jpg',
          needsRotation: false,
          uploadedAt: at('2026-09-11'),
        },
      ]),
    )
    expect(screen.queryByText(LABELS.rotateAndRead)).toBeNull()
  })

  it('offers nothing to somebody who may not file compliance', () => {
    // Reading a card to propose a record the reader cannot create is work done
    // for a refusal — the same rule the read routes already apply.
    render(
      <DriverDocuments
        documents={[
          {
            id: 'a',
            filename: 'parked.jpg',
            needsRotation: true,
            uploadedAt: at('2026-09-12'),
          },
        ]}
        driverId="driver-1"
        mayRead={false}
        labels={LABELS}
      />,
    )
    // The state is still VISIBLE — they can see there is work outstanding.
    expect(screen.getByText(LABELS.needsRotation)).toBeTruthy()
    // They just cannot do it.
    expect(screen.queryByText(LABELS.rotateAndRead)).toBeNull()
  })

  it('opens the rotate step rather than reading immediately', async () => {
    // NOBODY IS ASKED TO TRUST A DEFAULT. The card is parked precisely because
    // its orientation is unknown, so pressing the button must ask which way up
    // it is — not guess and read.
    render(
      panel([
        {
          id: 'a',
          filename: 'parked.jpg',
          needsRotation: true,
          uploadedAt: at('2026-09-12'),
        },
      ]),
    )
    await userEvent.click(screen.getByText(LABELS.rotateAndRead))
    expect(screen.getByText(LABELS.upright.title)).toBeTruthy()
    expect(screen.getByText(LABELS.upright.read)).toBeTruthy()
  })

  it('shows a parked card among read ones, not instead of them', () => {
    render(
      panel([
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
      ]),
    )
    expect(screen.getByText('parked.jpg')).toBeTruthy()
    expect(screen.getByText('fine.jpg')).toBeTruthy()
    expect(screen.getAllByText(LABELS.needsRotation)).toHaveLength(1)
  })
})
