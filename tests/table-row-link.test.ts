import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

// ---------------------------------------------------------------------------
// §7.1 — THE ROW LINK'S STRETCH IS PER CELL (queue item 20 (2)).
//
// Measured on dev 2026-10-07: the anchor's box was 97 px of a 1,056 px row and a
// click in the fourth cell did not navigate, because Chromium does not let a
// positioned <tr> contain the anchor's ::after. The fix is held here in source:
// each cell is its own containing block, the first cell carries the one named
// link, every other cell an overlay that the accessibility tree does not see.
// ---------------------------------------------------------------------------

const table = readFileSync(join('src', 'components', 'ui', 'Table.tsx'), 'utf8')
const doc = readFileSync('TMS-DESIGN-SYSTEM.md', 'utf8')

describe('the row link', () => {
  it('is specified per cell before the code', () => {
    expect(doc).toContain('**THE STRETCH IS PER CELL, NOT PER ROW.**')
  })

  it('makes every cell of a linked row its own containing block', () => {
    expect(table).toMatch(/href && 'relative',/)
  })

  it('names the row once, in the first cell', () => {
    const first = table.slice(
      table.indexOf('href && index === 0 ? ('),
      table.indexOf('href && index > 0 ? ('),
    )
    expect(first).toContain("after:absolute after:inset-0 after:content-['']")
    expect(first).not.toContain('aria-hidden')
  })

  it('overlays every other cell with a hidden, untabbable anchor to the same href', () => {
    const rest = table.slice(table.indexOf('href && index > 0 ? ('))
    const overlay = rest.slice(0, rest.indexOf('</td>'))
    expect(overlay).toContain('href={href}')
    expect(overlay).toContain('aria-hidden')
    expect(overlay).toContain('tabIndex={-1}')
    expect(overlay).toContain('className="absolute inset-0"')
  })

  it('still refuses a <tr onClick>', () => {
    // The element, not the comment that names the refusal.
    expect(table).not.toMatch(/<tr[^>]*onClick=/)
  })
})
