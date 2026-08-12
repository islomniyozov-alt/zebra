import { chromium } from 'playwright'
import { neonConfig, Pool } from '@neondatabase/serverless'

// ---------------------------------------------------------------------------
// THE TWO MEASUREMENTS §9 AND RULE 10 OWE.
//
//   1. The deployed createLoad save round trip. Client wall clock here; the
//      worker's CPU and wall come from `wrangler tail` running alongside.
//   2. The forty-second keyboard-only repeat load — no mouse, tab order only,
//      timed from the first keystroke to the load existing.
//
// A REPEAT load, per §9: the broker, both places, the truck and the driver all
// already exist, and the authority defaults to last-used. That is the load a
// dispatcher actually books at 6am, and the one the target is written against.
// The first run below is deliberately a COLD load — new broker, new places —
// so the difference between "create-on-miss" and "pick from the list" is
// visible rather than assumed.
//
//   SHOT_CHROME=... node -r dotenv/config scripts/time-create-load.mjs
// ---------------------------------------------------------------------------

const BASE =
  process.env.VERIFY_BASE ?? 'https://zebra-dev.tajikcargollc.workers.dev'
const TAG = `T${Date.now().toString(36).slice(-4).toUpperCase()}`

neonConfig.webSocketConstructor ??= WebSocket
neonConfig.poolQueryViaFetch = false
const pool = new Pool({ connectionString: process.env.DIRECT_DATABASE_URL })

const loadCount = async () =>
  Number((await pool.query('select count(*)::int n from "Load"')).rows[0].n)

const browser = await chromium.launch(
  process.env.SHOT_CHROME ? { executablePath: process.env.SHOT_CHROME } : {},
)
const context = await browser.newContext({
  viewport: { width: 1920, height: 1080 },
})
const page = await context.newPage()

await page.goto(`${BASE}/login`, { waitUntil: 'domcontentloaded' })
await page.fill('input[name="email"]', process.env.SEED_OWNER_EMAIL)
await page.fill('input[name="password"]', process.env.SEED_OWNER_PASSWORD)
await Promise.all([
  page.waitForURL(/\/(loads|dashboard)/, { timeout: 60_000 }),
  page.click('button[type="submit"]'),
])

// --- fixtures: a truck and a driver to pick, created through the UI ---------
for (const [path, fields] of [
  ['/trucks/new', { unitNumber: `${TAG}-101` }],
  ['/drivers/new', { firstName: 'Repeat', lastName: TAG }],
]) {
  await page.goto(`${BASE}${path}`, { waitUntil: 'domcontentloaded' })
  for (const [name, value] of Object.entries(fields)) {
    await page.fill(`input[name="${name}"]`, value)
  }
  await Promise.all([
    page.waitForURL(/\/(trucks|drivers)(\?|$)/, { timeout: 60_000 }),
    page.click('form button[type="submit"]'),
  ])
}

/**
 * Fill and save the form using ONLY the keyboard.
 *
 * `page.keyboard` throughout — no click, no fill, no selectOption. Tab moves
 * between fields in the order the form declares them, which is the point: if
 * the tab order is wrong the run is slow, and that is the measurement.
 */
/** Whatever the form is saying went wrong, from either error slot. */
async function formError(page) {
  const texts = await page
    .locator('[role="alert"], p.text-danger')
    .allTextContents()
  const message = texts
    .map((t) => t.trim())
    .filter(Boolean)
    .join(' | ')
  return message || '(the form reported nothing)'
}

