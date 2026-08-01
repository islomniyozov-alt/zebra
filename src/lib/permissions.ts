import type { Role } from '@/generated/prisma/client'

// ---------------------------------------------------------------------------
// ONE PLACE WHERE PERMISSION IS DECIDED
//
// §7: every route and every server action calls `can`. No route decides its
// own permissions inline. The value of that rule is not tidiness — it is that
// when someone asks "can a dispatcher see driver pay", there is exactly one
// file that answers, and changing the answer changes it everywhere at once.
//
// A permission is `resource:action`. Resources are deliberately finer than
// tables where money is involved: `load` and `load.financials` are separate,
// because a dispatcher books loads all day and must never see the margin on
// them, and `driver` and `driver.pay` are separate for the same reason.
//
// Note what this file does NOT do. It answers "may this role do this kind of
// thing", not "may this user touch this row". Row scoping is two other
// mechanisms: the organization is enforced by Postgres (see tenancy.ts), and
// the operating authority is a filter (see companyScopeFilter). Conflating the
// three is how a check ends up looking sufficient while protecting nothing.
// ---------------------------------------------------------------------------

export const RESOURCES = [
  // Operations
  'dashboard',
  'dispatch',
  'load',
  'calendar',
  // Money visible on an operational surface. Separate on purpose.
  'load.financials',
  'driver.pay',
  // Fleet
  'truck',
  'trailer',
  'driver',
  'maintenance',
  'compliance',
  // Money
  'invoice',
  'receivable',
  'payment',
  'settlement',
  'expense',
  'fuel',
  // Records
  'customer',
  'document',
  'report',
  // Admin
  'user',
  'company',
  'organization',
  'integration',
  'auditLog',
  // Driver portal. A separate vocabulary so that granting a driver anything
  // in the operator application takes a deliberate act, not an oversight.
  'portal.load',
  'portal.document',
  'portal.settlement',
] as const

export type Resource = (typeof RESOURCES)[number]

export const ACTIONS = [
  'read',
  'create',
  'update',
  'delete',
  'approve',
  'export',
] as const

export type Action = (typeof ACTIONS)[number]

export type Permission = `${Resource}:${Action}`

export interface PermissionOverrides {
  /** Added on top of the role. */
  grant?: Permission[]
  /** Removed from the role. Wins over `grant`. */
  revoke?: Permission[]
}

/**
 * What `can` needs to know. A real session satisfies this, and so does a
 * literal in a test — which is the point, since the alternative is a
 * permission suite that can only run against a database.
 */
export interface AuthorizedSession {
  userId: string
  organizationId: string
  role: Role
  companyScopes: readonly string[]
  permissionOverrides?: PermissionOverrides | null
}

const read = (resource: Resource): Permission[] => [`${resource}:read`]

const crud = (resource: Resource): Permission[] => [
  `${resource}:read`,
  `${resource}:create`,
  `${resource}:update`,
  `${resource}:delete`,
]

// ---------------------------------------------------------------------------
// THE SHELL'S OWN PRECONDITION.
//
// §6.3 gives every operator screen a company filter, and the app shell reads
// the authority names to build it. So every role that can open the application
// at all needs `company:read` — without it the shell's own query throws
// ForbiddenError on EVERY page, which is what a DISPATCHER got until the
// Phase 2 acceptance run went looking. It reads the NAME of an authority, not
// its settings; `company:update` stays where it was.
//
// The DRIVER role is deliberately not given it: the portal is a separate shell
// with a separate vocabulary and no company filter.
const SHELL_READ: Permission[] = [...read('company')]

const OPERATIONS_READ: Permission[] = [
  ...read('dashboard'),
  ...read('dispatch'),
  ...read('load'),
  ...read('calendar'),
]

const OPERATIONS_WRITE: Permission[] = [
  ...crud('load'),
  'dispatch:update',
  ...crud('calendar'),
]

const FLEET_READ: Permission[] = [
  ...read('truck'),
  ...read('trailer'),
  ...read('driver'),
  ...read('maintenance'),
  ...read('compliance'),
]

const FLEET_WRITE: Permission[] = [
  ...crud('truck'),
  ...crud('trailer'),
  ...crud('driver'),
  ...crud('maintenance'),
  ...crud('compliance'),
]

const MONEY_READ: Permission[] = [
  ...read('invoice'),
  ...read('receivable'),
  ...read('payment'),
  ...read('settlement'),
  ...read('expense'),
  ...read('fuel'),
  ...read('load.financials'),
  ...read('driver.pay'),
]

const MONEY_WRITE: Permission[] = [
  ...crud('invoice'),
  ...crud('payment'),
  ...crud('settlement'),
  ...crud('expense'),
  ...crud('fuel'),
  'invoice:export',
  'receivable:export',
  'settlement:approve',
  'invoice:approve',
]

const RECORDS_READ: Permission[] = [
  ...read('customer'),
  ...read('document'),
  ...read('report'),
]

const RECORDS_WRITE: Permission[] = [...crud('customer'), ...crud('document')]

const ALL_PERMISSIONS: Permission[] = RESOURCES.flatMap((resource) =>
  ACTIONS.map((action): Permission => `${resource}:${action}`),
)

/** Every non-portal permission. What OWNER holds. */
const EVERYTHING: Permission[] = ALL_PERMISSIONS.filter(
  (permission) => !permission.startsWith('portal.'),
)

