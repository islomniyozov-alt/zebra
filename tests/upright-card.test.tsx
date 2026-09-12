/**
 * @vitest-environment jsdom
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { UprightCard } from '@/components/UprightCard'

// ---------------------------------------------------------------------------
// CANCELLING THE ROTATION STEP MEANS NO READ (owner's ruling, 2026-09-12).
//
// ── WHY THIS IS RENDERED RATHER THAN REASONED ABOUT ───────────────────────
//
// The step exists because a medical certificate photographed on its side made
// one engine return four different examiner names in four reads, one of them
// the driver's own surname. The step only helps if it actually BLOCKS: a
// rotate dialog that a person dismisses, after which the card is read
// sideways anyway, is worse than no dialog — it moves the failure from
// "obviously unhandled" to "handled, apparently".
//
// A handler that looks correct and never fires is indistinguishable from one
// that works, by reading. So the component is mounted and the buttons are
// pressed, and what is asserted is that `onConfirm` — the only path that leads
// to an engine — was never called.
//
// THE FALLBACK THIS FORBIDS IS THE SILENT ONE. Cancelling is allowed to do
// exactly one thing: nothing. Not read it unrotated, not read it at the last
// preview angle, not queue it for later.
// ---------------------------------------------------------------------------

const LABELS = {
  title: 'Which way up is this card?',
  hint: 'Turn it upright, then read it.',
  rotateLeft: 'Rotate left',
  rotateRight: 'Rotate right',
  read: 'It is upright — read it',
  cancel: 'Choose another photo',
}

// jsdom has no object URLs. Stubbed rather than mocked away, because the
// component revokes on unmount and a missing `revokeObjectURL` would throw
// there rather than in the assertion.
const stubObjectUrls = () => {
  URL.createObjectURL = vi.fn(() => 'blob:stub')
  URL.revokeObjectURL = vi.fn()
}

const card = () =>
  new File([new Uint8Array([0xff, 0xd8, 0xff, 0xd9])], 'card.jpg', {
    type: 'image/jpeg',
  })

afterEach(cleanup)

describe('the rotate step', () => {
  it('reads nothing when the person cancels', async () => {
    stubObjectUrls()
    const onConfirm = vi.fn()
    const onCancel = vi.fn()
    render(
      <UprightCard
        file={card()}
        labels={LABELS}
        onConfirm={onConfirm}
        onCancel={onCancel}
      />,
    )

    await userEvent.click(screen.getByText(LABELS.cancel))

    // THE ONLY ASSERTION THAT MATTERS. `onConfirm` is the single path to an
    // engine; if it was not called, nothing was read.
    expect(onConfirm).not.toHaveBeenCalled()
    expect(onCancel).toHaveBeenCalledTimes(1)
  })

  it('still reads nothing when the person turned it first, then cancelled', async () => {
    // THE TEMPTING BUG: somebody decides a person who rotated the card clearly
    // meant to read it, and treats cancel as "read it at the angle on screen".
    // Turning a card and then changing your mind is a person saying the photo
    // is wrong, not a person confirming an angle.
    stubObjectUrls()
    const onConfirm = vi.fn()
    const onCancel = vi.fn()
    render(
      <UprightCard
        file={card()}
        labels={LABELS}
        onConfirm={onConfirm}
        onCancel={onCancel}
      />,
    )

    await userEvent.click(screen.getByText(LABELS.rotateRight))
    await userEvent.click(screen.getByText(LABELS.rotateRight))
    await userEvent.click(screen.getByText(LABELS.cancel))

    expect(onConfirm).not.toHaveBeenCalled()
    expect(onCancel).toHaveBeenCalledTimes(1)
  })

  it('reads only when the person says it is upright, with their turns', async () => {
    // The positive half, so "it never reads" cannot be satisfied by a button
    // that does nothing at all.
    stubObjectUrls()
    const onConfirm = vi.fn()
    render(
      <UprightCard
        file={card()}
        labels={LABELS}
        onConfirm={onConfirm}
        onCancel={vi.fn()}
      />,
    )

    await userEvent.click(screen.getByText(LABELS.rotateLeft))
    await userEvent.click(screen.getByText(LABELS.read))

    // Left is three quarter-turns clockwise, which is what the canvas applies.
    expect(onConfirm).toHaveBeenCalledWith(3)
  })

  it('sends no turns when the card was already upright', async () => {
    stubObjectUrls()
    const onConfirm = vi.fn()
    render(
      <UprightCard
        file={card()}
        labels={LABELS}
        onConfirm={onConfirm}
        onCancel={vi.fn()}
      />,
    )

    await userEvent.click(screen.getByText(LABELS.read))
    expect(onConfirm).toHaveBeenCalledWith(0)
  })
})
