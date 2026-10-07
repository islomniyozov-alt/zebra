import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  EMPTY_TABS,
  RECORD_TABS,
  recordTabFor,
  visibleRecordTabs,
} from '@/lib/driver-record'

// ---------------------------------------------------------------------------
// §6.4 PART 2 — the driver record's eleven tabs, held to the brief and the doc.
// ---------------------------------------------------------------------------

describe('the eleven tabs', () => {
  it("are the brief's names in the brief's order", () => {
    // COUNTED AGAINST THE BRIEF AS TRANSCRIBED, and against §6.4's own list —
    // a tab added to the page and not to either fails by name.
    const brief = readFileSync('docs/QUEUE.md', 'utf8')
    expect(brief).toContain(
      'Main · Documents · Mobile app login ·\n   Recruiting · Accounting',
    )
    const doc = readFileSync('TMS-DESIGN-SYSTEM.md', 'utf8')
    for (const word of [
      '**Main**',
      '**Documents**',
      '**Mobile app login**',
      '**Recruiting**',
      '**Accounting**',
      '**Safety**',
      '**Assets**',
      '**Statistics**',
      '**Log history**',
      '**Tasks**',
      '**Others**',
    ]) {
      expect(doc, word).toContain(word)
    }
    expect([...RECORD_TABS]).toEqual([
      'main',
      'documents',
      'mobile',
      'recruiting',
      'accounting',
      'safety',
      'assets',
      'statistics',
      'log',
      'tasks',
      'others',
    ])
  })

  it('opens Main by default and for a stale link', () => {
    expect(recordTabFor(undefined)).toBe('main')
    expect(recordTabFor('')).toBe('main')
    expect(recordTabFor('payroll')).toBe('main')
    expect(recordTabFor('safety')).toBe('safety')
  })

  it('names the three tabs that say so in words, and no more', () => {
    expect([...EMPTY_TABS]).toEqual(['mobile', 'recruiting', 'tasks'])
  })

  it('does not render a tab a role may not see', () => {
    const dispatcher = visibleRecordTabs({
      maySeePay: false,
      maySeeCompliance: true,
      maySeeInspections: true,
    })
    expect(dispatcher).not.toContain('accounting')
    expect(dispatcher).toContain('safety')

    const nobody = visibleRecordTabs({
      maySeePay: false,
      maySeeCompliance: false,
      maySeeInspections: false,
    })
    expect(nobody).not.toContain('documents')
    expect(nobody).not.toContain('safety')
    expect(nobody).toContain('main')
    expect(nobody).toContain('log')

    const owner = visibleRecordTabs({
      maySeePay: true,
      maySeeCompliance: true,
      maySeeInspections: true,
    })
    expect(owner).toEqual([...RECORD_TABS])
  })
})
