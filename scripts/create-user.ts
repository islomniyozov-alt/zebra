import 'dotenv/config'
import { createPrismaClient } from '@/lib/db'
import { createUser, type CreateUserInput } from '@/lib/users'
import { normalizeEmail } from '@/lib/auth'
import { isProductionLabel } from '../prisma/production-gate'
import type { Role } from '@/generated/prisma/client'

// ---------------------------------------------------------------------------
// CREATE ONE USER ON DEV, THROUGH THE SAME FUNCTION THE USERS SCREEN CALLS.
//
//   npx tsx scripts/create-user.ts --email livecheck@zebratms.com \
//     --name "Live Check" --role ADMIN
//
// Owner's ruling, 2026-10-06: the Live Check and dispatcher accounts are created
// on dev by script, and on production by Islom through Admin -> Users. So this
// script is DEV-ONLY and says so before it opens a socket: a `NEON_BRANCH` that
// labels production is refused outright, not gated behind an override, because
// there is nothing it should ever do there.
//
// `createUser` is the one place a user is minted (AGENTS.md: domain logic in
// src/lib, an action calls one function). It runs here on the owner connection,
// which carries BYPASSRLS, so the organization is resolved from the seed
// owner's OWN membership and printed by name before anything is written —
// the same stand-in for row-level security that `scripts/datatruck-tenancy.ts`
// describes for the other writers on this fence.
//
// THE TEMPORARY PASSWORD IS PRINTED ONCE, here, and nowhere else. It is the
// hand-over `createUser` was designed for; the person signs in and changes it.
// ---------------------------------------------------------------------------

const ROLES: readonly Role[] = [
  'ADMIN',
  'MANAGER',
  'DISPATCHER',
  'ACCOUNTING',
  'DRIVER',
]

function arg(name: string): string | null {
  const at = process.argv.indexOf(`--${name}`)
  if (at === -1) return null
  const value = process.argv[at + 1]
  return value === undefined || value.startsWith('--') ? null : value
}

async function main(): Promise<void> {
  if (isProductionLabel(process.env)) {
    console.error(
      'REFUSED: NEON_BRANCH labels production. Production users are created through Admin -> Users, by a person.',
    )
    process.exit(1)
  }
  const url = process.env.DIRECT_DATABASE_URL
  const ownerEmail = process.env.SEED_OWNER_EMAIL
  if (!url || !process.env.NEON_BRANCH || !ownerEmail) {
    console.error(
      'DIRECT_DATABASE_URL, NEON_BRANCH and SEED_OWNER_EMAIL must be set (the dev .env).',
    )
    process.exit(1)
  }

  const email = arg('email')
  const name = arg('name')
  const role = arg('role') as Role | null
  if (!email || !name || !role || !ROLES.includes(role)) {
    console.error(
      `usage: --email <address> --name "<name>" --role <${ROLES.join('|')}>  [--company <id>]...`,
    )
    process.exit(1)
  }
  const companyIds: string[] = []
  process.argv.forEach((value, index) => {
    if (value === '--company' && process.argv[index + 1])
      companyIds.push(process.argv[index + 1]!)
  })

  const db = createPrismaClient(url)
  try {
    // THE ORGANIZATION IS THE SEED OWNER'S OWN, resolved by membership and named.
    const membership = await db.membership.findFirst({
      where: { role: 'OWNER', user: { email: normalizeEmail(ownerEmail) } },
      select: {
        organizationId: true,
        organization: { select: { name: true, slug: true } },
      },
    })
    if (!membership) {
      console.error(
        `No OWNER membership for ${ownerEmail} on the ${process.env.NEON_BRANCH} branch.`,
      )
      process.exit(1)
    }
    const before = await db.membership.count({
      where: { organizationId: membership.organizationId },
    })
    console.log(
      `branch ${process.env.NEON_BRANCH} · organization "${membership.organization.name}" (${membership.organization.slug}) · ${String(before)} member(s) before`,
    )

    const input: CreateUserInput = { name, email, role, companyIds }
    const outcome = await db.$transaction((tx) =>
      createUser(tx, membership.organizationId, 'OWNER', input),
    )
    if (!outcome.ok) {
      console.error(`REFUSED: ${outcome.reason}`)
      process.exit(1)
    }
    const after = await db.membership.count({
      where: { organizationId: membership.organizationId },
    })
    console.log(
      `created ${role} ${email} (${name}) · ${String(after)} member(s) after`,
    )
    console.log('')
    console.log(
      'TEMPORARY PASSWORD, PRINTED ONCE — hand it over, they change it at Account:',
    )
    console.log(`  ${outcome.temporaryPassword}`)
  } finally {
    await db.$disconnect().catch(() => undefined)
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exit(1)
})
