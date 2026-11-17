import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  dqfChecklist,
  dqfEntryFor,
  dqfFactsAfter,
  dqfOnFileDocument,
  dqfOnFileRecord,
  dqfRowAction,
  dqfRowSatisfied,
  DQF_REQUIREMENTS,
  type DqfFacts,
  type DqfFiledDocument,
  type DqfFiledRecord,
} from '@/lib/dqf'

// ---------------------------------------------------------------------------
// EVERY DQF ROW ITS ACTION, AND THE ACTION AGREES WITH THE ROW (§6.4 part 2
// v11.30; safety team on dev, 2026-11-17).
//
// The checklist read "Missing — Since No hire date recorded" nine times and
// offered nothing. Each row now offers the act that satisfies it, derived from
// its evidence (`dqfRowAction`). The risk in two derivations of one rule is
// that they drift: a row whose button files something the row does not read
// is a button that turns nothing green. So the agreement is the test:
//
//   every UNSATISFIED row: its action, applied, satisfies the predicate;
//   every SATISFIED row with a link: the linked document is evidence the
//   predicate reads (its kind, or attached to a record of its type).
//
// Over FIXTURE FILES that put rows on both sides — and the counts of each side
// are asserted above zero, because an agreement over an empty side is true of
// anything.
// ---------------------------------------------------------------------------

const NOW = new Date('2026-11-17T12:00:00.000Z')
const days = (n: number) => new Date(NOW.getTime() + n * 86_400_000)

interface FixtureFile {
  name: string
  facts: DqfFacts
  documents: DqfFiledDocument[]
  records: DqfFiledRecord[]
}

/** The facts the checklist reads, derived from the files — never stated twice. */
function file(
  name: string,
  hireDate: Date | null,
  documents: Omit<DqfFiledDocument, 'filename'>[],
  records: (Omit<DqfFiledRecord, 'documents' | 'isSuperseded'> & {
    attached?: string
    isSuperseded?: boolean
  })[],
): FixtureFile {
  const filed = documents.map((document) => ({
    ...document,
    filename: `${document.type.toLowerCase()}-${document.id}.pdf`,
  }))
  const kept = records.map((record) => ({
    id: record.id,
    type: record.type,
    expiresAt: record.expiresAt,
    isSuperseded: record.isSuperseded ?? false,
    documents: record.attached
      ? [{ id: record.attached, filename: `${record.attached}.pdf` }]
      : [],
  }))
  return {
    name,
    facts: {
      hireDate,
      compliance: kept
        .filter((record) => !record.isSuperseded)
        .map((record) => ({ type: record.type, expiresAt: record.expiresAt })),
      documents: filed.map((document) => document.type),
    },
    documents: filed,
    records: kept,
  }
}

const FIXTURES: FixtureFile[] = [
  // The safety team's driver: nothing on file, no hire date.
  file('empty, no hire date', null, [], []),
  // Everything filed and current; the CDL row by its copy.
  file(
    'complete',
    days(-400),
    [
      { id: 'd1', type: 'EMPLOYMENT_APPLICATION', uploadedAt: days(-400) },
      { id: 'd2', type: 'EMPLOYMENT_VERIFICATION', uploadedAt: days(-399) },
      { id: 'd3', type: 'ROAD_TEST_CERTIFICATE', uploadedAt: days(-398) },
      { id: 'd4', type: 'CDL_COPY', uploadedAt: days(-397) },
    ],
    [
      { id: 'r1', type: 'MVR', expiresAt: days(200), attached: 'a1' },
      { id: 'r2', type: 'ANNUAL_REVIEW', expiresAt: days(150) },
      { id: 'r3', type: 'MEDICAL_CARD', expiresAt: days(300), attached: 'a3' },
      { id: 'r4', type: 'CLEARINGHOUSE_QUERY', expiresAt: days(90) },
    ],
  ),
  // Mixed: the CDL row by the record alone, an expired MVR, a due medical,
  // a superseded clearinghouse behind a current one.
  file(
    'mixed',
    days(-100),
    [{ id: 'd5', type: 'EMPLOYMENT_APPLICATION', uploadedAt: days(-100) }],
    [
      { id: 'r5', type: 'CDL', expiresAt: days(700), attached: 'a5' },
      { id: 'r6', type: 'MVR', expiresAt: days(-3) },
      { id: 'r7', type: 'MEDICAL_CARD', expiresAt: days(10) },
      {
        id: 'r8',
        type: 'CLEARINGHOUSE_QUERY',
        // A LATER EXPIRY THAN THE CURRENT ONE, so only the supersession filter
        // keeps it out — newest-first alone would pick it (a guard that did not
        // fire on 2026-11-17 until this was so).
        expiresAt: days(400),
        isSuperseded: true,
        attached: 'a8',
      },
      { id: 'r9', type: 'CLEARINGHOUSE_QUERY', expiresAt: days(165) },
    ],
  ),
]

