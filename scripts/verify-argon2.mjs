import { chromium } from 'playwright'
import { neonConfig, Pool } from '@neondatabase/serverless'
import 'dotenv/config'

// ---------------------------------------------------------------------------
// THE LIVE PROOF, against the DEPLOYED worker.
//
// Phase 1 claimed 600,000 PBKDF2 iterations were "measured in workerd". They
// were measured in the vitest workers pool, which does not enforce the cap the
// deployed runtime does, and the claim was false. Standing rule 10 exists
// because of it: a measurement is shown, not summarised.
//
// So this drives the real login form on the real worker with a real browser,
// and then reads the row back out of Postgres. Four things it settles that no
// local test can:
//
//   * argon2id at the configured parameters completes inside a deployed
//     Worker's CPU limit;
//   * 19 MiB of scratch memory per hash fits alongside Next and Prisma;
//   * the rolling upgrade fires — a PBKDF2 row becomes an argon2id row on a
//     successful login, with nobody locked out in between;
//   * the rotated DATABASE_URL secret is the one the worker is using.
//
//   node scripts/verify-argon2.mjs
// ---------------------------------------------------------------------------

const BASE =
  process.env.VERIFY_BASE ?? 'https://zebra-dev.tajikcargollc.workers.dev'
const EMAIL = process.env.SEED_OWNER_EMAIL ?? process.env.VERIFY_EMAIL
const PASSWORD = process.env.SEED_OWNER_PASSWORD
const executablePath = process.env.SHOT_CHROME

if (!EMAIL || !PASSWORD) {
  throw new Error('Set SEED_OWNER_EMAIL and SEED_OWNER_PASSWORD in .env.')
}

neonConfig.webSocketConstructor ??= WebSocket
neonConfig.poolQueryViaFetch = false

const pool = new Pool({ connectionString: process.env.DIRECT_DATABASE_URL })

const hashPrefix = async () => {
  const { rows } = await pool.query(
    'select left("passwordHash", 30) as prefix from "User" where email = $1',
    [EMAIL],
  )
  return rows[0]?.prefix ?? null
}

console.log('before login, stored hash:', await hashPrefix())

const browser = await chromium.launch(executablePath ? { executablePath } : {})
const context = await browser.newContext({
  viewport: { width: 1920, height: 1080 },
})
const page = await context.newPage()

await page.goto(`${BASE}/login`, { waitUntil: 'domcontentloaded' })
await page.fill('input[name="email"]', EMAIL)
await page.fill('input[name="password"]', PASSWORD)

const started = Date.now()
await Promise.all([
  page.waitForURL(/\/(loads|dashboard)/, { timeout: 60_000 }),
  page.click('button[type="submit"]'),
])
const elapsed = Date.now() - started

console.log('login round trip:', `${elapsed}ms`)
console.log('landed on:', new URL(page.url()).pathname)

// The upgrade is written after the verify, inside the same request. Give the
// worker a beat rather than racing it.
await page.waitForTimeout(1500)
const after = await hashPrefix()
console.log('after login, stored hash: ', after)

const cookies = await context.cookies()
const session = cookies.find((c) => c.name === 'zebra_session')
console.log('session cookie issued:', session ? 'yes' : 'no')

await browser.close()

// Second login, now against the argon2id hash. The first proved the migration;
// this proves the destination format actually verifies on the deployed worker,
// which is the thing that would lock the owner out if it did not.
const second = await chromium.launch(executablePath ? { executablePath } : {})
const secondPage = await second.newPage()
await secondPage.goto(`${BASE}/login`, { waitUntil: 'domcontentloaded' })
await secondPage.fill('input[name="email"]', EMAIL)
await secondPage.fill('input[name="password"]', PASSWORD)
const secondStart = Date.now()
await Promise.all([
  secondPage.waitForURL(/\/(loads|dashboard)/, { timeout: 60_000 }),
  secondPage.click('button[type="submit"]'),
])
console.log('argon2id login round trip:', `${Date.now() - secondStart}ms`)
console.log('argon2id login landed on:', new URL(secondPage.url()).pathname)
await second.close()

const final = await hashPrefix()
console.log('final stored hash:       ', final)
console.log(
  final?.startsWith('$argon2id$')
    ? 'RESULT: argon2id live, owner re-hashed on login.'
    : 'RESULT: FAILED — the stored hash is not argon2id.',
)

await pool.end()
process.exit(final?.startsWith('$argon2id$') ? 0 : 1)
