import type { Role } from '@/generated/prisma/client'
import type { TxClient } from './tenancy'
import { hashPassword } from './password'
import { normalizeEmail } from './auth'
import { revokeAllSessionsForUser } from './session'
import { isUniqueViolation } from './reference'

// ---------------------------------------------------------------------------
// USER PROVISIONING — the admin screen's whole service layer.
//
// THE TENANCY TRAP THAT SHAPES THIS FILE. `User` has no `organizationId`. It
// cannot: one person may hold memberships in several organizations, which is
// the schema's own comment on Membership. So `User` is NOT one of the 39
// tables row-level security protects, and `tx.user.findMany()` inside
// `withCurrentOrg` returns every user of every tenant — silently, with no
// error, looking exactly like a working query.
//
// Every read below therefore starts from `Membership`, which does carry an
// organizationId and is policied; and every write that names a user by id
// first proves that user has a membership HERE. A route that trusted an id
// from a form could otherwise deactivate somebody in another company.
//
// NO SELF-SERVICE SIGNUP AND NO EMAIL. An admin creates the account, the
// screen shows a temporary password exactly once, and the admin hands it over
// out of band. That is a deliberate limit, not a missing feature: the reset
// transport only reaches the Resend account owner until a sending domain is
// verified, so an invitation email would silently reach nobody.
// ---------------------------------------------------------------------------

export interface UserRow {
  id: string
  name: string
  email: string
  role: Role
  isActive: boolean
  /** Empty means every authority in the organization. */
  companyNames: string[]
  lastLoginAt: Date | null
}

export async function listUsers(
  tx: TxClient,
  organizationId: string,
): Promise<UserRow[]> {
  // FROM MEMBERSHIP, not from User. See the note at the top of this file.
  const memberships = await tx.membership.findMany({
    where: { organizationId },
    orderBy: [{ role: 'asc' }, { user: { name: 'asc' } }],
    select: {
      role: true,
      user: {
        select: {
          id: true,
          name: true,
          email: true,
          isActive: true,
          lastLoginAt: true,
        },
      },
      companyScopes: { select: { company: { select: { name: true } } } },
    },
  })

  return memberships.map((membership) => ({
    id: membership.user.id,
    name: membership.user.name,
    email: membership.user.email,
    role: membership.role,
    isActive: membership.user.isActive,
    companyNames: membership.companyScopes.map((scope) => scope.company.name),
    lastLoginAt: membership.user.lastLoginAt,
  }))
}

/**
 * A temporary password: 24 random bytes, base64url.
 *
 * Long enough that its short life is not the only thing protecting it, and
 * URL-safe so that pasting it into a chat message cannot mangle it. It is
 * generated on the server, shown once, and never stored in the clear —
 * `passwordHash` is the only trace, and the holder is expected to change it
 * within minutes.
 */
export function generateTemporaryPassword(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(24))
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

export interface CreateUserInput {
  name: string
  email: string
  role: Role
  /** Empty means every authority. Ids are validated against the org. */
  companyIds: readonly string[]
}

export type CreateUserFailure =
  | 'name_required'
  | 'email_required'
  | 'already_a_member'
  | 'email_unavailable'
  | 'role_not_grantable'
  | 'company_not_in_org'

export type CreateUserOutcome =
  | { ok: true; userId: string; temporaryPassword: string }
  | { ok: false; reason: CreateUserFailure }

/**
 * Which roles an actor may hand out.
 *
 * An ADMIN holds everything an OWNER does bar `organization:delete`, so
 * letting one mint OWNERs is a small escalation rather than a large one — but
 * it is still the shape of bug that is embarrassing to discover later, and
 * three lines to prevent now.
 */
export function grantableRoles(actor: Role): Role[] {
  const all: Role[] = ['ADMIN', 'MANAGER', 'DISPATCHER', 'ACCOUNTING', 'DRIVER']
  return actor === 'OWNER' ? ['OWNER', ...all] : all
}