async function keyboardRun(label, { broker, from, to, pickDay, dropDay }) {
  await page.goto(`${BASE}/loads/new`, { waitUntil: 'domcontentloaded' })
  await page.waitForSelector('select[name="companyId"]')

  const before = await loadCount()
  const started = Date.now()

  // Authority is already focused (autoFocus) and already correct (last-used).
  await page.keyboard.press('Tab') // → broker
  await page.keyboard.type(broker)
  await page.keyboard.press('Tab') // → truck
  await page.keyboard.press('ArrowDown') // first real option
  await page.keyboard.press('Tab') // → driver
  await page.keyboard.press('ArrowDown')
  // THE STOP LIST, since Phase 6 §4 step 1. Each stop is place -> type ->
  // date, so a two-stop load costs two more tab stops than the old pair of
  // places followed by the pair of dates. The type select is LEFT ALONE on the
  // way past — its default is right for the ordinary load, and a typist who
  // needs to change it arrives at it deliberately. Counted here rather than
  // designed around: that is what the before/after measurement is for.
  await page.keyboard.press('Tab') // → stop 1 place
  await page.keyboard.type(from)
  await page.keyboard.press('Tab') // → stop 1 type
  await page.keyboard.press('Tab') // → stop 1 date
  await page.keyboard.type(pickDay)
  await page.keyboard.press('Tab') // → stop 1 window from
  await page.keyboard.press('Tab') // → stop 1 window to
  await page.keyboard.press('Tab') // → stop 2 place
  await page.keyboard.type(to)
  await page.keyboard.press('Tab') // → stop 2 type
  await page.keyboard.press('Tab') // → stop 2 date
  await page.keyboard.type(dropDay)
  await page.keyboard.press('Tab') // → stop 2 window from
  await page.keyboard.press('Tab') // → stop 2 window to
  await page.keyboard.press('Tab') // → miles
  await page.keyboard.type('1080')
  await page.keyboard.press('Tab') // → rate
  await page.keyboard.type('2450')

  const typedAt = Date.now()

  // Read the form back before submitting. A date input takes typed digits in
  // the BROWSER's locale, not the string handed to it, and a date that silently
  // did not land produces a load with no window — which `overlaps()` treats as
  // "could be anywhere", so every later load collides with it. Asserting the
  // input holds what was meant is the difference between measuring the form and
  // measuring a typo.
  const filled = await page.evaluate(() =>
    Object.fromEntries(
      ['stops[0].date', 'stops[1].date', 'miles', 'rate', 'broker'].map(
        (name) => [
          name,
          document.querySelector(`[name="${name}"]`)?.value ?? '',
        ],
      ),
    ),
  )
  if (!filled['stops[0].date'] || !filled['stops[1].date']) {
    console.log(`  ! dates did not land: ${JSON.stringify(filled)}`)
  }

  // Ctrl+Enter saves from anywhere (§7.6). No tabbing to the button.
  await page.keyboard.press('Control+Enter')

  await page.waitForFunction(
    (n) => {
      void n
      return !document.querySelector('button[type="submit"][disabled]')
    },
    null,
    { timeout: 60_000 },
  )
  // The load existing is the finish line, not the spinner stopping.
  const deadline = Date.now() + 60_000
  let after = before
  while (after === before && Date.now() < deadline) {
    after = await loadCount()
  }
  const finished = Date.now()

  // A run that did not save has to say WHY. The first version of this script
  // printed "NOT SAVED" and nothing else, which sent me looking at the save
  // path when the answer — §8 refusing an overlapping load — was on screen
  // the whole time.
  const refusal = after > before ? '' : await formError(page)

  if (process.env.DEBUG_STOPS) {
    const { rows } = await pool.query(
      `select l."loadNumber", s.sequence, s.type, s."scheduledAt"
         from "LoadStop" s join "Load" l on l.id = s."loadId"
        order by l."loadNumber", s.sequence`,
    )
    console.log('  stored stops:', JSON.stringify(rows))
    console.log('  form held:   ', JSON.stringify(filled))
  }

  console.log(
    `${label.padEnd(22)} typing ${String(typedAt - started).padStart(5)}ms` +
      `   save ${String(finished - typedAt).padStart(5)}ms` +
      `   TOTAL ${String(finished - started).padStart(5)}ms` +
      `   ${after > before ? 'saved' : `NOT SAVED — ${refusal}`}`,
  )
  return {
    total: finished - started,
    save: finished - typedAt,
    saved: after > before,
  }
}

console.log(`\nkeyboard-only runs against ${BASE}\n`)

// A repeat load is the same lane and broker NEXT WEEK, not the same truck on
// the same days. The first version of this script booked identical dates three
// times and the §8 overlap rule refused runs two and three — correctly. The
// measurement was wrong, not the application.
const lane = {
  broker: `Meridian ${TAG}`,
  from: 'Chicago, IL',
  to: 'Dallas, TX',
}

// Cold: broker and both places do not exist, so all three are created on miss.
const cold = await keyboardRun('cold (create-on-miss)', {
  ...lane,
  pickDay: '803',
  dropDay: '805',
})

// Repeat: everything is now in the lists. This is the §9 target.
const repeat = await keyboardRun('REPEAT (§9 target)', {
  ...lane,
  pickDay: '810',
  dropDay: '812',
})
const repeat2 = await keyboardRun('repeat again', {
  ...lane,
  pickDay: '817',
  dropDay: '819',
})

console.log(
  `\n§9 target: a repeat load under 40s, keyboard only — ` +
    `${(Math.min(repeat.total, repeat2.total) / 1000).toFixed(1)}s best, ` +
    `${(Math.max(repeat.total, repeat2.total) / 1000).toFixed(1)}s worst. ` +
    `${Math.max(repeat.total, repeat2.total) < 40_000 ? 'MET' : 'NOT MET'}`,
)
console.log(
  `save round trip (client wall): cold ${cold.save}ms, repeat ${repeat.save}ms, ${repeat2.save}ms`,
)

await browser.close()

// --- clean up: §12, nothing invented stays behind --------------------------
const loads = await pool.query(
  `select id from "Load" where "customerId" in (select id from "Customer" where name like $1)`,
  [`Meridian ${TAG}%`],
)
for (const { id } of loads.rows) {
  await pool.query('delete from "LoadStatusEvent" where "loadId" = $1', [id])
  await pool.query('delete from "LoadStop" where "loadId" = $1', [id])
  await pool.query('delete from "Document" where "loadId" = $1', [id])
  await pool.query('delete from "AuditLog" where "entityId" = $1', [id])
  await pool.query('delete from "Load" where id = $1', [id])
}
await pool.query('delete from "Customer" where name like $1', [
  `Meridian ${TAG}%`,
])
await pool.query(
  `delete from "AssetAssignment" where "truckId" in (select id from "Truck" where "unitNumber" like $1)
     or "driverId" in (select id from "Driver" where "lastName" = $2)`,
  [`${TAG}%`, TAG],
)
await pool.query('delete from "Truck" where "unitNumber" like $1', [`${TAG}%`])
await pool.query('delete from "Driver" where "lastName" = $1', [TAG])
await pool.query('delete from "Location" where name in ($1, $2)', [
  'Chicago, IL',
  'Dallas, TX',
])

console.log(`\nloads remaining: ${await loadCount()}`)
await pool.end()
