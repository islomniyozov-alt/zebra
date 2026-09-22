import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  dqfChecklist,
  dqfIncompleteCount,
  isQualifiable,
  DQF_COMPLIANCE_TYPES,
  DQF_DOCUMENT_TYPES,
  DQF_LEAD_DAYS,
  DQF_REQUIREMENTS,
  type DqfFacts,
  type DqfKey,
} from '@/lib/dqf'
import {
  driverWarnings,
  NO_DRIVER_FACTS,
  REQUIRED_DRIVER_DOCUMENTS,
  type DriverFacts,
} from '@/lib/warnings'

// ---------------------------------------------------------------------------
// ITEM 13 — ONE DEFINITION OF A QUALIFIED DRIVER.
//
// 49 CFR 391.51 is a list an auditor walks. Zebra held two of its eight items
// in a hand-written array and the other six nowhere. These are the rules that
// keep it one list, and the four failures the ruling named.
// ---------------------------------------------------------------------------

const NOW = new Date(Date.UTC(2026, 8, 21, 12, 0, 0))
const days = (n: number) => new Date(NOW.getTime() + n * 86_400_000)

/** Every requirement on file and current. */
const COMPLETE: DqfFacts = {
  hireDate: days(-500),
  compliance: DQF_COMPLIANCE_TYPES.map((type) => ({
    type: type as string,
    expiresAt: days(300) as Date | null,
  })),
  documents: [...DQF_DOCUMENT_TYPES],
}

const without = (key: DqfKey): DqfFacts => {
  const requirement = DQF_REQUIREMENTS.find((r) => r.key === key)!
  if (requirement.evidence.kind === 'document') {
    const type = requirement.evidence.type as string
    return {
      ...COMPLETE,
      documents: COMPLETE.documents.filter((d) => d !== type),
    }
  }
  const type = requirement.evidence.type as string
  return {
    ...COMPLETE,
    compliance: COMPLETE.compliance.filter((c) => c.type !== type),
  }
}

const statusOf = (facts: DqfFacts, key: DqfKey) =>
  dqfChecklist(facts, NOW).find((entry) => entry.key === key)!

describe('the definition', () => {
  it('is the eight items 391.51 lists, each with its section', () => {
    expect(DQF_REQUIREMENTS).toHaveLength(8)
    for (const requirement of DQF_REQUIREMENTS) {
      expect(requirement.cfr).toMatch(/^\d{3}\./)
    }
    expect(DQF_REQUIREMENTS.map((r) => r.key).sort()).toEqual([
      'annual_review',
      'application',
      'cdl_copy',
      'clearinghouse',
      'medical_certificate',
      'mvr',
      'prior_employers',
      'road_test',
    ])
  })

  it('keeps the MVR and the review of it as two items', () => {
    // §391.25(a) is obtaining the record; §391.25(b) is a person at the
    // carrier reviewing it and saying so. A carrier that pulls the MVR and
    // never reviews it has one of the two, and an audit finds exactly that.
    const mvr = DQF_REQUIREMENTS.find((r) => r.key === 'mvr')!
    const review = DQF_REQUIREMENTS.find((r) => r.key === 'annual_review')!
    expect(mvr.evidence).not.toEqual(review.evidence)
    expect(mvr.cadence).toBe('annual')
    expect(review.cadence).toBe('annual')
  })

  it('splits the evidence by whether the thing expires', () => {
    // An employment application does not expire and `ComplianceItem.expiresAt`
    // is NOT NULL — so filing one there would mean inventing a date.
    for (const requirement of DQF_REQUIREMENTS) {
      if (requirement.cadence === 'annual') {
        expect(requirement.evidence.kind).toBe('compliance')
      }
    }
    expect(DQF_COMPLIANCE_TYPES.length + DQF_DOCUMENT_TYPES.length).toBe(8)
  })
})

