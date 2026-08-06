import { chromium } from 'playwright'
import { mkdirSync } from 'node:fs'

// The §15 evidence: Loads and login at 1080p, Standard density, in English,
// Russian and right-to-left Farsi.
//
// 1920x1080 exactly, because the density rules are written against a 1080p
// screen and "20 rows visible without scrolling" is a claim about that
// viewport and no other.

const BASE = process.env.SHOT_BASE ?? 'http://127.0.0.1:3000'
const OUT = 'screenshots'

const VIEWPORT = { width: 1920, height: 1080 }

const SHOTS = [
  { name: 'login-en', path: '/login', locale: 'en', authed: false },
  { name: 'login-ru', path: '/login', locale: 'ru', authed: false },
  { name: 'login-fa-rtl', path: '/login', locale: 'fa', authed: false },
  { name: 'loads-en', path: '/loads', locale: 'en', authed: true },
  { name: 'loads-ru', path: '/loads', locale: 'ru', authed: true },
  { name: 'loads-fa-rtl', path: '/loads', locale: 'fa', authed: true },
  { name: 'account-en', path: '/account', locale: 'en', authed: true },
  { name: 'account-ru', path: '/account', locale: 'ru', authed: true },
  { name: 'account-fa-rtl', path: '/account', locale: 'fa', authed: true },
  // Step 2's reference screens. Trucks stands in for the three fleet lists,
  // which share a layout; brokers differs (no authority column, ever) and the
  // truck form is the only new form shape.
  { name: 'trucks-en', path: '/trucks', locale: 'en', authed: true },
  { name: 'trucks-ru', path: '/trucks', locale: 'ru', authed: true },
  { name: 'trucks-fa-rtl', path: '/trucks', locale: 'fa', authed: true },
  { name: 'brokers-en', path: '/brokers', locale: 'en', authed: true },
  { name: 'brokers-ru', path: '/brokers', locale: 'ru', authed: true },
  { name: 'brokers-fa-rtl', path: '/brokers', locale: 'fa', authed: true },
  { name: 'load-new-en', path: '/loads/new', locale: 'en', authed: true },
  { name: 'load-new-ru', path: '/loads/new', locale: 'ru', authed: true },
  { name: 'load-new-fa-rtl', path: '/loads/new', locale: 'fa', authed: true },
  // Step 6. The board is the new layout, so all three locales; the Loads
  // shots above already carry the saved-views bar, which is why they are not
  // duplicated here.
  { name: 'dispatch-en', path: '/dispatch', locale: 'en', authed: true },
  { name: 'dispatch-ru', path: '/dispatch', locale: 'ru', authed: true },
  { name: 'dispatch-fa-rtl', path: '/dispatch', locale: 'fa', authed: true },
  // Step 7. The driver form gained the truck pairing, and the Loads view bar
  // gained the density control — both are new layout and both are shot in all
  // three locales.
  { name: 'driver-new-en', path: '/drivers/new', locale: 'en', authed: true },
  { name: 'driver-new-ru', path: '/drivers/new', locale: 'ru', authed: true },
  {
    name: 'driver-new-fa-rtl',
    path: '/drivers/new',
    locale: 'fa',
    authed: true,
  },
  // Admin → Users. New layout, so all three locales; the create form is where
  // the credential panel lives and is worth seeing mirrored.
  { name: 'users-en', path: '/users', locale: 'en', authed: true },
  { name: 'users-ru', path: '/users', locale: 'ru', authed: true },
  { name: 'users-fa-rtl', path: '/users', locale: 'fa', authed: true },
  { name: 'user-new-en', path: '/users/new', locale: 'en', authed: true },
  { name: 'user-new-ru', path: '/users/new', locale: 'ru', authed: true },
  { name: 'user-new-fa-rtl', path: '/users/new', locale: 'fa', authed: true },
  { name: 'truck-new-en', path: '/trucks/new', locale: 'en', authed: true },
  { name: 'truck-new-ru', path: '/trucks/new', locale: 'ru', authed: true },
  { name: 'truck-new-fa-rtl', path: '/trucks/new', locale: 'fa', authed: true },
  // PHASE 4 step 1. The compliance queue — dense, and every row a date next to
  // a status word, which is where §12's longer Russian bites.
  ...money('safety', '/safety'),
  // Step B. The dashboard — the first screen of the day, and the one §12's
  // "Russian runs ~30% longer" hits hardest because every queue row is a
  // sentence rather than a label.
  ...money('dashboard', '/dashboard'),
  // PHASE 3. The money screens, all three locales. These are where §12's
  // "Russian runs ~30% longer" bites hardest: every one of them is a dense
  // table of right-aligned figures beside a translated label, and Farsi
  // mirrors the lot.
  ...money('invoices', '/invoices'),
  ...money('receivables', '/receivables'),
  ...money('payments', '/payments'),
  ...money('settlements', '/settlements'),
]

