import { describe, expect, it } from 'vitest'
import { deriveBatchStatus } from '@/lib/batch-status'

// ---------------------------------------------------------------------------
// THE DERIVATION, WITHOUT A DATABASE (§6.2.10 part 3).
//
// The batch's status is never set by hand. These are the four answers and the
// edges between them, including the one that is easy to get wrong in both
// directions: a voided statement is not a vote.
// ---------------------------------------------------------------------------

describe('a batch is what its statements are', () => {
  it('nothing issued is DRAFT', () => {
    expect(deriveBatchStatus([])).toBe('DRAFT')
    expect(deriveBatchStatus(['DRAFT', 'DRAFT'])).toBe('DRAFT')
  })

  it('some issued and some not is PARTIAL — the state the enum could not say', () => {
    expect(deriveBatchStatus(['APPROVED', 'DRAFT'])).toBe('PARTIAL')
    expect(deriveBatchStatus(['PAID', 'DRAFT', 'DRAFT'])).toBe('PARTIAL')
  })

  it('every statement issued is FINAL, even with some already paid', () => {
    expect(deriveBatchStatus(['APPROVED', 'APPROVED'])).toBe('FINAL')
    // PAID ⊂ issued: a batch half paid is FINAL, not PARTIAL. PARTIAL is about
    // drafts remaining, not about money remaining.
    expect(deriveBatchStatus(['APPROVED', 'PAID'])).toBe('FINAL')
  })

  it('every statement paid is PAID', () => {
    expect(deriveBatchStatus(['PAID'])).toBe('PAID')
    expect(deriveBatchStatus(['PAID', 'PAID', 'PAID'])).toBe('PAID')
  })

  it('a voided statement is not a vote, either way', () => {
    // It must not hold a batch in DRAFT …
    expect(deriveBatchStatus(['APPROVED', 'VOID'])).toBe('FINAL')
    expect(deriveBatchStatus(['PAID', 'VOID'])).toBe('PAID')
    // … and it must not count towards FINAL.
    expect(deriveBatchStatus(['DRAFT', 'VOID'])).toBe('DRAFT')
    // A batch of nothing but voids has nothing issued in it.
    expect(deriveBatchStatus(['VOID', 'VOID'])).toBe('DRAFT')
  })
})
