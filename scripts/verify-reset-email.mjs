import { chromium } from 'playwright'
import { neonConfig, Pool } from '@neondatabase/serverless'

// ---------------------------------------------------------------------------
// §13 — the password-reset link, on the deployed worker.
//
// Four claims, and only the fourth needs an API key:
//
//   1. a token is issued for a real account;
//   2. NO token is issued for an address that does not exist;
//   3. the screen says the SAME sentence either way — that is what stops this
//      being the account-enumeration oracle login carefully is not;
//   4. the mail is handed to Resend.
//
// The delivery line is in the worker's log, not in the database, so run this
// with a tail open beside it:
//
//   npx wrangler tail --format json > tail.json &
//   SHOT_CHROME=... node -r dotenv/config scripts/verify-reset-email.mjs
//
// and look for `[zebra.email]`. No line at all means the send succeeded; the
// transport only logs when something went wrong.
// ---------------------------------------------------------------------------

const BASE =
  process.env.VERIFY_BASE ?? 'https://zebra-dev.tajikcargollc.workers.dev'
const REAL = process.env.SEED_OWNER_EMAIL
const UNKNOWN = `nobody-${Date.now().toString(36)}@example.test`

neonConfig.webSocketConstructor ??= WebSocket
neonConfig.poolQueryViaFetch = false
const pool = new Pool({ connectionString: process.env.DIRECT_DATABASE_URL })

const results = []
const record = (label, ok, detail) => {
  results.push({ label, ok })
  console.log(`${ok ? 'ok  ' : 'FAIL'}  ${label.padEnd(56)} ${detail}`)
}

const tokensFor = async (email) =>
  (
    await pool.query(
      `select count(*)::int n from "PasswordResetToken"
        where "userId" in (select id from "User" where email = $1)`,
      [email],
    )
  ).rows[0].n

// The rate limiter counts failed login attempts per email AND per IP, and a
// reset request is one of them. Left over from an earlier run it would refuse
// this one and the refusal would look like a bug in the transport.
await pool.query(`delete from "LoginAttempt" where "userAgent" = $1`, [
  'password-reset',
])

const before = await tokensFor(REAL)

const browser = await chromium.launch(
  process.env.SHOT_CHROME ? { executablePath: process.env.SHOT_CHROME } : {},
)
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } })

const request = async (email) => {
  await page.goto(`${BASE}/reset-password`, { waitUntil: 'domcontentloaded' })
  await page.fill('input[name="email"]', email)
  await page.click('form button[type="submit"]')
  await page.waitForTimeout(15_000)
  // `main`, not `main, body` — the latter matches both and Playwright's
  // strict mode refuses, which is right: comparing two different elements
  // between the two calls would compare nothing.
  return (await page.locator('main').first().innerText()).replace(/\s+/g, ' ')
}

const realAnswer = await request(REAL)
const after = await tokensFor(REAL)
record(
  'a real account gets a token',
  after === before + 1,
  `${before} → ${after}`,
)

const unknownAnswer = await request(UNKNOWN)
record(
  'an address that does not exist gets none',
  (await tokensFor(UNKNOWN)) === 0,
  UNKNOWN,
)

// Compared as whole screens, not as a substring: a difference anywhere — a
// missing line, a different heading — is an oracle.
const sentence = (text) => text.slice(0, 400)
record(
  'and the screen says the same thing either way',
  sentence(realAnswer) === sentence(unknownAnswer),
  sentence(realAnswer).slice(0, 90),
)

const stored = (
  await pool.query(
    `select "tokenHash", "expiresAt", "usedAt" from "PasswordResetToken"
      where "userId" in (select id from "User" where email = $1)
      order by "createdAt" desc limit 1`,
    [REAL],
  )
).rows[0]
record(
  'the token is stored as a digest, unused, and expiring',
  Boolean(stored) &&
    stored.tokenHash.length === 64 &&
    stored.usedAt === null &&
    stored.expiresAt > new Date(),
  `sha256, expires ${stored?.expiresAt?.toISOString?.().slice(11, 19) ?? '?'}Z`,
)

await page.screenshot({ path: 'screenshots/reset-request.png' })
await browser.close()

await pool.query(
  `delete from "PasswordResetToken" where "userId" in (select id from "User" where email = $1)`,
  [REAL],
)
await pool.query(`delete from "LoginAttempt" where "userAgent" = $1`, [
  'password-reset',
])
await pool.end()

console.log(
  '\nDELIVERY: check the tail for `[zebra.email]`. No line means it was sent.',
)
const failed = results.filter((r) => !r.ok).length
console.log(`${results.length - failed}/${results.length} passed`)
process.exit(failed === 0 ? 0 : 1)
