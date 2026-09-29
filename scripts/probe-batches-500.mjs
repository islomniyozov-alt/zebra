import { chromium } from 'playwright'

// ---------------------------------------------------------------------------
// THE 500 ON `/payroll/batches`, HUNTED RATHER THAN ASSUMED.
//
//   node -r dotenv/config scripts/probe-batches-500.mjs
//
// One shot returned 500 on 2026-09-29 — the first request against a worker
// seconds after a deploy — and the same URL returned 200 later in that same
// run. Twenty-six shots passed on a second pass. So it is either a cold start
// or something rarer, and "it went away" is not an explanation.
//
// ── WHAT THIS DOES THAT THE SCREENSHOT RUN DOES NOT ───────────────────────
//
// Hits the page N times in a row and reports EVERY status, not the last one. A
// run that reports only its final state cannot tell "fixed" from "intermittent",
// which is the distinction the whole exercise is about.
//
// IT FAILS ON ANY NON-200. Not on a majority, not on the last — one 500 in
// thirty is the thing being looked for, and a probe that averaged it away would
// be the instrument agreeing with the hope.
// ---------------------------------------------------------------------------

const BASE =
  process.env.SHOT_BASE ?? 'https://zebra-dev.tajikcargollc.workers.dev'
const PATH = process.env.PROBE_PATH ?? '/payroll/batches'
const ROUNDS = Number(process.env.PROBE_ROUNDS ?? 12)

const browser = await chromium.launch(
  process.env.SHOT_CHROME ? { executablePath: process.env.SHOT_CHROME } : {},
)
const origin = new URL(BASE).origin

async function signIn() {
  if (process.env.SHOT_TOKEN) return process.env.SHOT_TOKEN
  const context = await browser.newContext()
  const page = await context.newPage()
  await page.goto(`${BASE}/login`, { waitUntil: 'domcontentloaded' })
  await page.fill('input[name="email"]', process.env.SEED_OWNER_EMAIL ?? '')
  await page.fill(
    'input[name="password"]',
    process.env.SEED_OWNER_PASSWORD ?? '',
  )
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

const token = await signIn()
if (!token) {
  console.error('NO SESSION.')
  await browser.close()
  process.exit(1)
}

const context = await browser.newContext()
await context.addCookies([{ name: 'zebra_session', value: token, url: origin }])

const statuses = []
for (let round = 0; round < ROUNDS; round++) {
  const page = await context.newPage()
  const started = Date.now()
  let status = 0
  try {
    const response = await page.goto(`${BASE}${PATH}`, {
      waitUntil: 'domcontentloaded',
      timeout: 60_000,
    })
    status = response?.status() ?? 0
  } catch (error) {
    status = -1
    console.log(`  round ${round + 1}: threw — ${String(error).slice(0, 120)}`)
  }
  const took = Date.now() - started
  statuses.push(status)
  console.log(`round ${String(round + 1).padStart(2)}: ${status}  ${took}ms`)
  await page.close()
}

await context.close()
await browser.close()

const bad = statuses.filter((status) => status !== 200)
console.log('')
if (bad.length > 0) {
  console.log(`${bad.length} OF ${ROUNDS} NOT 200: ${bad.join(', ')} — NOT OK.`)
  process.exit(1)
}
console.log(`ALL ${ROUNDS} RETURNED 200 — OK.`)
