import { describe, expect, it } from 'vitest'
import type { Role } from '@/generated/prisma/client'
import {
  ACTIONS,
  RESOURCES,
  can,
  navigationFor,
  permissionsOf,
  type Action,
  type AuthorizedSession,
  type Permission,
  type Resource,
} from '@/lib/permissions'

const session = (
  role: Role,
  overrides?: AuthorizedSession['permissionOverrides'],
): AuthorizedSession => ({
  userId: 'cms59hb1s0000tgvsyq75inm2',
  organizationId: 'cms59hc0u0002tgvsqcq9ehtx',
  role,
  companyScopes: [],
  ...(overrides ? { permissionOverrides: overrides } : {}),
})

const ROLES: Role[] = [
  'OWNER',
  'ADMIN',
  'MANAGER',
  'DISPATCHER',
  'ACCOUNTING',
  'DRIVER',
]

describe('can', () => {
  it('denies when there is no session', () => {
    expect(can(null, 'read', 'load')).toBe(false)
    expect(can(undefined, 'read', 'dashboard')).toBe(false)
  })

  it('gives OWNER everything in the operator application', () => {
    for (const resource of RESOURCES) {
      if (resource.startsWith('portal.')) continue
      for (const action of ACTIONS) {
        expect(
          can(session('OWNER'), action, resource),
          `${resource}:${action}`,
        ).toBe(true)
      }
    }
  })

  it('stops ADMIN short of dissolving the tenant', () => {
    expect(can(session('ADMIN'), 'update', 'organization')).toBe(true)
    expect(can(session('ADMIN'), 'delete', 'organization')).toBe(false)
    expect(can(session('OWNER'), 'delete', 'organization')).toBe(true)
  })
})

describe('the dispatcher boundary', () => {
  // The rule that shapes the whole product: the 6am user books freight all day
  // and never sees what it earns.
  const dispatcher = session('DISPATCHER')

  it('can run the operation', () => {
    expect(can(dispatcher, 'read', 'load')).toBe(true)
    expect(can(dispatcher, 'create', 'load')).toBe(true)
    expect(can(dispatcher, 'update', 'load')).toBe(true)
    expect(can(dispatcher, 'update', 'dispatch')).toBe(true)
    expect(can(dispatcher, 'read', 'truck')).toBe(true)
    expect(can(dispatcher, 'read', 'driver')).toBe(true)
  })

  it('cannot see money anywhere it might appear', () => {
    for (const resource of [
      'invoice',
      'receivable',
      'payment',
      'settlement',
      'expense',
      'fuel',
      'load.financials',
      'driver.pay',
    ] as const) {
      for (const action of ACTIONS) {
        expect(can(dispatcher, action, resource), `${resource}:${action}`).toBe(
          false,
        )
      }
    }
  })

  it('cannot change the fleet or the users', () => {
    expect(can(dispatcher, 'create', 'truck')).toBe(false)
    expect(can(dispatcher, 'delete', 'driver')).toBe(false)
    expect(can(dispatcher, 'read', 'user')).toBe(false)
    expect(can(dispatcher, 'read', 'auditLog')).toBe(false)
  })
})

describe('the accounting boundary', () => {
  const accounting = session('ACCOUNTING')

  it('can do the money work', () => {
    expect(can(accounting, 'create', 'invoice')).toBe(true)
    expect(can(accounting, 'approve', 'settlement')).toBe(true)
    expect(can(accounting, 'read', 'load.financials')).toBe(true)
    expect(can(accounting, 'read', 'driver.pay')).toBe(true)
    // An invoice is built from a load, so reading loads is necessary.
    expect(can(accounting, 'read', 'load')).toBe(true)
  })

  it('does not dispatch or change the fleet', () => {
    expect(can(accounting, 'create', 'load')).toBe(false)
    expect(can(accounting, 'update', 'dispatch')).toBe(false)
    expect(can(accounting, 'create', 'truck')).toBe(false)
  })
})

describe('the manager boundary', () => {
  const manager = session('MANAGER')

  it('watches the numbers without moving them', () => {
    expect(can(manager, 'read', 'invoice')).toBe(true)
    expect(can(manager, 'read', 'load.financials')).toBe(true)
    expect(can(manager, 'create', 'invoice')).toBe(false)
    expect(can(manager, 'approve', 'settlement')).toBe(false)
    expect(can(manager, 'delete', 'payment')).toBe(false)
  })

  it('runs operations and fleet', () => {
    expect(can(manager, 'create', 'load')).toBe(true)
    expect(can(manager, 'create', 'truck')).toBe(true)
  })
})

