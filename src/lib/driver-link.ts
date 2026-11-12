import type { Prisma } from '@/generated/prisma/client'
import type { TxClient } from './tenancy'
import { revokeAllSessionsForUser } from './session'

// ---------------------------------------------------------------------------
// THE LINK BETWEEN A ROSTER ROW AND A SIGN-IN (Phase 7 step 1).
//
// `Driver.userId` existed from Phase 1 and nothing ever wrote it: 167 drivers
// on dev, 0 linked (PHASE-7-BRIEF.md §0, §8 flag 4). This is its one writer.
//
// THE RULINGS IT IMPLEMENTS (owner, 2026-11-12; TMS-DESIGN-SYSTEM.md §9):
//
//   §4.6  The link is made by OWNER or ADMIN on the driver's record, never by
//         the driver. The gate is `user:update`, which those two roles hold
//         alone — decided in permissions.ts, asked by the action; this file
//         never decides it.
//   §4.7  Setting the termination date deactivates the sign-in in the same
//         write. Reactivation is a NEW link by OWNER or ADMIN, and the audit
//         row names who — the audit extension writes `userId: from → to` on
//         the Driver row under the actor's attribution, so "who" is the
//         transaction's, not an argument here.
//
// ONE PREDICATE FOR "USER MAY BE LINKED" (owner's instruction): the picker
// lists it, the write checks it, the agreement test holds both to the SQL.
// A second spelling anywhere is the bug this comment exists to refuse.
// ---------------------------------------------------------------------------

export type LinkFailure =
  | 'driver_not_found'
  | 'driver_removed'
  | 'driver_terminated'
  | 'driver_already_linked'
  | 'not_a_member'
  | 'not_a_driver_role'
  | 'user_already_linked'

export type LinkOutcome = { ok: true } | { ok: false; reason: LinkFailure }

export type UnlinkFailure = 'driver_not_found' | 'not_linked'

export type UnlinkOutcome = { ok: true } | { ok: false; reason: UnlinkFailure }

/**
 * A membership whose user may be linked to a roster row of THIS organization:
 * role DRIVER, same organization, not already the sign-in of a live driver
 * here.
 *
 * `organizationId` is named twice on purpose. Row-level security already
 * hides another tenant's memberships and drivers, but `User` is not
 * tenant-scoped (one person may drive for two carriers), so "not already
 * linked" must say WHICH organization's roster it means — a link in another
 * carrier's roster does not spend the sign-in here.
 */
export function linkableMembershipWhere(
  organizationId: string,
): Prisma.MembershipWhereInput {
  return {
    organizationId,
    role: 'DRIVER',
    user: { driverProfiles: { none: { organizationId, deletedAt: null } } },
  }
}

export interface LinkableUser {
  userId: string
  name: string
  email: string
  /** False after a termination: linking again reactivates (§4.7). */
  isActive: boolean
  /** §6.4 part 2 names it as what the tab holds: the login and its last sign-in. */
  lastLoginAt: Date | null
}

const USER_SELECT = {
  id: true,
  name: true,
  email: true,
  isActive: true,
  lastLoginAt: true,
} as const

type UserRow = {
  id: string
  name: string
  email: string
  isActive: boolean
  lastLoginAt: Date | null
}

const toLinkable = (user: UserRow): LinkableUser => ({
  userId: user.id,
  name: user.name,
  email: user.email,
  isActive: user.isActive,
  lastLoginAt: user.lastLoginAt,
})

/** Who the picker offers. The predicate, listed. */
export async function linkableUsers(
  tx: TxClient,
  organizationId: string,
): Promise<LinkableUser[]> {
  const rows = await tx.membership.findMany({
    where: linkableMembershipWhere(organizationId),
    select: { user: { select: USER_SELECT } },
    orderBy: { user: { name: 'asc' } },
  })
  return rows.map((row) => toLinkable(row.user))
}

export interface SignInLinkView {
  linked: LinkableUser | null
  /** Empty while a sign-in is linked: the card offers unlink, not a second. */
  candidates: LinkableUser[]
}

