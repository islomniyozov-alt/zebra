import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import type { Role } from '@/generated/prisma/client'
import { can, type AuthorizedSession } from '@/lib/permissions'
import { withoutDqfGaps, type Warning } from '@/lib/warnings'

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

// ---------------------------------------------------------------------------
// THE FLAG IS NOT THE FILE (§6.8, owner's ruling on GAPS 23, 2026-10-11).
//
// "DQF incomplete" on the drivers list and the dashboard's DQF ring are
// readiness signals — an unready driver does not get a paid load — so
// accounting sees them. The file's documents, gaps and dates stay behind
// `dqf`: accounting sees the flag, never which items are missing, and the
// roster refuses it.
// ---------------------------------------------------------------------------

const session = (role: Role): AuthorizedSession => ({
  userId: 'cms59hb1s0000tgvsyq75inm2',
  organizationId: 'cms59hc0u0002tgvsqcq9ehtx',
  role,
  companyScopes: [],
})

const warnings: Warning[] = [
  { name: 'dqf_incomplete', detail: 'Medical card, MVR' },
  { name: 'compliance_expired', detail: 'MEDICAL_CARD' },
]

describe('accounting sees the flag and cannot open the roster', () => {
  const accounting = session('ACCOUNTING')

  it('reads what the flag answers to, and not the file', () => {
    expect(can(accounting, 'read', 'driver')).toBe(true)
    expect(can(accounting, 'read', 'compliance')).toBe(true)
    expect(can(accounting, 'read', 'dqf')).toBe(false)
  })

  it('keeps the warning and loses the named gaps', () => {
    const seen = withoutDqfGaps(warnings, can(accounting, 'read', 'dqf'))
    expect(seen).toEqual([
      { name: 'dqf_incomplete', detail: '' },
      { name: 'compliance_expired', detail: 'MEDICAL_CARD' },
    ])
  })

  it('a role that reads the file keeps the gaps', () => {
    expect(
      withoutDqfGaps(warnings, can(session('DISPATCHER'), 'read', 'dqf')),
    ).toEqual(warnings)
  })

  it('the drivers list applies it, and the dashboard ring stays on compliance', () => {
    const list = source('src/app/(app)/drivers/page.tsx')
    expect(list).toMatch(
      /const maySeeDqf = await currentUserCan\('read', 'dqf'\)/,
    )
    expect(list).toMatch(
      /warnings: withoutDqfGaps\(\s*driverWarnings\(driverFacts, now\)\.map\(namedGaps\),\s*maySeeDqf,\s*\)/,
    )
    const dashboard = source('src/app/(app)/dashboard/page.tsx')
    expect(dashboard).toMatch(
      /const maySeeCompliance = await currentUserCan\('read', 'compliance'\)/,
    )
    expect(dashboard).toMatch(
      /maySeeCompliance\s*\?\s*withCurrentOrg\([\s\S]{0,120}dqfSplit\(/,
    )
  })
})
