// ---------------------------------------------------------------------------
// THE AMAZON LOAD DETAIL'S TRACKER, RENDERED (TMS-DESIGN-SYSTEM.md §7.13;
// owner's report 2026-11-17: on dev the step digits 1–6 "render mirrored /
// upside down").
//
// THERE WAS NO TRANSFORM. Probed on dev at 08eae6c: no ancestor of any circle
// carried a transform, rotate, scale, writing mode or direction. Each step's
// connector bar is an absolute 3 px line that comes LATER in the DOM than the
// circle to its start, so it painted straight through that circle's digit in
// the same blue — a digit with a bar through its middle reads as mirrored or
// upside down. elementFromPoint at each digit's centre found the bar for 1–7
// and the circle only for 8, which has no bar after it.
//
// So this RENDERS a load's tracker and fails unless every digit is (1) the
// topmost element at its own centre and (2) upright — no ancestor of it
// carries a rotation, a mirror or a vertical writing mode. A source check
// cannot do this: jsdom lays nothing out, and the defect was in the painting.
//
//   node --env-file=.env scripts/tracker-render.mjs [base]
//
// The deploy sweep runs it as the owner, after the shell check.
// ---------------------------------------------------------------------------

/** How many loads from the top of /loads to try for one with a tracker. */
export const TRACKER_CANDIDATES = 10

/**
 * The findings for one measured tracker, as sentences. `null` — no load among
 * the candidates rendered a tracker — is a finding too: unreadable is not
 * clean.
 */
export function trackerFindings(measured) {
  if (measured === null)
    return [
      `no tracker on the first ${TRACKER_CANDIDATES} loads of /loads — nothing measured`,
    ]
  const problems = []
  if (measured.steps.length === 0)
    problems.push(`${measured.path}: a tracker with no steps`)
  for (const step of measured.steps) {
    if (!step.topmost)
      problems.push(
        `${measured.path}: step ${step.digit} is covered at its centre by ${step.coveredBy}`,
      )
    if (!step.upright)
      problems.push(
        `${measured.path}: step ${step.digit} is not upright — ${step.turned}`,
      )
  }
  return problems
}

/**
 * In the page: each step's digit, whether it is the element at its own centre,
 * and whether anything above it turns or mirrors it. A pure translation is
 * upright; any other matrix, a rotate, a scale with a negative factor or a
 * vertical writing mode is not.
 */
export function readTracker() {
  const steps = [
    ...document.querySelectorAll('[data-tracker] [data-tracker-step]'),
  ]
  if (steps.length === 0) return null
  const turnedBy = (element) => {
    for (let at = element; at; at = at.parentElement) {
      const style = getComputedStyle(at)
      if (style.writingMode !== 'horizontal-tb')
        return `writing-mode ${style.writingMode} on ${at.tagName}`
      if (style.rotate !== 'none')
        return `rotate ${style.rotate} on ${at.tagName}`
      if (style.scale !== 'none' && /-/.test(style.scale))
        return `scale ${style.scale} on ${at.tagName}`
      if (style.transform !== 'none') {
        const m = new DOMMatrixReadOnly(style.transform)
        if (m.a <= 0 || m.d <= 0 || m.b !== 0 || m.c !== 0)
          return `transform ${style.transform} on ${at.tagName}`
      }
    }
    return null
  }
  return steps.map((step) => {
    const box = step.getBoundingClientRect()
    const hit = document.elementFromPoint(
      box.left + box.width / 2,
      box.top + box.height / 2,
    )
    const topmost = hit !== null && (hit === step || step.contains(hit))
    const turned = turnedBy(step)
    return {
      digit: step.textContent.trim(),
      topmost,
      coveredBy: topmost
        ? null
        : hit
          ? `${hit.tagName.toLowerCase()}.${String(hit.className).split(' ').slice(0, 3).join('.')}`
          : 'nothing',
      upright: turned === null,
      turned,
    }
  })
}

/** Signed in by `cookie`, the first load from the top of /loads with a tracker. */
export async function measureTracker(browser, base, cookie) {
  const cookies = cookie
    .split(';')
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => {
      const at = part.indexOf('=')
      return { name: part.slice(0, at), value: part.slice(at + 1), url: base }
    })
  const context = await browser.newContext({
    viewport: { width: 1886, height: 961 },
  })
  try {
    await context.addCookies(cookies)
    const page = await context.newPage()
    await page.goto(new URL('/loads', base).href, {
      waitUntil: 'load',
      timeout: 90_000,
    })
    const hrefs = await page.$$eval('tbody a[href^="/loads/"]', (links) => [
      ...new Set(links.map((link) => link.getAttribute('href'))),
    ])
    for (const path of hrefs.slice(0, TRACKER_CANDIDATES)) {
      await page.goto(new URL(path, base).href, {
        waitUntil: 'load',
        timeout: 90_000,
      })
      const steps = await page.evaluate(readTracker)
      if (steps !== null) return { path, steps }
    }
    return null
  } finally {
    await context.close()
  }
}

/** Prints the reading and the findings; returns the problem count. */
export function reportTracker(measured) {
  if (measured !== null)
    console.log(
      `   ${measured.path}  ${measured.steps.map((step) => `${step.digit}:${step.topmost && step.upright ? 'ok' : 'NO'}`).join(' ')}`,
    )
  const problems = trackerFindings(measured)
  for (const line of problems) console.log(`   TRACKER ${line}`)
  console.log(
    problems.length === 0
      ? `TRACKER DIGITS: ${measured.steps.length} step(s), every digit upright and on top — OK.`
      : `TRACKER DIGITS: ${problems.length} PROBLEM(S) — NOT OK.`,
  )
  return problems.length
}

if (
  process.argv[1]?.replace(/\\/g, '/').endsWith('scripts/tracker-render.mjs')
) {
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
    failed = reportTracker(await measureTracker(browser, base, cookie))
  } catch (error) {
    console.error(
      `TRACKER DIGITS: ${String(error?.message ?? error).split('\n')[0]} — NOT OK.`,
    )
  } finally {
    await browser.close()
  }
  process.exit(failed === 0 ? 0 : 1)
}
