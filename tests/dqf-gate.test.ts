import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

// ---------------------------------------------------------------------------
// THE DQF HAS ONE PERMISSION AND THREE DOORS (TMS-DESIGN-SYSTEM.md §6.8,
// owner's ruling on GAPS 19, 2026-10-11).
//
// Accounting reads `compliance` for insurance certificates, and the roster,
// the hub's link to it and the driver record's checklist all answered to
// `compliance` — so the certificates granted the file. Each door now asks
// `dqf`, and these fail by name for one that goes back to the old question.
// `tests/permissions.test.ts` pins who holds it.
// ---------------------------------------------------------------------------

const source = (path: string) => readFileSync(path, 'utf8')

describe('every door to the DQF asks `dqf`', () => {
  it('the roster refuses before it reads, and reads under `dqf`', () => {
    const page = source('src/app/(app)/safety/dqf/page.tsx')
    expect(page).toMatch(
      /if \(!\(await currentUserCan\('read', 'dqf'\)\)\) notFound\(\)/,
    )
    expect(page).toMatch(/withCurrentOrg\(\s*'read',\s*'dqf',/)
    expect(page).not.toMatch(/currentUserCan\('read', 'compliance'\)/)
  })

  it('the Safety hub draws the roster link only for a role that holds it', () => {
    const page = source('src/app/(app)/safety/page.tsx')
    expect(page).toMatch(
      /const maySeeDqf = await currentUserCan\('read', 'dqf'\)/,
    )
    expect(page).toMatch(/\{maySeeDqf \? \(\s*<Link\s+href="\/safety\/dqf"/)
  })

  it('the driver record renders the checklist only behind `dqf`', () => {
    const page = source('src/app/(app)/drivers/[id]/page.tsx')
    expect(page).toMatch(
      /const maySeeDqf = await currentUserCan\('read', 'dqf'\)/,
    )
    expect(page).toMatch(
      /\{tab === 'safety' && maySeeDqf \? \(\s*<div className="max-w-\[900px\]">\s*<DqfPanel/,
    )
  })
})