/** One screen in all three locales. The RTL shot is named so it sorts last. */
function money(name, path) {
  return [
    { name: `${name}-en`, path, locale: 'en', authed: true },
    { name: `${name}-ru`, path, locale: 'ru', authed: true },
    { name: `${name}-fa-rtl`, path, locale: 'fa', authed: true },
  ]
}

// The DETAIL screens need a real row, so their paths are resolved from the
// database rather than written here. A shot of an empty detail page proves
// nothing about a table of money, and a hard-coded id goes stale the first
// time somebody reseeds.
if (process.env.DIRECT_DATABASE_URL) {
  const { neonConfig, Pool } = await import('@neondatabase/serverless')
  neonConfig.webSocketConstructor ??= WebSocket
  neonConfig.poolQueryViaFetch = false
  const pool = new Pool({ connectionString: process.env.DIRECT_DATABASE_URL })
  try {
    const newest = async (table, extra = '') =>
      (
        await pool.query(
          `select id from "${table}" where "deletedAt" is null ${extra}
            order by "createdAt" desc limit 1`,
        )
      ).rows[0]?.id ?? null

    const invoice = await newest('Invoice')
    const payment = await newest('Payment')
    const settlement = await newest('Settlement', "and status <> 'VOID'")

    if (invoice) SHOTS.push(...money('invoice-detail', `/invoices/${invoice}`))
    if (payment) SHOTS.push(...money('payment-detail', `/payments/${payment}`))
    if (settlement) {
      SHOTS.push(...money('settlement-detail', `/settlements/${settlement}`))
    }
    console.log(
      `detail shots: invoice=${Boolean(invoice)} payment=${Boolean(payment)} settlement=${Boolean(settlement)}`,
    )
  } finally {
    await pool.end()
  }
}

mkdirSync(OUT, { recursive: true })

// SHOT_CHROME lets this point at a Chromium already on the machine. This
// build of Playwright wants revision 1194 and the box has a complete 1223,
// which renders identically for a screenshot and saves a 150MB download that
// had already deadlocked twice on its own install lock.
const executablePath = process.env.SHOT_CHROME
const browser = await chromium.launch(executablePath ? { executablePath } : {})
const origin = new URL(BASE).origin

/**
 * A session, by signing in the way a person does.
 *
 * SHOT_TOKEN still wins if it is set. Otherwise this drives the real login
 * form, which is both less fiddly than minting a row by hand and one more
 * place the deployed login path gets exercised. Sessions now cost an argon2id
 * verify, so it is issued once and reused across every authenticated shot.
 */
async function signIn() {
  if (process.env.SHOT_TOKEN) return process.env.SHOT_TOKEN

  const email = process.env.SEED_OWNER_EMAIL
  const password = process.env.SEED_OWNER_PASSWORD
  if (!email || !password) return ''

  const context = await browser.newContext({ viewport: VIEWPORT })
  const page = await context.newPage()
  await page.goto(`${BASE}/login`, { waitUntil: 'domcontentloaded' })
  await page.fill('input[name="email"]', email)
  await page.fill('input[name="password"]', password)
  await Promise.all([
    page.waitForURL(/\/(loads|dashboard)/, { timeout: 60_000 }),
    page.click('button[type="submit"]'),
  ])
  const cookie = (await context.cookies()).find(
    (c) => c.name === 'zebra_session',
  )
  await context.close()
  return cookie?.value ?? ''
}

const TOKEN = await signIn()

for (const shot of SHOTS) {
  const context = await browser.newContext({
    viewport: VIEWPORT,
    deviceScaleFactor: 1,
    // Locale comes from the cookie, not Accept-Language — a Farsi-speaking
    // dispatcher on a Russian-configured laptop gets what they chose.
    locale: shot.locale,
  })

  const cookies = [{ name: 'zebra_locale', value: shot.locale, url: origin }]
  if (shot.authed && TOKEN) {
    cookies.push({ name: 'zebra_session', value: TOKEN, url: origin })
  }
  await context.addCookies(cookies)

  const page = await context.newPage()
  // NOT `networkidle`. Against the deployed worker it never arrives — the
  // streamed SSR response and Next's link prefetching keep a connection in
  // flight, and the shot times out instead of being taken.
  const response = await page.goto(`${BASE}${shot.path}`, {
    waitUntil: 'domcontentloaded',
  })

  // Fonts must be in before the shot, or the screenshot is a picture of the
  // fallback stack.
  await page.evaluate(() => document.fonts.ready)
  await page.waitForTimeout(500)

  const dir = await page.evaluate(() => document.documentElement.dir)
  const lang = await page.evaluate(() => document.documentElement.lang)

  await page.screenshot({ path: `${OUT}/${shot.name}.png` })
  console.log(
    `${shot.name.padEnd(14)} ${String(response?.status()).padEnd(4)} lang=${lang} dir=${dir} ${page.url().replace(BASE, '')}`,
  )

  await context.close()
}

await browser.close()
