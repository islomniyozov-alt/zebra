import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

// ---------------------------------------------------------------------------
// THE BATCH PAGE SCROLLS INSIDE THE SHELL (§6.1: content is the only
// scrolling region). 2026-11-02: the draft batch page's root was a plain
// flex column with no bound on its height, so inside the shell's
// `h-screen overflow-hidden` it grew to its ~50 trips (~4,300 px) and the
// shell clipped the rest — no scrollbar at 100% zoom, the remaining rows
// reachable only by zooming out. The fix was the same three classes every
// other page's content region carries; this holds them in place.
//
// AND SINCE 2026-11-06 THE SHELL'S COLUMN SCROLLS BY ITSELF (§6.1, rule 10 as
// clarified): `overflow-y-auto` on the content column, so a page that forgets
// the three classes overflows the column and the column scrolls instead of
// the shell clipping it. The per-page opt-in was the hazard — one page out of
// fifty-odd missed it — and this pins the column that makes the opt-in
// unnecessary. A page that owns a table body still shrinks it inside the
// column; the column only moves when a page has nothing that shrinks.
// ---------------------------------------------------------------------------

describe('the batch page is its own scroll region', () => {
  const page = readFileSync(
    'src/app/(app)/settlements/batches/[id]/page.tsx',
    'utf8',
  )
  const shell = readFileSync('src/app/(app)/layout.tsx', 'utf8')

  it('its root column shrinks to the viewport and scrolls', () => {
    // The first element the page returns — the one that fills the shell's
    // content column.
    const root =
      /return \(\s*(?:\/\/[^\n]*\n\s*)*<div className="([^"]*)">\s*<header/.exec(
        page,
      )?.[1]
    expect(root, 'the root <div> before the <header>').toBeDefined()
    for (const cls of [
      'min-h-0',
      'flex-1',
      'overflow-y-auto',
      'flex',
      'flex-col',
    ])
      expect(root!.split(' '), cls).toContain(cls)
  })

  it('and the shell gives it a bounded column to shrink inside', () => {
    expect(shell).toContain(
      'className="flex h-screen overflow-hidden bg-surface-2"',
    )
    // The column that holds {children}: bounded (min-h-0 flex-1) AND the
    // scrolling region (overflow-y-auto). Matched by its classes rather than
    // the whole line, because prettier may wrap the element.
    const column = /<div className="([^"]*)">\s*\{children\}\s*<\/div>/.exec(
      shell,
    )?.[1]
    expect(column, 'the <div> around {children}').toBeDefined()
    for (const cls of [
      'flex',
      'min-h-0',
      'flex-1',
      'flex-col',
      'overflow-y-auto',
    ])
      expect(column!.split(' '), cls).toContain(cls)
  })

  it('and no page needs the opt-in to be reachable: the column scrolls', () => {
    // The hazard was a page without the three classes. With the column
    // scrolling, such a page overflows INTO a scroll region rather than under
    // an overflow-hidden one. The shell must not have gone back to a column
    // that only bounds.
    expect(shell).not.toContain(
      '<div className="flex min-h-0 flex-1 flex-col">{children}</div>',
    )
  })
})
