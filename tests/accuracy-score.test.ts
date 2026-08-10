import { describe, expect, it } from 'vitest'
// A plain .mjs helper, shared with scripts/accuracy-run.mjs — untyped on
// purpose: the scripts directory is JavaScript, and a .d.ts beside it would be
// a second declaration of the same four functions to keep in step.
import {
  accuracyTable,
  flatten,
  normalize,
  scoreDocument,
  scoreRefusal,
} from '../scripts/_accuracy-score.mjs'

// ---------------------------------------------------------------------------
// THE ACCEPTANCE INSTRUMENT'S OWN TESTS (Phase 5 §5).
//
// §5's first box is a number this run prints. An unverified instrument
// measures nothing twice — it produces a figure whose only evidence is that
// the code looked right — so the scoring is separated from the network and
// tested here, on the four outcomes that are cheap to confuse.
// ---------------------------------------------------------------------------

const field = (value: unknown) => ({ value, confidence: 'high' })
const asRecord = (value: unknown) => value as Record<string, unknown>

describe('flattening an extraction to the sheet’s keys', () => {
  it('reads stops by index and money from the PARSED cents', () => {
    // Money comes from `body.money`, not from `extracted`: the sheet stores
    // cents because cents are what the system stores, and an accuracy claim
    // about money has to be about the number that would have been saved.
    const flat = asRecord(
      flatten(
        {
          brokerName: field('Cascade Freight'),
          stops: [{ city: field('Salem') }, { city: field('Sacramento') }],
          money: { linehaul: field('$2,450.00') },
        },
        { linehaulCents: 245_000, totalCents: 295_750 },
      ),
    )
    expect(flat['brokerName']).toBe('Cascade Freight')
    expect(flat['stops[1].city']).toBe('Sacramento')
    expect(flat['money.linehaulCents']).toBe(245_000)
    expect(flat['money.totalCents']).toBe(295_750)
  })

  it('and a dispatcher’s money-less payload flattens to nulls, not to crashes', () => {
    // §1.3 removes the money key entirely. The instrument must survive being
    // handed one of those rather than scoring the whole document as missed.
    const flat = asRecord(
      flatten({ brokerName: field('Cascade'), stops: [] }, undefined),
    )
    expect(flat['money.linehaulCents']).toBeNull()
  })
})

describe('the four outcomes', () => {
  const sheet = {
    brokerName: { truth: 'Cascade Freight Partners' },
    poNumber: { truth: null },
    bolNumber: { truth: 'BOL-77' },
    commodity: { truth: 'Frozen blueberries' },
    sealNumber: { truth: null },
  }

  it('separates missed, invented and wrong — they call for different fixes', () => {
    // A MISSED field is a prompt that did not ask clearly enough; an INVENTED
    // one is a model filling a blank it should have left; a WRONG one is a
    // reading error. A single percentage throws away which.
    const outcomes = scoreDocument(sheet, {
      brokerName: 'Cascade Freight Partners',
      poNumber: 'PO-9999',
      bolNumber: null,
      commodity: 'Frozen blackberries',
      sealNumber: null,
    })
    expect(Object.fromEntries(outcomes)).toEqual({
      brokerName: 'right',
      poNumber: 'invented',
      bolNumber: 'missed',
      commodity: 'wrong',
      // sealNumber absent: agreed absence is not scored at all.
    })
  })

  it('does not score an agreed absence', () => {
    // Counting "the document has no PO and the model said none" as a hit would
    // inflate every rate with the fields documents mostly do not carry.
    const outcomes = scoreDocument(
      { poNumber: { truth: null }, sealNumber: { truth: null } },
      {},
    )
    expect(outcomes).toEqual([])
  })

  it('and a REFUSED document scores every field it should have had as missed', () => {
    // Leaving a refusal out would make the corpus smaller and the number
    // better, which is the most comfortable way to publish a wrong one.
    expect(Object.fromEntries(scoreRefusal(sheet))).toEqual({
      brokerName: 'missed',
      bolNumber: 'missed',
      commodity: 'missed',
    })
  })
})

describe('comparing two answers', () => {
  it('treats empty, null and undefined as one absence', () => {
    expect(normalize('')).toBeNull()
    expect(normalize(null)).toBeNull()
    expect(normalize(undefined)).toBeNull()
  })

  it('compares a number to its own string, because a sheet holds JSON', () => {
    expect(normalize(245_000)).toBe(normalize('245000'))
    expect(normalize(false)).toBe('false')
  })

  it('and forgives the seconds on a time the document printed to the minute', () => {
    expect(normalize('2026-08-14T07:00:00')).toBe(normalize('2026-08-14T07:00'))
  })

  it('but NOT a different minute', () => {
    expect(normalize('2026-08-14T07:00')).not.toBe(
      normalize('2026-08-14T07:30'),
    )
  })
})

describe('the table', () => {
  it('is ordered worst first, which is the order somebody fixes them', () => {
    const rows = accuracyTable([
      ['brokerName', 'right'],
      ['brokerName', 'right'],
      ['stops[1].scheduledAt', 'missed'],
      ['stops[1].scheduledAt', 'right'],
      ['weightLbs', 'invented'],
    ])
    expect(rows.map((row: { field: string }) => row.field)).toEqual([
      'weightLbs',
      'stops[1].scheduledAt',
      'brokerName',
    ])
    expect(rows[1]).toMatchObject({ right: 1, missed: 1, total: 2, rate: 0.5 })
  })
})
