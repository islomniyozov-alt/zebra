import { chromium } from 'playwright'
import { mkdirSync } from 'node:fs'

// ---------------------------------------------------------------------------
// THE ACCOUNTING SECTION, PHOTOGRAPHED ON DEV.
//
// Owner's ruling, 2026-09-28: screenshots of each page before anything is
// dispatched to production. Five pages, plus the two states that only exist as
// pictures — a week with no batch, and a list narrowed by every control at once.
//
// 1920x1080 EXACTLY, because §5's density rules are written against a 1080p
// screen. "How many rows fit" is a claim about that viewport and no other.
//
// AND THE FILTERED SHOTS CARRY THEIR URL, which is the point of §7.4: a filter
// that serialises means the screenshot is reproducible by pasting the address.
// A picture of a filtered list whose filter cannot be named is not evidence.
// ---------------------------------------------------------------------------

const BASE =
  process.env.SHOT_BASE ?? 'https://zebra-dev.tajikcargollc.workers.dev'
const OUT = 'screenshots'
const VIEWPORT = { width: 1920, height: 1080 }

const SHOTS = [
  // ── ACCOUNTING, IN SIDEBAR ORDER ────────────────────────────────────────
  { name: 'acc-1-invoices', path: '/accounting/invoices' },
  { name: 'acc-2-payments', path: '/accounting/payments' },
  { name: 'acc-3-reports', path: '/accounting/reports' },

  // ── PAYROLL ─────────────────────────────────────────────────────────────
  { name: 'pay-1-batches', path: '/payroll/batches' },
  { name: 'pay-2-statements', path: '/payroll/statements' },
  { name: 'pay-3-charges', path: '/payroll/charges' },

  // ── EVERY OTHER TAB ─────────────────────────────────────────────────────
  //
  // A tab is a different question (§7.1.6), so a picture of one is not evidence
  // about the others.
  { name: 'acc-1b-invoices-ready', path: '/accounting/invoices?tab=ready' },
  { name: 'acc-1c-invoices-direct', path: '/accounting/invoices?tab=direct' },
  {
    name: 'acc-2b-payments-unapplied',
    path: '/accounting/payments?tab=unapplied',
  },
  { name: 'acc-3b-reports-week', path: '/accounting/reports?cut=week' },
  { name: 'acc-3c-reports-driver', path: '/accounting/reports?cut=driver' },
  { name: 'pay-1b-batches-balances', path: '/payroll/batches?tab=balances' },
  { name: 'pay-3b-charges-onetime', path: '/payroll/charges?tab=oneTime' },
  { name: 'pay-3c-charges-thisweek', path: '/payroll/charges?tab=thisWeek' },

  // ── THE GRID CONTRACT, VISIBLE ──────────────────────────────────────────
  //
  // Sorted, filtered and on page two, so the footer's `Total (N rows)` can be
  // read against a body that is deliberately NOT N rows long — which is the
  // correction the artefact forced (§7.1.2).
  {
    name: 'grid-1-invoices-page2',
    path: '/accounting/invoices?sort=balance&dir=desc&per=25&page=2',
  },
  {
    name: 'grid-2-invoices-filtered',
    path: '/accounting/invoices?age=d90_plus&sort=balance&dir=desc',
  },
  {
    name: 'grid-3-batches-sorted',
    path: '/payroll/batches?sort=amount&dir=desc',
  },

  // A week with no batch: §10's empty state is an invitation with the action
  // attached, and reads differently from "no rows match".
  {
    name: 'grid-4-batches-nobatch',
    path: '/payroll/batches?week=2026-08-02',
  },
  // The week this session corrected, so the derived check date is in a picture.
  { name: 'grid-5-batches-week', path: '/payroll/batches?week=2026-09-13' },

  // ── RUSSIAN AND FARSI ───────────────────────────────────────────────────
  //
  // §12: Russian runs ~30% longer and Farsi is right-to-left. The batches grid
  // is the widest, and the breadcrumb is new — its separator has to mirror.
  { name: 'i18n-1-batches-ru', path: '/payroll/batches', locale: 'ru' },
  { name: 'i18n-2-batches-fa-rtl', path: '/payroll/batches', locale: 'fa' },
  {
    name: 'i18n-3-invoices-fa-rtl',
    path: '/accounting/invoices',
    locale: 'fa',
  },

  // ── AND THE OLD PATHS STILL LAND SOMEWHERE ──────────────────────────────
  { name: 'redir-1-thisweek', path: '/money/this-week' },
  { name: 'redir-2-settlements', path: '/settlements' },
  { name: 'redir-3-accounting-payroll', path: '/accounting/payroll' },
  { name: 'redir-4-accounting-charges', path: '/accounting/charges' },
]

mkdirSync(OUT, { recursive: true })

const executablePath = process.env.SHOT_CHROME
const browser = await chromium.launch(executablePath ? { executablePath } : {})
const origin = new URL(BASE).origin

/** A session, by signing in the way a person does. Issued once, reused. */
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
  // LOUD, AND IT STOPS. Without a session every shot is the login page, and
  // fifteen pictures of a login form look like fifteen screenshots until
  // somebody opens one.
  console.error('NO SESSION. Set SEED_OWNER_EMAIL and SEED_OWNER_PASSWORD.')
  await browser.close()
  process.exit(1)
}

let failures = 0

for (const shot of SHOTS) {
  const locale = shot.locale ?? 'en'
  const context = await browser.newContext({
    viewport: VIEWPORT,
    deviceScaleFactor: 1,
    locale,
  })
  await context.addCookies([
    { name: 'zebra_locale', value: locale, url: origin },
    { name: 'zebra_session', value: TOKEN, url: origin },
  ])

  const page = await context.newPage()
  // NOT `networkidle`: against the deployed worker it never arrives, because
  // the streamed SSR response and Next's prefetching keep a connection open.
  const response = await page.goto(`${BASE}${shot.path}`, {
    waitUntil: 'domcontentloaded',
  })
  // Fonts in before the shutter, or the picture is of the fallback stack.
  await page.evaluate(() => document.fonts.ready)
  await page.waitForTimeout(600)

  const dir = await page.evaluate(() => document.documentElement.dir)
  const landed = page.url().replace(BASE, '')
  const status = response?.status() ?? 0

  // A 4xx OR A BOUNCE TO LOGIN IS A FAILED SHOT, counted and reported at the
  // end. A screenshot run that photographs an error page and exits 0 is the
  // `tail` trap with a camera.
  const bounced = landed.startsWith('/login')
  if (status >= 400 || bounced) failures += 1

  await page.screenshot({ path: `${OUT}/${shot.name}.png` })
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
