import { chromium } from 'playwright'

// ---------------------------------------------------------------------------
// THE LOADS LIST IN DATATRUCK'S SHAPE, IN A BROWSER (TMS-DESIGN-SYSTEM.md §6.7).
//
//   VERIFY_BASE=http://localhost:3100 node -r dotenv/config scripts/verify-loads-list.mjs
//
// What no unit test can see: that the copy button copies rather than opening
// the load, that a broker name opens the broker while the rest of the row opens
// the load, that the bar fits two rows at 1920, that the Filters popover and
// its typeahead write the URL, that the export downloads the view, that a row
// expands and its menu opens, and that a hidden column stays hidden across a
// reload. Defaults to dev's worker.
//
// IT CHANGES ONE THING AND PUTS IT BACK: the column step hides Truck, reloads,
// and restores it, and the density step does the same with density.
// ---------------------------------------------------------------------------

const BASE =
  process.env.VERIFY_BASE ?? 'https://zebra-dev.tajikcargollc.workers.dev'
const SHOTS = process.env.SHOT_DIR ?? null

const results = []
const record = (label, ok, detail = '') => {
  results.push({ label, ok })
  console.log(`${ok ? 'ok  ' : 'FAIL'}  ${label.padEnd(60)} ${detail}`)
}

const browser = await chromium.launch(
  process.env.SHOT_CHROME ? { executablePath: process.env.SHOT_CHROME } : {},
)
const context = await browser.newContext({
  viewport: { width: 1920, height: 1080 },
  permissions: ['clipboard-read', 'clipboard-write'],
  acceptDownloads: true,
})
const page = await context.newPage()

const openList = async (query = '') => {
  await page.goto(`${BASE}/loads${query}`, { timeout: 120_000 })
  await page.waitForSelector('table tbody tr', { timeout: 120_000 })
}
const headers = async () =>
  (await page.locator('thead th').allTextContents())
    .map((h) => h.trim())
    .filter((h) => h !== '')

