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
  // The other two money-on-a-non-money-screen fields, added in Phase 3's
  // sweep. Both existed as COLUMNS with no resource covering them, so they
  // were omitted from every payload rather than gated — see flag 5, and the
  // verify-dispatcher check that asserts the absence for an owner too.
  'truck.financials',
  'customer.financials',
  // Fleet
  'truck',
  'trailer',
  'driver',
  'maintenance',
  'compliance',
  // A roadside inspection is its own kind of record, not a compliance date: it
  // is an EVENT with violations hanging off it, it is what a DataQs challenge
  // is written against (§2.5, step 5), and an out-of-service order on it is a
  // dispatch fact. Naming it separately means the answer to "who may record an
  // inspection" is not welded to "who may renew a registration".
  'inspection',
  // Claims and DataQs challenges. §2.5 gives them their own role line —
  // OWNER/ADMIN/MANAGER write, ACCOUNTING reads — which is neither FLEET_* nor
  // MONEY_*, so they are named here and granted explicitly below.
  'claim',
  'dataQs',
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
  // Places. A dispatcher creates them by typing a stop (create-on-miss) and
  // corrects a timezone from the load screen; that is management of reference
  // data and it deserves naming rather than riding on `load:update`.
  'location.manage',
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
  // A DISPATCHER reads inspections for the same reason they read compliance
  // dates (§2.5): a driver placed out of service at a scale house is the fact
  // that decides what happens to the load they are under.
  ...read('inspection'),
]

const FLEET_WRITE: Permission[] = [
  ...crud('truck'),
  ...crud('trailer'),
  ...crud('driver'),
  ...crud('maintenance'),
  ...crud('compliance'),
  ...crud('inspection'),
]

/**
 * Money that appears on a FLEET or RECORDS screen rather than a money screen.
 *
 * Held apart from MONEY_READ because the roles differ: accounting needs a
 * customer's credit limit to decide whether to haul for them, and a manager
 * needs a truck's purchase price to talk about the fleet — while neither
 * implies the invoice ledger.
 */
