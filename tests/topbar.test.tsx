/**
 * @vitest-environment jsdom
 */
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { Topbar } from '@/components/shell/Topbar'
import { ribbonBranch } from '@/lib/environment'

// ---------------------------------------------------------------------------
// THE ACCOUNT CONTROL SAYS WHOSE IT IS.
//
// It read "OW" on every screen until 2026-09-06 — a hardcoded string, the same
// two letters for every person who ever logged in. Nothing failed, because
// nothing asserted that the control showed a fact about anybody: a placeholder
// renders exactly as well as a name.
//
// So these tests are about IDENTITY, not layout. They would have caught the
// literal, and they catch the next well-meaning change back to initials.
// ---------------------------------------------------------------------------

afterEach(cleanup)

const labels = {
  notifications: 'Notifications',
  userMenu: 'Account',
  dataFrom: 'DATA: dev',
}

// ── §6.1.2 — WHICH DATABASE AM I LOOKING AT ───────────────────────────────
//
// The ruling was "a DEV ribbon on the dev worker". The failure that matters is
// not a missing ribbon — somebody notices that in a day — but a ribbon that
// renders on PRODUCTION, or one that says "dev" above production's rows. Both
// read as reassurance.
describe('the environment ribbon', () => {
  it('names the database when the worker is not production', () => {
    render(<Topbar accountName="Islom" dataFrom="dev" labels={labels} />)
    expect(screen.getByText('DATA: dev')).toBeTruthy()
  })

  it('renders nothing at all on production', () => {
    const { container } = render(
      <Topbar accountName="Islom" dataFrom={null} labels={labels} />,
    )
    // NOT "no ribbon element" — no such TEXT anywhere. A band that rendered with
    // an empty label would pass a test that only looked for the element's
    // absence, and would still be a strip of warning colour on production.
    expect(container.textContent).not.toContain('DATA')
    expect(container.textContent).not.toContain('dev')
    expect(container.textContent).not.toContain('production')
  })

  it('and carries its word as text, never colour alone (standing rule 5)', () => {
    render(
      <Topbar
        accountName="Islom"
        dataFrom="ci-884"
        labels={{ ...labels, dataFrom: 'DATA: ci-884' }}
      />,
    )
    // THE BRANCH IT FOUND, not the word DEV. CI forks `ci-<run id>`, and a
    // ribbon that says DEV above `ci-884` is confidently wrong.
    const found = screen.getByText('DATA: ci-884')
    expect(found.textContent).toContain('ci-884')
  })
})

describe('ribbonBranch decides, and production is the silent answer', () => {
  it('is null for production, however it is spelled', () => {
    for (const label of ['production', 'PRODUCTION', ' Production ']) {
      expect(ribbonBranch({ NEON_BRANCH: label })).toBeNull()
    }
  })

  it('names anything else, including a CI branch', () => {
    expect(ribbonBranch({ NEON_BRANCH: 'dev' })).toBe('dev')
    expect(ribbonBranch({ NEON_BRANCH: 'ci-884' })).toBe('ci-884')
    expect(ribbonBranch({ NEON_BRANCH: 'ci-prod-884' })).toBe('ci-prod-884')
  })

  it('and announces a worker it cannot place rather than assuming it is safe', () => {
    // A MISSING BINDING IS NOT PRODUCTION. It is a worker nobody can locate,
    // which is exactly when somebody should be told — and "" would render an
    // empty ribbon that says nothing.
    expect(ribbonBranch({})).toBe('unknown')
    expect(ribbonBranch({ NEON_BRANCH: '   ' })).toBe('unknown')
  })
})

describe('the account control', () => {
  it('shows the name, not initials', () => {
    render(
      <Topbar accountName="Islom Niyozov" dataFrom={null} labels={labels} />,
    )
    const link = screen.getByRole('link', { name: 'Account' })
    expect(link.textContent).toContain('Islom Niyozov')
    expect(link.textContent).not.toContain('OW')
  })

  it('truncates rather than abbreviating a long name', () => {
    // "Islom Niyozov" clipped at the edge still answers whose account this is.
    // "IN" starts a guessing game. The width lives in CSS so the DOM keeps the
    // whole string — which is also what a screen reader reads.
    const long = 'Bartholomew Featherstonehaugh-Cholmondeley'
    render(<Topbar accountName={long} dataFrom={null} labels={labels} />)
    const shown = screen.getByText(long)
    expect(shown.className).toContain('truncate')
    expect(shown.textContent).toBe(long)
  })

  it('still links to /account, which is the only door to it', () => {
    render(
      <Topbar accountName="Islom Niyozov" dataFrom={null} labels={labels} />,
    )
    expect(
      screen.getByRole('link', { name: 'Account' }).getAttribute('href'),
    ).toBe('/account')
  })

  it('renders the control with no name rather than nothing at all', () => {
    // The email fallback is decided in the layout; if BOTH are somehow absent
    // the door must still exist.
    render(<Topbar accountName="" dataFrom={null} labels={labels} />)
    expect(screen.getByRole('link', { name: 'Account' })).toBeTruthy()
  })

  it('offers no authority filter — it moved to the loads screen', () => {
    render(
      <Topbar accountName="Islom Niyozov" dataFrom={null} labels={labels} />,
    )
    expect(screen.queryByRole('group')).toBeNull()
  })
})
