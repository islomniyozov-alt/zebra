import { chromium } from 'playwright'
import { neonConfig, Pool } from '@neondatabase/serverless'
import { isProduction, requireCredentials } from './check-credentials.mjs'

// ---------------------------------------------------------------------------
// THE USERS SCREEN, ON THE DEPLOYED WORKER.
//
// The onboarding procedure hangs on one thing being true: an admin creates an
// account, is shown a temporary password once, and the person on the other end
// of a Telegram message can sign in with it. So this uses the password — a
// screen that renders a plausible-looking string and mints a different hash
// would pass every check but the one that matters.
//
// It also proves the two halves of "deactivated":
//   * they cannot sign in afterwards, and
//   * the session they already held is dead, because isActive alone would only
//     stop the NEXT sign-in.
//
//   SHOT_CHROME=... node -r dotenv/config scripts/verify-users.mjs
// ---------------------------------------------------------------------------

const BASE =
  process.env.VERIFY_BASE ?? 'https://zebra-dev.tajikcargollc.workers.dev'
const TAG = `US${Date.now().toString(36).slice(-4).toUpperCase()}`
const EMAIL = `${TAG.toLowerCase()}@example.test`

neonConfig.webSocketConstructor ??= WebSocket
neonConfig.poolQueryViaFetch = false
const pool = new Pool({
  connectionString: isProduction(BASE)
    ? process.env.PROD_DIRECT_DATABASE_URL
    : process.env.DIRECT_DATABASE_URL,
})

const results = []
const record = (label, ok, detail) => {
  results.push({ label, ok })
  console.log(`${ok ? 'ok  ' : 'FAIL'}  ${label.padEnd(54)} ${detail}`)
}

const browser = await chromium.launch(
  process.env.SHOT_CHROME ? { executablePath: process.env.SHOT_CHROME } : {},
)

const signIn = async (email, password) => {
  const context = await browser.newContext({
    viewport: { width: 1920, height: 1080 },
  })
  const page = await context.newPage()
  await page.goto(`${BASE}/login`, { waitUntil: 'domcontentloaded' })
  await page.fill('input[name="email"]', email)
  await page.fill('input[name="password"]', password)
  await page.click('button[type="submit"]')
  await page
    .waitForURL(/\/(loads|dashboard)/, { timeout: 90_000 })
    .catch(() => {})
  return { context, page, landed: page.url().replace(BASE, '') }
}

// Production signs in as the Live Check ADMIN, never as the owner. And it
// needs its OWN database URL: this script creates a user and removes it again,
// and doing that against production through a dev connection string would
// either fail or, worse, half-succeed.
const CREDENTIALS = requireCredentials(BASE)
if (
  CREDENTIALS.target === 'production' &&
  !process.env.PROD_DIRECT_DATABASE_URL
) {
  console.error(
    'Refusing to run against production without PROD_DIRECT_DATABASE_URL.',
    '\n  This script creates and deletes a user, and asserts against the row.',
  )
  process.exit(1)
}

const owner = await signIn(CREDENTIALS.email, CREDENTIALS.password)

// --- create --------------------------------------------------------------
await owner.page.goto(`${BASE}/users/new`, { waitUntil: 'domcontentloaded' })
await owner.page.waitForTimeout(1500)
await owner.page.fill('input[name="name"]', `Dispatcher ${TAG}`)
await owner.page.fill('input[name="email"]', EMAIL)
await owner.page.selectOption('select[name="role"]', 'DISPATCHER')
await owner.page.click('form button[type="submit"]')
await owner.page.waitForTimeout(12_000)

const shown = await owner.page
  .locator('p.select-all')
  .first()
  .textContent()
  .catch(() => null)
const temporary = (shown ?? '').trim()
record(
  'the temporary password is shown once',
  /^[A-Za-z0-9_-]{32}$/.test(temporary),
  temporary ? `${temporary.length} characters, base64url` : '(nothing shown)',
)

// --- the hand-over message -----------------------------------------------
// The whole point of the share action is that nobody retypes a 32-character
// password. So the assertion is that the composed message carries THE SAME
// string the panel just displayed — not that a message exists.
const telegramHref = await owner.page
  .locator('a[href^="https://t.me/share/url"]')
  .first()
  .getAttribute('href')
  .catch(() => null)

const shareParams = telegramHref
  ? new URL(telegramHref).searchParams
  : new URLSearchParams()
const shareText = shareParams.get('text') ?? ''

record(
  'the Telegram share carries the real password',
  temporary.length > 0 && shareText.includes(temporary),
  telegramHref ? 'password present in the draft' : '(no share link)',
)
record(
  'and the address and sign-in URL',
  shareText.includes(EMAIL) &&
    (shareParams.get('url') ?? '').startsWith('http'),
  shareParams.get('url') ?? '(none)',
)
record(
  'and the instruction, verbatim',
  shareText.includes('change your password immediately'),
  shareText
    .split(String.fromCharCode(10))
    .filter(Boolean)
    .pop()
    ?.slice(0, 60) ?? '(empty)',
)
record(
  'and names no recipient',
  Boolean(telegramHref) &&
    !/[?&](to|chat|phone|user)=/.test(telegramHref ?? ''),
  'share picker only',
)

