/**
 * @vitest-environment jsdom
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { FilterBar } from '@/components/ui/FilterBar'

// ---------------------------------------------------------------------------
// §6.5 PART 1 — A CHIP GROUP WITH A DEFAULT: the trucks list's view chips.
//
// With no `?view=` the Active chip is lit; pressing it writes nothing; pressing
// a lit non-default chip returns to the default by DELETING the key, never by
// writing `view=active`. One chip is always lit, which is what makes the group
// a view and not a filter.
// ---------------------------------------------------------------------------

const replace = vi.fn()
let url = new URLSearchParams()

vi.mock('next/navigation', () => ({
  useSearchParams: () => url,
  useRouter: () => ({ replace, push: vi.fn() }),
  usePathname: () => '/trucks',
}))

afterEach(() => {
  cleanup()
  replace.mockClear()
  url = new URLSearchParams()
})

const views = () => (
  <FilterBar
    layout="twoRows"
    clearLabel="Clear filters"
    moreLabel="More"
    groups={[
      {
        param: 'view',
        label: 'View',
        defaultValue: 'active',
        choices: [
          { value: 'active', label: 'Active', count: 9 },
          { value: 'unassigned', label: 'Unassigned', count: 3 },
          { value: 'all', label: 'All', count: 15 },
        ],
      },
    ]}
  />
)

/** The chip's `aria-pressed`, which is the one signal of "lit". */
const pressed = (name: RegExp) =>
  screen.getByRole('button', { name }).getAttribute('aria-pressed')

describe('a chip group with a default', () => {
  it('lights the default chip when the URL carries no value', () => {
    render(views())
    expect(pressed(/Active/)).toBe('true')
    expect(pressed(/All/)).toBe('false')
    // And nothing to clear: the default is not a filter.
    expect(screen.queryByText('Clear filters')).toBeNull()
  })

  it('pressing the lit default chip writes nothing', () => {
    render(views())
    fireEvent.click(screen.getByRole('button', { name: /Active/ }))
    expect(replace).toHaveBeenCalledWith('/trucks', { scroll: false })
  })

  it('pressing another chip writes it, and the default chip goes out', () => {
    render(views())
    fireEvent.click(screen.getByRole('button', { name: /All/ }))
    expect(replace).toHaveBeenCalledWith('/trucks?view=all', { scroll: false })
    cleanup()
    url = new URLSearchParams('view=all')
    render(views())
    expect(pressed(/All/)).toBe('true')
    expect(pressed(/Active/)).toBe('false')
    expect(screen.getByText('Clear filters')).toBeTruthy()
  })

  it('pressing the lit non-default chip, or the default, deletes the key', () => {
    url = new URLSearchParams('view=all&q=1001')
    render(views())
    fireEvent.click(screen.getByRole('button', { name: /All/ }))
    expect(replace).toHaveBeenLastCalledWith('/trucks?q=1001', {
      scroll: false,
    })
    fireEvent.click(screen.getByRole('button', { name: /Active/ }))
    expect(replace).toHaveBeenLastCalledWith('/trucks?q=1001', {
      scroll: false,
    })
  })

  it('a group without a default is the bar every other screen has', () => {
    render(
      <FilterBar
        clearLabel="Clear filters"
        moreLabel="More"
        groups={[
          {
            param: 'status',
            label: 'Status',
            choices: [{ value: 'BOOKED', label: 'Booked' }],
          },
        ]}
      />,
    )
    const chip = screen.getByRole('button', { name: /Booked/ })
    expect(chip.getAttribute('aria-pressed')).toBe('false')
    fireEvent.click(chip)
    expect(replace).toHaveBeenCalledWith('/trucks?status=BOOKED', {
      scroll: false,
    })
  })
})
