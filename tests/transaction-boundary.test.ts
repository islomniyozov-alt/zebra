import { describe, expect, it } from 'vitest'
import {
  assertOutsideTransaction,
  auditScope,
  TransactionBoundaryError,
} from '@/lib/audit'

describe('the transaction boundary guard', () => {
  it('permits a call made outside a tenant transaction', () => {
    expect(() => assertOutsideTransaction('R2 headObject')).not.toThrow()
  })

  it('refuses a call made inside one, and says what to do', () => {
    auditScope.run(
      { organizationId: 'o', attribution: null, buffer: [] } as never,
      () => {
        expect(() => assertOutsideTransaction('R2 headObject')).toThrow(
          TransactionBoundaryError,
        )
        try {
          assertOutsideTransaction('R2 headObject')
        } catch (error) {
          expect(String(error)).toContain('R2 headObject')
          expect(String(error)).toContain('short transaction')
        }
      },
    )
  })
})
