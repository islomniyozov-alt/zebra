import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import {
  dayFromParam,
  isBatchPeriod,
  lastFullSettlementWeek,
  weekOf,
  type Week,
} from '@/lib/settlement-week'
import { batchOverlapWhere, openBatch } from '@/lib/settlement-batch'
import { translator } from '@/lib/i18n'

// §6.2.10 part 7 step 2 — Create batch (owner's rulings R1, R2, R3 and the
// overlap ruling, 2026-11-17): a free range pre-filled with the last full
// week, no overlap per authority, the authority required.

const d = (iso: string) => new Date(`${iso}T00:00:00.000Z`)
const p = (from: string, to: string): Week => ({ start: d(from), end: d(to) })
const read = (path: string) => readFileSync(path, 'utf8')

describe('a batch period is any whole-day range (R1)', () => {
  it('accepts a week, two weeks, a single day', () => {
    expect(isBatchPeriod(weekOf(d('2026-11-10')))).toBe(true)
    expect(isBatchPeriod(p('2026-11-01', '2026-11-14'))).toBe(true)
    expect(isBatchPeriod(p('2026-11-10', '2026-11-10'))).toBe(true)
    // A Wednesday-to-Tuesday range: not a settlement week, and allowed now.
    expect(isBatchPeriod(p('2026-11-11', '2026-11-17'))).toBe(true)
  })

  it('refuses an end before its start, a part day, and no date at all', () => {
    expect(isBatchPeriod(p('2026-11-14', '2026-11-08'))).toBe(false)
    expect(
      isBatchPeriod({
        start: new Date('2026-11-08T05:00:00.000Z'),
        end: d('2026-11-14'),
      }),
    ).toBe(false)
    expect(isBatchPeriod({ start: new Date(NaN), end: d('2026-11-14') })).toBe(
      false,
    )
  })

  it('reads a day from a form only when it is a real calendar day', () => {
    expect(dayFromParam('2026-11-08')?.toISOString()).toBe(
      '2026-11-08T00:00:00.000Z',
    )
    expect(dayFromParam('2026-02-30')).toBeNull()
    expect(dayFromParam('11/08/2026')).toBeNull()
    expect(dayFromParam(null)).toBeNull()
    expect(dayFromParam(undefined)).toBeNull()
  })
})

describe('the pre-fill is the last FULL settlement week', () => {
  const iso = (week: Week) => [
    week.start.toISOString().slice(0, 10),
    week.end.toISOString().slice(0, 10),
  ]

  it('is 11/08–11/14 on Tuesday 11/17, as the screenshot shows', () => {
    expect(iso(lastFullSettlementWeek(d('2026-11-17')))).toEqual([
      '2026-11-08',
      '2026-11-14',
    ])
  })

  it('on a Saturday is the week before, because this one is not over', () => {
    expect(iso(lastFullSettlementWeek(d('2026-11-14')))).toEqual([
      '2026-11-01',
      '2026-11-07',
    ])
  })

  it('on a Sunday is the week that ended yesterday', () => {
    expect(iso(lastFullSettlementWeek(d('2026-11-15')))).toEqual([
      '2026-11-08',
      '2026-11-14',
    ])
  })
})

// ── THE OVERLAP PREDICATE, EVALUATED AGAINST ROWS ─────────────────────────
//
// The `where` `openBatch` sends, applied to stored batches by a small matcher
// for the operators it uses (equality, lte, gte, OR). So the test reads what
// the predicate selects, not what its source looks like.

interface Batch {
  id: string
  organizationId: string
  companyId: string | null
  periodStart: Date
  periodEnd: Date
  deletedAt: Date | null
}

type Where = Record<string, unknown>

function matches(row: Batch, where: Where): boolean {
  return Object.entries(where).every(([key, wanted]) => {
    if (key === 'OR') {
      return (wanted as Where[]).some((branch) => matches(row, branch))
    }
    const value = (row as unknown as Record<string, unknown>)[key]
    if (
      wanted instanceof Date ||
      wanted === null ||
      typeof wanted !== 'object'
    ) {
      return value instanceof Date && wanted instanceof Date
        ? value.getTime() === wanted.getTime()
        : value === wanted
    }
    const op = wanted as { lte?: Date; gte?: Date }
    const at = (value as Date).getTime()
    if (op.lte && at > op.lte.getTime()) return false
    if (op.gte && at < op.gte.getTime()) return false
    return true
  })
}

const RAM = 'ram'
const DOLPHIN = 'dolphin'
const existing: Batch[] = [
  {
    id: 'ram-1108',
    organizationId: 'o1',
    companyId: RAM,
    periodStart: d('2026-11-08'),
    periodEnd: d('2026-11-14'),
    deletedAt: null,
  },
  {
    id: 'ram-deleted',
    organizationId: 'o1',
    companyId: RAM,
    periodStart: d('2026-10-25'),
    periodEnd: d('2026-10-31'),
    deletedAt: d('2026-11-01'),
  },
  {
    id: 'org-wide-0920',
    organizationId: 'o1',
    companyId: null,
    periodStart: d('2026-09-20'),
    periodEnd: d('2026-09-26'),
    deletedAt: null,
  },
  {
    id: 'other-org',
    organizationId: 'o2',
    companyId: RAM,
    periodStart: d('2026-12-06'),
    periodEnd: d('2026-12-12'),
    deletedAt: null,
  },
]

