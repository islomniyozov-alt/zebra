import { chromium } from 'playwright'

// ---------------------------------------------------------------------------
// THE LOADS LIST IN DATATRUCK'S SHAPE, IN A BROWSER (TMS-DESIGN-SYSTEM.md §6.7).
//
//   VERIFY_BASE=http://localhost:3100 node -r dotenv/config scripts/verify-loads-list.mjs
//
// What no unit test can see: that the copy button copies rather than opening
// the load, that a broker name opens the broker while the rest of the row opens
// the load, that the typeahead fills from the server on focus and writes the
// URL, and that the new chips write a named view. Defaults to dev's worker.
//
// READ ONLY. It signs in as the seed owner and clicks; it changes nothing.
// ---------------------------------------------------------------------------

const BASE =
  process.env.VERIFY_BASE ?? 'https://zebra-dev.tajikcargollc.workers.dev'
const SHOTS = process.env.SHOT_DIR ?? null

const results = []
const record = (label, ok, detail = '') => {
  results.push({ label, ok })
  console.log(`${ok ? 'ok  ' : 'FAIL'}  ${label.padEnd(56)} ${detail}`)
}

const browser = await chromium.launch(
  process.env.SHOT_CHROME ? { executablePath: process.env.SHOT_CHROME } : {},
)
const context = await browser.newContext({
  viewport: { width: 1920, height: 1080 },
  permissions: ['clipboard-read', 'clipboard-write'],
})
const page = await context.newPage()

try {
  await page.goto(`${BASE}/login`)
  await page.fill('input[name="email"]', process.env.SEED_OWNER_EMAIL)
  await page.fill('input[name="password"]', process.env.SEED_OWNER_PASSWORD)
  await page.click('button[type="submit"]')
  await page.waitForURL((url) => !url.pathname.startsWith('/login'), {
    timeout: 60_000,
  })

  await page.goto(`${BASE}/loads`, { timeout: 120_000 })
  await page.waitForSelector('table tbody tr', { timeout: 120_000 })
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/loads-list.png` })

  // ── 5 and 3: the new columns are there ────────────────────────────────
  const headers = await page.locator('thead th').allTextContents()
  record(
    'DEL date is a column',
    headers.some((h) => h.includes('DEL date')),
  )
  record(
    'Driver is a column',
    headers.some((h) => h.includes('Driver')),
  )
  record(
    'nine columns or fewer',
    headers.filter((h) => h.trim() !== '').length <= 9,
    `${headers.filter((h) => h.trim() !== '').length} headers`,
  )

  // ── 4: the copy button copies and does not open the load ──────────────
  const firstRow = page.locator('table tbody tr').first()
  const number = (
    await firstRow.locator('.z-identifier').first().textContent()
  )?.trim()
  await firstRow.getByRole('button', { name: /Copy load number/ }).click()
  const toast = page.getByText(`Load ${number} copied`)
  await toast.waitFor({ timeout: 10_000 }).catch(() => {})
  record(
    'copy shows the toast',
    await toast.isVisible(),
    `"Load ${number} copied"`,
  )
  record(
    'copy does not open the load',
    new URL(page.url()).pathname === '/loads',
  )
  const clipboard = await page.evaluate(() => navigator.clipboard.readText())
  record('the clipboard holds the load number', clipboard === number, clipboard)

  // ── 3: the broker name opens the broker ───────────────────────────────
  const broker = firstRow.locator('a[href^="/brokers/"]').first()
  record('the broker cell is a link', (await broker.count()) === 1)
  if ((await broker.count()) === 1) {
    await broker.click()
    await page.waitForURL(/\/brokers\//, { timeout: 60_000 })
    record('clicking it opens the broker', /\/brokers\//.test(page.url()))
    await page.goBack()
    await page.waitForSelector('table tbody tr', { timeout: 120_000 })
  }

  // ── 6: the counted views write a NAME ─────────────────────────────────
  const unpaid = page.getByRole('button', { name: /^Unpaid/ })
  const unpaidLabel = (await unpaid.textContent()) ?? ''
  record('Unpaid carries a count', /\d/.test(unpaidLabel), unpaidLabel.trim())
  await unpaid.click()
  await page.waitForURL(/view=unpaid/, { timeout: 60_000 })
  record('Unpaid writes ?view=unpaid', /view=unpaid/.test(page.url()))
  const upcoming = page.getByRole('button', { name: /^Upcoming/ })
  record(
    'Upcoming carries a count',
    /\d/.test((await upcoming.textContent()) ?? ''),
  )

  // ── 1: a preset clears the other view ─────────────────────────────────
  await page.getByRole('button', { name: 'Delivers this week' }).click()
  await page.waitForURL(/view=deliversThisWeek/, { timeout: 60_000 })
  record(
    'a date preset replaces the view',
    /view=deliversThisWeek/.test(page.url()) && !/view=unpaid/.test(page.url()),
  )

  // ── 2: the driver typeahead fills on focus and writes ?driver= ───────
  await page.goto(`${BASE}/loads`, { timeout: 120_000 })
  const driverBox = page.getByRole('combobox', { name: 'Driver' })
  await driverBox.click()
  // SCOPED TO THE LISTBOX. The page has native <option>s too (the range's
  // select), and the first unscoped run typed "Pick" into the driver box.
  const options = page
    .getByRole('listbox', { name: 'Driver' })
    .getByRole('option')
  await options
    .first()
    .waitFor({ timeout: 30_000 })
    .catch(() => {})
  const count = await options.count()
  record('the driver list arrives on focus', count > 0, `${count} shown`)
  if (count > 0) {
    const name = ((await options.first().textContent()) ?? '').trim()
    await driverBox.fill(name.slice(0, 4))
    await page.keyboard.press('Enter')
    await page.waitForURL(/driver=/, { timeout: 60_000 })
    record('choosing one writes ?driver=', /driver=/.test(page.url()), name)
    await page.waitForSelector('table', { timeout: 120_000 })
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/loads-driver.png` })
  }
} catch (error) {
  record('the walk finished', false, String(error).slice(0, 200))
} finally {
  await browser.close()
}

const failed = results.filter((row) => !row.ok).length
console.log(
  failed === 0
    ? `\nALL ${results.length} CHECKS OK.`
    : `\n${failed} OF ${results.length} CHECKS FAILED — NOT OK.`,
)
process.exit(failed === 0 ? 0 : 1)
