import { createRequire } from 'node:module'
import { rayOf, startTail, trimEvent, workerNameFor } from './worker-tail.mjs'

// ---------------------------------------------------------------------------
// DOES THE DEV WORKER'S PASSWORD-RESET MAIL ACTUALLY LEAVE? (GAPS 41)
//
//   node -r dotenv/config scripts/verify-reset-mail.mjs
//
// The reset screen says the same sentence whether or not a mail was sent —
// deliberately, so it is not an account-enumeration oracle — which means the
// ONLY witness to "the mail left" is the worker's own log line:
// `[zebra.email] sent {to, id}`. This starts a bounded tail on the dev worker
// (through `startTail`, which refuses production), proves the tail sees
// requests, submits the reset form for the seed owner's address, and prints
// every `[zebra.email]` / `[zebra.reset]` line the invocation logged. OK only
// if a `sent` line is among them; no line at all is NOT OK, never silence.
//
// WRITTEN AFTER THE FIRST READING WAS "[object Object]". On 2026-11-05 dev's
// `RESEND_API_KEY` had been set and the probe logged "Resend refused the
// message" with its detail flattened by the capture; the second probe, with
// `logPart` serialising objects, read `{"status":401,"body":"API key is
// invalid"}`. A verdict here is that line, quoted — not the screen.
//
// Needs SEED_OWNER_EMAIL (the address Resend's shared sender may deliver to)
// and SHOT_CHROME, as the other probes do. One request per run: the reset
// ledger rate-limits five per address per fifteen minutes.
// ---------------------------------------------------------------------------

const BASE =
  process.env.VERIFY_BASE ?? 'https://zebra-dev.tajikcargollc.workers.dev'
const EMAIL = process.env.VERIFY_EMAIL ?? process.env.SEED_OWNER_EMAIL
const TAIL_MAX_MS = 90_000

if (!EMAIL) {
  console.error('NOT OK: SEED_OWNER_EMAIL (or VERIFY_EMAIL) is not set.')
  process.exit(2)
}
const worker = workerNameFor(BASE)
if (!worker) {
  console.error(`NOT OK: ${BASE} is not a workers.dev origin.`)
  process.exit(2)
}

const require = createRequire(import.meta.url)
const { chromium } = require('playwright')

const tail = startTail(worker, { maxMs: TAIL_MAX_MS })
if (tail.failure()) {
  console.error(`NOT OK: ${tail.failure()}`)
  process.exit(1)
}
if (!(await tail.ready(new URL('/login', BASE)))) {
  console.error(
    `NOT OK: ${tail.failure() ?? 'the canary never came back through the tail'}`,
  )
  tail.stop()
  process.exit(1)
}

const browser = await chromium.launch(
  process.env.SHOT_CHROME ? { executablePath: process.env.SHOT_CHROME } : {},
)
try {
  const page = await browser.newPage()
  await page.goto(`${BASE}/reset-password`, { waitUntil: 'networkidle' })
  await page.fill('input[name="email"]', EMAIL)
  await page.click('button[type="submit"]')
  await page.waitForTimeout(6_000)
  const text = (await page.textContent('body'))?.replace(/\s+/g, ' ') ?? ''
  console.log(
    `reset requested on ${BASE}; the screen says ${
      text.includes('on its way')
        ? 'its usual sentence'
        : JSON.stringify(text.slice(0, 160))
    }`,
  )
} finally {
  await browser.close()
}

// The log line can trail the response by a few seconds.
await new Promise((resolve) => setTimeout(resolve, 12_000))
tail.stop()

const lines = []
for (const raw of tail.all()) {
  const event = trimEvent(raw)
  for (const log of event.logs ?? [])
    if (/\[zebra\.(email|reset)\]/.test(log.message))
      lines.push({ ray: rayOf(raw), level: log.level, message: log.message })
}

if (lines.length === 0) {
  console.log(
    `NOT OK: the tail saw ${tail.all().length} event(s) and no [zebra.email] or [zebra.reset] line. THIS IS NOT A REPORT THAT THE MAIL LEFT.`,
  )
  process.exit(1)
}
for (const line of lines)
  console.log(
    `  ${String(line.level).padEnd(5)} ${line.message.slice(0, 600)}  (ray ${line.ray ?? '?'})`,
  )

const sent = lines.some((line) => line.message.startsWith('[zebra.email] sent'))
console.log(
  sent
    ? 'DEV RESET MAIL — OK: the worker logged a sent line with Resend’s id.'
    : 'DEV RESET MAIL — NOT OK: the worker logged no sent line; read the refusal above.',
)
process.exit(sent ? 0 : 1)
