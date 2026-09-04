import { chromium } from 'playwright'

// ---------------------------------------------------------------------------
// WHAT A DEPLOYED ROUTE ACTUALLY RETURNS.
//
// Every other check in this repository stops short of the response:
//
//   `check:drift`          reads the version MESSAGE `deploy.mjs` stamped. Its
//                          own comment says it — "a version id tells you a
//                          deploy happened; it does not tell you what is in
//                          it" — and the drift line had been read as stronger
//                          than that for weeks.
//   the artifact probe     asks whether a route returns 200. A stale cached
//                          page returns 200 beautifully.
//   grepping `.open-next`  reads what was UPLOADED, not what is served.
//
// On 2026-09-04 all three said the same thing and all three were beside the
// point: production reported `8177a71`, the bundle contained the new code, the
// route returned 200 — and the screen rendered markup that had been DELETED ten
// commits earlier. The owner then found the mechanism by hand: a request for
// load 1010 came back with load 1013's HTML, twice, and `?v=2` produced the
// real page.
//
// SO THIS LOGS IN AND READS THE BODY. Read-only: it fetches, it asserts, it
// changes nothing. Two questions, and the second is the one that matters:
//
//   1. Does the page carry the code the tree says it should?
//   2. Is it the page that was ASKED FOR? A cache that can serve load 1013 for
//      load 1010 is a cache whose key is not the URL, and the next question
//      after that is whether it can serve one organisation's load to another.
//      This does not answer that; it makes the failure visible where it can be
//      asked properly.
//
//   SHOT_CHROME=... VERIFY_LOAD=1010 node -r dotenv/config scripts/verify-response.mjs
//   VERIFY_BASE=https://zebra.tajikcargollc.workers.dev ... (production)
// ---------------------------------------------------------------------------

const BASE =
  process.env.VERIFY_BASE ?? 'https://zebra-dev.tajikcargollc.workers.dev'
// The seeded owner, the same identity `verify-argon2.mjs` signs in as. Named
// through VERIFY_* first so a run can use a different account without editing.
const EMAIL = process.env.VERIFY_EMAIL ?? process.env.SEED_OWNER_EMAIL
const PASSWORD = process.env.VERIFY_PASSWORD ?? process.env.SEED_OWNER_PASSWORD
const LOAD = process.env.VERIFY_LOAD
/** A second load number, so the cross-load collision can be reproduced. */
const SECOND = process.env.VERIFY_LOAD_B

if (!EMAIL || !PASSWORD || !LOAD) {
  console.error(
    'Needs VERIFY_EMAIL, VERIFY_PASSWORD and VERIFY_LOAD (a load number).\n' +
      'It reads a deployed page as a real session; there is no way to do that\n' +
      'without credentials, and none are invented here.',
  )
  process.exit(1)
}

const results = []
const check = (label, ok, detail) => {
  results.push({ label, ok })
  console.log(`${ok ? 'ok  ' : 'FAIL'}  ${label.padEnd(52)} ${detail}`)
}

/**
 * The href of a load ROW, not of a nav item.
 *
 * THREE WAYS THIS PROBE LIED BEFORE IT WORKED, all of them worth knowing:
 *
 *   1. `a[href^="/loads/"]` ALSO MATCHES THE SIDEBAR. `/loads/import` is a nav
 *      link, so the first version followed it, landed on the loads LIST, and
 *      reported "stops are numbered: NOT FOUND" about a page that has no
 *      stops. A load id is a cuid — `c` and twenty-odd of [a-z0-9] — and
 *      nothing in the navigation looks like that, which is why the filter is
 *      on the shape of the id rather than on the prefix.
 *
 *   2. THE SEARCH PARAMETER IS `ref`, NOT `q`. `src/app/(app)/loads/page.tsx`
 *      reads `params['ref']`; `?q=` is ignored, the list comes back unfiltered,
 *      and this helper then returns the NEWEST load every time. That produced
 *      "asked 1110, header says 1114" — which is indistinguishable from the
 *      cross-load cache collision this probe was written to investigate. See
 *      flag 94.
 *
 *   3. DEV AND PRODUCTION HAVE DIFFERENT DATABASES. Load numbers from one do
 *      not exist in the other, and a search that finds nothing falls back to
 *      the same wrong row as (2). Pass a load number that exists on the target.
 */