// ── THE GUARD NAMED "two definitions of required" ───────────────────────
describe('one definition of required', () => {
  it('has item 9 reading this list rather than its own', () => {
    for (const type of DQF_COMPLIANCE_TYPES) {
      expect(REQUIRED_DRIVER_DOCUMENTS).toContain(type)
    }
  })

  it('leaves no hand-written list behind in warnings.ts', () => {
    // The literal that was there: `['CDL', 'MEDICAL_CARD']`. A second list is
    // two chances to add a requirement to one of them, and the copy that does
    // not get updated is the one nobody is looking at when the auditor
    // arrives.
    const source = readFileSync('src/lib/warnings.ts', 'utf8')
    expect(source).toContain('DQF_COMPLIANCE_TYPES')
    expect(source).not.toMatch(
      /REQUIRED_DRIVER_DOCUMENTS = \[\s*'CDL',\s*'MEDICAL_CARD',?\s*\]/,
    )
  })

  it('grows item 9 the moment the definition grows', () => {
    // The relationship, not the current contents: a requirement added to
    // dqf.ts is required by the warning without anybody editing warnings.ts.
    expect(REQUIRED_DRIVER_DOCUMENTS.length).toBeGreaterThanOrEqual(
      DQF_COMPLIANCE_TYPES.length,
    )
  })
})

describe('the checklist', () => {
  it('reads a complete file as complete', () => {
    const entries = dqfChecklist(COMPLETE, NOW)
    expect(entries.every((entry) => entry.status === 'present')).toBe(true)
    expect(dqfIncompleteCount(entries)).toBe(0)
  })

  // ── THE GUARD NAMED "an expired item read as present" ─────────────────
  it('reads a lapsed record as EXPIRED, never as present', () => {
    const lapsed: DqfFacts = {
      ...COMPLETE,
      compliance: [
        { type: 'MEDICAL_CARD', expiresAt: days(-1) },
        ...COMPLETE.compliance.filter((c) => c.type !== 'MEDICAL_CARD'),
      ],
    }
    const entry = statusOf(lapsed, 'medical_certificate')
    expect(entry.status).toBe('expired')
    expect(entry.dueSince).toEqual(days(-1))
    expect(dqfIncompleteCount(dqfChecklist(lapsed, NOW))).toBe(1)
  })

  it('reads a renewal inside the window as DUE, which still qualifies', () => {
    const soon: DqfFacts = {
      ...COMPLETE,
      compliance: [
        { type: 'MEDICAL_CARD', expiresAt: days(DQF_LEAD_DAYS - 1) },
        ...COMPLETE.compliance.filter((c) => c.type !== 'MEDICAL_CARD'),
      ],
    }
    expect(statusOf(soon, 'medical_certificate').status).toBe('due')
    // DUE IS NOT INCOMPLETE. A number that never reaches zero is a number
    // nobody chases.
    expect(dqfIncompleteCount(dqfChecklist(soon, NOW))).toBe(0)
  })

  it('lets the LATEST record decide, not the first one found', () => {
    const renewed: DqfFacts = {
      ...COMPLETE,
      compliance: [
        { type: 'MVR', expiresAt: days(-40) },
        { type: 'MVR', expiresAt: days(300) },
        ...COMPLETE.compliance.filter((c) => c.type !== 'MVR'),
      ],
    }
    expect(statusOf(renewed, 'mvr').status).toBe('present')
  })

  it('dates a missing item from the hire date', () => {
    const entry = statusOf(without('application'), 'application')
    expect(entry.status).toBe('missing')
    expect(entry.dueSince).toEqual(days(-500))
  })

  it('leaves the date null when nobody recorded a hire date', () => {
    // An absence, not a licence to ignore it: the entry is still missing.
    const entry = statusOf(
      { ...without('application'), hireDate: null },
      'application',
    )
    expect(entry.status).toBe('missing')
    expect(entry.dueSince).toBeNull()
  })

  it('finds every item missing for a driver with nothing on file', () => {
    const empty: DqfFacts = { hireDate: null, compliance: [], documents: [] }
    const entries = dqfChecklist(empty, NOW)
    expect(entries.every((entry) => entry.status === 'missing')).toBe(true)
    expect(dqfIncompleteCount(entries)).toBe(8)
  })
})