export async function createUser(
  tx: TxClient,
  organizationId: string,
  actorRole: Role,
  input: CreateUserInput,
): Promise<CreateUserOutcome> {
  const name = input.name.trim()
  const email = normalizeEmail(input.email)

  if (name === '') return { ok: false, reason: 'name_required' }
  if (email === '' || !email.includes('@')) {
    return { ok: false, reason: 'email_required' }
  }
  if (!grantableRoles(actorRole).includes(input.role)) {
    return { ok: false, reason: 'role_not_grantable' }
  }

  // Company scope is checked against THIS organization's companies. The query
  // is tenant-scoped, so an id from another org simply does not come back and
  // the count disagrees.
  if (input.companyIds.length > 0) {
    const found = await tx.company.count({
      where: { id: { in: [...input.companyIds] } },
    })
    if (found !== input.companyIds.length) {
      return { ok: false, reason: 'company_not_in_org' }
    }
  }

  // Already here? Say so precisely — it is this organization's own data and
  // the admin is entitled to it.
  const existing = await tx.membership.findFirst({
    where: { organizationId, user: { email } },
    select: { id: true },
  })
  if (existing) return { ok: false, reason: 'already_a_member' }

  const temporaryPassword = generateTemporaryPassword()
  const passwordHash = await hashPassword(temporaryPassword)

  let userId: string
  try {
    const user = await tx.user.create({
      data: { email, name, passwordHash, isActive: true },
      select: { id: true },
    })
    userId = user.id
  } catch (error) {
    // The address belongs to a user in ANOTHER organization. The membership
    // check above already ruled out this one, so the only honest answer is a
    // refusal that does not confirm the address exists somewhere else — that
    // difference is precisely the fact an admin here may not have.
    if (isUniqueViolation(error)) {
      return { ok: false, reason: 'email_unavailable' }
    }
    throw error
  }

  const membership = await tx.membership.create({
    data: { userId, organizationId, role: input.role },
    select: { id: true },
  })

  for (const companyId of input.companyIds) {
    await tx.membershipCompany.create({
      data: { membershipId: membership.id, companyId, organizationId },
    })
  }

  return { ok: true, userId, temporaryPassword }
}

export type SetActiveFailure = 'not_found' | 'cannot_deactivate_self'

/**
 * Deactivate or reactivate a member of THIS organization.
 *
 * Deactivating revokes every session the user holds. Without that, `isActive`
 * only stops the next sign-in and somebody removed at nine in the morning
 * keeps working until their cookie expires that evening — which is not what
 * anybody means by the word.
 */
export async function setUserActive(
  tx: TxClient,
  organizationId: string,
  actorUserId: string,
  userId: string,
  isActive: boolean,
): Promise<{ ok: true } | { ok: false; reason: SetActiveFailure }> {
  if (userId === actorUserId && !isActive) {
    return { ok: false, reason: 'cannot_deactivate_self' }
  }

  // Membership first. `User` is not tenant-scoped, so this lookup is the only
  // thing standing between a posted id and somebody else's employee.
  const membership = await tx.membership.findFirst({
    where: { organizationId, userId },
    select: { id: true },
  })
  if (!membership) return { ok: false, reason: 'not_found' }

  await tx.user.update({ where: { id: userId }, data: { isActive } })
  if (!isActive) await revokeAllSessionsForUser(tx, userId)

  return { ok: true }
}

// ── CHANGING A MEMBER'S ROLE (§6.11, owner's instruction 2026-11-13) ────────

export type ChangeRoleFailure =
  | 'not_found'
  | 'cannot_change_self'
  | 'unchanged'
  | 'role_not_grantable'
  | 'owner_needs_owner'
  | 'last_owner'
  | 'driver_via_link'

export type ChangeRoleOutcome =
  | { ok: true; from: Role; to: Role; sessionsEnded: number }
  | { ok: false; reason: ChangeRoleFailure }

