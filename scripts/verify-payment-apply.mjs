import { chromium } from 'playwright'

// ---------------------------------------------------------------------------
// APPLYING A PAYMENT, ON THE DEPLOYED WORKER (§6.2.5).
//
//   node -r dotenv/config scripts/verify-payment-apply.mjs
//
// READ-ONLY ON PURPOSE. It opens the Payments grid, finds a payment with
// money left, opens it, and checks that the open-items form is THERE and
// carries what the ruling asked for: both kinds in one list, an amount box
// per row, and each box prefilled to that row's balance.
//
// IT DOES NOT PRESS APPLY. Applying moves money against real invoices on
// dev, and a verifier that spends its subject cannot be run twice. What it
// proves is the thing that was broken before: a surface reachable, rendered,
// and populated. The arithmetic is covered by the suite, and the refusal
// paths by the guards.
//
// ── WHY A FETCH AT ALL ───────────────────────────────────────────────────
//
// The statement PDF was complete, tested, and reached by a button pointing
// at the wrong renderer. A unit test proves a function; only a fetch proves
// the page a person actually lands on.
// ---------------------------------------------------------------------------

const BASE =
  process.env.SHOT_BASE ?? 'https://zebra-dev.tajikcargollc.workers.dev'

const browser = await chromium.launch(
  process.env.SHOT_CHROME ? { executablePath: process.env.SHOT_CHROME } : {},
)
const origin = new URL(BASE).origin
const context = await browser.newContext()
const page = await context.newPage()

await page.goto(`${BASE}/login`, { waitUntil: 'domcontentloaded' })
await page.fill('input[name="email"]', process.env.SEED_OWNER_EMAIL ?? '')
await page.fill('input[name="password"]', process.env.SEED_OWNER_PASSWORD ?? '')
await Promise.all([
  page.waitForURL(/\/(loads|dashboard)/, { timeout: 60_000 }),
  page.click('button[type="submit"]'),
])

let bad = 0

console.log('TABS')
for (const tab of ['payments', 'unapplied']) {
  const response = await context.request.get(
    `${origin}/accounting/payments?tab=${tab}`,
  )
  const ok = response.status() === 200
  if (!ok) bad += 1
  console.log(
    `  ${ok ? 'ok  ' : 'MISS'}  ${tab.padEnd(10)} ${response.status()}`,
  )
}

// A payment with money left. The Unapplied tab is exactly that population,
// so it is where one is looked for rather than filtering the full list here.
await page.goto(`${BASE}/accounting/payments?tab=unapplied`, {
  waitUntil: 'domcontentloaded',
})
await page.waitForTimeout(1500)
const ids = await page.evaluate(() =>
  [...document.querySelectorAll('a[href^="/payments/"]')]
    .map((a) => new URL(a.href).pathname.split('/').pop())
    // ROUTE SEGMENTS ARE NOT IDS. `/payments/new` and `/payments/import`
    // are nav links on the same page, and reporting them as payments with
    // "no open items" makes a clean run read like two failures.
    .filter((value) => value && !['new', 'import'].includes(value))
    .filter((value, index, all) => all.indexOf(value) === index)
    .slice(0, 8),
)

console.log('')
console.log(`UNAPPLIED PAYMENTS FOUND: ${ids.length}`)
if (ids.length === 0) {
  // NOT A PASS. No unapplied payment means the apply surface was never
  // rendered, and reporting OK here is how an empty screen ships.
  console.log('  NONE — THE APPLY SURFACE IS UNPROVEN, NOT PROVEN.')
  await browser.close()
  process.exit(1)
}

let proven = 0
const seen = { invoices: 0, loads: 0 }
for (const id of ids) {
  await page.goto(`${BASE}/payments/${id}`, { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(900)

  const found = await page.evaluate(() => {
    const boxes = [...document.querySelectorAll('input[name^="amount."]')]
    return {
      rows: boxes.length,
      invoices: boxes.filter((b) =>
        b.getAttribute('name').startsWith('amount.invoice.'),
      ).length,
      loads: boxes.filter((b) =>
        b.getAttribute('name').startsWith('amount.load.'),
      ).length,
      // PREFILLED IS THE CLAIM. An empty box would mean the form rendered
      // and the ruling's "prefilled to the balance" did not.
      blank: boxes.filter((b) => b.value.trim() === '').length,
      sample: boxes
        .slice(0, 3)
        .map((b) => `${b.getAttribute('name').split('.')[1]}=${b.value}`),
    }
  })

  if (found.rows === 0) {
    console.log(`  ${id}  no open items`)
    continue
  }
  const ok = found.blank === 0
  if (!ok) bad += 1
  else proven += 1
  console.log(
    `  ${ok ? 'ok  ' : 'MISS'}  ${id}  rows=${found.rows} ` +
      `(invoice ${found.invoices}, load ${found.loads})  blank=${found.blank}  ${found.sample.join(' ')}`,
  )
  seen.invoices += found.invoices
  seen.loads += found.loads
  if (proven > 0) break
}

await browser.close()
console.log('')
if (proven === 0) {
  console.log('NO PAYMENT HAD OPEN ITEMS — THE APPLY SURFACE IS UNPROVEN.')
  process.exit(1)
}
if (bad > 0) {
  console.log(`${bad} CHECKS FAILED — NOT OK.`)
  process.exit(1)
}
console.log('APPLY SURFACE RENDERS WITH PREFILLED OPEN ITEMS — OK.')
// WHICH KINDS WERE ACTUALLY SEEN, because "it rendered" and "both halves of
// it rendered" are different claims and only one of them is usually true.
// Dev has no unapplied payment belonging to a customer with open invoices,
// so the invoice half of the list may be unexercised — said out loud rather
// than left for somebody to infer from a count.
console.log(
  `KINDS SEEN: ${seen.invoices} invoice row(s), ${seen.loads} load row(s).`,
)
if (seen.invoices === 0) {
  console.log(
    'THE INVOICE HALF WAS NOT EXERCISED. No unapplied payment on this ' +
      'database belongs to a payer with open invoices.',
  )
}
