import { chromium } from 'playwright'

// The two §13 criteria that were arithmetic rather than measurement, checked
// against whatever URL is given — the deployed worker, for the close of
// Phase 1.
//
//   * 20 rows visible at 1080p, Standard density.
//   * Keyboard focus visible on every interactive element.

const BASE =
  process.env.VERIFY_BASE ?? 'https://zebra-dev.tajikcargollc.workers.dev'
const TOKEN = process.env.VERIFY_TOKEN ?? ''
const executablePath = process.env.SHOT_CHROME

const browser = await chromium.launch(executablePath ? { executablePath } : {})
const context = await browser.newContext({
  viewport: { width: 1920, height: 1080 },
  deviceScaleFactor: 1,
})
const origin = new URL(BASE).origin
await context.addCookies([
  { name: 'zebra_locale', value: 'en', url: origin },
  { name: 'zebra_session', value: TOKEN, url: origin },
])

const page = await context.newPage()
await page.goto(`${BASE}/loads`, { waitUntil: 'domcontentloaded' })
await page.evaluate(() => document.fonts.ready)

// --- rows visible at 1080p --------------------------------------------------
const rows = await page.evaluate(() => {
  const scroller = document.querySelector('table')?.parentElement
  const thead = document.querySelector('thead')
  if (!scroller || !thead) return null
  const available =
    scroller.getBoundingClientRect().height -
    thead.getBoundingClientRect().height
  const rowHeight = parseFloat(
    getComputedStyle(document.documentElement).getPropertyValue(
      '--z-row-height',
    ),
  )
  return {
    scrollerHeight: Math.round(scroller.getBoundingClientRect().height),
    theadHeight: Math.round(thead.getBoundingClientRect().height),
    rowHeight,
    visible: Math.floor(available / rowHeight),
  }
})
console.log('rows at 1080p Standard:', JSON.stringify(rows))

// --- focus ring on every interactive element --------------------------------
// Tab through the document and check each landing point actually shows an
// outline. "Never outline:none without a replacement" is only true if someone
// looks.
const focusReport = await page.evaluate(() => {
  const focusables = Array.from(
    document.querySelectorAll(
      'a[href], button, input, select, textarea, [tabindex]:not([tabindex="-1"])',
    ),
  ).filter((el) => {
    const rect = el.getBoundingClientRect()
    if (rect.width === 0 || rect.height === 0) return false
    // A disabled control cannot take focus, so it correctly shows no ring.
    // Counting it was a bug in this check, not in the stylesheet.
    if ('disabled' in el && el.disabled) return false
    return true
  })

  const invisible = []
  for (const el of focusables) {
    el.focus()
    // :focus-visible only applies when the browser decides focus should be
    // shown. Programmatic focus counts for keyboard-style elements, which is
    // what this is asserting.
    if (document.activeElement !== el) continue
    const style = getComputedStyle(el)
    const width = parseFloat(style.outlineWidth)
    const hasRing = style.outlineStyle !== 'none' && width > 0
    if (!hasRing) {
      invisible.push(
        `${el.tagName.toLowerCase()}.${el.className.split(' ')[0] ?? ''}`,
      )
    }
  }
  return { total: focusables.length, invisible }
})
console.log('focusable elements:', focusReport.total)
console.log('without a visible ring:', JSON.stringify(focusReport.invisible))

await browser.close()
