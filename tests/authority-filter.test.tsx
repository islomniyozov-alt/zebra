// @vitest-environment jsdom
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render } from '@testing-library/react'
import { AuthorityFilter } from '@/app/(app)/_grid/AuthorityFilter'

// ---------------------------------------------------------------------------
// THE AUTHORITIES ARE NEVER LISTED ON SCREEN UNLESS THE USER OPENS THE CONTROL
// (§6.3 as amended 2026-11-06, owner's third-round review on dev). The reason
// is the rule: someone beside the owner's screen must not read the list of
// companies. So:
//
//   * the control is a native <select>: closed it shows "Authority: All" or
//     the one selected name, and the names are <option>s the browser draws
//     only while it is open;
//   * no <button> or <a> per authority anywhere in the component;
//   * ONE component on every screen — the loads board has no company chip
//     group left in its filter bar, the accident register no row of links,
//     and nothing under src/app renders the old CompanyChips;
//   * the URL contract is unchanged: `company` is the key and All deletes it.
// ---------------------------------------------------------------------------

const replace = vi.fn()
vi.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams(),
  useRouter: () => ({ replace, push: vi.fn() }),
  usePathname: () => '/dashboard',
}))

afterEach(() => {
  cleanup()
  replace.mockReset()
})

const COMPANIES = [
  { id: 'ram', name: 'RAM Haulage LLC', count: 12 },
  { id: 'dol', name: 'Dolphins Transport LLC', count: 3 },
]

describe('AuthorityFilter — a dropdown, closed by default', () => {
  it('is a native select whose closed value is All, with the names as options', () => {
    const { container } = render(
      <AuthorityFilter
        companies={COMPANIES}
        label="Authority"
        allLabel="All"
      />,
    )
    const select = container.querySelector('select')!
    expect(select).not.toBeNull()
    expect(select.value).toBe('')
    expect(select.selectedOptions[0]?.textContent).toBe('All')
    // The names exist only as options — nothing else in the tree says them.
    const options = [...select.querySelectorAll('option')].map(
      (o) => o.textContent,
    )
    expect(options).toEqual([
      'All',
      'RAM Haulage LLC (12)',
      'Dolphins Transport LLC (3)',
    ])
    expect(container.querySelectorAll('button, a')).toHaveLength(0)
    const outsideOptions = container.textContent!.replace(
      select.textContent ?? '',
      '',
    )
    expect(outsideOptions).not.toContain('RAM Haulage')
    expect(outsideOptions).not.toContain('Dolphins')
    // Closed, it reads "Authority:" and nothing more beside the select.
    expect(outsideOptions.trim()).toBe('Authority:')
  })

  it('shows the first authority, not All, where a screen passes no allLabel', () => {
    const { container } = render(
      <AuthorityFilter companies={COMPANIES} label="Authority" />,
    )
    const select = container.querySelector('select')!
    expect(select.value).toBe('ram')
    expect([...select.querySelectorAll('option')]).toHaveLength(2)
  })

  it('renders nothing for a single-authority organization (§6.3)', () => {
    const { container } = render(
      <AuthorityFilter
        companies={[COMPANIES[0]!]}
        label="Authority"
        allLabel="All"
      />,
    )
    expect(container.innerHTML).toBe('')
  })

  it('writes ?company= and deletes it for All, keeping the path', () => {
    const { container } = render(
      <AuthorityFilter
        companies={COMPANIES}
        label="Authority"
        allLabel="All"
      />,
    )
    const select = container.querySelector('select')!
    select.value = 'dol'
    select.dispatchEvent(new Event('change', { bubbles: true }))
    expect(replace).toHaveBeenLastCalledWith('/dashboard?company=dol', {
      scroll: false,
    })
    select.value = ''
    select.dispatchEvent(new Event('change', { bubbles: true }))
    expect(replace).toHaveBeenLastCalledWith('/dashboard', { scroll: false })
  })
})

describe('one component, every screen', () => {
  const APP = 'src/app/(app)'
  const files: string[] = []
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry)
      if (statSync(full).isDirectory()) walk(full)
      else if (/\.tsx?$/.test(entry)) files.push(full)
    }
  }
  walk(APP)
  const source = (file: string) => readFileSync(file, 'utf8')

  it('reads real files', () => {
    expect(files.length).toBeGreaterThan(50)
  })

  it('nothing renders the old chip row', () => {
    for (const file of files)
      expect(source(file), file).not.toMatch(/CompanyChips/)
  })

  it('the loads board has no company chip group in its filter bar', () => {
    const loads = source(`${APP}/loads/page.tsx`)
    expect(loads).not.toMatch(/param:\s*'company'/)
    expect(loads).toContain('<AuthorityFilter')
  })

  it('the accident register has no row of links naming each authority', () => {
    const page = source(`${APP}/safety/accidents/page.tsx`)
    expect(page).not.toContain('/safety/accidents?company=${company.id}')
    expect(page).toContain('<AuthorityFilter')
  })

  it('every screen that offered the filter offers the dropdown', () => {
    for (const page of [
      'dashboard/page.tsx',
      'accounting/invoices/page.tsx',
      'accounting/payments/page.tsx',
      'accounting/reports/page.tsx',
      'payroll/charges/page.tsx',
      'payroll/batches/new/page.tsx',
      'loads/page.tsx',
      'safety/accidents/page.tsx',
    ])
      expect(source(`${APP}/${page}`), page).toContain('<AuthorityFilter')
  })
})
