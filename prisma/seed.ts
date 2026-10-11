import 'dotenv/config'
import { neonConfig } from '@neondatabase/serverless'
import { createPrismaClient } from '../src/lib/db'
import { hashPassword } from '../src/lib/password'
import { normalizeEmail } from '../src/lib/auth'
import { assertProductionWrite, isProductionLabel } from './production-gate'
import { readLatestMigrationNumber, readPersistedScopes } from './gate-readers'
import type { PrismaClient, Role } from '../src/generated/prisma/client'

// ---------------------------------------------------------------------------
// SEED — §12, and nothing beyond it.
//
// One real organization with the two authorities that actually exist, one
// owner, and a second organization whose entire purpose is to be the thing an
// isolation failure would expose.
//
// No demo loads, no fake brokers, no placeholder trucks. A TMS full of
// invented freight is a TMS nobody trusts the numbers in.
//
// Runs as the Neon owner over DIRECT_DATABASE_URL, which bypasses row-level
// security — necessary, because it writes into two organizations and the
// first one does not exist yet to be scoped to.
//
// Idempotent. Re-running changes nothing and re-prints nothing secret.
// ---------------------------------------------------------------------------

neonConfig.webSocketConstructor ??= WebSocket
neonConfig.poolQueryViaFetch = false

const OWNER_EMAIL = normalizeEmail(
  process.env.SEED_OWNER_EMAIL ?? 'islomniyozov@gmail.com',
)

interface CompanySeed {
  name: string
  legalName: string
  dotNumber: string
  mcNumber: string
  scac?: string
}

// Real identifiers. These are the authorities the group operates under; the
// remaining three get added through the UI as they are formed.
const COMPANIES: CompanySeed[] = [
  {
    name: 'RAM Haulage',
    legalName: 'RAM Haulage LLC',
    dotNumber: '3162967',
    mcNumber: 'MC-112499',
    scac: 'ABFQZ',
  },
  {
    name: 'Dolphins Transport',
    legalName: 'Dolphins Transport Inc',
    dotNumber: '2544585',
    mcNumber: 'MC-885668',
  },
]

function generatePassword(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(24))
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

async function seedOperatingGroup(db: PrismaClient): Promise<void> {
  const organization = await db.organization.upsert({
    where: { slug: 'zebra' },
    update: {},
    create: {
      name: 'Zebra Carrier Group',
      slug: 'zebra',
      tier: 'INTERNAL',
      maxCompanies: 5,
    },
  })

  for (const seed of COMPANIES) {
    const company = await db.company.upsert({
      where: {
        organizationId_dotNumber: {
          organizationId: organization.id,
          dotNumber: seed.dotNumber,
        },
      },
      update: {},
      create: {
        organizationId: organization.id,
        name: seed.name,
        legalName: seed.legalName,
        dotNumber: seed.dotNumber,
        mcNumber: seed.mcNumber,
        scac: seed.scac ?? null,
      },
    })

    // Configuration, not sample data: every consumer of the profitability
    // defaults would otherwise need to handle a missing row. Values are the
    // schema's own defaults — nothing invented.
    await db.companySettings.upsert({
      where: { companyId: company.id },
      update: {},
      create: { companyId: company.id, organizationId: organization.id },
    })

    console.log(
      `  ${seed.legalName}  USDOT ${seed.dotNumber}  ${seed.mcNumber}`,
    )
  }

  const existing = await db.user.findUnique({
    where: { email: OWNER_EMAIL },
    select: { id: true, passwordHash: true },
  })

  let announcedPassword: string | null = null
  let passwordHash = existing?.passwordHash ?? null

  if (!passwordHash) {
    // Never a default password. Either the operator supplies one or we mint
    // one and say it exactly once.
    const supplied = process.env.SEED_OWNER_PASSWORD
    const password = supplied ?? generatePassword()
    if (!supplied) announcedPassword = password
    passwordHash = await hashPassword(password)
  }

  const user = await db.user.upsert({
    where: { email: OWNER_EMAIL },
    update: {},
    create: {
      email: OWNER_EMAIL,
      name: 'Owner',
      passwordHash,
      locale: 'en',
    },
  })

  // Org-level membership with an EMPTY companyScopes list: access to every
  // authority in the group, including the ones that do not exist yet.
  await db.membership.upsert({
    where: {
      userId_organizationId: {
        userId: user.id,
        organizationId: organization.id,
      },
    },
    update: {},
    create: {
      userId: user.id,
      organizationId: organization.id,
      role: 'OWNER',
      isDefault: true,
    },
  })

  console.log(`  owner ${OWNER_EMAIL} — OWNER, all authorities`)
  if (announcedPassword) {
    console.log('')
    console.log('  ┌─────────────────────────────────────────────────────────┐')
    console.log('  │ Generated owner password. Shown once, stored nowhere.   │')
    console.log('  └─────────────────────────────────────────────────────────┘')
    console.log(`  ${announcedPassword}`)
    console.log('')
    console.log('  Set SEED_OWNER_PASSWORD to choose your own instead.')
  }
}

/**
 * §12's second organization: exists solely so that a tenancy failure has
 * something to expose. Never seeded into production.
 */
