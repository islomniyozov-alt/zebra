/**
 * @vitest-environment jsdom
 */
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { Topbar } from '@/components/shell/Topbar'

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

const labels = { notifications: 'Notifications', userMenu: 'Account' }

describe('the account control', () => {
  it('shows the name, not initials', () => {
    render(<Topbar accountName="Islom Niyozov" labels={labels} />)
    const link = screen.getByRole('link', { name: 'Account' })
    expect(link.textContent).toContain('Islom Niyozov')
    expect(link.textContent).not.toContain('OW')
  })

  it('truncates rather than abbreviating a long name', () => {
    // "Islom Niyozov" clipped at the edge still answers whose account this is.
    // "IN" starts a guessing game. The width lives in CSS so the DOM keeps the
    // whole string — which is also what a screen reader reads.
    const long = 'Bartholomew Featherstonehaugh-Cholmondeley'
    render(<Topbar accountName={long} labels={labels} />)
    const shown = screen.getByText(long)
    expect(shown.className).toContain('truncate')
    expect(shown.textContent).toBe(long)
  })

  it('still links to /account, which is the only door to it', () => {
    render(<Topbar accountName="Islom Niyozov" labels={labels} />)
    expect(
      screen.getByRole('link', { name: 'Account' }).getAttribute('href'),
    ).toBe('/account')
  })

  it('renders the control with no name rather than nothing at all', () => {
    // The email fallback is decided in the layout; if BOTH are somehow absent
    // the door must still exist.
    render(<Topbar accountName="" labels={labels} />)
    expect(screen.getByRole('link', { name: 'Account' })).toBeTruthy()
  })

  it('offers no authority filter — it moved to the loads screen', () => {
    render(<Topbar accountName="Islom Niyozov" labels={labels} />)
    expect(screen.queryByRole('group')).toBeNull()
  })
})
