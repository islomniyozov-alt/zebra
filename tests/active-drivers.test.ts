import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { activeDriversWhere, WORKING_STATUSES } from '@/lib/driver-list'
import { driverHealthBase } from '@/lib/data-health'

// ---------------------------------------------------------------------------
// §6.6 — "ACTIVE" IS ONE PREDICATE (queue item 20 (6)). The accident register's
// picker and the drivers' data-health base read the same function, so the word
// means one thing on every screen that says it.
// ---------------------------------------------------------------------------

describe('the active drivers', () => {
  it('are live rows on a working roster value, and people', () => {
    expect(activeDriversWhere()).toEqual({
      deletedAt: null,
      status: { in: [...WORKING_STATUSES] },
      kind: { not: 'PAYEE' },
    })
  })

  it('are what the data-health base counts over, by the same function', () => {
    expect(driverHealthBase()).toEqual(activeDriversWhere())
    const source = readFileSync(join('src', 'lib', 'data-health.ts'), 'utf8')
    expect(source).toContain('return activeDriversWhere()')
  })

  it('are what the accident register offers, scoped to the authority', () => {
    const page = readFileSync(
      join('src', 'app', '(app)', 'safety', 'accidents', 'page.tsx'),
      'utf8',
    )
    expect(page).toContain(
      'where: { companyId: chosen, ...activeDriversWhere() }',
    )
    // The old predicate — every row that is not removed — is gone from the
    // DRIVER picker, so a terminated driver or a payee is not offered. The
    // trucks query beside it keeps that shape on purpose: a truck has no
    // roster, and an accident can involve one that is since out of service.
    expect(page).not.toMatch(
      /tx\.driver\.findMany\(\{\s*where: \{ companyId: chosen, deletedAt: null \}/,
    )
  })

  it('is specified before the code', () => {
    const doc = readFileSync('TMS-DESIGN-SYSTEM.md', 'utf8')
    expect(doc).toContain(
      "### 6.6 Safety — the accident register's driver picker",
    )
  })
})
