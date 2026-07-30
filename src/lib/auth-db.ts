import 'server-only'
import { createPrismaClient } from './db'
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
  const connectionString = process.env.DATABASE_URL
  if (!connectionString) throw new Error('DATABASE_URL is not set.')
  // Still zebra_app — createPrismaClient refuses anything else. Being outside
  // RLS is a property of these four tables, not a licence to connect as owner.
  return createPrismaClient(connectionString)
}
