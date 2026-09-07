import { chromium } from 'playwright'

// ---------------------------------------------------------------------------
// WHAT DOES THE DEPLOYED /drivers/new ACTUALLY RENDER?
//
// A version id says a deploy happened, not what is in it. This is the second
// time that has cost a session:
//
//   2026-09-04, LOAD 1010. Four screen changes were reported missing after a
//   deploy whose version id had moved. `verify-response.mjs` was written to
//   read what the load page RETURNS, and found the deploy was fine.
//
//   2026-09-06, /drivers/new. The New Driver form was reported unchanged on
//   production at a commit that contains the change — while dev, on the same
//   commit, rendered it correctly. This file is what answered that.
//
// TWICE IS A RECURRING QUESTION, so the answer lives beside its sibling as
// `npm run verify:driver-form` rather than being rewritten from memory the
// next time somebody says "it looks the same to me".
//
// ── AND THEN IT WENT STALE, WHICH IS THE THIRD LESSON ────────────────────
//
// 2026-09-07: it was reported that production showed "only the field form".
// It does not — the deployment was correct. But this script had been written
// for `774e731`, the field-form redesign, and asserted those fields must be
// PRESENT on /drivers/new. The two-control ruling then moved the form behind
// the drop zone and nobody updated this, so it exited 3 against a correct
// deployment — and, far worse, it would have printed `ok` for exactly the
// regression it was being asked about.
//
// A CHECK THAT FAILS WHEN THE CODE IS RIGHT GETS IGNORED, and an ignored
// check is how the real regression ships. So it now verifies the screen the
// ruling actually describes, IN TWO STAGES:
//
//   1. ON LOAD: the drop zone, its file input, the authority select, the
//      manual link — and NO form at all. The upload is the front door.
//   2. AFTER CLICKING MANUAL: the confirm form and its exact field list.
//      `EXPECTED` and `GONE` survive from the old version and are checked
//      here, where they were always true — one stage later than they used
//      to be.
//
// IT ASKS THE DOM FOR STRUCTURE AND FIELD NAMES, NEVER FOR LABELS. Labels are
// translated; `input[name=...]` is the string the form will actually post, and
// the drop zone is found by the file input it wraps rather than by its
// heading. A selector keyed on English would fail the day somebody runs this
// against a Russian locale and prove nothing about either.
//
// NO PRODUCTION CREDENTIALS EXIST HERE by design — SEED_OWNER_PASSWORD is
// dev-only and the production password was never shared with this tooling. So
// the default target is dev, and pointing it at production requires passing
// credentials in deliberately.
//
//   node -r dotenv/config scripts/verify-driver-form.mjs
//   VERIFY_BASE=https://... VERIFY_EMAIL=... VERIFY_PASSWORD=... node ...
// ---------------------------------------------------------------------------

const BASE =
  process.env.VERIFY_BASE ?? 'https://zebra-dev.tajikcargollc.workers.dev'
const EMAIL = process.env.VERIFY_EMAIL ?? process.env.SEED_OWNER_EMAIL
const PASSWORD = process.env.VERIFY_PASSWORD ?? process.env.SEED_OWNER_PASSWORD

/** What the confirm form must hold, and what it must no longer hold. */
export const EXPECTED = [
  'companyId',
  'firstName',
  'lastName',
  'cdlExpiresAt',
  'payPercent',
]
export const GONE = ['status', 'assignedTruckId', 'notes', 'hireDate']

/**
 * The drop zone, found by the file input it wraps.
 *
 * NOT BY ITS HEADING and not by `aria-label`, both of which are translated.
 * The structural fact — a control that takes a file — is the thing the ruling
 * is about, and it is the same in every language.
 */
export const dropZone = (page) =>
  page.locator('[role="button"]:has(input[type="file"])')

const report = (ok, label, detail) => {
  console.log(`${ok ? 'ok  ' : 'FAIL'}  ${label}${detail ? `  ${detail}` : ''}`)
  return ok
}

/**
 * Stage 1 — the front door, before anything has been clicked.
 *
 * THE ABSENCE OF THE FORM IS AN ASSERTION, not an omission. "The upload zone
 * is the front door; the fields are the confirm step" is only true if the
 * fields are NOT here, and a check that merely looked for the drop zone would
 * pass on a page showing both.
 */
