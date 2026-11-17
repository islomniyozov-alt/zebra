import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { ROUTE_VARIANTS } from '../scripts/sweep.mjs'

// ---------------------------------------------------------------------------
// THE CLICKABLE AUDIT OF /drivers, ADD DRIVER AND EVERY DRIVER TAB
// (2026-11-17). Each dead control fixed inside the scope is pinned here by
// the line that makes it live; the rest are GAPS rows.
// ---------------------------------------------------------------------------

const read = (path: string) => readFileSync(path, 'utf8')
const RECORD = read('src/app/(app)/drivers/[id]/page.tsx')
const LIST = read('src/app/(app)/drivers/page.tsx')

describe('the dead controls, made live', () => {
  it('Main’s Save is not offered to a role that cannot save (it crashed to the error page)', () => {
    expect(RECORD).toMatch(/readOnly=\{!mayEdit\}/)
    const form = read('src/app/(app)/drivers/[id]/DriverMainForm.tsx')
    expect(form).toMatch(/<fieldset disabled=\{readOnly\}/)
    expect(form).toMatch(/\{readOnly \? null : \(\s*<Button type="submit"/)
  })

  it('Remove is absent without driver:delete — never a no-op server action', () => {
    expect(RECORD).not.toMatch(/async \(\) => \{\s*'use server'\s*\}/)
    expect(RECORD).toMatch(/mayDelete\s*\?\s*\{ retireAction:/)
    const actions = read('src/app/(app)/_reference/AssetActions.tsx')
    expect(actions).toMatch(/\{retireAction \? \(/)
  })

  it('Transfer is absent when there is no other authority, not disabled for ever', () => {
    const actions = read('src/app/(app)/_reference/AssetActions.tsx')
    expect(actions).toMatch(/\{authorities\.length > 0 \? \(/)
    expect(actions).not.toMatch(/disabled=\{authorities\.length === 0\}/)
  })

  it('closing a pay rule says why it was refused', () => {
    const rules = read('src/app/(app)/drivers/[id]/PayRules.tsx')
    expect(rules).not.toMatch(/const \[, act, pending\]/)
    expect(rules).toMatch(/translate\[state\.error\] \?\? state\.error/g)
  })

  it('closing a deduction prints words, not the key', () => {
    const deductions = read('src/app/(app)/drivers/[id]/Deductions.tsx')
    expect(
      deductions.match(/translate\[state\.error\] \?\? state\.error/g),
    ).toHaveLength(2)
  })

  it('the Type funnel matches the words the cell shows', () => {
    expect(LIST).toMatch(
      /type: \(row\) => t\(`drivers\.type\.\$\{row\.driverType\}` as MessageKey\)/,
    )
  })

  it('the two buttons inside forms do not submit them', () => {
    expect(read('src/app/(app)/drivers/BulkRoster.tsx')).toMatch(
      /<Button\s+type="button"\s+variant="ghost"/,
    )
    expect(read('src/app/(app)/_grid/ColumnsChooser.tsx')).toMatch(
      /<Button\s+type="button"\s+variant="ghost"/,
    )
  })

  it('the dead ends have a way out', () => {
    expect(read('src/app/(app)/drivers/[id]/SignInLink.tsx')).toMatch(
      /href="\/users\/new"/,
    )
    expect(RECORD).toMatch(/href: '\/safety\/inspections\/new'/)
    expect(RECORD).toMatch(/mayRecordInspection\s*\?/)
    expect(LIST).toMatch(/rosterEmpty \? \(/)
    expect(LIST).toMatch(/t\('drivers\.emptyFiltered\.clear'\)/)
  })

  it('a document on the Documents tab opens', () => {
    expect(read('src/app/(app)/_reference/DriverDocuments.tsx')).toMatch(
      /<DocumentLink\s+id=\{document\.id\}/,
    )
  })
})

describe('the sweep fetches the tab that answered 500', () => {
  it('the report’s own URL, the terminated tab at 500 a page, and the vacation tab', () => {
    const variants = ROUTE_VARIANTS.get('/drivers') ?? []
    expect(variants).toContain('per=500&dispatch=available&tab=terminated')
    expect(variants).toContain('tab=terminated&per=500')
    expect(variants).toContain('tab=vacation&per=500')
  })
})
