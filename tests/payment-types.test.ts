import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  PAYMENT_TYPES,
  isPaymentType,
  readPaymentType,
} from '@/lib/payment-types'

// ---------------------------------------------------------------------------
// FOUR CODES, IN A LIST, VALIDATED — AND NOT A POSTGRES ENUM.
//
// Owner's ruling, same reasoning as the deduction type: the vocabulary lives
// in TypeScript so a fifth arrangement is an edit somebody reviews, not a
// migration against a table with 14,464 rows.
//
// The first draft of this made it a Postgres enum. It was changed in the
// migration itself rather than corrected by a later one, because nothing had
// read it yet and production had never seen it.
// ---------------------------------------------------------------------------

describe('the four codes', () => {
  it('are exactly the four, spelled as they are shown', () => {
    expect([...PAYMENT_TYPES]).toEqual([
      'Quickpay',
      'Factored',
      'ACH',
      'Direct',
    ])
  })

  it('live in TypeScript, not in the database', () => {
    // THE RULING, CHECKED. An enum type in the schema would put the vocabulary
    // back where changing it costs a migration.
    const schema = readFileSync('prisma/schema.prisma', 'utf8')
    expect(schema).not.toMatch(/enum\s+LoadPaymentType/)
    expect(schema).toMatch(/paymentType\s+String\?/)

    // And the migration must not have created the type either — a dropped
    // enum that still exists in history is an enum production would get.
    const migration = readFileSync(
      'prisma/migrations/20260920160000_pay_to_payment_type_default_authority/migration.sql',
      'utf8',
    )
    expect(migration).not.toMatch(/CREATE TYPE/i)
    expect(migration).toMatch(/"paymentType" TEXT/)
  })
})

describe('reading a payment type', () => {
  it.each([...PAYMENT_TYPES])('accepts %s', (code) => {
    expect(readPaymentType(code)).toBe(code)
  })

  it('trims what arrived', () => {
    expect(readPaymentType('  Factored  ')).toBe('Factored')
  })

  it('treats absent as absent, not as an error', () => {
    // A load booked before anybody decided simply has none. That is why every
    // column holding one is nullable.
    expect(readPaymentType(null)).toBeNull()
    expect(readPaymentType(undefined)).toBeNull()
    expect(readPaymentType('')).toBeNull()
  })

  it('REFUSES a value that is present and not one of the four', () => {
    // Silence is allowed; nonsense is not. A column that quietly accepted
    // "quickpay" would split a receivables list in two without anybody seeing
    // it — which is the whole reason this validates where the deduction list
    // deliberately does not.
    expect(() => readPaymentType('quickpay')).toThrow(/not a payment type/)
    expect(() => readPaymentType('Net30')).toThrow(/Quickpay, Factored/)
  })

  it('does not normalise case, so a wrong spelling is visible', () => {
    // "ACH" and "Ach" are the same arrangement, but only one is the spelling
    // this system shows. Accepting both is how two spellings end up in one
    // column and a GROUP BY starts lying.
    expect(() => readPaymentType('ach')).toThrow()
    expect(isPaymentType('Ach')).toBe(false)
  })
})
