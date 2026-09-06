import { describe, expect, it } from 'vitest'
import { readdirSync, readFileSync } from 'node:fs'
import { stateFor } from '@/lib/inbound-email'
import { isEmptyReading } from '@/lib/extraction/parse'
import type { Extracted } from '@/lib/extraction/rate-con-shape'

// ---------------------------------------------------------------------------
// THREE KINDS OF NOTHING, TOLD APART.
//
// Until UNREAD existed the queue could not distinguish:
//
//   nobody asked            — deferred, the model was never called
//   the asking failed       — the reader could not answer
//   the answer was empty    — the reader answered and said nothing
//
// from each other, or from a document that genuinely had no freight in it.
// All four rendered as an ordinary row. That is not hypothetical: a real
// Relay booking came back with every field null, no stops, and one
// high-confidence `brokerName` that was the CARRIER's own name taken from a
// greeting — and it sat in REVIEW looking like any other message needing a
// glance (brief flag 76).
//
// ONE STATE, `ocrStatus` CARRIES THE WHY. The queue's job is to show that
// nothing was read. Which flavour of nothing is a label beside it.
// ---------------------------------------------------------------------------

/** An extraction with nothing in it. The shape the reader actually returned. */
function emptyExtraction(over: Partial<Extracted> = {}): Extracted {
  const nothing = {
    brokerName: null,
    brokerReference: null,
    bolNumber: null,
    poNumber: null,
    commodity: null,
    weightLbs: null,
    miles: null,
    pieces: null,
    pallets: null,
    equipmentType: null,
    tempF: null,
    isHazmat: null,
    isTeam: null,
    sealNumber: null,
    instructions: null,
    stops: [],
    money: {
      linehaul: null,
      fuelSurcharge: null,
      total: null,
      accessorials: [],
    },
  } as unknown as Extracted
  return { ...nothing, ...over }
}

const field = (value: unknown) => ({ value, confidence: 'high' as const })

describe('what counts as the reader saying nothing', () => {
  it('an answer with no stops and nothing load-defining is empty', () => {
    expect(isEmptyReading(emptyExtraction())).toBe(true)
  })

  // THE FLAG-76 CASE, EXACTLY. One confident name and nothing else.
  it('is still empty when a broker name came back on its own', () => {
    const abstention = emptyExtraction({
      brokerName: field('RAM HAULAGE'),
    } as Partial<Extracted>)
    expect(
      isEmptyReading(abstention),
      'a name lifted from a greeting must not rescue an empty answer',
    ).toBe(true)
  })

  it('is NOT empty once there is a stop', () => {
    const withLane = emptyExtraction({
      stops: [{ city: field('Dallas') }],
    } as unknown as Partial<Extracted>)
    expect(isEmptyReading(withLane)).toBe(false)
  })

  it.each([
    ['bolNumber', { bolNumber: field('BOL-1') }],
    ['poNumber', { poNumber: field('PO-9') }],
    ['brokerReference', { brokerReference: field('REF-3') }],
    ['commodity', { commodity: field('paper') }],
    ['weightLbs', { weightLbs: field(41000) }],
  ])('is NOT empty once %s came back', (_name, over) => {
    expect(isEmptyReading(emptyExtraction(over as Partial<Extracted>))).toBe(
      false,
    )
  })

  it('is NOT empty once money came back', () => {
    const paid = emptyExtraction()
    paid.money.linehaul = field('$1,850.00') as never
    expect(isEmptyReading(paid)).toBe(false)
  })
})

describe('the state each kind of nothing lands in', () => {
  it('a reading nobody asked for is UNREAD', () => {
    // The rate limiter's case: no model call was made at all.
    expect(stateFor({ read: false, warnings: [] })).toBe('UNREAD')
  })

  it('a reading that failed is UNREAD, not CONFLICT', () => {
    // CONFLICT means "this may already be a load" — a claim about freight.
    // "We could not read it" is a claim about us, and one word for both made
    // an unreadable document sort beside a duplicate booking.
    expect(stateFor({ read: false, warnings: [] })).not.toBe('CONFLICT')
  })

  it('an answer that said nothing is UNREAD even though it succeeded', () => {
    expect(stateFor({ read: true, empty: true, warnings: [] })).toBe('UNREAD')
  })

  // UNREAD outranks everything, because a warning computed from an empty
  // reading is a warning about nothing.
  it('stays UNREAD even when the empty answer raised warnings', () => {
    const warnings = [
      { kind: 'missing_pickup_date', messageKey: 'x', values: {} },
    ] as never
    expect(stateFor({ read: true, empty: true, warnings })).toBe('UNREAD')
  })
})

describe('a real reading still lands where it always did', () => {
  it('READY when it read cleanly', () => {
    expect(stateFor({ read: true, empty: false, warnings: [] })).toBe('READY')
  })

  it('REVIEW when something wants a person', () => {
    const warnings = [
      { kind: 'missing_pickup_date', messageKey: 'x', values: {} },
    ] as never
    expect(stateFor({ read: true, empty: false, warnings })).toBe('REVIEW')
  })

  it('CONFLICT when it may already be a load', () => {
    const warnings = [
      { kind: 'duplicate_bol', messageKey: 'x', values: {} },
    ] as never
    expect(stateFor({ read: true, empty: false, warnings })).toBe('CONFLICT')
  })

  it('and empty defaults to false, so callers cannot get UNREAD by accident', () => {
    expect(stateFor({ read: true, warnings: [] })).toBe('READY')
  })
})

describe('the state exists everywhere it has to', () => {
  it('is in the schema as an enum value', () => {
    const schema = readFileSync('prisma/schema.prisma', 'utf8')
    const block = schema.slice(
      schema.indexOf('enum InboundEmailState'),
      schema.indexOf('}', schema.indexOf('enum InboundEmailState')),
    )
    expect(block).toMatch(/^\s*UNREAD\s*$/m)
  })

  it('has a migration behind it, not just a schema edit', () => {
    // Record-only-after-migrate: the value must exist in the database before
    // any code can write it, so a schema edit alone is not enough.
    const dir = readdirSync('prisma/migrations').find((name) =>
      name.endsWith('inbound_email_unread'),
    )
    expect(dir, 'no migration adds UNREAD').toBeDefined()
    const sql = readFileSync(`prisma/migrations/${dir}/migration.sql`, 'utf8')
    expect(sql).toContain("ADD VALUE 'UNREAD'")
  })
})
