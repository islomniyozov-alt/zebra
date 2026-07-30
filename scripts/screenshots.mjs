import { chromium } from 'playwright'
import { mkdirSync } from 'node:fs'

// The §15 evidence: Loads and login at 1080p, Standard density, in English,
// Russian and right-to-left Farsi.
//
// 1920x1080 exactly, because the density rules are written against a 1080p
// screen and "20 rows visible without scrolling" is a claim about that
// viewport and no other.

const BASE = process.env.SHOT_BASE ?? 'http://127.0.0.1:3000'
const TOKEN = process.env.SHOT_TOKEN ?? ''
const OUT = 'screenshots'

const VIEWPORT = { width: 1920, height: 1080 }

const SHOTS = [
  { name: 'login-en', path: '/login', locale: 'en', authed: false },
  { name: 'login-ru', path: '/login', locale: 'ru', authed: false },
  { name: 'login-fa-rtl', path: '/login', locale: 'fa', authed: false },
  { name: 'loads-en', path: '/loads', locale: 'en', authed: true },
  { name: 'loads-ru', path: '/loads', locale: 'ru', authed: true },
  { name: 'loads-fa-rtl', path: '/loads', locale: 'fa', authed: true },
]

mkdirSync(OUT, { recursive: true })

// SHOT_CHROME lets this point at a Chromium already on the machine. This
// build of Playwright wants revision 1194 and the box has a complete 1223,
// which renders identically for a screenshot and saves a 150MB download that
// had already deadlocked twice on its own install lock.
const executablePath = process.env.SHOT_CHROME
const browser = await chromium.launch(executablePath ? { executablePath } : {})
const origin = new URL(BASE).origin

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
  const response = await page.goto(`${BASE}${shot.path}`, {
    waitUntil: 'networkidle',
  })

  // Fonts must be in before the shot, or the screenshot is a picture of the
  // fallback stack.
  await page.evaluate(() => document.fonts.ready)

  const dir = await page.evaluate(() => document.documentElement.dir)
  const lang = await page.evaluate(() => document.documentElement.lang)

  await page.screenshot({ path: `${OUT}/${shot.name}.png` })
  console.log(
    `${shot.name.padEnd(14)} ${String(response?.status()).padEnd(4)} lang=${lang} dir=${dir} ${page.url().replace(BASE, '')}`,
  )

  await context.close()
}

await browser.close()
