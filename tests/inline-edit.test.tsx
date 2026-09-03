/**
 * @vitest-environment jsdom
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MilesField } from '@/app/(app)/loads/[id]/MilesField'
import type { DetailState } from '@/app/(app)/loads/[id]/actions'

// ---------------------------------------------------------------------------
// THE THREE PROMISES THE INLINE EDITORS MAKE, TESTED IN A DOM.
//
// The load detail lost its Save buttons because a screen full of them makes a
// dispatcher wonder what is committed. What replaced them is a promise —
// blur and Enter commit, Escape abandons, and the page will not leave with
// something typed and uncommitted — and that promise was verified by READING
// THE SOURCE, on the one screen whose whole premise is that nothing is
// silently lost. That was the weakest thing in the commit that introduced it.
//
// jsdom EXISTS FOR EXACTLY THIS AND NOTHING ELSE. It is opted into per file by
// the docblock above; the rest of the node project still runs with no DOM, and
// the workerd and integration projects have never heard of it. A DOM available
// everywhere would invite tests that assert a browser where the code runs on
// workerd.
//
// THE COMPONENT IS RENDERED, NOT REASONED ABOUT. A blur handler that looks
// correct and never fires is indistinguishable from one that works, by
// reading. That is the whole gap this file closes.
// ---------------------------------------------------------------------------

afterEach(cleanup)

const LABELS = {
  miles: 'Miles',
  edit: 'Edit',
  saving: 'Saving…',
  failed: 'Not saved',
}

/** A save that records what it was given and reports success. */
function recorder(result: DetailState = { error: null, notice: null }) {
  const calls: string[] = []
  const save = vi.fn(async (_previous: DetailState, data: FormData) => {
    calls.push(String(data.get('miles')))
    return result
  })
  return { save, calls }
}

const openEditor = async (user: ReturnType<typeof userEvent.setup>) => {
  await user.click(screen.getByRole('button', { name: /Edit: Miles/ }))
  return screen.getByRole('textbox', { name: 'Miles' })
}

describe('miles, edited inline', () => {
  it('commits what was typed when the field loses focus', async () => {
    const user = userEvent.setup()
    const { save, calls } = recorder()
    render(
      <MilesField
        dispatchedMiles={583}
        save={save}
        locale="en-US"
        labels={LABELS}
      />,
    )

    const input = await openEditor(user)
    await user.clear(input)
    await user.type(input, '612')
    // Focus moves away — the ordinary way a dispatcher finishes with a field.
    await user.tab()

    await waitFor(() => expect(save).toHaveBeenCalledTimes(1))
    expect(calls).toEqual(['612'])
  })

  it('commits on Enter without waiting for focus to move', async () => {
    const user = userEvent.setup()
    const { save, calls } = recorder()
    render(
      <MilesField
        dispatchedMiles={583}
        save={save}
        locale="en-US"
        labels={LABELS}
      />,
    )

    const input = await openEditor(user)
    await user.clear(input)
    await user.type(input, '470{Enter}')

    await waitFor(() => expect(save).toHaveBeenCalledTimes(1))
    expect(calls).toEqual(['470'])
  })

  // ESCAPE IS THE ONE EXIT THAT DISCARDS, and it must not also commit on the
  // way out — the input blurs when it unmounts, and a blur handler that did
  // not know about the abandonment would save the value Escape just rejected.
  it('abandons the edit on Escape and saves nothing', async () => {
    const user = userEvent.setup()
    const { save } = recorder()
    render(
      <MilesField
        dispatchedMiles={583}
        save={save}
        locale="en-US"
        labels={LABELS}
      />,
    )

    const input = await openEditor(user)
    await user.clear(input)
    await user.type(input, '999{Escape}')

    expect(save).not.toHaveBeenCalled()
    // And the saved value is what the screen shows again.
    expect(
      screen.getByRole('button', { name: /Edit: Miles/ }).textContent,
    ).toContain('583')
  })

  it('does not call the server when nothing changed', async () => {
    const user = userEvent.setup()
    const { save } = recorder()
    render(
      <MilesField
        dispatchedMiles={583}
        save={save}
        locale="en-US"
        labels={LABELS}
      />,
    )

    await openEditor(user)
    await user.tab()

    // Opening a field and closing it again is not an edit. A write here would
    // put a status event and an audit row against a load nobody changed.
    expect(save).not.toHaveBeenCalled()
  })

  // A REFUSAL MUST NOT LOOK LIKE A SAVE. This is the defect the whole pattern
  // exists to remove: the typed value stays, the field stays open, and the
  // screen says so.
  it('keeps the typed value and says so when the save is refused', async () => {
    const user = userEvent.setup()
    const { save } = recorder({ error: 'Not a number', notice: null })
    render(
      <MilesField
        dispatchedMiles={583}
        save={save}
        locale="en-US"
        labels={LABELS}
      />,
    )

    const input = await openEditor(user)
    await user.clear(input)
    await user.type(input, '61x2')
    await user.tab()

    await waitFor(() => expect(save).toHaveBeenCalled())
    await waitFor(() =>
      expect(
        (screen.getByRole('textbox', { name: 'Miles' }) as HTMLInputElement)
          .value,
      ).toBe('612'),
    )
  })
})

describe('the dirty guard, which covers the exit blur cannot see', () => {
  const listeners = () => {
    const added: string[] = []
    const removed: string[] = []
    vi.spyOn(window, 'addEventListener').mockImplementation(((type: string) => {
      added.push(type)
    }) as never)
    vi.spyOn(window, 'removeEventListener').mockImplementation(((
      type: string,
    ) => {
      removed.push(type)
    }) as never)
    return { added, removed }
  }

  afterEach(() => vi.restoreAllMocks())

  it('arms beforeunload only once an edit is pending', async () => {
    const user = userEvent.setup()
    const { save } = recorder()
    const { added } = listeners()
    render(
      <MilesField
        dispatchedMiles={583}
        save={save}
        locale="en-US"
        labels={LABELS}
      />,
    )

    // Nothing typed: a dispatcher who changed nothing must never be asked
    // whether they meant to leave.
    expect(added).not.toContain('beforeunload')

    const input = await openEditor(user)
    await user.type(input, '9')

    await waitFor(() => expect(added).toContain('beforeunload'))
  })

  it('disarms it again once the edit is committed', async () => {
    const user = userEvent.setup()
    const { save } = recorder()
    const { removed } = listeners()
    render(
      <MilesField
        dispatchedMiles={583}
        save={save}
        locale="en-US"
        labels={LABELS}
      />,
    )

    const input = await openEditor(user)
    await user.type(input, '9')
    await user.tab()

    // A prompt that outlives the thing it was guarding trains people to click
    // through it, which is how the real one gets ignored.
    await waitFor(() => expect(removed).toContain('beforeunload'))
  })
})
