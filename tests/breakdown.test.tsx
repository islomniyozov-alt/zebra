/**
 * @vitest-environment jsdom
 */
import { readFileSync } from 'node:fs'
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { Breakdown } from '@/app/(app)/_charts/Breakdown'

// ---------------------------------------------------------------------------
// §6.3 (amended 2026-11-07) — A BREAKDOWN BY AUTHORITY IS CLOSED BY DEFAULT.
//
// Owner's ruling on dev, round five: the by-authority donut on the dashboard
// and the company cut of Accounting → Reports collapse behind "Show
// breakdown", open for the current view only, never persisted. The reason is
// §6.3's: someone beside the owner's screen must not read the list of
// companies, and a chart naming each with money beside it is that list.
//
// THREE THINGS PINNED. The component: closed by default, nothing of the
// breakdown in the document while closed (not hidden — absent), open on the
// control and closed again on it. The mechanism: no URL, no storage, no
// preference — read off the component's source by name, because a `useState`
// that happened to be initialised from a search param would pass every render
// test and persist anyway. The placement: the dashboard wraps the by-authority
// donut and NOT the by-customer one, and the reports page wraps the
// per-authority charts and the matrix and NOT the receivables and settlements
// sections, read off each page's source.
// ---------------------------------------------------------------------------

afterEach(cleanup)

const labels = { show: 'Show breakdown', hide: 'Hide breakdown' }

describe('the control', () => {
  it('is closed by default, with the heading and nothing of the breakdown', () => {
    render(
      <Breakdown heading="Gross by authority" labels={labels}>
        <p>RAM Haulage $1,000.00</p>
      </Breakdown>,
    )
    expect(screen.getByText('Gross by authority')).toBeTruthy()
    expect(screen.queryByText('RAM Haulage $1,000.00')).toBeNull()
    const button = screen.getByRole('button', { name: 'Show breakdown' })
    expect(button.getAttribute('aria-expanded')).toBe('false')
  })

  it('opens on the control, and the chart then carries its own heading', () => {
    render(
      <Breakdown heading="Gross by authority" labels={labels}>
        <p>RAM Haulage $1,000.00</p>
      </Breakdown>,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Show breakdown' }))
    expect(screen.getByText('RAM Haulage $1,000.00')).toBeTruthy()
    const button = screen.getByRole('button', { name: 'Hide breakdown' })
    expect(button.getAttribute('aria-expanded')).toBe('true')
    // The wrapper's heading steps aside for the chart's own.
    expect(screen.queryByText('Gross by authority')).toBeNull()
  })

  it('closes again on the same control, and the breakdown leaves the document', () => {
    render(
      <Breakdown labels={labels}>
        <p>RAM Haulage $1,000.00</p>
      </Breakdown>,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Show breakdown' }))
    fireEvent.click(screen.getByRole('button', { name: 'Hide breakdown' }))
    expect(screen.queryByText('RAM Haulage $1,000.00')).toBeNull()
  })

  it('starts closed on every mount — nothing carries over', () => {
    const first = render(
      <Breakdown labels={labels}>
        <p>RAM Haulage $1,000.00</p>
      </Breakdown>,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Show breakdown' }))
    first.unmount()
    render(
      <Breakdown labels={labels}>
        <p>RAM Haulage $1,000.00</p>
      </Breakdown>,
    )
    expect(screen.queryByText('RAM Haulage $1,000.00')).toBeNull()
  })
})

describe('the mechanism is component state and nothing else', () => {
  const source = readFileSync('src/app/(app)/_charts/Breakdown.tsx', 'utf8')
  for (const forbidden of [
    'useSearchParams',
    'useRouter',
    'localStorage',
    'sessionStorage',
    'cookie',
    'UserPreference',
  ]) {
    it(`never reaches for ${forbidden}`, () => {
      expect(source).not.toMatch(new RegExp(`\\b${forbidden}\\b`))
    })
  }
  it('is a client component holding one boolean, and renders nothing closed', () => {
    expect(source).toMatch(/^'use client'$/m)
    expect(source).toMatch(/useState\(false\)/)
    // A CSS collapse would be the same bug as none: the breakdown is absent,
    // not styled away.
    expect(source).not.toMatch(/\bhidden\b/)
  })
})

describe('where it sits', () => {
  /** The text between the page's one `<Breakdown` and its `</Breakdown>`. */
  const split = (file: string): { inside: string; after: string } => {
    const source = readFileSync(file, 'utf8')
    expect(source.split('<Breakdown').length - 1, file).toBe(1)
    const start = source.indexOf('<Breakdown')
    const end = source.indexOf('</Breakdown>', start)
    expect(end, file).toBeGreaterThan(start)
    return { inside: source.slice(start, end), after: source.slice(end) }
  }

  it('the dashboard wraps the by-authority donut and not the by-customer one', () => {
    const page = split('src/app/(app)/dashboard/page.tsx')
    expect(page.inside).toContain('money.byCompany.map')
    expect(page.inside).not.toContain('money.byCustomer.map')
    expect(page.after).toContain('money.byCustomer.map')
  })

  it('reports wraps the per-authority charts and the matrix, not the other sections', () => {
    const page = split('src/app/(app)/accounting/reports/page.tsx')
    expect(page.inside).toContain('authorities.map((authority)')
    expect(page.inside).toContain('cell.companyName')
    // The receivables and settlements sections are `charts`, rendered outside.
    expect(page.inside).not.toContain('{charts}')
    expect(page.after).toContain('{charts}')
  })
})
