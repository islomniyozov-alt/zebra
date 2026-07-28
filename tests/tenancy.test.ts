import { describe, expect, it } from 'vitest'
import {
  InvalidOrgIdError,
  assertOrgId,
  companyScopeFilter,
  isCompanyInScope,
} from '@/lib/tenancy'

// A real cuid v1, the shape `@default(cuid())` emits.
const ORG = 'cms59hb1s0000tgvsyq75inm2'

describe('assertOrgId', () => {
  it('accepts a cuid', () => {
    expect(() => assertOrgId(ORG)).not.toThrow()
  })

  it.each([
    ['empty', ''],
    ['not a cuid', 'org-a'],
    ['uuid', '3f2504e0-4f89-11d3-9a0c-0305e82c3301'],
    ['too short', 'cms59hb1s0000tgvsyq75in'],
    ['too long', ORG + 'x'],
    ['uppercase', ORG.toUpperCase()],
    ['wrong prefix', 'x' + ORG.slice(1)],
    ['sql fragment', `' OR '1'='1`],
    ['quote injection', `${ORG}'; DROP TABLE "Load"; --`],
    ['leading whitespace', ` ${ORG}`],
    ['null', null],
    ['undefined', undefined],
    ['number', 12345],
    ['object', { id: ORG }],
  ])('rejects %s', (_label, value) => {
    expect(() => assertOrgId(value)).toThrow(InvalidOrgIdError)
  })
})

describe('companyScopeFilter', () => {
  it('does not restrict when the scope list is empty', () => {
    // Empty means every authority in the organization — an owner, typically.
    expect(companyScopeFilter([])).toEqual({})
  })

  it('restricts to the listed authorities', () => {
    expect(companyScopeFilter(['c1', 'c2'])).toEqual({
      companyId: { in: ['c1', 'c2'] },
    })
  })

  it('does not hand out a reference to the caller’s array', () => {
    const scopes = ['c1']
    const filter = companyScopeFilter(scopes)
    scopes.push('c2')
    expect(filter).toEqual({ companyId: { in: ['c1'] } })
  })
})

describe('isCompanyInScope', () => {
  it('agrees with companyScopeFilter on the empty list', () => {
    expect(isCompanyInScope([], 'anything')).toBe(true)
  })

  it('admits a listed authority and refuses an unlisted one', () => {
    expect(isCompanyInScope(['c1', 'c2'], 'c2')).toBe(true)
    expect(isCompanyInScope(['c1', 'c2'], 'c3')).toBe(false)
  })
})