/**
 * Change one member's role in THIS organization.
 *
 * WHO MAY CALL IT is `user:update`, decided in `permissions.ts` and checked by
 * the action's `withCurrentOrg` — OWNER and ADMIN hold it and nobody else.
 * What this function decides is which CHANGES are allowed, in the order the
 * refusals are most informative:
 *
 *   1. never yourself — the next screen is decided by the role, and a slip
 *      would end the very session that could undo it;
 *   2. the target must be a member here — `User` is not tenant-scoped, so the
 *      membership lookup is what stands between a posted id and somebody
 *      else's employee (the same reasoning as `setUserActive`);
 *   3. DRIVER is neither granted nor removed here — the driver link owns that
 *      sign-in and ties it to a Driver record (§6.11, for the owner's ruling);
 *   4. an ADMIN may not change an OWNER's role, and may grant only what
 *      `grantableRoles` lets an ADMIN create — demoting the owner is minting
 *      one reached from the other side;
 *   5. never the LAST OWNER — counted inside this transaction, so two changes
 *      at once cannot both see a second owner who is about to stop being one.
 *
 * THE UPDATE IS BY ID, so the audit extension reads the row before it and
 * writes `Membership` / `update` with `changes.role` `{ from, to }`. Then
 * every live session whose active organization is this one is revoked: the
 * role is copied onto the session at sign-in, and a demoted ADMIN would
 * otherwise keep ADMIN until the cookie expired. Other organizations'
 * sessions are left alone — this is a change in this organization.
 */
export async function changeUserRole(
  tx: TxClient,
  organizationId: string,
  actor: { userId: string; role: Role },
  userId: string,
  to: Role,
): Promise<ChangeRoleOutcome> {
  if (userId === actor.userId)
    return { ok: false, reason: 'cannot_change_self' }

  const membership = await tx.membership.findFirst({
    where: { organizationId, userId },
    select: { id: true, role: true },
  })
  if (!membership) return { ok: false, reason: 'not_found' }
  const from = membership.role

  if (from === to) return { ok: false, reason: 'unchanged' }
  if (from === 'DRIVER' || to === 'DRIVER') {
    return { ok: false, reason: 'driver_via_link' }
  }
  if (actor.role !== 'OWNER' && from === 'OWNER') {
    return { ok: false, reason: 'owner_needs_owner' }
  }
  if (!grantableRoles(actor.role).includes(to)) {
    return { ok: false, reason: 'role_not_grantable' }
  }
  if (from === 'OWNER') {
    // LOCKED, NOT JUST COUNTED. Two owners demoting each other at the same
    // moment would each count two owners under READ COMMITTED and leave the
    // organization with none. `FOR UPDATE` makes the second wait for the
    // first and re-read the rows after it commits — by then the first's
    // target is no longer an OWNER, so the second counts one and is refused.
    const owners = await tx.$queryRaw<{ id: string }[]>`
      SELECT m."id" FROM "Membership" m
       WHERE m."organizationId" = ${organizationId} AND m."role" = 'OWNER'
       FOR UPDATE
    `
    if (owners.length <= 1) return { ok: false, reason: 'last_owner' }
  }

  await tx.membership.update({
    where: { id: membership.id },
    data: { role: to },
  })
  const { count } = await tx.session.updateMany({
    where: { userId, activeOrganizationId: organizationId, revokedAt: null },
    data: { revokedAt: new Date() },
  })

  return { ok: true, from, to, sessionsEnded: count }
}

/**
 * The roles the `/users` screen offers for one row, or null for no control —
 * the same refusals `changeUserRole` makes, asked before the click so the
 * screen does not offer what the server will refuse. The server still asks
 * them all again; this only decides what is drawn.
 */
export function roleChoicesFor(
  actor: { userId: string; role: Role },
  target: { id: string; role: Role },
): Role[] | null {
  if (target.id === actor.userId) return null
  if (target.role === 'DRIVER') return null
  if (actor.role !== 'OWNER' && target.role === 'OWNER') return null
  return grantableRoles(actor.role).filter((role) => role !== 'DRIVER')
}
