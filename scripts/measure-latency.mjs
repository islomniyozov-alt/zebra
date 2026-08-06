// ---------------------------------------------------------------------------
// ROUND-TRIP LATENCY, for the Smart Placement before/after.
//
// The thing being measured is not CPU. Step 1 settled that: a login costs
// ~650ms of CPU and ~5s of wall clock, and the gap is Neon round trips from
// wherever Cloudflare happened to run the worker to us-east-2. Smart Placement
// moves the worker toward the backend, trading one client hop for several
// database hops.
//
// So this measures whole-request wall clock from the client, on pages that do
// real database work, and reports the median rather than a single sample —
// one number off a network this variable is not a measurement.
//
//   SHOT_CHROME=... node -r dotenv/config scripts/measure-latency.mjs [label]
// ---------------------------------------------------------------------------

const BASE =
  process.env.VERIFY_BASE ?? 'https://zebra-dev.tajikcargollc.workers.dev'
const LABEL = process.argv[2] ?? 'run'
const SAMPLES = Number(process.env.SAMPLES ?? 9)

const { chromium } = await import('playwright')
const browser = await chromium.launch(
  process.env.SHOT_CHROME ? { executablePath: process.env.SHOT_CHROME } : {},
)
const context = await browser.newContext()
const page = await context.newPage()

await page.goto(new URL('/login', BASE).href, { waitUntil: 'domcontentloaded' })
await page.fill('input[name="email"]', process.env.SEED_OWNER_EMAIL)
await page.fill('input[name="password"]', process.env.SEED_OWNER_PASSWORD)
await Promise.all([
  page.waitForURL(/\/(loads|dashboard)/, { timeout: 60_000 }),
  page.click('button[type="submit"]'),
])
const cookie = (await context.cookies()).find((c) => c.name === 'zebra_session')
await browser.close()

const headers = { cookie: `zebra_session=${cookie.value}` }

const median = (values) => {
  const sorted = [...values].sort((a, b) => a - b)
  const middle = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 0
    ? Math.round((sorted[middle - 1] + sorted[middle]) / 2)
    : sorted[middle]
}

// Each of these opens a transaction and runs two or more queries, so each one
// pays the worker→Neon round trip several times over. `/login` is the outlier
// on purpose: it also pays for an argon2id verify, which placement cannot help.
const PAGES = [
  ['/trucks', headers],
  ['/drivers', headers],
  ['/brokers', headers],
  ['/loads', headers],
  ['/login', {}],
]

console.log(`\n${LABEL} — median of ${SAMPLES} samples, ${BASE}\n`)

for (const [path, requestHeaders] of PAGES) {
  const timings = []
  for (let i = 0; i < SAMPLES; i++) {
    const started = Date.now()
    const response = await fetch(new URL(path, BASE), {
      headers: requestHeaders,
      redirect: 'manual',
    })
    await response.arrayBuffer()
    timings.push(Date.now() - started)
  }
  const sorted = [...timings].sort((a, b) => a - b)
  console.log(
    `${path.padEnd(10)} median ${String(median(timings)).padStart(5)}ms` +
      `   min ${String(sorted[0]).padStart(5)}ms` +
      `   max ${String(sorted[sorted.length - 1]).padStart(5)}ms`,
  )
}