async function seedIsolationCounterpart(db: PrismaClient): Promise<void> {
  const organization = await db.organization.upsert({
    where: { slug: 'isolation-counterpart' },
    update: {},
    create: {
      name: 'Isolation Counterpart',
      slug: 'isolation-counterpart',
      tier: 'INTERNAL',
      maxCompanies: 1,
      notes:
        'Exists only so a row-level-security failure has something to leak. ' +
        'If you are reading this in production, something is wrong.',
    },
  })

  await db.company.upsert({
    where: {
      organizationId_dotNumber: {
        organizationId: organization.id,
        dotNumber: '0000001',
      },
    },
    update: {},
    create: {
      organizationId: organization.id,
      name: 'Counterpart Carrier',
      dotNumber: '0000001',
    },
  })

  const email = 'counterpart@invalid.test'
  const user = await db.user.upsert({
    where: { email },
    update: {},
    create: {
      email,
      name: 'Counterpart User',
      // No password. This account is never meant to log in — it exists to be
      // a row in another tenant.
      passwordHash: null,
    },
  })

  await db.membership.upsert({
    where: {
      userId_organizationId: {
        userId: user.id,
        organizationId: organization.id,
      },
    },
    update: {},
    create: {
      userId: user.id,
      organizationId: organization.id,
      role: 'OWNER',
      isDefault: true,
    },
  })

  console.log(
    '  isolation counterpart organization, one company, one login-less user',
  )
}

/**
 * The sweep's role accounts (TMS-DESIGN-SYSTEM.md §6.8, 2026-10-10): one
 * member of the operating group per role other than the owner, across every
 * authority, so `scripts/sweep.mjs` can hold every page to the route matrix
 * as every role. NEVER SEEDED INTO PRODUCTION — called only beside the
 * isolation counterpart.
 *
 * The credentials come from `SEED_<ROLE>_EMAIL` / `SEED_<ROLE>_PASSWORD` and
 * no password is printed: the sweep reads the same variables, so there is
 * nothing to hand over. Re-seeding resets each password to the environment's,
 * which keeps the sweep's sign-in and the stored hash from drifting apart.
 */
const SWEEP_ROLES = [
  'ADMIN',
  'MANAGER',
  'DISPATCHER',
  'ACCOUNTING',
  'DRIVER',
] as const satisfies readonly Role[]

async function seedSweepRoles(db: PrismaClient): Promise<void> {
  const organization = await db.organization.findUniqueOrThrow({
    where: { slug: 'zebra' },
    select: { id: true },
  })
  for (const role of SWEEP_ROLES) {
    const email = process.env[`SEED_${role}_EMAIL`]
    const password = process.env[`SEED_${role}_PASSWORD`]
    if (!email || !password) {
      console.log(
        `  skipping the sweep ${role} — SEED_${role}_EMAIL / ` +
          `SEED_${role}_PASSWORD not set`,
      )
      continue
    }
    const passwordHash = await hashPassword(password)
    const name = `Sweep ${role.charAt(0)}${role.slice(1).toLowerCase()}`
    const user = await db.user.upsert({
      where: { email },
      update: { passwordHash },
      create: { email, name, passwordHash, locale: 'en' },
    })
    await db.membership.upsert({
      where: {
        userId_organizationId: {
          userId: user.id,
          organizationId: organization.id,
        },
      },
      // THE ROLE IS RESET ON EVERY SEED, because a sweep that signed in as an
      // account somebody had promoted would hold one column of the matrix
      // against another role's answers and pass.
      update: { role },
      create: {
        userId: user.id,
        organizationId: organization.id,
        role,
        isDefault: true,
      },
    })
    console.log(
      `  sweep ${role.toLowerCase()} ${email} — ${role}, all authorities`,
    )
  }
}

async function main(): Promise<void> {
  // ── THE GATE, BEFORE ANYTHING OPENS A SOCKET ──────────────────────────
  //
  // THIS USED TO BE A SOFT SKIP AND THAT WAS NOT A GUARD. The seed ran happily
  // against the production branch, wrote the operating group, and printed
  // "skipping the isolation counterpart" — so the one organization it refused
  // to create was the only thing it refused to do. Everything else it writes is
  // an upsert into the carrier's live database.
  //
  // The same one-shot override as a migration, from the same module, because a
  // seed is a write and `prisma db seed` is one keystroke from `prisma migrate`.
  //
  // FIRST, SO THE REFUSAL COSTS NOTHING. Before the URL check, before the
  // client, before any connection: a refusal that has already opened a socket to
  // production has already done the thing it was refusing.
  // THE SAME TWO READINGS AS THE MIGRATION PATH. A seed against production
  // names the schema it is seeding — the migration at the head of
  // `prisma/migrations` — for the same reason: a number that expires.
  assertProductionWrite(process.env, 'seed', {
    expected: readLatestMigrationNumber(),
    persisted: readPersistedScopes(),
  })

  const branch = process.env.NEON_BRANCH
  const url = process.env.DIRECT_DATABASE_URL

  if (!url) throw new Error('DIRECT_DATABASE_URL is not set.')
  if (!branch) throw new Error('NEON_BRANCH is not set.')

  const db = createPrismaClient(url)
  try {
    console.log(`Seeding the ${branch} branch.`)
    await seedOperatingGroup(db)

    // THE COUNTERPART IS STILL NEVER SEEDED INTO PRODUCTION. Reaching here with
    // the production label now means somebody passed the override deliberately;
    // the organization that exists to be the thing an isolation failure would
    // expose still has no business in the carrier's own database.
    if (isProductionLabel(process.env)) {
      console.log('  skipping the isolation counterpart — never in production')
    } else {
      await seedIsolationCounterpart(db)
      // §6.8: the sweep's role accounts, on the same never-in-production side.
      await seedSweepRoles(db)
    }

    console.log('Done.')
  } finally {
    await db.$disconnect()
  }
}

await main()