try {
  await page.goto(`${BASE}/login`)
  await page.fill('input[name="email"]', process.env.SEED_OWNER_EMAIL)
  await page.fill('input[name="password"]', process.env.SEED_OWNER_PASSWORD)
  await page.click('button[type="submit"]')
  await page.waitForURL((url) => !url.pathname.startsWith('/login'), {
    timeout: 60_000,
  })

  await openList()
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/loads-list.png` })

  // ── the columns the owner named ───────────────────────────────────────
  const shown = await headers()
  record(
    'the default columns are the ruled ten',
    shown.length === 10,
    shown.join(' | '),
  )
  record('Pickup is shown', shown.includes('Pickup'))
  record(
    'Rate and Billing start hidden',
    !shown.includes('Rate') && !shown.includes('Billing'),
  )

  // ── the bar is two rows at 1920 ───────────────────────────────────────
  const bar = page.locator('[data-filter-bar]')
  const box = await bar.boundingBox()
  const rows = await bar.evaluate((el) =>
    [...el.children].map((child) => child.getBoundingClientRect().height),
  )
  const overflow = await bar.evaluate((el) => {
    const first = el.firstElementChild
    return first ? first.scrollWidth - first.clientWidth : -1
  })
  record(
    'the filter bar is two rows',
    rows.length === 2 && rows.every((h) => h <= 40),
    `bar ${Math.round(box?.height ?? 0)} px; rows ${rows.map(Math.round).join(' + ')} px`,
  )
  record(
    'row one does not overflow at 1920',
    overflow <= 0,
    `overflow ${overflow} px`,
  )

  // ── copy, and the broker link ─────────────────────────────────────────
  const firstRow = page.locator('table tbody tr').first()
  const number = (
    await firstRow.locator('.z-identifier').first().textContent()
  )?.trim()
  await firstRow.getByRole('button', { name: /^Copy load number/ }).click()
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

  const broker = firstRow.locator('a[href^="/brokers/"]').first()
  record('the broker cell is a link', (await broker.count()) === 1)
  if ((await broker.count()) === 1) {
    await broker.click()
    await page.waitForURL(/\/brokers\//, { timeout: 60_000 })
    record('clicking it opens the broker', /\/brokers\//.test(page.url()))
    await openList()
  }

  // ── 8: expand and the row menu ────────────────────────────────────────
  const row = page.locator('table tbody tr').first()
  await row.getByRole('button', { name: /^Show details/ }).click()
  const stops = page.getByRole('heading', { name: 'Stops' })
  await stops.waitFor({ timeout: 10_000 }).catch(() => {})
  record('the chevron opens the stops', await stops.isVisible())
  const notesSettled = page.getByText(/No notes on this load\.|·/).first()
  await notesSettled.waitFor({ timeout: 30_000 }).catch(() => {})
  record('the notes arrive when the row opens', await notesSettled.isVisible())
  record(
    'the expand does not open the load',
    new URL(page.url()).pathname === '/loads',
  )
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/loads-expanded.png` })

  await row.getByRole('button', { name: /^Load actions/ }).click()
  const items = await page.getByRole('menuitem').allTextContents()
  record(
    'the menu holds Open and Copy load number',
    items.includes('Open') && items.includes('Copy load number'),
    items.join(' | '),
  )
  await page.keyboard.press('Escape')

  // ── 6: the counted views write a NAME ─────────────────────────────────
  const unpaid = page.getByRole('button', { name: /^Unpaid/ })
  const unpaidLabel = (await unpaid.textContent()) ?? ''
  record('Unpaid carries a count', /\d/.test(unpaidLabel), unpaidLabel.trim())
  await unpaid.click()
  await page.waitForURL(/view=unpaid/, { timeout: 60_000 })
  record('Unpaid writes ?view=unpaid', /view=unpaid/.test(page.url()))

  // ── 7: the export is this view ────────────────────────────────────────
  await page.waitForSelector('table tbody tr', { timeout: 120_000 })
  const [download] = await Promise.all([
    page.waitForEvent('download', { timeout: 120_000 }),
    page.getByRole('link', { name: 'Export' }).click(),
  ])
  const name = download.suggestedFilename()
  record(
    'the export is named for the view and the day',
    /^zebra-loads-unpaid-\d{4}-\d{2}-\d{2}\.csv$/.test(name),
    name,
  )
  const path = await download.path()
  const { readFileSync } = await import('node:fs')
  const lines = readFileSync(path, 'utf8')
    .replace(/^﻿/, '')
    .split('\r\n')
    .filter((line) => line !== '')
  const footer =
    (await page
      .locator('nav[aria-label] p')
      .first()
      .textContent()
      .catch(() => null)) ?? ''
  const total = Number(
    (footer.match(/of ([\d,]+)/)?.[1] ?? '').replace(/,/g, ''),
  )
  const listed = total || (await page.locator('table tbody tr').count())
  record(
    'the export has a row per listed load',
    lines.length - 1 === listed && listed > 0,
    `${lines.length - 1} rows, list says ${listed}`,
  )
  record(
    'the export header is codes',
    lines[0]?.startsWith('load_number,reference') ?? false,
    lines[0] ?? '',
  )

  // ── the Filters popover: a preset, and the driver typeahead ──────────
  await openList()
  await page.getByRole('button', { name: /^Filters/ }).click()
  await page.getByRole('button', { name: 'Delivers this week' }).click()
  await page.waitForURL(/view=deliversThisWeek/, { timeout: 60_000 })
  record(
    'a preset in the popover writes the view',
    /view=deliversThisWeek/.test(page.url()),
  )
  const badge =
    (await page.getByRole('button', { name: /^Filters/ }).textContent()) ?? ''
  record('the Filters badge counts it', /Filters\s*1/.test(badge), badge.trim())

  await openList()
  await page.getByRole('button', { name: /^Filters/ }).click()
  const driverBox = page.getByRole('combobox', { name: 'Driver' })
  await driverBox.click()
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
    const driverName = ((await options.first().textContent()) ?? '').trim()
    await driverBox.fill(driverName.slice(0, 4))
    await page.keyboard.press('Enter')
    await page.waitForURL(/driver=/, { timeout: 60_000 })
    record(
      'choosing one writes ?driver=',
      /driver=/.test(page.url()),
      driverName,
    )
  }

  // ── 9: a hidden column stays hidden across a reload ───────────────────
  await openList()
  await page.getByRole('button', { name: 'Columns' }).click()
  await page.getByLabel('Truck', { exact: true }).uncheck()
  await page.getByRole('button', { name: 'Apply' }).click()
  await page.waitForTimeout(1500)
  await openList()
  record(
    'a hidden column stays hidden after a reload',
    !(await headers()).includes('Truck'),
  )
  // And put it back, so the walk leaves the account as it found it.
  await page.getByRole('button', { name: 'Columns' }).click()
  await page.getByLabel('Truck', { exact: true }).check()
  await page.getByRole('button', { name: 'Apply' }).click()
  await page.waitForTimeout(1500)
  await openList()
  record('and comes back when restored', (await headers()).includes('Truck'))

  // ── 9: density survives a reload ──────────────────────────────────────
  const density = page.locator('select#density')
  const before = await density.inputValue()
  const other = before === 'comfortable' ? 'compact' : 'comfortable'
  await density.selectOption(other)
  await page.waitForTimeout(1500)
  await openList()
  record(
    'density survives a reload',
    (await density.inputValue()) === other,
    `${before} → ${other}`,
  )
  await density.selectOption(before)
  await page.waitForTimeout(1500)
} catch (error) {
  record('the walk finished', false, String(error).slice(0, 200))
} finally {
  await browser.close()
}

const failed = results.filter((entry) => !entry.ok).length
console.log(
  failed === 0
    ? `\nALL ${results.length} CHECKS OK.`
    : `\n${failed} OF ${results.length} CHECKS FAILED — NOT OK.`,
)
process.exit(failed === 0 ? 0 : 1)