async function loadRowHref(page) {
  const hrefs = await page
    .locator('a[href^="/loads/"]')
    .evaluateAll((nodes) => nodes.map((node) => node.getAttribute('href')))
  return (
    hrefs.find((href) => /^\/loads\/c[a-z0-9]{16,}$/.test(href ?? '')) ?? null
  )
}

const browser = await chromium.launch(
  process.env.SHOT_CHROME ? { executablePath: process.env.SHOT_CHROME } : {},
)

try {
  const context = await browser.newContext()
  const page = await context.newPage()

  await page.goto(`${BASE}/login`, { waitUntil: 'domcontentloaded' })
  await page.fill('input[name="email"]', EMAIL)
  await page.fill('input[name="password"]', PASSWORD)
  await page.click('button[type="submit"]')
  // A TIMEOUT THAT DOES NOT SAY WHY is the thing this whole file is against.
  // The login page puts its refusal in an alert; read it before giving up.
  await page
    .waitForURL(/\/(loads|dashboard)/, { timeout: 60_000 })
    .catch(async () => {
      const said = await page
        .locator('[role="alert"], p.text-danger')
        .first()
        .textContent()
        .catch(() => null)
      throw new Error(
        `login as ${EMAIL} failed at ${BASE}: ${said?.trim() ?? '(no message on the page)'}\n` +
          `Landed on ${page.url()}`,
      )
    })

  // THE SEARCH IS HOW WE REACH A LOAD BY NUMBER without knowing its id, and it
  // is also a second read of the same deployment.
  await page.goto(`${BASE}/loads?ref=${encodeURIComponent(LOAD)}`, {
    waitUntil: 'domcontentloaded',
  })
  const href = await loadRowHref(page)
  if (!href) {
    check('found the load', false, `no result for ${LOAD}`)
    process.exit(1)
  }

  // ASKED FOR, AND ASKED FOR PLAINLY. No cache-buster: the point is to read
  // what an ordinary request gets, because an ordinary request is what a
  // dispatcher makes.
  await page.goto(`${BASE}${href}`, { waitUntil: 'domcontentloaded' })
  const html = await page.content()

  // 1. IS IT THE PAGE THAT WAS ASKED FOR? The load number is rendered in the
  // header; a different number means the response belongs to another load.
  const heading = (await page.locator('h1').first().textContent()) ?? ''
  check(
    'the response is the load that was requested',
    heading.includes(LOAD),
    `asked ${LOAD}, header says "${heading.trim().slice(0, 40)}"`,
  )

  // 2. DOES IT CARRY WHAT THE TREE SAYS? Two markers, chosen because one was
  // ADDED and one was DELETED — a stale response fails them in opposite
  // directions, which distinguishes "old page" from "gate turned off".
  check(
    'stops are numbered (ddd4095 added this)',
    /Stop\s*\d+\s*·/.test(html),
    /Stop\s*\d+\s*·/.test(html) ? 'found "Stop N ·"' : 'NOT FOUND',
  )

  const oldForm = html.includes('name="addressLine1"')
  check(
    'the always-on address form is gone (ddd4095 deleted it)',
    !oldForm,
    oldForm ? 'STILL PRESENT — this response predates ddd4095' : 'absent',
  )

  // 3. AND THE SAME URL AGAIN, BUSTED. If the plain request and the busted one
  // disagree, the difference IS the cache, stated rather than inferred.
  await page.goto(`${BASE}${href}?v=${Date.now()}`, {
    waitUntil: 'domcontentloaded',
  })
  const busted = await page.content()
  const bustedNumbered = /Stop\s*\d+\s*·/.test(busted)
  check(
    'a cache-busted request agrees with the plain one',
    bustedNumbered === /Stop\s*\d+\s*·/.test(html),
    bustedNumbered
      ? 'busted request has the new page'
      : 'busted request also lacks it',
  )

  // ── 4. TWO LOADS IN SEQUENCE, WHICH IS THE COLLISION REPRODUCED ─────────
  //
  // The owner asked for load 1010 and got load 1013's HTML, twice. If a cache
  // key is coarser than the URL, the SECOND of two requests returns the first's
  // body — so this asks for a second load immediately after the first and reads
  // the heading back.
  //
  // IN THE SAME BROWSER CONTEXT ON PURPOSE. Next's client router keeps a cache
  // of visited and prefetched segments, and that cache is a far likelier
  // explanation than anything on the server — a tab open across a deploy holds
  // payloads rendered by the old code. Doing it in one context is what makes
  // that visible; the fresh-context check below separates it from the server.
  if (SECOND) {
    await page.goto(`${BASE}/loads?ref=${encodeURIComponent(SECOND)}`, {
      waitUntil: 'domcontentloaded',
    })
    const secondHref = await loadRowHref(page)

    if (!secondHref) {
      check('found the second load', false, `no result for ${SECOND}`)
    } else if (secondHref === href) {
      check(
        'the two loads are different pages',
        false,
        'search returned the same href',
      )
    } else {
      await page.goto(`${BASE}${secondHref}`, { waitUntil: 'domcontentloaded' })
      const secondHeading =
        (await page.locator('h1').first().textContent()) ?? ''
      check(
        'the second load returns its OWN page, not the first',
        secondHeading.includes(SECOND),
        `asked ${SECOND}, header says "${secondHeading.trim().slice(0, 40)}"`,
      )

      // AND BACK TO THE FIRST, which is the direction the owner hit it in.
      await page.goto(`${BASE}${href}`, { waitUntil: 'domcontentloaded' })
      const backHeading = (await page.locator('h1').first().textContent()) ?? ''
      check(
        'returning to the first load still returns the first',
        backHeading.includes(LOAD),
        `asked ${LOAD}, header says "${backHeading.trim().slice(0, 40)}"`,
      )
    }
  }

  // ── 5. A FRESH SESSION, SAME URL ────────────────────────────────────────
  //
  // A new browser context is a new cookie jar and an empty client router cache.
  // If the plain request in the first context disagreed with this one, the
  // difference is in the BROWSER; if they agree and both are stale, it is on
  // the server. That distinction is the whole question and neither the version
  // id nor a 200 can answer it.
  //
  // WHAT THIS DOES NOT TEST: two different organisations. That needs a second
  // account and is the one boundary worth knowing for certain — the response is
  // `private, no-store` and anonymous requests get a 307 to /login, so a shared
  // cache should not hold it at all, but "should" is what has been wrong three
  // times this week.
  const second = await browser.newContext()
  const fresh = await second.newPage()
  await fresh.goto(`${BASE}/login`, { waitUntil: 'domcontentloaded' })
  await fresh.fill('input[name="email"]', EMAIL)
  await fresh.fill('input[name="password"]', PASSWORD)
  await fresh.click('button[type="submit"]')
  await fresh.waitForURL(/\/(loads|dashboard)/, { timeout: 60_000 })
  await fresh.goto(`${BASE}${href}`, { waitUntil: 'domcontentloaded' })

  const freshHtml = await fresh.content()
  const freshHeading = (await fresh.locator('h1').first().textContent()) ?? ''
  check(
    'a fresh session gets the load it asked for',
    freshHeading.includes(LOAD),
    `asked ${LOAD}, header says "${freshHeading.trim().slice(0, 40)}"`,
  )
  check(
    'a fresh session and the first agree about the markup',
    /Stop\s*\d+\s*·/.test(freshHtml) === /Stop\s*\d+\s*·/.test(html),
    /Stop\s*\d+\s*·/.test(freshHtml)
      ? 'both have the new page'
      : 'fresh session ALSO lacks it — the staleness is server-side',
  )
  await second.close()
  const failed = results.filter((result) => !result.ok).length
  console.log(
    `\n${results.length - failed}/${results.length} — ` +
      (failed === 0
        ? 'the deployed response matches the tree.'
        : 'the deployed RESPONSE disagrees with what was uploaded.'),
  )
  process.exit(failed === 0 ? 0 : 1)
} finally {
  await browser.close()
}
