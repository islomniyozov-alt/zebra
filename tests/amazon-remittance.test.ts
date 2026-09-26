import { readFileSync, readdirSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  DORMANT_MONEY_COLUMNS,
  REMITTANCE_COLUMNS,
  censusItemTypes,
  checkColumns,
  classifyItemType,
} from '@/lib/amazon/remittance-shape'
import { parseSheet } from '@/lib/datatruck/xlsx'
import {
  readRemittance,
  remittanceCents,
  totalsAgree,
  parseWorkPeriod,
} from '@/lib/amazon/remittance'
import { keyFor, previewRemittance } from '@/lib/amazon/remittance-preview'

// ---------------------------------------------------------------------------
// THE REMITTANCE CONTRACT, AND ITS GUARDS WATCHED FAILING.
//
// Every fixture below is transcribed from `corpus/amazon`, six workbooks
// covering 2026-07-26 → 2026-09-05, profiled raw before any of this was
// written. The corpus is gitignored, so the assertions that need the real
// files are skipped when it is absent and run when it is there — a test that
// silently passed on a missing corpus would be the comfortable kind of wrong.
//
// THE GUARDS ARE THE POINT. A discovery guard that has never been watched
// firing is not known to work, and this one cannot be retrofitted honestly:
// once an importer has run against a changed file, the evidence of what
// changed is gone.
// ---------------------------------------------------------------------------

const HEADER = [...REMITTANCE_COLUMNS]

describe('the column contract', () => {
  it('accepts the header the six workbooks actually print', () => {
    expect(checkColumns(HEADER)).toEqual([])
  })

  // A 21ST COLUMN. Watched failing, by name.
  it('fails by name when a column is added', () => {
    const problems = checkColumns([...HEADER, 'Accessorial Detail'])
    expect(problems).toContainEqual({
      kind: 'added',
      column: 'Accessorial Detail',
      at: 20,
    })
  })

  // ONE OF THE 20 DISAPPEARS.
  it('fails by name when a column goes missing', () => {
    const problems = checkColumns(HEADER.filter((c) => c !== 'TONU'))
    expect(problems).toContainEqual({ kind: 'missing', column: 'TONU' })
  })

  // A RENAME IS BOTH AT ONCE, and both halves are named — which is what tells
  // somebody it was renamed rather than dropped.
  it('names both halves of a rename', () => {
    const renamed = HEADER.map((c) =>
      c === 'TONU' ? 'Truck Order Not Used' : c,
    )
    const problems = checkColumns(renamed)
    expect(problems).toContainEqual({ kind: 'missing', column: 'TONU' })
    expect(problems).toContainEqual({
      kind: 'added',
      column: 'Truck Order Not Used',
      at: 16,
    })
  })

  it('notices a column that merely moved', () => {
    const swapped = [...HEADER]
    ;[swapped[2], swapped[3]] = [swapped[3]!, swapped[2]!]
    const problems = checkColumns(swapped)
    expect(
      problems.some((p) => p.kind === 'moved' && p.column === 'Trip ID'),
    ).toBe(true)
  })

  // SPACING IS PART OF THE CONTRACT. This is the case a trimming reader cannot
  // see at all, which is why the remittance path reads untrimmed.
  it('fails on a re-spaced column, not just a renamed one', () => {
    const respaced = HEADER.map((c) => (c === 'Gross Pay' ? 'Gross  Pay' : c))
    const problems = checkColumns(respaced)
    expect(problems).toContainEqual({ kind: 'missing', column: 'Gross Pay' })
  })
})

