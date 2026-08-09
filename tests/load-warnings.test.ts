import { describe, expect, it } from 'vitest'
import {
  loadWarnings,
  warningSignature,
  type WarningInput,
} from '@/lib/load-warnings'
import type { TxClient } from '@/lib/tenancy'

// ---------------------------------------------------------------------------
// THE TWO DECISIONS IN THE WARNINGS THAT ARE NOT QUERIES (§3 step 5).
//
// What gets said when nothing conflicts — the missing-required half, which
// needs no database — and what a confirmation is a confirmation OF. The
// duplicate lookups have their own integration test; these are the rules that
// would still be wrong against a perfect database.
// ---------------------------------------------------------------------------

/** A database with nothing in it. Every duplicate lookup answers null. */
const empty = {
  load: { findFirst: async () => null },
} as unknown as TxClient

const complete: WarningInput = {
  customerId: 'cus_1',
  customerName: 'Cascade Freight Partners',
  bolNumber: 'BOL-77',
  poNumber: 'PO-4471',
  pickupAt: new Date('2026-08-14T00:00:00Z'),
  deliveryAt: new Date('2026-08-15T00:00:00Z'),
  pickup: { city: 'Salem', state: 'OR' },
  delivery: { city: 'Sacramento', state: 'CA' },
  linehaulCents: 245_000,
}

describe('a load with nothing wrong with it', () => {
  it('says nothing at all', async () => {
    expect(await loadWarnings(empty, complete)).toEqual([])
  })
})

describe('what is missing', () => {
  it('names each missing date separately', async () => {
    const warnings = await loadWarnings(empty, {
      ...complete,
      pickupAt: null,
      deliveryAt: null,
    })
    expect(warnings.map((warning) => warning.kind)).toEqual([
      'missing_pickup_date',
      'missing_delivery_date',
    ])
  })

  it('EVERY warning at once, not the first', async () => {
    // A dispatcher who fixes one problem and is then told about the next has
    // been made to type twice. The same ruling the dispatch conflicts follow.
    const warnings = await loadWarnings(empty, {
      ...complete,
      pickupAt: null,
      deliveryAt: null,
      linehaulCents: 0,
    })
    expect(warnings).toHaveLength(3)
  })
})

describe('§1.3: a role with no rate field is never told a rate is missing', () => {
  it('warns about a rate of zero when the role has one', async () => {
    const warnings = await loadWarnings(empty, {
      ...complete,
      linehaulCents: 0,
    })
    expect(warnings.map((w) => w.kind)).toContain('missing_rate')
  })

  it('and says NOTHING about money when the role has none', async () => {
    // THE TEST THAT MATTERS HERE. "No rate" is a money label: it tells a
    // dispatcher the load has a rate and that it is empty, on the one screen
    // §1.3 keeps money off entirely. `null` is how the caller says this role
    // does not see money — which is a different fact from a rate of zero, and
    // a check written as `!input.linehaulCents` would have collapsed the two.
    const warnings = await loadWarnings(empty, {
      ...complete,
      linehaulCents: null,
    })
    expect(warnings).toEqual([])
  })
})

describe('what a confirmation confirms', () => {
  const bol = {
    kind: 'duplicate_bol' as const,
    messageKey: 'loads.warn.duplicateBol' as const,
    values: { bol: 'BOL-77', load: '1042', customer: 'Cascade', date: 'Aug 3' },
  }
  const missingRate = {
    kind: 'missing_rate' as const,
    messageKey: 'loads.warn.missingRate' as const,
    values: {},
  }

  it('the same warnings in either order are the same confirmation', async () => {
    expect(warningSignature([bol, missingRate])).toBe(
      warningSignature([missingRate, bol]),
    )
  })

  it('but a DIFFERENT record is a different confirmation', async () => {
    // THE POINT OF THE SIGNATURE. A dispatcher warned that BOL-77 is on load
    // 1042, who then types a different BOL that is on a different load, must be
    // warned again — not waved through by a tick from a moment ago. A
    // confirmation keyed on the warning KIND alone would wave them through.
    expect(warningSignature([bol])).not.toBe(
      warningSignature([
        { ...bol, values: { ...bol.values, bol: 'BOL-99', load: '1091' } },
      ]),
    )
  })

  it('and one more warning is a different confirmation', async () => {
    expect(warningSignature([bol])).not.toBe(
      warningSignature([bol, missingRate]),
    )
  })

  it('nothing to confirm is the empty string, which no form posts', async () => {
    expect(warningSignature([])).toBe('')
  })
})
