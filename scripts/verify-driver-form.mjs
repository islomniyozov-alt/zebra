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
// IT ASKS THE DOM FOR FIELD NAMES, NOT FOR LABELS. A label is translated and a
// screenshot is a picture; `input[name=...]` is the string the form will
// actually post, and it is the same string the field spec declares — so this
// compares the deployment against the source's own vocabulary rather than
// against what somebody expects to see.
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

if (!EMAIL || !PASSWORD) {
  console.error('Needs VERIFY_EMAIL and VERIFY_PASSWORD (or the SEED_OWNER_*).')
  process.exit(1)
}

/** What the form should hold after 774e731, and what it must no longer hold. */
const EXPECTED = [
  'companyId',
  'firstName',
  'lastName',
  'cdlExpiresAt',
  'payPercent',
]
const GONE = ['status', 'assignedTruckId', 'notes', 'hireDate']

const browser = await chromium.launch(
  process.env.SHOT_CHROME ? { executablePath: process.env.SHOT_CHROME } : {},
)

try {
  const page = await (await browser.newContext()).newPage()

  await page.goto(`${BASE}/login`, { waitUntil: 'domcontentloaded' })
  await page.fill('input[name="email"]', EMAIL)
  await page.fill('input[name="password"]', PASSWORD)
  await page.click('button[type="submit"]')
  await page.waitForURL(/\/(loads|dashboard)/, { timeout: 60_000 })

  await page.goto(`${BASE}/drivers/new`, { waitUntil: 'domcontentloaded' })

  const names = await page
    .locator('form [name]')
    .evaluateAll((nodes) => nodes.map((n) => n.getAttribute('name')))
  const seen = [...new Set(names.filter(Boolean))]

  console.log(`\n${BASE}/drivers/new renders ${seen.length} named fields:`)
  console.log(`  ${seen.join(', ')}\n`)

  let ok = true
  for (const name of EXPECTED) {
    const present = seen.includes(name)
    if (!present) ok = false
    console.log(`${present ? 'ok  ' : 'FAIL'}  expected present  ${name}`)
  }
  for (const name of GONE) {
    const present = seen.includes(name)
    if (present) ok = false
    console.log(`${present ? 'FAIL' : 'ok  '}  expected absent   ${name}`)
  }

  // The employment select's OPTIONS, since "Owned" was the complaint.
  const employment = await page
    .locator('select[name="employmentType"] option')
    .evaluateAll((nodes) => nodes.map((n) => n.textContent?.trim()))
  console.log(`\nemploymentType options: ${employment.join(' | ') || '(none)'}`)

  process.exit(ok ? 0 : 3)
} finally {
  await browser.close()
}
