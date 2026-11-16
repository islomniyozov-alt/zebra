// ---------------------------------------------------------------------------
// THE SHELL FILLS THE WINDOW, AND THE PAGE NEVER SCROLLS (owner's report
// 2026-11-16, dev /dashboard at 1886×961). The shell is `h-screen` and its
// content column scrolls inside it (§3.6), so the document itself must be
// exactly one window tall. It was 2,743 px: every chart's screen-reader
// table was `sr-only` ON THE TABLE, and a table treats `height: 1px` as a
// minimum and ignores `overflow: hidden` — 1,760 px of rows, absolutely
// positioned against the page. Scroll the page and the shell rode up out of
// the window with the grey body under it, cutting "Loads delivered per day"
// in half. Every HTTP check passed, because nothing about it is a status.
//
// So this RENDERS the pages that draw charts, at the window the report came
// from and a laptop's, scrolls the page as far as it goes, and holds three
// facts: the shell's top is at 0, its height is the window's, and the
// document is no taller than the window.
//
//   node --env-file=.env scripts/shell-height.mjs [base-url]
//
// The deploy sweep calls `measureShells` with the owner's session it already
// has; run alone it signs in as the owner (`check-credentials.mjs`).
// ---------------------------------------------------------------------------

/** The report's window, and a 1366×768 laptop. */
export const SHELL_VIEWPORTS = [
  { width: 1886, height: 961 },
  { width: 1366, height: 768 },
]

/**
 * The pages that draw a chart — `tests/shell-height.test.ts` holds this list
 * to the pages that import one, so a new chart page cannot go unmeasured.
 */
export const SHELL_PAGES = [
  '/dashboard',
  '/accounting/invoices',
  '/accounting/payments',
  '/accounting/reports',
  '/payroll/batches',
  '/payroll/statements',
]

/**
 * One problem line per measurement that breaks the rule; none when it holds.
 * A page that rendered no shell, or answered anything but 200, is a problem
 * too — unmeasured is not clean.
 */
export function shellFindings(rows) {
  const problems = []
  for (const row of rows) {
    const where = `${row.path} at ${row.width}×${row.height}`
    if (row.status !== 200) {
      problems.push(`${where}: answered ${row.status}, shell not measured`)
      continue
    }
    if (row.shellHeight === null) {
      problems.push(`${where}: no shell rendered`)
      continue
    }
    if (row.shellHeight !== row.height)
      problems.push(
        `${where}: shell ${row.shellHeight}px tall, window ${row.height}px`,
      )
    if (row.shellTop !== 0)
      problems.push(
        `${where}: shell top at ${row.shellTop}px after scrolling the page`,
      )
    if (row.documentHeight > row.height)
      problems.push(
        `${where}: document ${row.documentHeight}px tall, window ${row.height}px`,
      )
  }
  return problems
}

/** Render every page at every viewport with `cookie`; one row per pair. */
export async function measureShells(
  browser,
  base,
  cookie,
  pages = SHELL_PAGES,
  viewports = SHELL_VIEWPORTS,
) {
  const rows = []
  const cookies = cookie
    .split(';')
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => {
      const at = part.indexOf('=')
      return { name: part.slice(0, at), value: part.slice(at + 1), url: base }
    })
  for (const viewport of viewports) {
    const context = await browser.newContext({ viewport })
    await context.addCookies(cookies)
    const page = await context.newPage()
    for (const path of pages) {
      const response = await page
        .goto(new URL(path, base).href, { waitUntil: 'load', timeout: 90_000 })
        .catch(() => null)
      const status = response?.status() ?? 0
      const measured =
        status === 200
          ? await page.evaluate(() => {
              window.scrollTo(0, document.documentElement.scrollHeight)
              const shell = document.querySelector('[data-density]')
              const box = shell?.getBoundingClientRect()
              return {
                shellTop: box ? Math.round(box.top) : null,
                shellHeight: box ? Math.round(box.height) : null,
                documentHeight: document.documentElement.scrollHeight,
              }
            })
          : { shellTop: null, shellHeight: null, documentHeight: null }
      rows.push({ path, ...viewport, status, ...measured })
    }
    await context.close()
  }
  return rows
}

/** Print the rows and the verdict; returns the problem count. */
export function reportShells(rows) {
  for (const row of rows)
    console.log(
      `   ${String(row.status).padEnd(3)} ${`${row.width}×${row.height}`.padEnd(9)} ${row.path.padEnd(22)} shell ${row.shellHeight ?? '-'}px at ${row.shellTop ?? '-'}, document ${row.documentHeight ?? '-'}px`,
    )
  const problems = shellFindings(rows)
  for (const line of problems) console.log(`   SHELL ${line}`)
  console.log(
    problems.length === 0
      ? `SHELL HEIGHT: ${rows.length} render(s), the shell fills the window on every one — OK.`
      : `SHELL HEIGHT: ${problems.length} PROBLEM(S) in ${rows.length} render(s) — NOT OK.`,
  )
  return problems.length
}

if (process.argv[1]?.replace(/\\/g, '/').endsWith('scripts/shell-height.mjs')) {
  const { chromium } = await import('playwright')
  const { credentialsFor } = await import('./check-credentials.mjs')
  const base = process.argv[2] ?? 'https://zebra-dev.tajikcargollc.workers.dev'
  const credentials = credentialsFor(base)
  if (!credentials.ok) {
    console.error(`${credentials.reason} NOT OK.`)
    process.exit(1)
  }
  const browser = await chromium.launch(
    process.env.SHOT_CHROME ? { executablePath: process.env.SHOT_CHROME } : {},
  )
  let failed = 1
  try {
    const context = await browser.newContext()
    const page = await context.newPage()
    await page.goto(new URL('/login', base).href, {
      waitUntil: 'domcontentloaded',
    })
    await page.fill('input[name="email"]', credentials.email)
    await page.fill('input[name="password"]', credentials.password)
    await Promise.all([
      page.waitForURL((url) => !url.pathname.startsWith('/login'), {
        timeout: 90_000,
      }),
      page.click('button[type="submit"]'),
    ])
    const cookie = (await context.cookies())
      .filter((entry) => entry.name === 'zebra_session')
      .map((entry) => `${entry.name}=${entry.value}`)
      .join('; ')
    await context.close()
    if (!cookie) throw new Error('signed in but no session cookie was set')
    failed = reportShells(await measureShells(browser, base, cookie))
  } catch (error) {
    console.error(
      `SHELL HEIGHT: ${String(error?.message ?? error).split('\n')[0]} — NOT OK.`,
    )
  } finally {
    await browser.close()
  }
  process.exit(failed === 0 ? 0 : 1)
}