describe('item type on two axes', () => {
  it('reads all four values the corpus prints', () => {
    expect(classifyItemType('TOUR - COMPLETED')).toEqual({
      scope: 'TOUR',
      outcome: 'COMPLETED',
    })
    expect(classifyItemType('LOAD - CANCELLED')).toEqual({
      scope: 'LOAD',
      outcome: 'CANCELLED',
    })
  })

  // THE AXES ARE INDEPENDENT, which is the whole reason for deriving them: a
  // combination nobody has seen still classifies if both halves are known.
  it('reads a combination the corpus never printed', () => {
    expect(classifyItemType('TOUR - CANCELLED')).toEqual({
      scope: 'TOUR',
      outcome: 'CANCELLED',
    })
  })

  it('refuses a value it does not recognise', () => {
    expect(classifyItemType('TOUR - DISPUTED')).toBeNull()
    expect(classifyItemType('BLOCK - COMPLETED')).toBeNull()
    expect(classifyItemType('COMPLETED')).toBeNull()
    expect(classifyItemType('TOUR-COMPLETED')).toBeNull()
  })

  // THE CENSUS FAILS BY NAME, quoting the value, so nobody has to go looking.
  it('names an unrecognised value in the census', () => {
    const census = censusItemTypes([
      'LOAD - COMPLETED',
      'LOAD - COMPLETED',
      'TOUR - DISPUTED',
    ])
    expect(census.unrecognised).toEqual(['TOUR - DISPUTED'])
    expect(census.counts).toContainEqual({
      value: 'LOAD - COMPLETED',
      rows: 2,
      scope: 'LOAD',
    })
  })

  // AND IT NEVER EXPECTS FOUR. Two of the six weeks carry only three.
  it('is content with three of the four values present', () => {
    const census = censusItemTypes([
      'LOAD - COMPLETED',
      'LOAD - CANCELLED',
      'TOUR - COMPLETED',
    ])
    expect(census.unrecognised).toEqual([])
    expect(census.counts).toHaveLength(3)
  })
})

describe('money as printed', () => {
  it('reads the bare decimals the file uses', () => {
    expect(remittanceCents('505.05')).toBe(50505)
    expect(remittanceCents('0.0')).toBe(0)
    expect(remittanceCents('')).toBe(0)
  })

  // THE ONE CANCELLATION THAT IS NOT $175. Six weeks, 62 cancellations, 61 at
  // 175.00 and this one — so there is no constant to hard-code and the column
  // is read instead.
  it('reads a cancellation that is not the usual figure', () => {
    expect(remittanceCents('137.82')).toBe(13782)
    expect(remittanceCents('175.0')).toBe(17500)
  })

  it('carries a separator rather than refusing the file over one', () => {
    expect(remittanceCents('1,234.56')).toBe(123456)
    expect(remittanceCents('$1,234.56')).toBe(123456)
  })
})

describe('three keys, three branches', () => {
  const row = (over: Record<string, unknown> = {}) =>
    ({
      at: 2,
      invoiceNumber: 'AZNG1',
      tripId: null,
      loadId: null,
      itemType: 'LOAD - COMPLETED',
      item: { scope: 'LOAD', outcome: 'COMPLETED' },
      money: {},
      grossCents: 1000,
      startDate: '',
      endDate: '',
      route: '',
      ...over,
    }) as never

  it('keys a tour on its trip', () => {
    expect(
      keyFor(
        row({
          itemType: 'TOUR - COMPLETED',
          item: { scope: 'TOUR', outcome: 'COMPLETED' },
          tripId: 'T-1115KD1LS',
        }),
      ),
    ).toEqual({ branch: 'tour', tripId: 'T-1115KD1LS' })
  })

  // THE BRANCH A FOUR-VALUE MODEL LOSES. A cancelled tour carries a Trip ID
  // and no Load ID, so "no Trip ID means single load, keyed by Load ID" leaves
  // it unkeyed — and it is absent from two of six weeks, which is how a reader
  // comes to be written without it.
  it('keys a CANCELLED tour on its trip too', () => {
    expect(
      keyFor(
        row({
          itemType: 'TOUR - CANCELLED',
          item: { scope: 'TOUR', outcome: 'CANCELLED' },
          tripId: 'T-116ABCDEF',
          loadId: null,
        }),
      ),
    ).toEqual({ branch: 'tour', tripId: 'T-116ABCDEF' })
  })

  it('keys a load under a trip on both', () => {
    expect(keyFor(row({ tripId: 'T-1115KD1LS', loadId: '111TZLSPZ' }))).toEqual(
      {
        branch: 'load_under_trip',
        tripId: 'T-1115KD1LS',
        loadId: '111TZLSPZ',
      },
    )
  })

  it('keys a single load on its load id', () => {
    expect(keyFor(row({ loadId: '116PV1Y42' }))).toEqual({
      branch: 'single_load',
      loadId: '116PV1Y42',
    })
  })
})