describe('one predicate per row', () => {
  it('the checklist is the predicate’s entries, row for row', () => {
    for (const fixture of FIXTURES) {
      expect(dqfChecklist(fixture.facts, NOW)).toEqual(
        DQF_REQUIREMENTS.map((r) => dqfEntryFor(r, fixture.facts, NOW)),
      )
    }
  })

  it('satisfied means present or due, nothing else', () => {
    for (const fixture of FIXTURES) {
      for (const requirement of DQF_REQUIREMENTS) {
        const { status } = dqfEntryFor(requirement, fixture.facts, NOW)
        expect(dqfRowSatisfied(requirement, fixture.facts, NOW)).toBe(
          status === 'present' || status === 'due',
        )
      }
    }
  })
})

describe('every row its action (§6.4 part 2 v11.30)', () => {
  it('derives the action from the evidence', () => {
    const byKey = Object.fromEntries(
      DQF_REQUIREMENTS.map((r) => [r.key, dqfRowAction(r)]),
    )
    expect(byKey.hire_date).toEqual({ kind: 'main', field: 'hireDate' })
    expect(byKey.application).toEqual({
      kind: 'upload',
      documentType: 'EMPLOYMENT_APPLICATION',
    })
    expect(byKey.prior_employers).toEqual({
      kind: 'upload',
      documentType: 'EMPLOYMENT_VERIFICATION',
    })
    expect(byKey.road_test).toEqual({
      kind: 'upload',
      documentType: 'ROAD_TEST_CERTIFICATE',
    })
    expect(byKey.cdl_copy).toEqual({ kind: 'upload', documentType: 'CDL_COPY' })
    for (const key of [
      'mvr',
      'annual_review',
      'medical_certificate',
      'clearinghouse',
    ])
      expect(byKey[key]?.kind).toBe('record')
  })

  it('AGREEMENT: the action satisfies every unsatisfied row; every link is evidence the row reads — both sides above zero', () => {
    let unsatisfied = 0
    let linked = 0
    const named: string[] = []
    for (const fixture of FIXTURES) {
      for (const requirement of DQF_REQUIREMENTS) {
        const satisfied = dqfRowSatisfied(requirement, fixture.facts, NOW)
        if (!satisfied) {
          unsatisfied += 1
          const after = dqfFactsAfter(
            dqfRowAction(requirement),
            fixture.facts,
            NOW,
          )
          if (!dqfRowSatisfied(requirement, after, NOW))
            named.push(
              `${fixture.name} / ${requirement.key}: action does not satisfy`,
            )
          continue
        }
        const link = dqfOnFileDocument(
          requirement,
          fixture.documents,
          fixture.records,
        )
        if (!link) continue
        linked += 1
        // THE LINKED FILE IS EVIDENCE THIS ROW READS: a document of its kind
        // on the driver, or a file on a live record of its type.
        const asDocument = fixture.documents.find((d) => d.id === link.id)
        const asRecord = fixture.records.find((r) =>
          r.documents.some((d) => d.id === link.id),
        )
        const reads = asDocument
          ? dqfRowSatisfied(
              requirement,
              { hireDate: null, compliance: [], documents: [asDocument.type] },
              NOW,
            )
          : asRecord
            ? !asRecord.isSuperseded &&
              dqfRowSatisfied(
                requirement,
                {
                  hireDate: null,
                  compliance: [
                    { type: asRecord.type, expiresAt: asRecord.expiresAt },
                  ],
                  documents: [],
                },
                NOW,
              )
            : false
        if (!reads)
          named.push(
            `${fixture.name} / ${requirement.key}: link ${link.id} is not its evidence`,
          )
      }
    }
    expect(named).toEqual([])
    expect(unsatisfied).toBeGreaterThan(0)
    expect(linked).toBeGreaterThan(0)
  })

  it('links the newest document of the kind, and a superseded record’s file never', () => {
    const mixed = FIXTURES[2]!
    const clearinghouse = DQF_REQUIREMENTS.find(
      (r) => r.key === 'clearinghouse',
    )!
    // r9 is current with nothing attached; r8's file is history.
    expect(
      dqfOnFileDocument(clearinghouse, mixed.documents, mixed.records),
    ).toBeNull()
    expect(dqfOnFileRecord(clearinghouse, mixed.records)?.id).toBe('r9')
    const cdl = DQF_REQUIREMENTS.find((r) => r.key === 'cdl_copy')!
    // No CDL_COPY on the driver: the licence record's own file.
    expect(dqfOnFileDocument(cdl, mixed.documents, mixed.records)?.id).toBe(
      'a5',
    )
  })

  it('the hire-date row alone prints "no hire date recorded"', () => {
    const page = readFileSync('src/app/(app)/drivers/[id]/page.tsx', 'utf8')
    expect(page).toMatch(
      /entry\.key === 'hire_date' && entry\.status === 'missing'\s*\?\s*t\('dqf\.since\.unknown'\)/,
    )
  })

  it('the page derives each row’s action with dqfRowAction, gated by the writer’s permission', () => {
    const page = readFileSync('src/app/(app)/drivers/[id]/page.tsx', 'utf8')
    expect(page).toMatch(/const action = dqfRowAction\(requirement\)/)
    expect(page).toMatch(/return mayEdit\s*\?\s*\{ kind: 'main'/)
    expect(page).toMatch(/return mayUploadDocument\s*\?/)
    expect(page).toMatch(/return mayRenewCompliance\s*\?/)
  })
})
