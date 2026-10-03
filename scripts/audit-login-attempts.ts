import { neonConfig } from '@neondatabase/serverless'
import { PrismaClient } from '@/generated/prisma/client'
import { PrismaNeon } from '@prisma/adapter-neon'
import { RATE_LIMIT } from '@/lib/auth'

// ---------------------------------------------------------------------------
// LOGIN ATTEMPTS BY OUTCOME. READ ONLY.
//
//   npx tsx -r dotenv/config scripts/audit-login-attempts.ts [email]
//   npx tsx -r dotenv/config scripts/audit-login-attempts.ts --production [email]
//
// ── WHY IT ALSO COMPUTES THE LOCKOUT ─────────────────────────────────────
//
// "Correct password refused" has a specific candidate: `login` counts FAILED
// attempts in a rolling window and refuses before it ever checks the password.
// A SUCCESS DOES NOT CLEAR THOSE ROWS — nothing deletes them and the count
// filters on `succeeded: false` — so five failures followed by a correct
// password still leave the account locked for the rest of the window.
//
// So the counts alone would not settle it. This asks the same question `login`
// asks, with the same window and the same thresholds imported from the same
// module rather than retyped: how many failures are in the window RIGHT NOW,
// and would the next attempt be refused.
//
// ── PRODUCTION IS READ THROUGH THE READONLY ROLE OR NOT AT ALL ───────────
//
// `--production` reads PROD_READONLY_DATABASE_URL and refuses any role that is
// not `zebra_ci_readonly`, exactly as `breakdown-ready-to-invoice.ts` does. No
// fallback to another variable: a fallback is how a read-only tool ends up
// authenticated as the owner.
// ---------------------------------------------------------------------------

neonConfig.webSocketConstructor ??= WebSocket

const READONLY_ROLE = 'zebra_ci_readonly'
const args = process.argv.slice(2)
const production = args.includes('--production')
const email = args.find((arg) => !arg.startsWith('--'))?.toLowerCase() ?? null

const url = production
  ? process.env.PROD_READONLY_DATABASE_URL
  : process.env.DIRECT_DATABASE_URL

if (!url) {
  throw new Error(
    production
      ? 'No PROD_READONLY_DATABASE_URL. This tool does not fall back.'
      : 'No DIRECT_DATABASE_URL.',
  )
}

if (production && !url.includes(READONLY_ROLE)) {
  throw new Error(
    `--production must authenticate as ${READONLY_ROLE}. Refusing.`,
  )
}

const db = new PrismaClient({
  adapter: new PrismaNeon({ connectionString: url }),
})

const now = new Date()
const dayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000)
const windowFrom = new Date(now.getTime() - RATE_LIMIT.windowMs)

console.log(`target    ${production ? 'PRODUCTION (readonly)' : 'DEV'}`)
console.log(`host      ${new URL(url).hostname.split('.')[0]}`)
console.log(`since     ${dayAgo.toISOString()} (24h)`)
console.log(
  `limits    ${String(RATE_LIMIT.perEmail)} per email, ${String(RATE_LIMIT.perIp)} per ip, over ${String(RATE_LIMIT.windowMs / 60000)} minutes\n`,
)

// WHOSE ATTEMPTS. `LoginAttempt` is keyed by EMAIL and carries no userId — the
// row is written for addresses that do not exist, which is the point. So the
// owner is found by membership and matched by address.
const owners = await db.membership.findMany({
  where: {
    role: 'OWNER',
    organization: { slug: 'zebra' },
    ...(email === null ? {} : { user: { email } }),
  },
  select: { user: { select: { id: true, email: true, lastLoginAt: true } } },
})

if (owners.length === 0) {
  console.log('No OWNER membership found for organization "zebra".')
} else {
  for (const { user } of owners) {
    const [day, failuresInWindow, lastSuccess, lastFailure] = await Promise.all(
      [
        db.loginAttempt.groupBy({
          by: ['succeeded'],
          where: { email: user.email, createdAt: { gte: dayAgo } },
          _count: { _all: true },
          _max: { createdAt: true },
        }),
        db.loginAttempt.count({
          where: {
            email: user.email,
            succeeded: false,
            createdAt: { gte: windowFrom },
          },
        }),
        db.loginAttempt.findFirst({
          where: { email: user.email, succeeded: true },
          orderBy: { createdAt: 'desc' },
          select: { createdAt: true, ip: true },
        }),
        db.loginAttempt.findFirst({
          where: { email: user.email, succeeded: false },
          orderBy: { createdAt: 'desc' },
          select: { createdAt: true, ip: true },
        }),
      ],
    )

    const ok = day.find((row) => row.succeeded)?._count._all ?? 0
    const bad = day.find((row) => !row.succeeded)?._count._all ?? 0

    console.log(`user      ${user.email}`)
    console.log(`  last 24h        succeeded ${ok}, failed ${bad}`)
    console.log(
      `  in the window   ${failuresInWindow} failures (threshold ${String(RATE_LIMIT.perEmail)})`,
    )
    console.log(
      `  NEXT ATTEMPT    ${
        failuresInWindow >= RATE_LIMIT.perEmail
          ? 'WOULD BE REFUSED as rate limited, whatever the password'
          : 'would be checked against the password'
      }`,
    )
    console.log(
      `  last success    ${lastSuccess?.createdAt.toISOString() ?? 'never'}`,
    )
    console.log(
      `  last failure    ${lastFailure?.createdAt.toISOString() ?? 'never'}`,
    )
    console.log(
      `  User.lastLoginAt ${user.lastLoginAt?.toISOString() ?? 'never'}`,
    )

    // ── THE ONE THAT DISTINGUISHES THE TWO SYMPTOMS ────────────────────
    //
    // A session row is created BEFORE the action reads the locale and before it
    // redirects. If the login "failed" with no message but a session exists
    // from the same minute, the login actually succeeded and the action threw
    // afterwards — which is "sometimes already signed in" and "refused with no
    // message" being one defect rather than two.
    const sessions = await db.session.findMany({
      where: { userId: user.id, createdAt: { gte: dayAgo } },
      orderBy: { createdAt: 'desc' },
      select: { createdAt: true, revokedAt: true, expiresAt: true },
      take: 10,
    })
    console.log(`  sessions (24h)  ${sessions.length}`)
    for (const session of sessions) {
      console.log(
        `    ${session.createdAt.toISOString()}  ` +
          `${session.revokedAt === null ? 'live until ' + session.expiresAt.toISOString() : 'revoked ' + session.revokedAt.toISOString()}`,
      )
    }
    console.log('')
  }
}

// EVERY ADDRESS THAT TRIED, because "sometimes refused" may be a typo in the
// address — which records a failure under a DIFFERENT email and still counts
// against the shared IP.
const byEmail = await db.loginAttempt.groupBy({
  by: ['email', 'succeeded'],
  where: { createdAt: { gte: dayAgo } },
  _count: { _all: true },
})
if (byEmail.length > 0) {
  console.log('EVERY ADDRESS ATTEMPTED IN THE LAST 24H')
  const emails = [...new Set(byEmail.map((row) => row.email))].sort()
  for (const address of emails) {
    const ok =
      byEmail.find((row) => row.email === address && row.succeeded)?._count
        ._all ?? 0
    const bad =
      byEmail.find((row) => row.email === address && !row.succeeded)?._count
        ._all ?? 0
    console.log(
      `  ${address.padEnd(34)} succeeded ${String(ok).padStart(3)}, failed ${String(bad).padStart(3)}`,
    )
  }
} else {
  console.log('No login attempts at all in the last 24h.')
}

await db.$disconnect()
console.log('')