describe('the five outcomes', () => {
  const reading = {
    rows: [
      {
        at: 2,
        invoiceNumber: 'A',
        tripId: null,
        loadId: 'L1',
        itemType: 'LOAD - COMPLETED',
        item: { scope: 'LOAD', outcome: 'COMPLETED' },
        money: {},
        grossCents: 10000,
        startDate: '',
        endDate: '',
        route: '',
      },
      {
        at: 3,
        invoiceNumber: 'A',
        tripId: null,
        loadId: 'L2',
        itemType: 'LOAD - COMPLETED',
        item: { scope: 'LOAD', outcome: 'COMPLETED' },
        money: {},
        grossCents: 9000,
        startDate: '',
        endDate: '',
        route: '',
      },
      {
        at: 4,
        invoiceNumber: 'A',
        tripId: null,
        loadId: 'L3',
        itemType: 'LOAD - COMPLETED',
        item: { scope: 'LOAD', outcome: 'COMPLETED' },
        money: {},
        grossCents: 12000,
        startDate: '',
        endDate: '',
        route: '',
      },
      {
        at: 5,
        invoiceNumber: 'A',
        tripId: null,
        loadId: 'L4',
        itemType: 'LOAD - COMPLETED',
        item: { scope: 'LOAD', outcome: 'COMPLETED' },
        money: {},
        grossCents: 5000,
        startDate: '',
        endDate: '',
        route: '',
      },
    ],
  } as never

  const freight = new Map([
    [
      'L1',
      [
        {
          id: '1',
          loadNumber: '1',
          reference: 'L1',
          totalRevenueCents: 10000,
          closedHistory: false,
        },
      ],
    ],
    [
      'L2',
      [
        {
          id: '2',
          loadNumber: '2',
          reference: 'L2',
          totalRevenueCents: 10000,
          closedHistory: false,
        },
      ],
    ],
    [
      'L3',
      [
        {
          id: '3',
          loadNumber: '3',
          reference: 'L3',
          totalRevenueCents: 10000,
          closedHistory: false,
        },
      ],
    ],
    [
      'L4',
      [
        {
          id: '4',
          loadNumber: '4',
          reference: 'L4',
          totalRevenueCents: 99999,
          closedHistory: true,
        },
      ],
    ],
  ])

  it('counts matched, short, over and closed history apart', () => {
    const preview = previewRemittance(reading, freight)
    expect(preview.counts.matched_exact).toBe(1)
    expect(preview.counts.short).toBe(1)
    expect(preview.counts.over).toBe(1)
    expect(preview.counts.matched_closed_history).toBe(1)
    expect(preview.counts.unmatched).toBe(0)
  })

  // CLOSED HISTORY IS DECIDED BEFORE THE MONEY IS COMPARED. L4 is $949.99
  // short of its load and must NOT be reported as short — nobody is going to
  // act on a discrepancy in freight another system settled.
  it('never reports closed history as short, however far off the money is', () => {
    const preview = previewRemittance(reading, freight)
    const line = preview.lines.find((l) => l.loads[0]?.reference === 'L4')
    expect(line?.outcome).toBe('matched_closed_history')
    expect(line?.deltaCents).toBeLessThan(0)
  })

  it('reports freight it cannot find as unmatched, never creating it', () => {
    const preview = previewRemittance(reading, new Map())
    expect(preview.counts.unmatched).toBe(4)
    expect(preview.lines.every((line) => line.loads.length === 0)).toBe(true)
  })
})

// ── AGAINST THE REAL WORKBOOKS, WHEN THEY ARE PRESENT ─────────────────────
const DIR = 'corpus/amazon'
const files = (() => {
  try {
    return readdirSync(DIR).filter((name) => name.endsWith('.xlsx'))
  } catch {
    return []
  }
})()

describe.skipIf(files.length === 0)('the six workbooks', () => {
  it('reads every one, and every one totals three ways', async () => {
    for (const name of files) {
      const outcome = await readRemittance(
        new Uint8Array(readFileSync(`${DIR}/${name}`)),
      )
      expect(outcome.ok, `${name} was refused`).toBe(true)
      if (!outcome.ok) continue
      expect(totalsAgree(outcome.reading), `${name} totals disagree`).toBe(true)
      expect(outcome.reading.census.unrecognised).toEqual([])
      expect(outcome.reading.footer.length).toBe(3)
    }
  })

  // THE DORMANT COLUMNS, ASSERTED AS DORMANT. If a future file carries one,
  // this test is the thing that says so — and it names the column.
  it('still finds Detention and Others empty in every week', async () => {
    for (const name of files) {
      const outcome = await readRemittance(
        new Uint8Array(readFileSync(`${DIR}/${name}`)),
      )
      if (!outcome.ok) continue
      expect(
        outcome.reading.dormantColumnsSeen,
        `${name} carried a figure in ${outcome.reading.dormantColumnsSeen
          .map((seen) => seen.column)
          .join(', ')} — the importer must be looked at before it runs`,
      ).toEqual([])
      expect(outcome.reading.summary.adjustmentTotalCents).toBe(0)
    }
    expect(DORMANT_MONEY_COLUMNS).toEqual(['Detention', 'Others'])
  })
})