// The clipboard fallback composes from the same function; this proves the
// button is wired to it rather than to a second copy of the text.
await owner.context.grantPermissions(['clipboard-read', 'clipboard-write'])
await owner.page.locator('button:has-text("Copy message")').click()
await owner.page.waitForTimeout(1500)
const clipboard = await owner.page.evaluate(() =>
  navigator.clipboard.readText(),
)
record(
  'the copy fallback puts the same message on the clipboard',
  clipboard.includes(temporary) && clipboard.includes(EMAIL),
  `${clipboard.length} characters`,
)

await owner.page.screenshot({ path: 'screenshots/users-created.png' })

// --- it is a real credential ---------------------------------------------
const newcomer = await signIn(EMAIL, temporary)
record(
  'the new user can sign in with it',
  newcomer.landed.includes('/loads'),
  newcomer.landed,
)

// --- and the role is what was chosen -------------------------------------
const forbidden = await newcomer.page.goto(`${BASE}/users`, {
  waitUntil: 'domcontentloaded',
})
record(
  'a DISPATCHER cannot reach the users screen',
  forbidden?.status() === 404,
  `HTTP ${forbidden?.status()}`,
)

const moneyVisible = await newcomer.page
  .locator('nav >> text=/Invoices|Settlements/')
  .count()
record(
  'and is offered no Money group at all',
  moneyVisible === 0,
  `${moneyVisible} money link(s)`,
)

// --- the list ------------------------------------------------------------
await owner.page.goto(`${BASE}/users`, { waitUntil: 'domcontentloaded' })
await owner.page.waitForTimeout(2500)
const listed = await owner.page.locator(`tr:has-text("${EMAIL}")`).first()
const listedText = ((await listed.textContent()) ?? '').replace(/\s+/g, ' ')
record(
  'the list shows them, with role and scope',
  listedText.includes('Dispatcher') && listedText.includes('All authorities'),
  listedText.trim().slice(0, 78),
)

// --- deactivate ----------------------------------------------------------
await listed.locator('button:has-text("Deactivate")').click()
await owner.page.waitForTimeout(10_000)

const active = (
  await pool.query('select "isActive" from "User" where email = $1', [EMAIL])
).rows[0]
record(
  'deactivating sets the flag',
  active?.isActive === false,
  `isActive=${active?.isActive}`,
)

const live = (
  await pool.query(
    `select count(*)::int n from "Session" s join "User" u on u.id = s."userId"
      where u.email = $1 and s."revokedAt" is null`,
    [EMAIL],
  )
).rows[0]
record(
  'and kills the session they already held',
  live.n === 0,
  `${live.n} live session(s)`,
)

// The session they held is revoked, so the page they were on is now a login.
const bounced = await newcomer.page.goto(`${BASE}/loads`, {
  waitUntil: 'domcontentloaded',
})
record(
  'so their open tab is signed out',
  newcomer.page.url().includes('/login'),
  `HTTP ${bounced?.status()} → ${newcomer.page.url().replace(BASE, '')}`,
)

const refused = await signIn(EMAIL, temporary)
record(
  'and they cannot sign in again',
  !refused.landed.includes('/loads'),
  refused.landed,
)
await refused.context.close()

// --- reactivate ----------------------------------------------------------
await owner.page.reload({ waitUntil: 'domcontentloaded' })
await owner.page.waitForTimeout(2500)
await owner.page
  .locator(`tr:has-text("${EMAIL}")`)
  .first()
  .locator('button:has-text("Reactivate")')
  .click()
await owner.page.waitForTimeout(10_000)

const back = await signIn(EMAIL, temporary)
record(
  'reactivating lets them back in (rule 11’s pair)',
  back.landed.includes('/loads'),
  back.landed,
)
await back.context.close()

// --- the actor cannot lock themselves out --------------------------------
const ownRow = owner.page.locator(`tr:has-text("${CREDENTIALS.email}")`).first()
const ownControls = await ownRow.locator('button').count()
record(
  'no deactivate control on your own row',
  ownControls === 0,
  `${ownControls} button(s)`,
)

await owner.page.screenshot({ path: 'screenshots/users-list.png' })
await browser.close()

// --- cleanup -------------------------------------------------------------
const { rows: created } = await pool.query(
  'select id from "User" where email = $1',
  [EMAIL],
)
for (const user of created) {
  await pool.query('delete from "Session" where "userId" = $1', [user.id])
  await pool.query('delete from "AuditLog" where "userId" = $1', [user.id])
  await pool.query(
    `delete from "MembershipCompany" where "membershipId" in
       (select id from "Membership" where "userId" = $1)`,
    [user.id],
  )
  await pool.query('delete from "Membership" where "userId" = $1', [user.id])
  await pool.query('delete from "User" where id = $1', [user.id])
}
await pool.query('delete from "LoginAttempt" where email = $1', [EMAIL])

console.log(
  `\nusers remaining: ${(await pool.query('select count(*)::int n from "User"')).rows[0].n}`,
)
await pool.end()

const failed = results.filter((r) => !r.ok).length
console.log(`${results.length - failed}/${results.length} passed`)
process.exit(failed === 0 ? 0 : 1)