describe('who has to be qualified', () => {
  it('is everybody on the roster, holiday included', () => {
    expect(isQualifiable({ status: 'AVAILABLE', deletedAt: null })).toBe(true)
    // Somebody on holiday comes back on Monday and their card must be valid.
    expect(isQualifiable({ status: 'VACATION', deletedAt: null })).toBe(true)
  })

  it('is NOT somebody who no longer drives here', () => {
    // §391.51(c): the file is KEPT for three years, not kept current.
    expect(isQualifiable({ status: 'INACTIVE', deletedAt: null })).toBe(false)
    expect(isQualifiable({ status: 'AVAILABLE', deletedAt: NOW })).toBe(false)
  })
})

describe('the warning', () => {
  const facts = (over: Partial<DriverFacts>): DriverFacts => ({
    ...NO_DRIVER_FACTS,
    hireDate: COMPLETE.hireDate,
    documents: [...COMPLETE.documents],
    compliance: REQUIRED_DRIVER_DOCUMENTS.map((type) => ({
      type: type as string,
      expiresAt: days(300) as Date | null,
    })),
    qualifiable: true,
    ...over,
  })

  const names = (warnings: { name: string }[]) => warnings.map((w) => w.name)

  it('says nothing about a complete file', () => {
    expect(names(driverWarnings(facts({}), NOW))).not.toContain(
      'dqf_incomplete',
    )
  })

  // ── THE GUARD NAMED "a missing item not warned" ───────────────────────
  it('warns when a DOCUMENT-backed item is missing', () => {
    // The three at-hire items are the ones item 9's per-type warning cannot
    // see at all, because it only walks compliance records. If this stops
    // firing, half the file is unwatched and nothing else says so.
    const out = driverWarnings(facts({ documents: [] }), NOW)
    expect(names(out)).toContain('dqf_incomplete')
    // NAMED, NOT COUNTED. A row reading "4" sends somebody to the driver
    // page to find out which four; the names are the thing they were going
    // to look up.
    expect(out.find((w) => w.name === 'dqf_incomplete')?.detail).toBe(
      'application,prior_employers,road_test,cdl_copy',
    )
  })

  it('warns when a compliance-backed item has lapsed', () => {
    const out = driverWarnings(
      facts({
        compliance: [
          { type: 'MVR', expiresAt: days(-2) },
          ...REQUIRED_DRIVER_DOCUMENTS.filter((t) => t !== 'MVR').map(
            (type) => ({
              type: type as string,
              expiresAt: days(300) as Date | null,
            }),
          ),
        ],
      }),
      NOW,
    )
    expect(names(out)).toContain('dqf_incomplete')
  })

  // ── THE GUARD NAMED "closed history drivers counted" ──────────────────
  it('is SILENT for a driver who no longer drives here', () => {
    // 69 terminated drivers and 39 applicants came over in the import.
    // Warning on each would be 108 alarms about nobody, and item 9's
    // closed-history rule is the same rule said about freight.
    const out = driverWarnings(
      facts({ documents: [], compliance: [], qualifiable: false }),
      NOW,
    )
    expect(names(out)).not.toContain('dqf_incomplete')
  })

  it('and the roster view applies the same predicate', () => {
    const page = readFileSync('src/app/(app)/safety/dqf/page.tsx', 'utf8')
    expect(page).toContain('isQualifiable')
    expect(page).toContain("status: { not: 'INACTIVE' }")
  })
})

describe('nothing about the file is stored', () => {
  it('has no completeness column anywhere on Driver', () => {
    const schema = readFileSync('prisma/schema.prisma', 'utf8')
    expect(schema).not.toMatch(/dqfComplete\s+/)
    expect(schema).not.toMatch(/dqfMissing\s+/)
    expect(schema).not.toMatch(/qualifiedAt\s+/)
  })
})