const hits = (period: Week, companyId: string | null) =>
  existing
    .filter((row) =>
      matches(
        row,
        batchOverlapWhere({ organizationId: 'o1', period, companyId }),
      ),
    )
    .map((row) => row.id)

describe('no overlap per authority (the overlap ruling)', () => {
  it('refuses RAM 11/10–11/16 over RAM 11/08–11/14', () => {
    expect(hits(p('2026-11-10', '2026-11-16'), RAM)).toEqual(['ram-1108'])
  })

  it('counts a shared single day as an overlap — the bounds are inclusive', () => {
    expect(hits(p('2026-11-14', '2026-11-20'), RAM)).toEqual(['ram-1108'])
    expect(hits(p('2026-11-01', '2026-11-08'), RAM)).toEqual(['ram-1108'])
  })

  it('allows the adjacent week, and another authority on the same dates', () => {
    expect(hits(p('2026-11-15', '2026-11-21'), RAM)).toEqual([])
    expect(hits(p('2026-11-10', '2026-11-16'), DOLPHIN)).toEqual([])
  })

  it('an org-wide batch blocks every authority on its dates, and a deleted one blocks nothing', () => {
    expect(hits(p('2026-09-24', '2026-09-30'), DOLPHIN)).toEqual([
      'org-wide-0920',
    ])
    expect(hits(p('2026-10-27', '2026-10-29'), RAM)).toEqual([])
  })

  it('never reaches across organizations', () => {
    expect(hits(p('2026-12-06', '2026-12-12'), RAM)).toEqual([])
  })
})

describe('openBatch, before it writes anything', () => {
  // A transaction that throws on ANY call: a refusal must come first.
  const untouchable = new Proxy(
    {},
    {
      get: () => {
        throw new Error('openBatch touched the database before refusing')
      },
    },
  )

  it('refuses a range whose end is before its start, by name', async () => {
    const result = await openBatch(untouchable as never, {
      organizationId: 'o1',
      companyId: RAM,
      period: p('2026-11-14', '2026-11-08'),
      statementDate: d('2026-11-17'),
    })
    expect(result).toEqual({ ok: false, reason: { kind: 'bad_range' } })
  })

  it('hands back the batch it would overlap, sending the shared predicate', async () => {
    const sent: unknown[] = []
    const tx = {
      settlementBatch: {
        findFirst: async (args: { where: unknown }) => {
          sent.push(args.where)
          return { id: 'ram-1108', status: 'DRAFT', batchNumber: 'SB-000470' }
        },
        create: () => {
          throw new Error('created over an overlap')
        },
      },
    }
    const input = {
      organizationId: 'o1',
      companyId: RAM,
      period: p('2026-11-10', '2026-11-16'),
      statementDate: d('2026-11-17'),
    }
    const result = await openBatch(tx as never, input)
    expect(result).toEqual({
      ok: false,
      reason: {
        kind: 'period_taken',
        batchId: 'ram-1108',
        status: 'DRAFT',
        batchNumber: 'SB-000470',
      },
    })
    expect(sent).toEqual([batchOverlapWhere(input)])
  })
})

describe('the Create screen and its action (R2, R3)', () => {
  const action = read('src/app/(app)/payroll/batches/actions.ts')
  const page = read('src/app/(app)/payroll/batches/new/page.tsx')

  it('the action refuses an empty authority before a transaction opens', () => {
    const refusal = action.indexOf("t('batch.error.noAuthority')")
    expect(refusal).toBeGreaterThan(0)
    expect(action.indexOf('withCurrentOrg(', refusal)).toBeGreaterThan(refusal)
    expect(action).not.toMatch(/companyId === '' \? null/)
  })

  it('the action and the screen read the range with one parser', () => {
    expect(action).toContain("dayFromParam(formData.get('from'))")
    expect(action).toContain("dayFromParam(formData.get('to'))")
    expect(page).toContain('dayFromParam(raw.from) ?? lastFull.start')
    expect(page).toContain('lastFullSettlementWeek(new Date())')
  })

  it('the screen withholds Create without an authority, on a bad range, and over an overlap', () => {
    expect(page).toMatch(
      /disabled=\{\s*companyId === null \|\| !validRange \|\| data\.existing !== null\s*\}/,
    )
    expect(page).toContain('where: batchOverlapWhere({')
  })

  it('the driver column says Driver pay, and freight stays Load gross', () => {
    const en = translator('en')
    expect(en('preview.loadPay')).toBe('Driver pay')
    expect(en('settlements.trip.gross')).toBe('Load gross')
  })
})
