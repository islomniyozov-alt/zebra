import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { DRIVER_TABS, fitTabColumn, tabDateColumn } from '@/lib/driver-list'
import {
  DRIVER_COLUMN_KEYS,
  DRIVER_COLUMNS_HIDDEN,
  TABLE_COLUMN_CAP,
} from '@/lib/list-columns'
import { gridColumnCap } from '@/lib/grid-columns'

// ---------------------------------------------------------------------------
// /drivers?tab=terminated ANSWERED 500 ON DEV (safety team, 2026-11-17).
//
// Session one read the tail: "A table may show 9 columns at most; this one
// has 10." The chooser bounds the chosen set by nine, the multi-authority
// default IS nine, and Terminated and Vacation appended their date as a
// tenth. §6.4 part 1 v11.30: the date takes a seat, it does not add one.
// ---------------------------------------------------------------------------

const CAP = gridColumnCap('drivers.drivers')
const DEFAULT = DRIVER_COLUMN_KEYS.filter(
  (key) => !(DRIVER_COLUMNS_HIDDEN as readonly string[]).includes(key),
)

describe('the tab date column fits inside the cap', () => {
  it('the cap is the table default, nine — no number of its own', () => {
    expect(CAP).toBe(TABLE_COLUMN_CAP)
    expect(CAP).toBe(9)
  })

  it('reproduces the failure: the default set is already at the cap', () => {
    // The precondition of the 500 — if this stops being true, the case below
    // is testing nothing.
    expect(DEFAULT).toHaveLength(CAP)
  })

  it('never exceeds the cap on any tab, for any chosen prefix of the keys', () => {
    let checked = 0
    for (const tab of DRIVER_TABS) {
      for (let n = 1; n <= DRIVER_COLUMN_KEYS.length; n += 1) {
        const visible = DRIVER_COLUMN_KEYS.slice(0, n)
        const shown = fitTabColumn(visible, tabDateColumn(tab), CAP)
        expect(shown.length).toBeLessThanOrEqual(CAP)
        const date = tabDateColumn(tab)
        if (date) expect(shown).toContain(date)
        checked += 1
      }
    }
    expect(checked).toBe(DRIVER_TABS.length * DRIVER_COLUMN_KEYS.length)
  })

  it('at the cap the date takes Last activity’s seat', () => {
    const shown = fitTabColumn(DEFAULT, 'terminated', CAP)
    expect(shown).toHaveLength(CAP)
    expect(shown).toContain('terminated')
    expect(shown).not.toContain('lastActivity')
    expect(shown[0]).toBe('name')
    expect(shown).toContain('warnings')
  })

  it('without Last activity it takes the last chosen column before Warnings', () => {
    const chosen = DRIVER_COLUMN_KEYS.filter(
      (key) => key !== 'lastActivity',
    ).slice(0, 8)
    const full = [...chosen, 'warnings']
    expect(full).toHaveLength(CAP)
    const shown = fitTabColumn(full, 'returns', CAP)
    expect(shown).toHaveLength(CAP)
    expect(shown).toContain('returns')
    expect(shown).toContain('warnings')
    expect(shown).toContain('name')
    expect(shown).not.toContain(chosen[chosen.length - 1])
  })

  it('under the cap the date is added and nothing is given up', () => {
    const chosen = ['name', 'phone', 'warnings']
    expect(fitTabColumn(chosen, 'terminated', CAP)).toEqual([
      ...chosen,
      'terminated',
    ])
  })

  it('a tab without a date column shows the chosen set as it is', () => {
    expect(fitTabColumn(DEFAULT, tabDateColumn('active'), CAP)).toEqual(DEFAULT)
  })

  it('the page uses the rule and hands the table the grid’s cap', () => {
    const page = readFileSync('src/app/(app)/drivers/page.tsx', 'utf8')
    expect(page).toMatch(
      // v11.38: the view is the tab and the chip (Inactive or Vacation).
      /fitTabColumn\(visible, tabDateColumn\(tab, chip\), DRIVER_COLUMN_CAP\)/,
    )
    expect(page).toMatch(/columnCap=\{DRIVER_COLUMN_CAP\}/)
    expect(page).toMatch(
      /const DRIVER_COLUMN_CAP = gridColumnCap\('drivers\.drivers'\)/,
    )
  })
})
