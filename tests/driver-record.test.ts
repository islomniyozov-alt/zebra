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
      // "Mobile app login" until 2026-11-12; the brief's transcript keeps
      // the old name, the doc carries the new one beside it.
      '**Sign-in**',
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

  it('names the two tabs that say so in words, and no more', () => {
    // Three until 2026-11-12: `mobile` became the Sign-in tab (Phase 7 step
    // 1) and holds the link, so it left this list.
    expect([...EMPTY_TABS]).toEqual(['recruiting', 'tasks'])
  })

  it('does not render a tab a role may not see', () => {
    const dispatcher = visibleRecordTabs({
      maySeePay: false,
      maySeeCompliance: true,
      maySeeInspections: true,
      maySetSignIn: false,
    })
    expect(dispatcher).not.toContain('accounting')
    expect(dispatcher).toContain('safety')
    // THE SIGN-IN TAB IS OWNER/ADMIN'S (`user:update`, Phase 7 §4.6): a
    // MANAGER edits the driver and never sees who signs in as them.
    expect(dispatcher).not.toContain('mobile')

    const nobody = visibleRecordTabs({
      maySeePay: false,
      maySeeCompliance: false,
      maySeeInspections: false,
      maySetSignIn: false,
    })
    expect(nobody).not.toContain('documents')
    expect(nobody).not.toContain('safety')
    expect(nobody).not.toContain('mobile')
    expect(nobody).toContain('main')
    expect(nobody).toContain('log')

    const owner = visibleRecordTabs({
      maySeePay: true,
      maySeeCompliance: true,
      maySeeInspections: true,
      maySetSignIn: true,
    })
    expect(owner).toEqual([...RECORD_TABS])
  })
})