export async function checkLanding(page) {
  const zone = dropZone(page)
  const zoneCount = await zone.count()
  let ok = report(zoneCount === 1, 'drop zone present', `(found ${zoneCount})`)

  const accept =
    zoneCount > 0
      ? ((await zone
          .locator('input[type="file"]')
          .first()
          .getAttribute('accept')) ?? '')
      : ''
  ok =
    report(accept.includes('image/'), 'accepts images', accept || '(none)') &&
    ok
  ok =
    report(
      accept.includes('application/pdf'),
      'accepts PDF',
      accept || '(none)',
    ) && ok

  const selects = await page.locator('select').count()
  ok =
    report(selects >= 1, 'authority select present', `(found ${selects})`) && ok

  // The manual link is the drop zone's sibling — located by position rather
  // than by its words, for the same reason as the zone itself.
  const manual = zoneCount
    ? page.locator('[role="button"]:has(input[type="file"]) ~ button')
    : page.locator('__none__')
  const manualCount = zoneCount ? await manual.count() : 0
  ok =
    report(
      manualCount === 1,
      'manual-entry link present',
      `(found ${manualCount})`,
    ) && ok

  const forms = await page.locator('form').count()
  ok =
    report(
      forms === 0,
      'no form on the landing step',
      `(found ${forms}; the fields belong to the confirm step)`,
    ) && ok

  return { ok, manual }
}

/** Stage 2 — the confirm form, reached by the manual link. */
export async function checkConfirm(page, manual) {
  await manual.click()
  await page.waitForSelector('form', { timeout: 15_000 }).catch(() => {})

  const forms = await page.locator('form').count()
  let ok = report(forms === 1, 'confirm form appears', `(found ${forms})`)

  const names = await page
    .locator('form [name]')
    .evaluateAll((nodes) => nodes.map((n) => n.getAttribute('name')))
  const seen = [...new Set(names.filter(Boolean))]
  console.log(`\n  confirm form renders ${seen.length} named fields:`)
  console.log(`    ${seen.join(', ') || '(none)'}\n`)

  for (const name of EXPECTED) {
    ok = report(seen.includes(name), `expected present  ${name}`) && ok
  }
  for (const name of GONE) {
    ok = report(!seen.includes(name), `expected absent   ${name}`) && ok
  }

  const employment = await page
    .locator('select[name="employmentType"] option')
    .evaluateAll((nodes) => nodes.map((n) => n.textContent?.trim()))
  console.log(
    `\n  employmentType options: ${employment.join(' | ') || '(none)'}`,
  )

  return ok
}

export async function signIn(page, base = BASE) {
  await page.goto(`${base}/login`, { waitUntil: 'domcontentloaded' })
  await page.fill('input[name="email"]', EMAIL)
  await page.fill('input[name="password"]', PASSWORD)
  await page.click('button[type="submit"]')
  await page.waitForURL(/\/(loads|dashboard)/, { timeout: 60_000 })
  await page.goto(`${base}/drivers/new`, { waitUntil: 'networkidle' })
}

export async function launch() {
  return chromium.launch(
    process.env.SHOT_CHROME ? { executablePath: process.env.SHOT_CHROME } : {},
  )
}

if (
  process.argv[1] &&
  import.meta.url ===
    new URL(`file://${process.argv[1].replace(/\\/g, '/')}`).href
) {
  if (!EMAIL || !PASSWORD) {
    console.error(
      'Needs VERIFY_EMAIL and VERIFY_PASSWORD (or the SEED_OWNER_*).',
    )
    process.exit(1)
  }

  const browser = await launch()
  try {
    const page = await (await browser.newContext()).newPage()
    await signIn(page)

    console.log(`\n${BASE}/drivers/new — stage 1, the front door:`)
    const { ok: landingOk, manual } = await checkLanding(page)

    console.log('\nstage 2, after clicking the manual link:')
    const confirmOk = await checkConfirm(page, manual)

    process.exit(landingOk && confirmOk ? 0 : 3)
  } finally {
    await browser.close()
  }
}