/** What the driver record's Sign-in card shows. One read, two at most. */
export async function signInLinkFor(
  tx: TxClient,
  organizationId: string,
  driverId: string,
): Promise<SignInLinkView | null> {
  const driver = await tx.driver.findUnique({
    where: { id: driverId },
    select: { user: { select: USER_SELECT } },
  })
  if (!driver) return null
  if (driver.user) return { linked: toLinkable(driver.user), candidates: [] }
  return { linked: null, candidates: await linkableUsers(tx, organizationId) }
}

/**
 * Link a sign-in to a roster row. The driver first, then the user through
 * THE predicate, then the write — and a refusal names the one reason, in the
 * order the predicate asks, so the office can fix it.
 *
 * RE-LINKING REACTIVATES. A sign-in deactivated by a termination comes back
 * when OWNER or ADMIN picks it again (§4.7): the link IS the activation, so
 * there is one act to audit and not two.
 */
export async function linkDriverSignIn(
  tx: TxClient,
  organizationId: string,
  driverId: string,
  userId: string,
): Promise<LinkOutcome> {
  const driver = await tx.driver.findUnique({
    where: { id: driverId },
    select: { userId: true, deletedAt: true, terminationDate: true },
  })
  if (!driver) return { ok: false, reason: 'driver_not_found' }
  if (driver.deletedAt !== null) return { ok: false, reason: 'driver_removed' }
  if (driver.terminationDate !== null) {
    return { ok: false, reason: 'driver_terminated' }
  }
  if (driver.userId !== null) {
    return { ok: false, reason: 'driver_already_linked' }
  }

  const linkable = await tx.membership.findFirst({
    where: { AND: [linkableMembershipWhere(organizationId), { userId }] },
    select: { user: { select: { isActive: true } } },
  })
  if (!linkable) {
    // Why not, in the predicate's own order. Only on refusal: the happy path
    // asks the predicate once.
    const membership = await tx.membership.findFirst({
      where: { organizationId, userId },
      select: { role: true },
    })
    if (!membership) return { ok: false, reason: 'not_a_member' }
    if (membership.role !== 'DRIVER') {
      return { ok: false, reason: 'not_a_driver_role' }
    }
    return { ok: false, reason: 'user_already_linked' }
  }

  await tx.driver.update({ where: { id: driverId }, data: { userId } })
  if (!linkable.user.isActive) {
    await tx.user.update({ where: { id: userId }, data: { isActive: true } })
  }
  return { ok: true }
}

/**
 * Drop the link and nothing else — the correction for a wrong pick. The
 * sign-in keeps whatever activation it had; deactivating is termination's
 * job (`deactivateLinkedSignIn`) or the Users screen's.
 */
export async function unlinkDriverSignIn(
  tx: TxClient,
  driverId: string,
): Promise<UnlinkOutcome> {
  const driver = await tx.driver.findUnique({
    where: { id: driverId },
    select: { userId: true },
  })
  if (!driver) return { ok: false, reason: 'driver_not_found' }
  if (driver.userId === null) return { ok: false, reason: 'not_linked' }
  await tx.driver.update({ where: { id: driverId }, data: { userId: null } })
  return { ok: true }
}

/**
 * Termination's half of §4.7: the linked sign-in is deactivated, every
 * session it holds is revoked, and the link is dropped — in the caller's
 * transaction, so a termination that fails writes none of it.
 *
 * CALLED BY `setRosterStatus` WHEN IT WRITES THE TERMINATION DATE, which runs
 * under `driver:update` — a MANAGER's permission. That a MANAGER's termination
 * deactivates a sign-in they could not deactivate on the Users screen is the
 * ruling's consequence, recorded here rather than hidden: the termination is
 * the decision, and this is what it means.
 *
 * Returns the sign-in it deactivated, or null when there was none, so a
 * caller can say so.
 */
export async function deactivateLinkedSignIn(
  tx: TxClient,
  driverId: string,
): Promise<{ userId: string | null }> {
  const driver = await tx.driver.findUnique({
    where: { id: driverId },
    select: { userId: true },
  })
  if (!driver || driver.userId === null) return { userId: null }
  const userId = driver.userId
  await tx.user.update({ where: { id: userId }, data: { isActive: false } })
  await revokeAllSessionsForUser(tx, userId)
  await tx.driver.update({ where: { id: driverId }, data: { userId: null } })
  return { userId }
}