// ---------------------------------------------------------------------------
// THE SELF-CLOSING CELL, WATCHED FAILING.
//
// `parseSheet` read `<c\b([^>]*)>([\s\S]*?)<\/c>` until 2026-09-10. Given a
// styled-but-empty `<c r="A3" s="1"/>`, that matched the self-closing tag and
// then ran its lazy body to the NEXT cell's `</c>` — so the empty cell
// swallowed its neighbour, took the neighbour's `<v>` and lost the
// neighbour's `t="s"`, writing a raw shared-string INDEX into the grid.
//
// A `95` where `Carrier:` belongs is not a value anybody would question. The
// Datatruck exports never emit empty cells, so nothing caught it for two
// months; the Amazon summary sheet emits them on every row.
// ---------------------------------------------------------------------------
describe('a self-closing empty cell', () => {
  const shared = ['Carrier:', 'RAM HAULAGE LLC']
  const xml =
    '<row r="3">' +
    '<c r="A3" s="1"/>' +
    '<c r="B3" t="s" s="2"><v>0</v></c>' +
    '<c r="C3" s="56"/>' +
    '<c r="D3" t="s" s="56"><v>1</v></c>' +
    '</row>'

  it('does not swallow the cell after it', () => {
    const [row] = parseSheet(xml, shared, { trim: false })
    expect(row).toEqual(['', 'Carrier:', '', 'RAM HAULAGE LLC'])
  })

  it('never lets a shared-string index reach the grid as text', () => {
    const [row] = parseSheet(xml, shared, { trim: false })
    expect(row).not.toContain('0')
    expect(row).not.toContain('1')
  })
})

// ---------------------------------------------------------------------------
// THE WORK PERIOD, PARSED — all six strings the corpus actually contains.
//
// Transcribed rather than read from `corpus/amazon`, which is gitignored: a
// guard that only exists where somebody's corpus happens to be is a guard for
// one laptop. `tests/trips-csv.test.ts` records why.
// ---------------------------------------------------------------------------

describe('the work period Amazon prints', () => {
  const ALL = [
    ['Jul 26 - Aug 1, 2026', '2026-07-26', '2026-08-01'],
    ['Aug 2 - Aug 8, 2026', '2026-08-02', '2026-08-08'],
    ['Aug 9 - Aug 15, 2026', '2026-08-09', '2026-08-15'],
    ['Aug 16 - Aug 22, 2026', '2026-08-16', '2026-08-22'],
    ['Aug 23 - Aug 29, 2026', '2026-08-23', '2026-08-29'],
    ['Aug 30 - Sep 5, 2026', '2026-08-30', '2026-09-05'],
  ] as const

  for (const [raw, start, end] of ALL) {
    it(`reads ${raw}`, () => {
      const period = parseWorkPeriod(raw)
      expect(period).not.toBeNull()
      expect(period!.start.toISOString().slice(0, 10)).toBe(start)
      expect(period!.end.toISOString().slice(0, 10)).toBe(end)
    })
  }

  // THE YEAR IS PRINTED ONCE AND BELONGS TO THE SECOND DATE. Two of the six
  // already cross a month; crossing a year is the same shape one week on, and
  // getting it wrong would file a December week under the following January.
  it('puts December in the year before the January it is printed with', () => {
    const period = parseWorkPeriod('Dec 27 - Jan 2, 2027')
    expect(period!.start.toISOString().slice(0, 10)).toBe('2026-12-27')
    expect(period!.end.toISOString().slice(0, 10)).toBe('2027-01-02')
  })

  // A STRING IT DOES NOT UNDERSTAND IS NULL, NOT A GUESS. The caller then
  // falls back to asking what the payment actually paid for, which is a worse
  // answer than the label but never a wrong one.
  it('refuses anything that is not a Sunday-to-Saturday week', () => {
    expect(parseWorkPeriod('Aug 17 - Aug 23, 2026')).toBeNull()
    expect(parseWorkPeriod('Aug 2 - Aug 15, 2026')).toBeNull()
    expect(parseWorkPeriod('week of August 2')).toBeNull()
    expect(parseWorkPeriod('')).toBeNull()
    expect(parseWorkPeriod(null)).toBeNull()
  })
})