describe('DRIVER', () => {
  const driver = session('DRIVER')

  it('has nothing at all in the operator application', () => {
    for (const resource of RESOURCES) {
      if (resource.startsWith('portal.')) continue
      for (const action of ACTIONS) {
        expect(can(driver, action, resource), `${resource}:${action}`).toBe(
          false,
        )
      }
    }
  })

  it('has only its own portal surfaces', () => {
    expect(can(driver, 'read', 'portal.load')).toBe(true)
    expect(can(driver, 'create', 'portal.document')).toBe(true)
    expect(can(driver, 'read', 'portal.settlement')).toBe(true)
    expect(can(driver, 'delete', 'portal.settlement')).toBe(false)
  })

  it('is the only role holding portal permissions', () => {
    for (const role of ROLES) {
      if (role === 'DRIVER') continue
      expect(can(session(role), 'read', 'portal.load'), role).toBe(false)
    }
  })
})

describe('permission overrides', () => {
  it('grants a named extra to one person', () => {
    // The schema's stated example: a dispatcher trusted with load margin.
    const trusted = session('DISPATCHER', { grant: ['load.financials:read'] })
    expect(can(trusted, 'read', 'load.financials')).toBe(true)
    // ...and nothing else came with it.
    expect(can(trusted, 'read', 'invoice')).toBe(false)
    expect(can(trusted, 'read', 'driver.pay')).toBe(false)
  })

  it('revokes from a role that otherwise has it', () => {
    const limited = session('ACCOUNTING', { revoke: ['settlement:approve'] })
    expect(can(limited, 'approve', 'settlement')).toBe(false)
    expect(can(limited, 'create', 'invoice')).toBe(true)
  })

  it('lets revoke win over grant', () => {
    const contradictory = session('DISPATCHER', {
      grant: ['invoice:read'],
      revoke: ['invoice:read'],
    })
    expect(can(contradictory, 'read', 'invoice')).toBe(false)
  })

  it('ignores a malformed override rather than failing open', () => {
    const nonsense = session('DISPATCHER', {
      grant: ['not-a-permission' as Permission],
    })
    expect(can(nonsense, 'read', 'invoice')).toBe(false)
  })
})

describe('permissionsOf', () => {
  it('is empty for nobody and non-empty for everybody', () => {
    for (const role of ROLES) {
      expect(permissionsOf(session(role)).length, role).toBeGreaterThan(0)
    }
  })

  it('never returns a permission can() would deny', () => {
    for (const role of ROLES) {
      for (const permission of permissionsOf(session(role))) {
        const separator = permission.lastIndexOf(':')
        const resource = permission.slice(0, separator) as Resource
        const action = permission.slice(separator + 1) as Action
        expect(
          can(session(role), action, resource),
          `${role} ${permission}`,
        ).toBe(true)
      }
    }
  })

  it('gives a dispatcher strictly fewer permissions than a manager', () => {
    expect(permissionsOf(session('DISPATCHER')).length).toBeLessThan(
      permissionsOf(session('MANAGER')).length,
    )
  })
})

describe('navigationFor', () => {
  it('shows an owner all five groups', () => {
    expect(navigationFor(session('OWNER')).map((group) => group.key)).toEqual([
      'operations',
      'fleet',
      'money',
      'records',
      'admin',
    ])
  })

  it('never shows a dispatcher an empty Money heading', () => {
    // §7, stated as a UI rule but enforced here: a group with no permitted
    // child does not render at all. Rendering the heading and hiding the items
    // tells someone exactly what they are missing.
    const groups = navigationFor(session('DISPATCHER'))
    expect(groups.map((group) => group.key)).toEqual([
      'operations',
      'fleet',
      'records',
    ])
    expect(groups.find((group) => group.key === 'money')).toBeUndefined()
  })

  it('drops individual items too, not just whole groups', () => {
    const records = navigationFor(session('DISPATCHER')).find(
      (g) => g.key === 'records',
    )
    expect(records?.items.map((item) => item.key)).toEqual([
      'brokers',
      'documents',
    ])
  })

  it('shows accounting Money but not Admin', () => {
    const keys = navigationFor(session('ACCOUNTING')).map((group) => group.key)
    expect(keys).toContain('money')
    expect(keys).not.toContain('admin')
  })

  it('shows a driver nothing', () => {
    expect(navigationFor(session('DRIVER'))).toEqual([])
    expect(navigationFor(null)).toEqual([])
  })

  it('labels everything with an i18n key, never literal text', () => {
    // EN, RU and FA from the first component. Retrofitting this cost a
    // session on the portal.
    for (const group of navigationFor(session('OWNER'))) {
      expect(group.labelKey).toMatch(/^nav\./)
      for (const item of group.items) {
        expect(item.labelKey).toMatch(/^nav\./)
        expect(item.href).toMatch(/^\//)
      }
    }
  })
})
