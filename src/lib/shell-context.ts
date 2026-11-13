import type { Prisma, PrismaClient, Role } from '@/generated/prisma/client'
import { DEFAULT_DENSITY, parseDensity, type Density } from './preferences'
import {
  hashSessionToken,
  parseOverrides,
  type SessionContext,
} from './session'

// ---------------------------------------------------------------------------
// THE SHELL'S ONE READ (GAPS 42 item 3; owner's instruction 2026-11-12; §6.10
// v10.93; migration 71).
//
// The operator shell paid three reads before any page: the session by token
// hash, the viewer's own name and email, and the density preference in a
// tenant transaction of its own — 840 ms median on every page (GAPS 42). This
// is the one statement that answers all three: `zebra_shell_context(hash)`,
// a SECURITY DEFINER function whose one predicate ties the preference to the
// session row the hash found — its own user and its own active organization
// — so a token reads its own density and nothing else.
//
// THE VALIDITY CHECKS STAY HERE, spelled as `resolveSession` spells them:
// revoked, expired, user inactive — null for each. The agreement test holds
// this function's answer against the three reads it replaces, both sides
// above zero, so the two spellings of "a live session" cannot drift.
// ---------------------------------------------------------------------------

export type ShellDb = Pick<PrismaClient, '$queryRaw'>

export interface ShellContext {
  session: SessionContext
  account: { name: string; email: string }
  density: Density
}

interface ShellRow {
  session_id: string
  user_id: string
  organization_id: string
  role: Role
  company_scopes: string[]
  permission_overrides: Prisma.JsonValue | null
  expires_at: Date
  revoked_at: Date | null
  user_active: boolean
  user_name: string
  user_email: string
  density: Prisma.JsonValue | null
}

/** The whole shell context for a session token, in ONE statement, or null. */
export async function resolveShellContext(
  db: ShellDb,
  token: string | null | undefined,
): Promise<ShellContext | null> {
  if (!token) return null
  const hash = await hashSessionToken(token)
  const rows = await db.$queryRaw<ShellRow[]>`
    SELECT * FROM zebra_shell_context(${hash})
  `
  const row = rows[0]
  if (!row) return null
  if (row.revoked_at !== null) return null
  if (row.expires_at.getTime() <= Date.now()) return null
  if (!row.user_active) return null
  return {
    session: {
      sessionId: row.session_id,
      userId: row.user_id,
      organizationId: row.organization_id,
      role: row.role,
      companyScopes: row.company_scopes,
      permissionOverrides: parseOverrides(row.permission_overrides),
      expiresAt: row.expires_at,
    },
    account: { name: row.user_name, email: row.user_email },
    // No row is the default, as `readDensity` reads it; an odd value too.
    density: row.density === null ? DEFAULT_DENSITY : parseDensity(row.density),
  }
}