const EMBEDDED_MONEY_READ: Permission[] = [
  ...read('truck.financials'),
  ...read('customer.financials'),
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

/**
 * Entering what a load is worth.
 *
 * §1: "Rates are entered by OWNER/ACCOUNTING." A MANAGER reads the number and
 * does not set it; a DISPATCHER never sees it at all.
 */
const RATE_ENTRY: Permission[] = [
  'load.financials:update',
  'load.financials:create',
]

const MONEY_WRITE: Permission[] = [
  ...crud('invoice'),
  ...crud('payment'),
  ...crud('settlement'),
  ...crud('expense'),
  ...crud('fuel'),
  // Factoring terms. Who each authority sells its invoices to, and at what
  // advance and fee — configuration that lives under receivables because that
  // is the number it changes. A MANAGER reads the aging through MONEY_READ and
  // does not renegotiate the terms behind it.
  //
  // Create and update only: nothing deletes a factor, and granting an action
  // no screen performs is a claim nobody ever checks.
  'receivable:create',
  'receivable:update',
  'invoice:export',
  'receivable:export',
  'settlement:approve',
  'invoice:approve',
]

/**
 * Claims and DataQs challenges (§2.5).
 *
 * Deliberately NOT in FLEET_READ: a claim carries an amount and a dispute, and
 * a dispatcher who books the next load has no part in either. §2.5 names the
 * roles exactly — OWNER/ADMIN/MANAGER write, ACCOUNTING reads — and that is a
 * shorter list than any existing bundle, so it gets its own.
 */
const CLAIMS_READ: Permission[] = [...read('claim'), ...read('dataQs')]

const CLAIMS_WRITE: Permission[] = [...crud('claim'), ...crud('dataQs')]

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
    ...EMBEDDED_MONEY_READ,
    'location.manage:read',
    'location.manage:create',
    'location.manage:update',
    ...OPERATIONS_READ,
    ...OPERATIONS_WRITE,
    ...FLEET_READ,
    ...FLEET_WRITE,
    ...CLAIMS_READ,
    ...CLAIMS_WRITE,
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
    // Places, and deliberately NOT the two financial resources above. A
    // dispatcher types "Chicago, IL" into a stop and the place is created; a
    // dispatcher corrects a dock's timezone. Neither is money.
    'location.manage:read',
    'location.manage:create',
    'location.manage:update',
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
    ...EMBEDDED_MONEY_READ,
    ...RATE_ENTRY,
    ...read('dashboard'),
    ...read('load'),
    ...read('calendar'),
    ...read('driver'),
    ...read('truck'),
    // READ-ONLY, deliberately. Accounting handles insurance certificates at
    // billing and factoring time, so it needs to see an expiry date — but
    // renewing one is a safety act, and `compliance:create/update/delete` stay
    // with the roles that hold FLEET_WRITE. Resolves PHASE-4-BRIEF.md §6
    // flag 5, which §2.5 left open.
    ...read('compliance'),
    // The same shape one step later, and the same ruling. Accounting already
    // holds `truck.financials`, so it could see a work order's cost and could
    // not open the screen the cost is on — it reconciles the shop's invoice
    // against what was recorded. Recording the work order stays with
    // FLEET_WRITE. Resolves §6 flag 7.
    ...read('maintenance'),
    // Read, from the brief itself rather than from a new ruling: §2.5 gives
    // ACCOUNTING read on claims and DataQs, and a DataQs challenge is "tied to
    // a roadside inspection/violation" (§1). Read on the challenge without read
    // on the thing it is written against would be a screen with a hole in it.
    ...read('inspection'),
    // Read and not write, straight from §2.5. Accounting reserves against an
    // open claim and reconciles what was paid on a settled one; filing and
    // moving one is the safety desk's act.
    ...CLAIMS_READ,
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
  /** Set only on screens that do not exist. Hidden until they do. */
  returnsIn?: string
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

/**
 * A nav entry for a screen that DOES NOT EXIST YET.
 *
 * Kept in the list, hidden from the sidebar, and carrying the phase it returns
 * in as DATA rather than as a comment — so the label and the behaviour cannot
 * drift apart, and building the screen is a one-word edit back to `item`.
 *
 * The same ruling as the search box: a control that looks finished and does
 * nothing teaches a dispatcher the application is flaky, which costs more than
 * the missing feature. Worse here — `/` and `/calendar` are not even 404s.
 * Dashboard REDIRECTS TO LOADS, so clicking it looked like the sidebar had
 * lost track of where you were.
 *
 * `returnsIn` is free text because three of these are in no brief at all, and
 * "unassigned" is the honest answer rather than a phase invented to fill the
 * field.
 */
const unbuilt = (
  key: string,
  href: string,
  resource: Resource,
  returnsIn: string,
  action: Action = 'read',
): NavItem => ({
  key,
  labelKey: `nav.${key}`,
  href,
  resource,
  action,
  returnsIn,
})

export const NAVIGATION: readonly NavGroup[] = [
  {
    key: 'operations',
    labelKey: 'nav.group.operations',
    items: [
      item('dashboard', '/dashboard', 'dashboard'),
      item('dispatch', '/dispatch', 'dispatch'),
      item('loads', '/loads', 'load'),
      unbuilt('calendar', '/calendar', 'calendar', 'Phase 5'),
    ],
  },
  {
    key: 'fleet',
    labelKey: 'nav.group.fleet',
    items: [
      item('trucks', '/trucks', 'truck'),
      item('trailers', '/trailers', 'trailer'),
      item('drivers', '/drivers', 'driver'),
      // Compliance dates are OPERATIONAL, not financial: a dispatcher reads
      // them because they gate a real dispatch decision (§2.5). `compliance`
      // has been in FLEET_READ since Phase 1, so no permission changes.
      item('safety', '/safety', 'compliance'),
      // Phase 4 step 3. `maintenance` is in FLEET_READ, so a dispatcher gets
      // the screen — and not the cost column on it, which is
      // `truck.financials` and is decided by the page rather than by the nav.
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
      // §2.6: Expenses, Fuel and IFTA move to Phase 5. Phase 4 is fleet and
      // safety, not the spend ledger — maintenance COSTS land in Phase 4
      // because they attach to a work order, but the general expense screens
      // do not.
      unbuilt('expenses', '/expenses', 'expense', 'Phase 5'),
      unbuilt('fuel', '/fuel', 'fuel', 'Phase 5'),
    ],
  },
  {
    key: 'records',
    labelKey: 'nav.group.records',
    items: [
      item('brokers', '/brokers', 'customer'),
      // Phase 4 step 6 — the reading room over the pipeline. `document:read`
      // is held by everyone who uploads one, and the screen is permission-aware
      // per ENTITY rather than per role: a dispatcher sees the PODs they filed
      // and not the settlement PDFs beside them. See document-browser.ts.
      item('documents', '/documents', 'document'),
      unbuilt('reports', '/reports', 'report', 'Phase 5'),
    ],
  },
  {
    key: 'admin',
    labelKey: 'nav.group.admin',
    items: [
      item('users', '/users', 'user'),
      // Phase 6 §7 flag 11. GATED ON `create`, NOT `read`.
      //
      // Every operator role holds `company:read` — the authority switcher in
      // the topbar is built from those rows — so a read-gated entry here put
      // the whole Administration group in a dispatcher's sidebar, which the
      // permissions test caught on the first run. Managing authorities is
      // create work and OWNER/ADMIN hold it alone.
      item('companies', '/companies', 'company', 'create'),
      // Phase 4 step 6. `organization:update` is what the screen asks to save;
      // reading is `organization:read`, which OWNER and ADMIN hold and nobody
      // else does — settings decide invoice terms and the settlement week, and
      // both are the owner's call.
      item('settings', '/settings', 'organization'),
    ],
  },
]

/**
 * The navigation this session may see: entries that EXIST, filtered by
 * permission, then groups with nothing left in them dropped entirely.
 *
 * Unbuilt first, because a screen nobody can open is not a permission
 * question — hiding it from an OWNER and from a DISPATCHER for two different
 * reasons would be two bugs waiting to disagree.
 *
 * The GROUP STRUCTURE SURVIVES this: every one of the five groups still has at
 * least one real screen in it, so the sidebar keeps its shape and nothing
 * rearranges when the missing screens land.
 */
export function navigationFor(
  session: AuthorizedSession | null | undefined,
): NavGroup[] {
  return NAVIGATION.map((group) => ({
    ...group,
    items: group.items.filter(
      (entry) =>
        entry.returnsIn === undefined &&
        can(session, entry.action, entry.resource),
    ),
  })).filter((group) => group.items.length > 0)
}