const ROLE_PERMISSIONS: Record<Role, ReadonlySet<Permission>> = {
  OWNER: new Set(EVERYTHING),

  // Everything an owner can do except dissolving the tenant itself.
  ADMIN: new Set(EVERYTHING.filter((p) => p !== 'organization:delete')),

  // Runs the operation and watches the numbers, but does not move money.
  MANAGER: new Set<Permission>([
    ...SHELL_READ,
    ...OPERATIONS_READ,
    ...OPERATIONS_WRITE,
    ...FLEET_READ,
    ...FLEET_WRITE,
    ...MONEY_READ,
    ...RECORDS_READ,
    ...RECORDS_WRITE,
    'report:export',
    'auditLog:read',
  ]),

  // The 6am user. Books loads, assigns trucks, chases PODs. Sees no margin,
  // no driver pay, and nothing under Money — which is why the Money nav group
  // does not render for them at all.
  DISPATCHER: new Set<Permission>([
    ...SHELL_READ,
    ...OPERATIONS_READ,
    ...OPERATIONS_WRITE,
    ...FLEET_READ,
    ...read('customer'),
    'customer:create',
    ...read('document'),
    'document:create',
    'document:update',
  ]),

  // Invoices, applies payments, runs settlements. Reads operations because an
  // invoice is built from a load; does not dispatch.
  ACCOUNTING: new Set<Permission>([
    ...SHELL_READ,
    ...read('dashboard'),
    ...read('load'),
    ...read('calendar'),
    ...read('driver'),
    ...read('truck'),
    ...MONEY_READ,
    ...MONEY_WRITE,
    ...RECORDS_READ,
    ...RECORDS_WRITE,
    'report:export',
  ]),

  // Nothing in the operator application. The portal is a separate shell and a
  // driver sees their own load, their own documents, their own settlement.
  DRIVER: new Set<Permission>([
    'portal.load:read',
    'portal.load:update',
    'portal.document:read',
    'portal.document:create',
    'portal.settlement:read',
  ]),
}

/**
 * The one authorization question in the application.
 *
 * Deny by default: an unknown role, a malformed permission or a missing
 * session all return false rather than throwing, because a route that forgets
 * to handle the error should still fail closed.
 */
export function can(
  session: AuthorizedSession | null | undefined,
  action: Action,
  resource: Resource,
): boolean {
  if (!session) return false

  const permission: Permission = `${resource}:${action}`
  const overrides = session.permissionOverrides

  // Revocation wins. A permission taken away from one person must not be
  // restorable by a role change nobody reviewed.
  if (overrides?.revoke?.includes(permission)) return false
  if (overrides?.grant?.includes(permission)) return true

  return ROLE_PERMISSIONS[session.role]?.has(permission) ?? false
}

/** Every permission a session actually holds. For debugging and for tests. */
export function permissionsOf(session: AuthorizedSession): Permission[] {
  return ALL_PERMISSIONS.filter((permission) => {
    // Resources contain dots but never colons, so this split is unambiguous.
    const separator = permission.lastIndexOf(':')
    const resource = permission.slice(0, separator) as Resource
    const action = permission.slice(separator + 1) as Action
    return can(session, action, resource)
  })
}

// ---------------------------------------------------------------------------
// NAVIGATION (§6.2)
//
// Nav is a permission question, so it is answered here rather than in a
// component. §7: a dispatcher without financial permission never sees an empty
// "Money" heading — groups render only where the user has at least one visible
// child. Doing that in CSS, or by rendering the group and hiding the items,
// leaks the shape of the application to someone who cannot use it.
//
// Labels are i18n keys, not text. EN, RU and FA from the first component.
// ---------------------------------------------------------------------------

export interface NavItem {
  key: string
  labelKey: string
  href: string
  resource: Resource
  action: Action
}

export interface NavGroup {
  key: string
  labelKey: string
  items: NavItem[]
}

const item = (
  key: string,
  href: string,
  resource: Resource,
  action: Action = 'read',
): NavItem => ({ key, labelKey: `nav.${key}`, href, resource, action })

export const NAVIGATION: readonly NavGroup[] = [
  {
    key: 'operations',
    labelKey: 'nav.group.operations',
    items: [
      item('dashboard', '/', 'dashboard'),
      item('dispatch', '/dispatch', 'dispatch'),
      item('loads', '/loads', 'load'),
      item('calendar', '/calendar', 'calendar'),
    ],
  },
  {
    key: 'fleet',
    labelKey: 'nav.group.fleet',
    items: [
      item('trucks', '/trucks', 'truck'),
      item('trailers', '/trailers', 'trailer'),
      item('drivers', '/drivers', 'driver'),
      item('maintenance', '/maintenance', 'maintenance'),
    ],
  },
  {
    key: 'money',
    labelKey: 'nav.group.money',
    items: [
      item('invoices', '/invoices', 'invoice'),
      item('receivables', '/receivables', 'receivable'),
      item('payments', '/payments', 'payment'),
      item('settlements', '/settlements', 'settlement'),
      item('expenses', '/expenses', 'expense'),
      item('fuel', '/fuel', 'fuel'),
    ],
  },
  {
    key: 'records',
    labelKey: 'nav.group.records',
    items: [
      item('brokers', '/brokers', 'customer'),
      item('documents', '/documents', 'document'),
      item('reports', '/reports', 'report'),
    ],
  },
  {
    key: 'admin',
    labelKey: 'nav.group.admin',
    items: [
      item('users', '/users', 'user'),
      item('settings', '/settings', 'organization'),
    ],
  },
]

/**
 * The navigation this session may see: items filtered by permission, then
 * groups with nothing left in them dropped entirely.
 */
export function navigationFor(
  session: AuthorizedSession | null | undefined,
): NavGroup[] {
  return NAVIGATION.map((group) => ({
    ...group,
    items: group.items.filter((entry) =>
      can(session, entry.action, entry.resource),
    ),
  })).filter((group) => group.items.length > 0)
}
