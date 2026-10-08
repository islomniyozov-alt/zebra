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
  const evidence = requirement.evidence
  if (evidence.kind === 'fact') return { ...COMPLETE, hireDate: null }
  if (evidence.kind === 'document' || evidence.kind === 'either') {
    const type = (
      evidence.kind === 'document' ? evidence.type : evidence.document
    ) as string
    return {
      ...COMPLETE,
      documents: COMPLETE.documents.filter((d) => d !== type),
    }
  }
  const type = evidence.type as string
  return {
    ...COMPLETE,
    compliance: COMPLETE.compliance.filter((c) => c.type !== type),
  }
}

const statusOf = (facts: DqfFacts, key: DqfKey) =>
  dqfChecklist(facts, NOW).find((entry) => entry.key === key)!

describe('the definition', () => {
  it('is the eight items 391.51 lists plus the date they are dated from, each with its section', () => {
    // NINE SINCE QUEUE ITEM 20 (4): the hire date is a row of its own, first,
    // because every at-hire row is dated from it and a file with none read
    // "8 of 8 missing — no hire date recorded" against a date nobody typed.
    expect(DQF_REQUIREMENTS).toHaveLength(9)
    expect(DQF_REQUIREMENTS[0]?.key).toBe('hire_date')
    for (const requirement of DQF_REQUIREMENTS) {
      expect(requirement.cfr).toMatch(/^\d{3}\./)
    }
    expect(DQF_REQUIREMENTS.map((r) => r.key).sort()).toEqual([
      'annual_review',
      'application',
      'cdl_copy',
      'clearinghouse',
      'hire_date',
      'medical_certificate',
      'mvr',
      'prior_employers',
      'road_test',
    ])
  })

  it('lets the licence record stand in for the copy of the CDL', () => {
    // Queue item 20 (4): the copy OR the live CDL compliance record. The
    // record stays out of DQF_COMPLIANCE_TYPES because its expiry already
    // warns through Phase 4 — one date, one warning.
    const copy = DQF_REQUIREMENTS.find((r) => r.key === 'cdl_copy')!
    expect(copy.evidence).toEqual({
      kind: 'either',
      document: 'CDL_COPY',
      compliance: 'CDL',
    })
    expect(DQF_COMPLIANCE_TYPES).not.toContain('CDL')
    expect(DQF_DOCUMENT_TYPES).toContain('CDL_COPY')
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
    expect(dqfIncompleteCount(entries)).toBe(9)
  })

  // ── QUEUE ITEM 20 (4): the licence record, and the hire date as a row ──
  it('reads the copy of the CDL as present from the document alone', () => {
    const entry = statusOf(COMPLETE, 'cdl_copy')
    expect(entry.status).toBe('present')
    expect(entry.dueSince).toBeNull()
  })

  it('reads the copy of the CDL from the licence record when there is no document, by its date', () => {
    const recordOnly: DqfFacts = {
      ...without('cdl_copy'),
      compliance: [
        ...COMPLETE.compliance,
        { type: 'CDL', expiresAt: days(300) },
      ],
    }
    expect(statusOf(recordOnly, 'cdl_copy').status).toBe('present')

    const dueSoon: DqfFacts = {
      ...recordOnly,
      compliance: [
        ...COMPLETE.compliance,
        { type: 'CDL', expiresAt: days(DQF_LEAD_DAYS - 1) },
      ],
    }
    expect(statusOf(dueSoon, 'cdl_copy').status).toBe('due')

    // A LAPSED LICENCE IS NOT A COPY ON FILE. The production walk's file had a
    // live record; a dead one must not pass for one.
    const lapsed: DqfFacts = {
      ...recordOnly,
      compliance: [
        ...COMPLETE.compliance,
        { type: 'CDL', expiresAt: days(-1) },
      ],
    }
    const entry = statusOf(lapsed, 'cdl_copy')
    expect(entry.status).toBe('expired')
    expect(entry.dueSince).toEqual(days(-1))
    expect(dqfIncompleteCount(dqfChecklist(lapsed, NOW))).toBe(1)

    // And neither: missing, dated from the hire date like any at-hire item.
    const neither = statusOf(without('cdl_copy'), 'cdl_copy')
    expect(neither.status).toBe('missing')
    expect(neither.dueSince).toEqual(days(-500))
  })

  it('counts a missing hire date as its own row, not against every other one', () => {
    const noDate: DqfFacts = { ...COMPLETE, hireDate: null }
    const entries = dqfChecklist(noDate, NOW)
    const row = entries.find((entry) => entry.key === 'hire_date')!
    expect(row.status).toBe('missing')
    // Nothing to be "since": the date IS the thing that is missing.
    expect(row.dueSince).toBeNull()
    // Every other row is on file and present; the file is one short, not nine.
    expect(dqfIncompleteCount(entries)).toBe(1)
    expect(statusOf(COMPLETE, 'hire_date').status).toBe('present')
  })
})

describe('who has to be qualified', () => {
  /** A person, unless a case says otherwise. */
  const person = { kind: 'PERSON' }

  it('is everybody on the roster, holiday included', () => {
    expect(
      isQualifiable({ ...person, status: 'AVAILABLE', deletedAt: null }),
    ).toBe(true)
    // Somebody on holiday comes back on Monday and their card must be valid.
    expect(
      isQualifiable({ ...person, status: 'VACATION', deletedAt: null }),
    ).toBe(true)
  })

  it('is NOT somebody who no longer drives here', () => {
    // §391.51(c): the file is KEPT for three years, not kept current.
    expect(
      isQualifiable({ ...person, status: 'INACTIVE', deletedAt: null }),
    ).toBe(false)
    expect(
      isQualifiable({ ...person, status: 'AVAILABLE', deletedAt: NOW }),
    ).toBe(false)
  })

  // ── A REFERRAL PAYEE HAS NO FILE (owner's ruling, 2026-09-24) ──────────
  it('is NOT a referral payee, however active the row is', () => {
    // `7 Star` is a commission on another driver's loads. It will never produce
    // a medical certificate or a road test, so its DQF would be permanently
    // incomplete — and a checklist that can never reach complete is what
    // teaches people to scroll past the reds that matter.
    //
    // AVAILABLE ON PURPOSE. The ruling forbids inactivating these rows, because
    // that would stop paying them, so the roster status cannot be what excludes
    // them here.
    expect(
      isQualifiable({ kind: 'PAYEE', status: 'AVAILABLE', deletedAt: null }),
    ).toBe(false)
  })

  it('is still a person when the kind is something nobody has defined yet', () => {
    // `not: 'PAYEE'` rather than `equals: 'PERSON'`, and this is the reason: a
    // future kind should keep appearing in the compliance lists until somebody
    // decides otherwise. Appearing wrongly gets noticed; vanishing does not.
    expect(
      isQualifiable({ kind: 'AGENCY', status: 'AVAILABLE', deletedAt: null }),
    ).toBe(true)
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
    // THE COPY OF THE CDL IS NOT AMONG THEM since queue item 20 (4): the
    // fixture's live CDL compliance record stands in for the document, which
    // is the whole change — and the hire date is recorded, so its row is
    // present too.
    expect(out.find((w) => w.name === 'dqf_incomplete')?.detail).toBe(
      'application,prior_employers,road_test',
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
