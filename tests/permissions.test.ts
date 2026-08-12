import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { Role } from '@/generated/prisma/client'
import {
  ACTIONS,
  NAVIGATION,
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
    // A DISPATCHER holds `document:read` and `customer:read` but not
    // `report:read`, so Records loses Reports on permission and keeps the other
    // two. Documents joined the list when Phase 4 step 6 built the browser —
    // and the browser is permission-aware per ENTITY, so what they see INSIDE
    // it is a separate question with its own tests.
    const records = navigationFor(session('DISPATCHER')).find(
      (g) => g.key === 'records',
    )
    expect(records?.items.map((item) => item.key)).toEqual([
      'brokers',
      'documents',
    ])

    // The permission half of that is still true and still worth asserting,
    // separately from the built half — the two filters must not be confused
    // for each other.
    expect(can(session('DISPATCHER'), 'read', 'document')).toBe(true)
    expect(can(session('DISPATCHER'), 'read', 'report')).toBe(false)
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

describe('the shell’s own precondition', () => {
  // §6.3 puts a company filter on every operator screen and the app shell
  // reads the authority names to build it. A role that can sign in and cannot
  // read a company name gets ForbiddenError from the LAYOUT, on every page —
  // which is what a DISPATCHER got until the Phase 2 acceptance run typed
  // /trucks/new into the URL bar and got a 500 where it expected a 404.

  const OPERATOR_ROLES: Role[] = ROLES.filter((role) => role !== 'DRIVER')

  it.each(OPERATOR_ROLES)('%s can read a company name', (role) => {
    expect(can(session(role), 'read', 'company')).toBe(true)
  })

  it('and still cannot change one unless the role says so', () => {
    // The pair, per standing rule 11: the grant above is `read` and nothing
    // more, so this assertion is what proves it was not widened by accident.
    expect(can(session('DISPATCHER'), 'update', 'company')).toBe(false)
    expect(can(session('ACCOUNTING'), 'update', 'company')).toBe(false)
    expect(can(session('OWNER'), 'update', 'company')).toBe(true)
  })

  it('does not reach the driver portal', () => {
    // A separate shell with a separate vocabulary and no company filter.
    expect(can(session('DRIVER'), 'read', 'company')).toBe(false)
  })
})

describe('Phase 3 sweep: money on a non-money screen', () => {
  // `Truck.purchasePriceCents` and `Customer.creditLimitCents` existed as
  // columns with NO resource covering them, so every screen omitted them
  // rather than gating them — flag 5, and the reason verify-dispatcher asserts
  // their absence for an OWNER too. Now they are nameable.

  it('a dispatcher sees neither', () => {
    expect(can(session('DISPATCHER'), 'read', 'truck.financials')).toBe(false)
    expect(can(session('DISPATCHER'), 'read', 'customer.financials')).toBe(
      false,
    )
  })

  it.each<Role>(['OWNER', 'ADMIN', 'MANAGER', 'ACCOUNTING'])(
    '%s does',
    (role) => {
      expect(can(session(role), 'read', 'truck.financials')).toBe(true)
      expect(can(session(role), 'read', 'customer.financials')).toBe(true)
    },
  )

  it('and reading them is not writing them', () => {
    // The pair. MANAGER "watches the numbers but does not move money", so a
    // grant that quietly included update would contradict the role's own
    // description.
    expect(can(session('MANAGER'), 'update', 'truck.financials')).toBe(false)
    expect(can(session('ACCOUNTING'), 'update', 'customer.financials')).toBe(
      false,
    )
    expect(can(session('OWNER'), 'update', 'truck.financials')).toBe(true)
  })
})

describe('Phase 4 step 3: a work order and what it cost', () => {
  // §2.5, and the reason maintenance needed two resources rather than one: the
  // SERVICE is operational and the COST is money. A dispatcher planning around
  // a truck in the shop needs the first and has no use for the second.

  it('a dispatcher reads the work order', () => {
    expect(can(session('DISPATCHER'), 'read', 'maintenance')).toBe(true)
  })

  it('and cannot read what it cost', () => {
    // THE PAIR. Either assertion alone is satisfied by a mistake: granting
    // both would hide nothing, granting neither would hide the screen.
    expect(can(session('DISPATCHER'), 'read', 'truck.financials')).toBe(false)
  })

  it.each<Role>(['OWNER', 'ADMIN', 'MANAGER'])('%s reads both', (role) => {
    expect(can(session(role), 'read', 'maintenance')).toBe(true)
    expect(can(session(role), 'read', 'truck.financials')).toBe(true)
  })

  it('and a dispatcher cannot open one either', () => {
    // Reading is FLEET_READ; recording is FLEET_WRITE. A dispatcher who could
    // file a work order would be entering a cost they cannot see.
    expect(can(session('DISPATCHER'), 'create', 'maintenance')).toBe(false)
    expect(can(session('MANAGER'), 'create', 'maintenance')).toBe(true)
  })

  it('accounting reads the work order and the cost on it', () => {
    // §6 flag 7, resolved by the owner: accounting already held
    // `truck.financials`, so it could see a cost and could not open the screen
    // the cost was on. It reconciles the shop's invoice against what was
    // recorded, so it reads both halves.
    expect(can(session('ACCOUNTING'), 'read', 'maintenance')).toBe(true)
    expect(can(session('ACCOUNTING'), 'read', 'truck.financials')).toBe(true)
  })

  it('and records none of it', () => {
    // THE PAIR for that grant. Read-only: opening a work order is a shop act
    // and stays with FLEET_WRITE. Without this, a later `crud('maintenance')`
    // in the ACCOUNTING list would go unnoticed.
    expect(can(session('ACCOUNTING'), 'create', 'maintenance')).toBe(false)
    expect(can(session('ACCOUNTING'), 'update', 'maintenance')).toBe(false)
    expect(can(session('ACCOUNTING'), 'delete', 'maintenance')).toBe(false)
  })
})

describe('Phase 4 step 5: claims and DataQs', () => {
  // §2.5, verbatim: "Claims and DataQs: OWNER/ADMIN/MANAGER write, ACCOUNTING
  // reads." The role line is shorter than any existing bundle, so the grant is
  // its own — and that is exactly the kind of hand-written list that drifts.

  it.each<Role>(['OWNER', 'ADMIN', 'MANAGER'])('%s writes both', (role) => {
    expect(can(session(role), 'create', 'claim')).toBe(true)
    expect(can(session(role), 'update', 'claim')).toBe(true)
    expect(can(session(role), 'create', 'dataQs')).toBe(true)
    expect(can(session(role), 'update', 'dataQs')).toBe(true)
  })

  it('accounting reads them', () => {
    // It reserves against an open claim and reconciles what was paid on a
    // settled one.
    expect(can(session('ACCOUNTING'), 'read', 'claim')).toBe(true)
    expect(can(session('ACCOUNTING'), 'read', 'dataQs')).toBe(true)
  })

  it('and writes neither', () => {
    // THE PAIR. Filing a claim and moving a challenge are the safety desk's
    // acts; without this, a later `crud` in the ACCOUNTING list goes unnoticed.
    expect(can(session('ACCOUNTING'), 'create', 'claim')).toBe(false)
    expect(can(session('ACCOUNTING'), 'update', 'claim')).toBe(false)
    expect(can(session('ACCOUNTING'), 'create', 'dataQs')).toBe(false)
    expect(can(session('ACCOUNTING'), 'update', 'dataQs')).toBe(false)
  })

  it('a dispatcher cannot even read one', () => {
    // Deliberately NOT in FLEET_READ, unlike compliance and inspections. A
    // claim carries an amount and a dispute; the dispatcher who books the next
    // load has no part in either, and §2.5 does not list them.
    expect(can(session('DISPATCHER'), 'read', 'claim')).toBe(false)
    expect(can(session('DISPATCHER'), 'read', 'dataQs')).toBe(false)
  })

  it('while still reading the inspection a challenge is written against', () => {
    // The pair's far side: gating the challenge must not gate the inspection.
    // An out-of-service order is a dispatch fact whatever is being disputed
    // about it.
    expect(can(session('DISPATCHER'), 'read', 'inspection')).toBe(true)
  })
})

describe('Phase 3 sweep: managing places', () => {
  // A dispatcher creates a Location by typing a stop, and corrects a dock's
  // timezone from the load screen. Both rode on `load:update` until now.

  it.each<Role>(['OWNER', 'ADMIN', 'MANAGER', 'DISPATCHER'])(
    '%s may manage places',
    (role) => {
      expect(can(session(role), 'create', 'location.manage')).toBe(true)
      expect(can(session(role), 'update', 'location.manage')).toBe(true)
    },
  )

  it('accounting does not', () => {
    // Not a slight: accounting never opens a load to fix a dock's timezone,
    // and a permission nobody uses is a permission nobody audits.
    expect(can(session('ACCOUNTING'), 'update', 'location.manage')).toBe(false)
  })

  it('and a driver may not touch any of the three', () => {
    for (const resource of [
      'truck.financials',
      'customer.financials',
      'location.manage',
    ] as const) {
      expect(can(session('DRIVER'), 'read', resource)).toBe(false)
    }
  })
})

describe('Phase 3 sweep: who sets a rate', () => {
  // §1: "Rates are entered by OWNER/ACCOUNTING — Step 1 makes that possible
  // on a booked load."

  it.each<Role>(['OWNER', 'ADMIN', 'ACCOUNTING'])('%s may set one', (role) => {
    expect(can(session(role), 'update', 'load.financials')).toBe(true)
  })

  it('a manager reads the number without setting it', () => {
    // "Runs the operation and watches the numbers, but does not move money."
    expect(can(session('MANAGER'), 'read', 'load.financials')).toBe(true)
    expect(can(session('MANAGER'), 'update', 'load.financials')).toBe(false)
  })

  it('a dispatcher cannot even read it', () => {
    expect(can(session('DISPATCHER'), 'read', 'load.financials')).toBe(false)
    expect(can(session('DISPATCHER'), 'update', 'load.financials')).toBe(false)
  })
})

describe('the sidebar only offers screens that exist', () => {
  // THE BUG THIS PREVENTS, reported from the parallel run: the sidebar listed
  // Dashboard, Calendar, Maintenance, Expenses, Fuel, Documents, Reports and
  // Settings, and not one of them had a page. Seven were 404s. Dashboard was
  // worse — `/` redirects to `/loads`, so clicking it looked like the sidebar
  // had lost track of where you were.
  //
  // The guard reads the FILESYSTEM rather than a list kept here, because a
  // list kept here is the same promise the nav was already making.

  const appDir = join(process.cwd(), 'src', 'app', '(app)')

  /** Does a route segment have a page? `/` is special — it has no page at all. */
  const hasPage = (href: string): boolean => {
    if (href === '/') return existsSync(join(appDir, 'page.tsx'))
    const segments = href.replace(/^\//, '').split('/')
    return existsSync(join(appDir, ...segments, 'page.tsx'))
  }

  const owner: AuthorizedSession = {
    userId: 'u',
    organizationId: 'o',
    role: 'OWNER',
    companyScopes: [],
  }

  it('every entry an OWNER is offered resolves to a real page', () => {
    // The OWNER sees the most, so this is the widest the sidebar ever gets.
    const missing = navigationFor(owner)
      .flatMap((group) => group.items)
      .filter((entry) => !hasPage(entry.href))
      .map((entry) => `${entry.key} -> ${entry.href}`)

    expect(missing, missing.join(', ')).toEqual([])
  })

  it('and every entry that does NOT resolve is marked with its phase', () => {
    // The other direction: an unbuilt screen must be hidden BY THE MARKER, not
    // by accident. Anything without a page and without `returnsIn` would be
    // offered the moment somebody granted its permission.
    const unmarked = NAVIGATION.flatMap((group) => group.items)
      .filter((entry) => !hasPage(entry.href) && entry.returnsIn === undefined)
      .map((entry) => entry.key)

    expect(unmarked, unmarked.join(', ')).toEqual([])
  })

  it('does not mark a screen that has in fact been built', () => {
    // The reverse mistake: a screen ships and nobody removes the marker, so it
    // stays invisible and the work is wasted.
    const stale = NAVIGATION.flatMap((group) => group.items)
      .filter((entry) => hasPage(entry.href) && entry.returnsIn !== undefined)
      .map((entry) => entry.key)

    expect(stale, stale.join(', ')).toEqual([])
  })

  it('keeps every group, because each still has a real screen in it', () => {
    // The ruling was "hide unbuilt entries, keep the group structure". If
    // hiding ever empties a group, the sidebar rearranges and this says so.
    expect(navigationFor(owner).map((group) => group.key)).toEqual([
      'operations',
      'fleet',
      'money',
      'records',
      'admin',
    ])
  })

  it('offers Settings to the two roles that hold it, and no others', () => {
    // It stopped being an unbuilt marker at Phase 4 step 6 and became an
    // ordinary permission question. `organization:read` is OWNER and ADMIN —
    // invoice terms and the settlement week boundary are the owner's call, and
    // a MANAGER who could move the boundary could move every driver's pay
    // period without touching a pay rule.
    const offers = (role: Role) =>
      navigationFor({ ...owner, role })
        .flatMap((group) => group.items.map((entry) => entry.href))
        .includes('/settings')

    expect(offers('OWNER')).toBe(true)
    expect(offers('ADMIN')).toBe(true)
    expect(offers('MANAGER')).toBe(false)
    expect(offers('DISPATCHER')).toBe(false)
    expect(offers('ACCOUNTING')).toBe(false)
  })

  it('hides the unbuilt from every role, not just from the ones without rights', () => {
    // A screen nobody can open is not a permission question. If it were, an
    // OWNER would see it and a DISPATCHER would not, for two different reasons
    // that would eventually disagree.
    const roles: Role[] = [
      'OWNER',
      'ADMIN',
      'MANAGER',
      'DISPATCHER',
      'ACCOUNTING',
    ]
    for (const role of roles) {
      const offered = navigationFor({ ...owner, role }).flatMap((group) =>
        group.items.map((entry) => entry.href),
      )
      expect(offered.includes('/calendar'), role).toBe(false)
      expect(offered.includes('/'), role).toBe(false)
    }
  })
})

describe('adding an authority is the owner’s act', () => {
  // Phase 6 §7 flag 11. `Company.id` IS the authority every scoped query
  // filters by, and `maxCompanies` is what the plan sells — so creating one is
  // both a tenancy act and a billing one.
  const roles = [
    'OWNER',
    'ADMIN',
    'MANAGER',
    'DISPATCHER',
    'ACCOUNTING',
  ] as const

  it('OWNER and ADMIN may, and NOBODY ELSE', () => {
    const may = roles.filter((role) =>
      can(
        {
          role,
          organizationId: 'org',
          userId: 'u',
          companyScopes: [],
        } as never,
        'create',
        'company',
      ),
    )
    expect(may).toEqual(['OWNER', 'ADMIN'])
  })

  it('while every operator role may READ them, because the switcher does', () => {
    // The pair. `company:read` is deliberately broad — the topbar's authority
    // switcher is built from these rows for a dispatcher too — which is
    // exactly why the NAV entry is gated on `create` instead. A read-gated
    // entry put the whole Administration group in a dispatcher's sidebar.
    for (const role of roles) {
      expect(
        can(
          {
            role,
            organizationId: 'org',
            userId: 'u',
            companyScopes: [],
          } as never,
          'read',
          'company',
        ),
      ).toBe(true)
    }
  })

  it('and the Authorities entry is absent from a MANAGER’s sidebar', () => {
    const sidebar = (role: (typeof roles)[number]) =>
      navigationFor({
        role,
        organizationId: 'org',
        userId: 'u',
        companyScopes: [],
      } as never)
        .flatMap((group) => group.items)
        .map((item) => item.href)

    expect(sidebar('OWNER')).toContain('/companies')
    expect(sidebar('ADMIN')).toContain('/companies')
    expect(sidebar('MANAGER')).not.toContain('/companies')
    expect(sidebar('DISPATCHER')).not.toContain('/companies')
    expect(sidebar('ACCOUNTING')).not.toContain('/companies')
  })
})
