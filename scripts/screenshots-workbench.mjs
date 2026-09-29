import { chromium } from 'playwright'
import { mkdirSync } from 'node:fs'

// ---------------------------------------------------------------------------
// THE SETTLEMENT WORKBENCH AND THE OPEN-BATCH SCREEN, PHOTOGRAPHED ON DEV.
//
// Owner's brief, 2026-09-29: "dev, screenshots, hold". Companion to
// `screenshots-accounting.mjs`, same viewport and the same fail-closed rule —
// a 4xx or a bounce to the login page is a failed shot, counted, and the run
// exits non-zero.
//
// ── IT FINDS THE STATEMENT RATHER THAN BEING TOLD ONE ─────────────────────
//
// The workbench is `/settlements/<id>` and the ids on dev change every time
// the drafts are replayed. A hardcoded id turns into a 404 the next time
// somebody re-seeds, and a 404 photographed at 1920x1080 looks exactly like a
// screenshot until you open it. So the run opens Payroll → Statements and
// follows the first row, the way a person would — and if there is no row, it
// says so and stops rather than shooting the empty grid twice.
// ---------------------------------------------------------------------------

const BASE =
  process.env.SHOT_BASE ?? 'https://zebra-dev.tajikcargollc.workers.dev'
const OUT = 'screenshots'
const VIEWPORT = { width: 1920, height: 1080 }

mkdirSync(OUT, { recursive: true })

const executablePath = process.env.SHOT_CHROME
const browser = await chromium.launch(executablePath ? { executablePath } : {})
const origin = new URL(BASE).origin

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
if (!TOKEN) {
  console.error('NO SESSION. Set SEED_OWNER_EMAIL and SEED_OWNER_PASSWORD.')
  await browser.close()
  process.exit(1)
}

const newContext = async (locale = 'en') => {
  const context = await browser.newContext({
    viewport: VIEWPORT,
    deviceScaleFactor: 1,
    locale,
  })
  await context.addCookies([
    { name: 'zebra_locale', value: locale, url: origin },
    { name: 'zebra_session', value: TOKEN, url: origin },
  ])
  return context
}

// ── FIND A STATEMENT ──────────────────────────────────────────────────────
const finder = await newContext()
const finderPage = await finder.newPage()
await finderPage.goto(`${BASE}/payroll/statements`, {
  waitUntil: 'domcontentloaded',
})
await finderPage.waitForTimeout(1500)
const statementPath = await finderPage.evaluate(() => {
  const link = document.querySelector('a[href^="/settlements/"]')
  return link ? new URL(link.href).pathname : null
})
await finder.close()

if (!statementPath) {
  console.error(
    'NO STATEMENT ON /payroll/statements. The workbench cannot be photographed.',
  )
  await browser.close()
  process.exit(1)
}
console.log(`workbench statement: ${statementPath}\n`)

const SHOTS = [
  // ── THE WORKBENCH ───────────────────────────────────────────────────────
  { name: 'wb-1-statement', path: statementPath },
  { name: 'wb-2-statement-ru', path: statementPath, locale: 'ru' },
  { name: 'wb-3-statement-fa-rtl', path: statementPath, locale: 'fa' },

  // ── THE OPEN-BATCH SCREEN ───────────────────────────────────────────────
  //
  // Three states, because the interesting one is the third: a range with
  // nothing available, where the whole screen is the unavailable groups and
  // the sentence attached to each.
  { name: 'wb-4-openbatch', path: '/payroll/batches/new' },
  {
    name: 'wb-5-openbatch-week',
    path: '/payroll/batches/new?from=2026-09-20&to=2026-09-26',
  },
  {
    name: 'wb-6-openbatch-twoweeks',
    path: '/payroll/batches/new?from=2026-09-13&to=2026-09-26',
  },
  { name: 'wb-7-openbatch-fa-rtl', path: '/payroll/batches/new', locale: 'fa' },
]

let failures = 0

for (const shot of SHOTS) {
  const locale = shot.locale ?? 'en'
  const context = await newContext(locale)
  const page = await context.newPage()
  const response = await page.goto(`${BASE}${shot.path}`, {
    waitUntil: 'domcontentloaded',
  })
  await page.evaluate(() => document.fonts.ready)
  await page.waitForTimeout(900)

  const dir = await page.evaluate(() => document.documentElement.dir)
  const landed = page.url().replace(BASE, '')
  const status = response?.status() ?? 0
  const bounced = landed.startsWith('/login')
  if (status >= 400 || bounced) failures += 1

  await page.screenshot({ path: `${OUT}/${shot.name}.png`, fullPage: true })
  console.log(
    `${shot.name.padEnd(26)} ${String(status).padEnd(4)} dir=${dir.padEnd(3)} ${landed}${
      status >= 400 || bounced ? '   <-- NOT OK' : ''
    }`,
  )
  await context.close()
}

await browser.close()

console.log('')
if (failures > 0) {
  console.log(`${failures} OF ${SHOTS.length} SHOTS ARE NOT OK.`)
  process.exit(1)
}
console.log(`ALL ${SHOTS.length} SHOTS OK.`)
