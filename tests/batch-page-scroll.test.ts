import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

// ---------------------------------------------------------------------------
// THE BATCH PAGE SCROLLS INSIDE THE SHELL (§6.1: content is the only
// scrolling region). 2026-11-02: the draft batch page's root was a plain
// flex column with no bound on its height, so inside the shell's
// `h-screen overflow-hidden` it grew to its ~50 trips (~4,300 px) and the
// shell clipped the rest — no scrollbar at 100% zoom, the remaining rows
// reachable only by zooming out. The fix is the same three classes every
// other page's content region carries; this holds them in place, and holds
// the shell's side of the bargain beside them.
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
    expect(shell).toContain(
      '<div className="flex min-h-0 flex-1 flex-col">{children}</div>',
    )
  })
})
