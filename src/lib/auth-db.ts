import 'server-only'
import { requestClient } from './db'
import type { AuthDb } from './auth'
import type { ResetDb } from './password-reset'

// ---------------------------------------------------------------------------
// THE ONE DATABASE HANDLE THAT IS NOT TENANT-SCOPED, AND WHY.
//
// ESLint refuses `prisma` and `createPrismaClient` under src/app, because a
// route reaching past `withCurrentOrg` gets neither the permission check nor
// the tenant scope. Sign-in and password reset are the exception that proves
// it: there is no session yet, so there is no tenant to scope to. `User`,
// `Session`, `LoginAttempt` and `PasswordResetToken` are outside row-level
// security for exactly this reason.
//
// The exception lives here rather than as an eslint-disable at each call site.
// One file to review, one comment to read, and the lint rule stays absolute —
// a disable comment in a route is indistinguishable from a disable comment
// someone added because they were in a hurry.
//
// If you find yourself importing this for anything that HAS a session, you
// want `withCurrentOrg`.
// ---------------------------------------------------------------------------

export function unauthenticatedDb(): AuthDb & ResetDb {
  // THE REQUEST'S CLIENT, NOT A SECOND ONE (GAPS 32, owner's ruling
  // 2026-10-12). This used to construct its own client — its own pool and its
  // own socket — on every call; the shell's account read through it cost
  // 2,229 ms against 794 for the session read on the request's client. It is
  // the same role and the same connection string: `requestClient()` builds
  // from `DATABASE_URL` and refuses anything that is not `zebra_app`. Being
  // outside RLS is a property of these four tables, not of the client.
  return requestClient()
}

/**
 * The same handle under a truthful name, for the one authenticated operation
 * that still has no tenant: a user changing their own password.
 *
 * It touches `User` and `Session` and nothing else, both of which sit outside
 * row-level security for the reasons above, and it is not a `user:update` —
 * that resource governs administering other people. A separate name rather
 * than a second call to `unauthenticatedDb`, because that name would be a lie
 * in a file that has a session in hand, and a lie in a name outlives every
 * comment written to excuse it.
 */
export function ownAccountDb(): AuthDb {
  return unauthenticatedDb()
}
