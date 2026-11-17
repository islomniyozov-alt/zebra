// @vitest-environment jsdom
import { readFileSync } from 'node:fs'
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import {
  trackerFindings,
  TRACKER_CANDIDATES,
} from '../scripts/tracker-render.mjs'

// THE AMAZON DETAIL, TWO FIXES (owner's review on dev, 2026-11-17, §7.13).
//
// 1. The tracker's digits read mirrored / upside down. No transform did it:
//    each step's connector bar is absolute and later in the DOM than the
//    circle to its start, so it painted through the digit. The circles sit at
//    z-10 now, and scripts/tracker-render.mjs renders the page and holds every
//    digit topmost at its centre and upright — the check that can see paint.
// 2. Cancel load leaves the header for the ⋮ menu, red only there.

afterEach(cleanup)

const step = (digit: string, over: Record<string, unknown> = {}) => ({
  digit,
  topmost: true,
  coveredBy: null,
  upright: true,
  turned: null,
  ...over,
})

describe('the tracker render check', () => {
  it('passes a tracker whose digits are on top and upright', () => {
    expect(
      trackerFindings({ path: '/loads/l1', steps: [step('1'), step('2')] }),
    ).toEqual([])
  })

  it('fails a digit a bar covers, and one that is turned', () => {
    // Read on dev at 08eae6c: the bar of step 2 at step 1's centre.
    expect(
      trackerFindings({
        path: '/loads/l1',
        steps: [
          step('1', { topmost: false, coveredBy: 'span.absolute.top-[15px]' }),
          step('2', { upright: false, turned: 'rotate 180deg on OL' }),
        ],
      }),
    ).toEqual([
      '/loads/l1: step 1 is covered at its centre by span.absolute.top-[15px]',
      '/loads/l1: step 2 is not upright — rotate 180deg on OL',
    ])
  })

  it('and no tracker at all is a finding, not a pass', () => {
    expect(trackerFindings(null)).toEqual([
      `no tracker on the first ${TRACKER_CANDIDATES} loads of /loads — nothing measured`,
    ])
    expect(trackerFindings({ path: '/loads/l1', steps: [] })).toEqual([
      '/loads/l1: a tracker with no steps',
    ])
  })

  it('runs in the deploy sweep, after the shell check', () => {
    const sweep = readFileSync('scripts/sweep.mjs', 'utf8')
    expect(sweep).toContain(
      "import { measureTracker, reportTracker } from './tracker-render.mjs'",
    )
    expect(sweep).toMatch(
      /sums\.problems \+= reportTracker\(\s*await measureTracker\(shellBrowser, BASE, cookie\),?\s*\)/,
    )
  })

  it('reads what moves the paint, never a source class', () => {
    const check = readFileSync('scripts/tracker-render.mjs', 'utf8')
    expect(check).toContain('document.elementFromPoint(')
    expect(check).toContain("'[data-tracker] [data-tracker-step]'")
  })
})

describe('the circles sit above the bars', () => {
  const source = readFileSync(
    'src/app/(app)/loads/[id]/AmazonDetail.tsx',
    'utf8',
  )

  it('each circle is z-10 and marked for the check', () => {
    const circle = /data-tracker-step\s+className=\{cx\(\s*'([^']*)'/.exec(
      source,
    )?.[1]
    expect(circle?.split(' ')).toEqual(
      expect.arrayContaining(['relative', 'z-10', 'rounded-full']),
    )
    expect(source).toContain('<ol data-tracker ')
  })

  it('and the bar takes no stacking of its own', () => {
    const bar = /'(absolute top-\[15px\][^']*)'/.exec(source)?.[1]
    expect(bar).toBeDefined()
    expect(bar).not.toMatch(/\bz-/)
  })
})

describe('Cancel load lives in the ⋮ menu on the Amazon header', () => {
  const labels = {
    markDelivered: 'Mark delivered',
    cancel: 'Cancel',
    cancelTitle: 'Cancel this load?',
    cancelBody: 'Nothing is deleted.',
    reason: 'Reason',
    confirmCancel: 'Cancel load',
    uncancel: 'Reinstate load',
    close: 'Cancel',
    menu: 'Load actions',
  }
  const noop = async () => ({ error: null, notice: null })

  async function renderActions(layout?: 'inline' | 'menu') {
    const { LoadActions } = await import('@/app/(app)/loads/[id]/LoadActions')
    render(
      <LoadActions
        layout={layout}
        isCancelled={false}
        canDeliver
        markDelivered={noop}
        cancel={noop}
        uncancel={async () => {}}
        labels={labels}
      />,
    )
  }

  it('the header shows Mark delivered, neutral, and the ⋮ — no red button', async () => {
    await renderActions('menu')
    const buttons = screen.getAllByRole('button')
    expect(
      buttons.map((b) => b.textContent?.trim() || b.getAttribute('aria-label')),
    ).toEqual(['Mark delivered', 'Load actions'])
    for (const button of buttons) expect(button.className).not.toMatch(/danger/)
  })

  it('and the menu holds Cancel load, the only red thing on it', async () => {
    // jsdom has no <dialog> methods; the Modal opens through them.
    HTMLDialogElement.prototype.showModal ??= function (
      this: HTMLDialogElement,
    ) {
      this.open = true
    }
    HTMLDialogElement.prototype.close ??= function (this: HTMLDialogElement) {
      this.open = false
    }
    await renderActions('menu')
    fireEvent.click(screen.getByRole('button', { name: 'Load actions' }))
    const item = screen.getByRole('menuitem', { name: 'Cancel load' })
    expect(item.className).toContain('text-danger')
    fireEvent.click(item)
    expect(screen.getByText('Cancel this load?')).toBeTruthy()
  })

  it('every other load detail keeps its inline Cancel', async () => {
    await renderActions()
    expect(screen.getByRole('button', { name: 'Cancel' }).className).toMatch(
      /danger/,
    )
    expect(screen.queryByRole('button', { name: 'Load actions' })).toBeNull()
  })

  it('and the Amazon header is the one that asks for the menu', () => {
    const page = readFileSync('src/app/(app)/loads/[id]/page.tsx', 'utf8')
    expect(page).toContain("{actionsFor('menu')}")
    expect(page).toContain("const actionsNode = actionsFor('inline')")
  })
})
