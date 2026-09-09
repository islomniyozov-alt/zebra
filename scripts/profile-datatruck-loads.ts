import { readFileSync } from 'node:fs'
import { asRecords, readXlsx } from '@/lib/datatruck/xlsx'
import { planDrivers } from '@/lib/datatruck/drivers'
import { planTrucks } from '@/lib/datatruck/trucks'

// ---------------------------------------------------------------------------
// WHAT IS ACTUALLY IN THE LOAD HISTORY, MEASURED BEFORE ANYTHING IS DESIGNED.
//
//   npx tsx scripts/profile-datatruck-loads.ts [path.xlsx]
//
// A PROFILER, NOT A SEEDER. It opens the export, counts, and touches no
// database at all — it does not read a connection string and there is no
// `--write` to add later. When the seeder is designed it gets its own file, so
// that nothing which can write shares a process with something whose whole job
// is to be run casually and often.
//
// ── WHERE THE ROSTER COMES FROM, AND WHY THAT IS A CAVEAT ────────────────
//
// "Does this load name a driver we have?" is a question about PRODUCTION rows.
// This script cannot ask production — reading that connection string is an
// allowlisted act (`tests/prod-url-guard.test.ts`) and a profiler has no
// business on that list. So it asks the SEED SOURCE instead: the same two
// exports, through the same `planDrivers`/`planTrucks` the seeders used, which
// is deterministic and is what produced those rows.
//
// THAT IS A PROXY AND IT IS NAMED AS ONE. It differs from production wherever
// the seed run differed from its plan — trucks HELD by a schema constraint,
// rows created by hand before the seed. The truck side is known to differ by
// at least one row (a hand-made `1024`), and the report says so rather than
// presenting a plan as a census.
//
// IT REPORTS SHAPE, NOT CONTENT. Distinct values are printed in full for the
// small controlled vocabularies a schema has to cover — statuses, authorities,
// payment types. Customers are counted and the top few named, because 14,451
// rows of counterparty names is content. Nothing personal is printed: the
// driver and truck sections print COUNTS and the unmatched NAMES only, which
// are the ones that have to be seeded and so have to be readable.
// ---------------------------------------------------------------------------

const DEFAULT_EXPORT =
  'corpus/datatruck/loads-and-trips_2026_09_08_20_05_05.xlsx'
const DRIVER_EXPORT = 'corpus/datatruck/drivers_2026_09_07_10_11_36.xlsx'
const TRUCK_EXPORT = 'corpus/datatruck/trucks_2026_09_04_15_56_32.xlsx'

const FILE =
  process.argv.slice(2).find((argument) => argument.endsWith('.xlsx')) ??
  DEFAULT_EXPORT

const rule = (title: string) =>
  console.log(`\n── ${title} ${'─'.repeat(Math.max(0, 70 - title.length))}`)

// ── DATES ARE PARSED, NEVER HANDED TO `new Date` ──────────────────────────
//
// The same rule `med-dates.ts` states: `new Date("Sep 09, 2026")` happens to
// work in V8 and is not a contract, and the failure mode of a date that parses
// wrongly is a load filed in the wrong year rather than an error. The format
// here is Datatruck's own — `Mon DD, YYYY` with an optional `, HH:MM` — so it
// is matched literally and anything else is counted as unparsed.
const MONTHS: Record<string, number> = {
  Jan: 1,
  Feb: 2,
  Mar: 3,
  Apr: 4,
  May: 5,
  Jun: 6,
  Jul: 7,
  Aug: 8,
  Sep: 9,
  Oct: 10,
  Nov: 11,
  Dec: 12,
}

/** `Sep 09, 2026` or `Sep 08, 2026, 18:13` → `2026-09-09`. Null if it is not that. */
function isoDate(text: string): string | null {
  const match = /^([A-Z][a-z]{2}) (\d{2}), (\d{4})(?:, (\d{2}):(\d{2}))?$/.exec(
    text.trim(),
  )
  if (!match) return null
  const month = MONTHS[match[1]!]
  if (!month) return null
  return `${match[3]}-${String(month).padStart(2, '0')}-${match[2]}`
}

/** A decimal string of dollars as integer cents. Null if it will not convert. */
function cents(text: string): number | null {
  const trimmed = text.trim()
  if (trimmed === '') return null
  if (!/^-?\d+(\.\d+)?$/.test(trimmed)) return null
  return Math.round(Number(trimmed) * 100)
}

function tally<T>(values: readonly T[]): Map<T, number> {
  const counts = new Map<T, number>()
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1)
  return new Map([...counts].sort((a, b) => b[1] - a[1]))
}

function printTally(counts: Map<string, number>, limit = Infinity) {
  let shown = 0
  for (const [value, count] of counts) {
    if (shown++ >= limit) {
      console.log(`  … and ${counts.size - limit} more`)
      break
    }
    console.log(
      `  ${String(count).padStart(6)}  ${value === '' ? '(blank)' : value}`,
    )
  }
}

const rows = await readXlsx(new Uint8Array(readFileSync(FILE)))
const header = rows[0] ?? []
const records = asRecords(rows)
const get = (record: Record<string, string>, column: string) =>
  (record[column] ?? '').trim()

console.log(`file    ${FILE}`)
console.log(`rows    ${records.length} data row(s), ${header.length} column(s)`)

rule('HEADERS, EXACTLY AS WRITTEN, WITH POPULATED COUNTS')
header.forEach((name, index) => {
  const populated = records.filter((r) => get(r, name) !== '').length
  console.log(
    `${String(index).padStart(3)}  ${JSON.stringify(name).padEnd(30)} ` +
      `${String(populated).padStart(6)}${populated === records.length ? ' (all)' : '      '}  ` +
      `${JSON.stringify(records.find((r) => get(r, name) !== '')?.[name] ?? '').slice(0, 40)}`,
  )
})

// ── THE IDEMPOTENCY KEY ───────────────────────────────────────────────────
//
// Whatever the seeder keys on has to be unique across every row it will ever
// read, or a re-run silently merges two loads. Both candidates are checked,
// and blanks are counted separately: a blank is not a duplicate, it is a row
// with no key at all, which is the worse of the two problems.
rule('IDENTITY: IS THERE A KEY THAT IS UNIQUE ACROSS ALL ROWS?')
for (const column of ['Shipment ID', 'Load ID', 'Trip ID']) {
  const values = records.map((r) => get(r, column))
  const present = values.filter((v) => v !== '')
  const counts = tally(present)
  const repeated = [...counts].filter(([, n]) => n > 1)
  console.log(
    `${column.padEnd(12)} ${String(present.length).padStart(6)} present  ` +
      `${String(values.length - present.length).padStart(4)} blank  ` +
      `${String(counts.size).padStart(6)} distinct  ` +
      `${repeated.length === 0 ? 'UNIQUE' : `${repeated.length} value(s) repeat`}`,
  )
  for (const [value, n] of repeated.slice(0, 8)) {
    console.log(`               ${value} ×${n}`)
  }
  if (repeated.length > 8)
    console.log(`               … and ${repeated.length - 8} more`)
}

// Do the two agree about which row is which? A pair that is unique separately
// can still be a many-to-many, which would make "the load" ambiguous.
const pairs = tally(
  records.map((r) => `${get(r, 'Shipment ID')}|${get(r, 'Load ID')}`),
)
console.log(
  `\nShipment↔Load  ${pairs.size} distinct pairing(s) over ${records.length} rows`,
)
const shipmentsPerLoad = new Map<string, Set<string>>()
for (const record of records) {
  const load = get(record, 'Load ID')
  if (load === '') continue
  const set = shipmentsPerLoad.get(load) ?? new Set()
  set.add(get(record, 'Shipment ID'))
  shipmentsPerLoad.set(load, set)
}
const multi = [...shipmentsPerLoad].filter(([, set]) => set.size > 1)
console.log(
  `               ${multi.length} Load ID(s) carry more than one Shipment ID`,
)

rule('DATE RANGE')
for (const column of [
  'Created date',
  'PU date',
  'DEL date',
  'Delivery Appointment Time',
  'Last update',
]) {
  const parsed = records
    .map((r) => isoDate(get(r, column)))
    .filter((d): d is string => d !== null)
    .sort()
  const blank = records.filter((r) => get(r, column) === '').length
  const unparsed = records.length - blank - parsed.length
  console.log(
    `${column.padEnd(26)} ${parsed[0] ?? '—'} … ${parsed.at(-1) ?? '—'}  ` +
      `(${parsed.length} parsed, ${blank} blank, ${unparsed} UNPARSED)`,
  )
  if (unparsed > 0) {
    const examples = records
      .map((r) => get(r, column))
      .filter((v) => v !== '' && isoDate(v) === null)
      .slice(0, 3)
    console.log(`${' '.repeat(26)} unparsed look like: ${examples.join(' | ')}`)
  }
}

// By year, so "over a year" is a measurement rather than a description.
const puYears = tally(
  records
    .map((r) => isoDate(get(r, 'PU date'))?.slice(0, 7) ?? '(none)')
    .sort(),
)
console.log('\nPU date by month:')
printTally(new Map([...puYears].sort((a, b) => a[0].localeCompare(b[0]))))

rule('CONTROLLED VOCABULARIES — EVERY DISTINCT VALUE')
for (const column of [
  'MC Number',
  'Load status',
  'Invoice billing status',
  'Trip Billing status',
  'Invoice Sub status',
  'Trip status',
  'Payment type',
  'Equipment types',
  'On Time Delivery',
  'Heading to',
]) {
  const counts = tally(records.map((r) => get(r, column)))
  console.log(`\n${column} — ${counts.size} distinct (blank included)`)
  printTally(counts, 25)
}

rule('CUSTOMER — COUNTED, NOT LISTED')
const customers = tally(records.map((r) => get(r, 'Customer')))
console.log(
  `${customers.size} distinct customer name(s) over ${records.length} rows`,
)
const once = [...customers].filter(([, n]) => n === 1).length
console.log(`${once} appear exactly once; the top 15 by load count:`)
printTally(customers, 15)

// ── THE ROSTER COMPARISON ─────────────────────────────────────────────────
//
// Measured against the SEED SOURCE, for the reason at the top of this file.
const driverPlan = planDrivers(
  asRecords(await readXlsx(new Uint8Array(readFileSync(DRIVER_EXPORT)))),
)
const truckPlan = planTrucks(
  asRecords(await readXlsx(new Uint8Array(readFileSync(TRUCK_EXPORT)))),
)

/** Exact, after collapsing whitespace and case. Never nearest-match. */
const nameKey = (text: string) => text.trim().toLowerCase().replace(/\s+/g, ' ')

const seededDrivers = new Map(
  driverPlan.planned.map((d) => [nameKey(`${d.firstName} ${d.lastName}`), d]),
)
rule(`DRIVER/CARRIER AGAINST ${seededDrivers.size} SEEDED DRIVERS`)
const driverCounts = tally(records.map((r) => get(r, 'Driver/Carrier')))
const namedDrivers = [...driverCounts].filter(([name]) => name !== '')
const matchedDrivers = namedDrivers.filter(([name]) =>
  seededDrivers.has(nameKey(name)),
)
const unmatchedDrivers = namedDrivers.filter(
  ([name]) => !seededDrivers.has(nameKey(name)),
)
const loadsOf = (entries: [string, number][]) =>
  entries.reduce((sum, [, n]) => sum + n, 0)
console.log(
  `${namedDrivers.length} distinct name(s) on ${loadsOf(namedDrivers)} rows; ` +
    `${driverCounts.get('') ?? 0} rows name nobody`,
)
console.log(
  `MATCHED   ${String(matchedDrivers.length).padStart(4)} name(s) → ${loadsOf(matchedDrivers)} rows`,
)
console.log(
  `UNMATCHED ${String(unmatchedDrivers.length).padStart(4)} name(s) → ${loadsOf(unmatchedDrivers)} rows`,
)
console.log(
  `\nSEEDED BUT NEVER NAMED: ${
    [...seededDrivers.keys()].filter(
      (key) => !namedDrivers.some(([name]) => nameKey(name) === key),
    ).length
  } of ${seededDrivers.size}`,
)
console.log('\nUNMATCHED NAMES, by load count — these are what is missing:')
printTally(new Map(unmatchedDrivers))

const seededTrucks = new Map(
  truckPlan.planned.map((t) => [nameKey(t.unitNumber), t]),
)
rule(`TRUCK AGAINST ${seededTrucks.size} PLANNED UNITS`)
const truckCounts = tally(records.map((r) => get(r, 'Truck')))
const namedTrucks = [...truckCounts].filter(([unit]) => unit !== '')
const matchedTrucks = namedTrucks.filter(([unit]) =>
  seededTrucks.has(nameKey(unit)),
)
const unmatchedTrucks = namedTrucks.filter(
  ([unit]) => !seededTrucks.has(nameKey(unit)),
)
console.log(
  `${namedTrucks.length} distinct unit(s) on ${loadsOf(namedTrucks)} rows; ` +
    `${truckCounts.get('') ?? 0} rows name no truck`,
)
console.log(
  `MATCHED   ${String(matchedTrucks.length).padStart(4)} unit(s) → ${loadsOf(matchedTrucks)} rows`,
)
console.log(
  `UNMATCHED ${String(unmatchedTrucks.length).padStart(4)} unit(s) → ${loadsOf(unmatchedTrucks)} rows`,
)
console.log(
  `held by the truck plan (not seeded): ${truckPlan.held.length} — ${truckPlan.held
    .map((h) => h.unitNumber)
    .join(', ')}`,
)
console.log('\nUNMATCHED UNITS, by load count:')
printTally(new Map(unmatchedTrucks), 40)

rule('MONEY')
for (const column of [
  'Load pay',
  'Driver gross',
  'Total other pay',
  'Total pay',
]) {
  const raw = records.map((r) => get(r, column))
  const blank = raw.filter((v) => v === '').length
  const parsed = raw.map(cents)
  const bad = parsed.filter((v, i) => v === null && raw[i] !== '').length
  const good = parsed.filter((v): v is number => v !== null)
  const zero = good.filter((v) => v === 0).length
  const negative = good.filter((v) => v < 0)
  const positive = good.filter((v) => v > 0)
  const sum = good.reduce((a, b) => a + b, 0)
  console.log(
    `${column.padEnd(16)} ${String(blank).padStart(5)} blank  ` +
      `${String(bad).padStart(4)} unparseable  ` +
      `${String(zero).padStart(5)} zero  ` +
      `${String(negative.length).padStart(4)} negative  ` +
      `${String(positive.length).padStart(5)} positive`,
  )
  console.log(
    `${' '.repeat(16)} total $${(sum / 100).toFixed(2)}  ` +
      `max $${(Math.max(0, ...good) / 100).toFixed(2)}  ` +
      `min $${(Math.min(0, ...good) / 100).toFixed(2)}`,
  )
  if (negative.length > 0) {
    console.log(
      `${' '.repeat(16)} negatives: ${negative
        .slice(0, 6)
        .map((v) => `$${(v / 100).toFixed(2)}`)
        .join(', ')}`,
    )
  }
  // Fractional cents would mean the export carries more precision than the
  // schema does, which is a rounding decision somebody has to make on purpose.
  const fractional = raw.filter((v) => /\.\d{3,}/.test(v)).length
  if (fractional > 0) {
    console.log(
      `${' '.repeat(16)} ${fractional} value(s) carry more than two decimals`,
    )
  }
}

// Does the export's own arithmetic hold? If `Total pay` is not
// `Load pay + Total other pay`, the seeder cannot treat any of them as derived.
const arithmetic = records.filter((r) => {
  const pay = cents(get(r, 'Load pay'))
  const other = cents(get(r, 'Total other pay'))
  const total = cents(get(r, 'Total pay'))
  return (
    pay !== null && other !== null && total !== null && pay + other !== total
  )
})
console.log(
  `\nLoad pay + Total other pay ≠ Total pay on ${arithmetic.length} row(s)`,
)
for (const record of arithmetic.slice(0, 5)) {
  console.log(
    `  ${get(record, 'Shipment ID')}  ${get(record, 'Load pay')} + ${get(record, 'Total other pay')} ≠ ${get(record, 'Total pay')}`,
  )
}

rule('STOPS')
printTally(tally(records.map((r) => get(r, 'Stops count'))))

rule('LOCATION FORMAT')
const CITY_STATE_ZIP = /^[^,]+, [A-Z]{2}, \d{5}$/
const CITY_STATE = /^[^,]+, [A-Z]{2}$/
for (const column of ['Pickup location', 'Delivery location']) {
  const values = records.map((r) => get(r, column))
  const shapes = tally(
    values.map((v) =>
      v === ''
        ? '(blank)'
        : CITY_STATE_ZIP.test(v)
          ? 'City, ST, ZIP'
          : CITY_STATE.test(v)
            ? 'City, ST'
            : 'other',
    ),
  )
  console.log(`\n${column}`)
  printTally(shapes)
  const other = values.filter(
    (v) => v !== '' && !CITY_STATE_ZIP.test(v) && !CITY_STATE.test(v),
  )
  for (const example of other.slice(0, 6)) console.log(`     e.g. ${example}`)
}

// The company columns are the other half of a stop: a name without an address.
for (const column of ['Pickup company', 'Delivery company']) {
  const values = records.map((r) => get(r, column)).filter((v) => v !== '')
  console.log(
    `\n${column}: ${new Set(values).size} distinct over ${values.length} populated`,
  )
  console.log(`     e.g. ${values.slice(0, 4).join(' | ')}`)
}

// ── SECOND PASS: THE QUESTIONS THE FIRST PASS RAISED ──────────────────────
//
// Each of these exists because a number above was surprising, and a surprising
// number is a question rather than a finding. Written after reading the first
// output and kept in the file, so the follow-up is re-runnable rather than a
// thing that happened once in a terminal.

rule('IS `Driver gross` THE DRIVER’S CUT, OR THE LOAD’S GROSS?')
//
// It totals MORE than `Load pay` across the file and is zero on far fewer
// rows, which no percentage of linehaul can do. The candidate explanations are
// distinguishable by counting agreement rather than by reasoning about names.
const grossVsTotal = records.filter(
  (r) => cents(get(r, 'Driver gross')) === cents(get(r, 'Total pay')),
).length
const grossVsLoad = records.filter(
  (r) => cents(get(r, 'Driver gross')) === cents(get(r, 'Load pay')),
).length
const grossBelowLoad = records.filter((r) => {
  const gross = cents(get(r, 'Driver gross'))
  const pay = cents(get(r, 'Load pay'))
  return gross !== null && pay !== null && gross < pay
}).length
const grossAboveLoad = records.filter((r) => {
  const gross = cents(get(r, 'Driver gross'))
  const pay = cents(get(r, 'Load pay'))
  return gross !== null && pay !== null && gross > pay
}).length
console.log(`Driver gross == Total pay  ${grossVsTotal} of ${records.length}`)
console.log(`Driver gross == Load pay   ${grossVsLoad}`)
console.log(`Driver gross <  Load pay   ${grossBelowLoad}`)
console.log(`Driver gross >  Load pay   ${grossAboveLoad}`)
// If it were a percentage of linehaul there would be a ratio. Ten rows where
// the two differ, printed whole, settle it faster than any aggregate.
console.log('\nrows where Driver gross differs from Load pay:')
for (const record of records
  .filter((r) => cents(get(r, 'Driver gross')) !== cents(get(r, 'Load pay')))
  .slice(0, 10)) {
  console.log(
    `  ${get(record, 'Shipment ID')}  load ${get(record, 'Load pay').padStart(9)}` +
      `  other ${get(record, 'Total other pay').padStart(7)}` +
      `  gross ${get(record, 'Driver gross').padStart(9)}` +
      `  total ${get(record, 'Total pay').padStart(9)}  ${get(record, 'MC Number')}`,
  )
}

rule('THE >2-DECIMAL VALUES — A ROUNDING DECISION, SO NAME IT')
for (const column of ['Load pay', 'Driver gross', 'Total pay']) {
  const long = records
    .map((r) => get(r, column))
    .filter((v) => /\.\d{3,}/.test(v))
  console.log(
    `${column.padEnd(14)} ${long.length} value(s), e.g. ${long.slice(0, 4).join(', ')}`,
  )
}

// ── ARE THE UNMATCHED DRIVERS REALLY UNMATCHED? ───────────────────────────
//
// Some read as `Surname Given` where the roster has `Given Surname`, and one
// carries a numeric suffix. The word-SET comparison is the one already in
// `matchDriverByName`, so asking it here says how many of the 106 are people
// we have under a different spelling versus people we do not have at all.
rule('UNMATCHED DRIVERS: SPELLING, OR GENUINELY ABSENT?')
const wordKey = (text: string) =>
  text
    .toLowerCase()
    .replace(/[.,]/g, ' ')
    .split(/\s+/)
    .filter((word) => word !== '')
    .sort()
    .join(' ')
const seededWordKeys = new Map<string, string>()
for (const driver of driverPlan.planned) {
  seededWordKeys.set(
    wordKey(`${driver.firstName} ${driver.lastName}`),
    `${driver.firstName} ${driver.lastName}`,
  )
}
const reordered = unmatchedDrivers.filter(([name]) =>
  seededWordKeys.has(wordKey(name)),
)
console.log(
  `${reordered.length} of ${unmatchedDrivers.length} unmatched name(s) are a WORD-ORDER variant of a seeded driver:`,
)
for (const [name, count] of reordered) {
  console.log(
    `  ${String(count).padStart(5)}  ${name}  →  ${seededWordKeys.get(wordKey(name))}`,
  )
}
console.log(
  `\nstill absent after that: ${unmatchedDrivers.length - reordered.length} name(s) on ` +
    `${loadsOf(unmatchedDrivers) - loadsOf(reordered)} rows`,
)
// A carrier is not a driver, and this column is called `Driver/Carrier`.
const carriers = unmatchedDrivers.filter(([name]) =>
  /\b(llc|inc|corp|logistic|logistics|transport|carrier|express|trucking)\b/i.test(
    name,
  ),
)
console.log(
  `\nnames that look like a COMPANY rather than a person: ${carriers.length}`,
)
for (const [name, count] of carriers) {
  console.log(`  ${String(count).padStart(5)}  ${name}`)
}

rule('CO-DRIVER')
const coDriven = records.filter((r) => get(r, 'Co-Driver') !== '')
console.log(`${coDriven.length} row(s) name a co-driver`)
const coNames = tally(coDriven.map((r) => get(r, 'Co-Driver')))
console.log(`${coNames.size} distinct co-driver name(s)`)
console.log(
  `of those, ${
    [...coNames.keys()].filter((n) => seededDrivers.has(nameKey(n))).length
  } match a seeded driver exactly`,
)

rule('LOCATION: WHAT THE "other" SHAPE ACTUALLY IS')
const CITY_BLANK_ZIP = /^[^,]+, *, *\d{5}$/
const STREET = /^\d+\s+\S+.*,/
for (const column of ['Pickup location', 'Delivery location']) {
  const other = records
    .map((r) => get(r, column))
    .filter((v) => v !== '' && !CITY_STATE_ZIP.test(v) && !CITY_STATE.test(v))
  const shapes = tally(
    other.map((v) =>
      CITY_BLANK_ZIP.test(v)
        ? 'City, (no state), ZIP'
        : STREET.test(v)
          ? 'street address'
          : 'neither',
    ),
  )
  console.log(`\n${column} — ${other.length} not City, ST, ZIP`)
  printTally(shapes)
  for (const example of other
    .filter((v) => !CITY_BLANK_ZIP.test(v) && !STREET.test(v))
    .slice(0, 8)) {
    console.log(`     neither: ${example}`)
  }
}
// The state is missing from the STRING, not from the row: `Pickup state` is a
// separate column. Whether it is populated where the location string is not
// decides whether anything is actually lost.
for (const [location, state] of [
  ['Pickup location', 'Pickup state'],
  ['Delivery location', 'Delivery state'],
] as const) {
  const missingInString = records.filter((r) =>
    CITY_BLANK_ZIP.test(get(r, location)),
  )
  const rescued = missingInString.filter((r) => get(r, state) !== '').length
  console.log(
    `\n${location}: ${missingInString.length} row(s) carry no state in the string, ` +
      `${rescued} of them have one in ${state}`,
  )
}

rule('DOCUMENTS COLUMN')
const withDocuments = records.filter((r) => get(r, 'Documents') !== '')
console.log(`${withDocuments.length} row(s) carry a Documents value`)
const fileTypes = tally(
  withDocuments.flatMap((r) =>
    [...get(r, 'Documents').matchAll(/'file_type':\s*'([^']*)'/g)].map(
      (m) => m[1] ?? '',
    ),
  ),
)
console.log('file types named inside it:')
printTally(fileTypes, 12)
console.log(
  `\none value, truncated:\n  ${get(withDocuments[0]!, 'Documents').slice(0, 300)}`,
)

rule('AUTHORITY × WHAT IT CARRIES')
for (const [authority] of tally(records.map((r) => get(r, 'MC Number')))) {
  const mine = records.filter((r) => get(r, 'MC Number') === authority)
  const paid = mine.reduce(
    (sum, r) => sum + (cents(get(r, 'Load pay')) ?? 0),
    0,
  )
  const dates = mine
    .map((r) => isoDate(get(r, 'PU date')))
    .filter((d): d is string => d !== null)
    .sort()
  console.log(
    `${authority.padEnd(32)} ${String(mine.length).padStart(6)} loads  ` +
      `$${(paid / 100).toFixed(2).padStart(14)}  ${dates[0] ?? '—'} … ${dates.at(-1) ?? '—'}`,
  )
}

// ── THIRD PASS ────────────────────────────────────────────────────────────

rule('ZERO-PAY ROWS: WHAT ARE THEY?')
const zeroPay = records.filter((r) => cents(get(r, 'Load pay')) === 0)
const zeroWithOther = zeroPay.filter(
  (r) => (cents(get(r, 'Total other pay')) ?? 0) > 0,
)
const zeroEverything = zeroPay.filter((r) => cents(get(r, 'Total pay')) === 0)
console.log(`${zeroPay.length} row(s) have Load pay = 0`)
console.log(`  ${zeroWithOther.length} of them carry Total other pay > 0`)
console.log(`  ${zeroEverything.length} of them are zero all the way through`)
console.log('  their Load status:')
printTally(tally(zeroPay.map((r) => get(r, 'Load status'))))
console.log('  the all-zero rows, by status:')
printTally(tally(zeroEverything.map((r) => get(r, 'Load status'))))

rule('MULTI-STOP LOADS: WHAT THE EXPORT CANNOT SAY')
//
// The file has ONE pickup and ONE delivery per row and a `Stops count` that
// often disagrees with that. Whatever is in between is not in this export at
// all, so a seeder cannot reconstruct it and should not pretend to.
const beyondTwo = records.filter((r) => {
  const n = Number(get(r, 'Stops count'))
  return Number.isFinite(n) && n > 2
})
console.log(
  `${beyondTwo.length} row(s) of ${records.length} (${((beyondTwo.length / records.length) * 100).toFixed(1)}%) ` +
    `declare more than 2 stops`,
)
const intermediate = beyondTwo.reduce(
  (sum, r) => sum + (Number(get(r, 'Stops count')) - 2),
  0,
)
console.log(
  `${intermediate} intermediate stop(s) are named nowhere in the file`,
)
const zeroStops = records.filter((r) => get(r, 'Stops count') === '0')
console.log(`\n${zeroStops.length} row(s) declare 0 stops; their statuses:`)
printTally(tally(zeroStops.map((r) => get(r, 'Load status'))))

rule('AUTHORITIES THIS SYSTEM DOES NOT KNOW')
//
// `trucks.ts` maps two and names one as retired. The loads name five. An
// authority with loads and no `Company` is a load that cannot be filed.
const KNOWN = ['RAM Haulage LLC', 'Dolphin Transport inc']
const RETIRED = ['Midwest Global Logistics LLC']
for (const [authority, count] of tally(
  records.map((r) => get(r, 'MC Number')),
)) {
  const standing = KNOWN.includes(authority)
    ? 'mapped in trucks.ts'
    : RETIRED.includes(authority)
      ? 'named RETIRED in trucks.ts'
      : 'NOT KNOWN TO THIS CODEBASE'
  console.log(
    `${authority.padEnd(32)} ${String(count).padStart(6)}  ${standing}`,
  )
}

rule('SEEDED BUT NEVER NAMED')
const namedDriverKeys = new Set(namedDrivers.map(([name]) => nameKey(name)))
for (const [key, driver] of seededDrivers) {
  if (!namedDriverKeys.has(key)) {
    console.log(
      `  driver ${driver.firstName} ${driver.lastName} (${driver.authority})`,
    )
  }
}
const namedTruckKeys = new Set(namedTrucks.map(([unit]) => nameKey(unit)))
for (const [key, truck] of seededTrucks) {
  if (!namedTruckKeys.has(key)) {
    console.log(`  truck  ${truck.unitNumber} (${truck.authority})`)
  }
}

rule('DRIVER ↔ AUTHORITY: DOES A DRIVER STAY ON ONE?')
const authoritiesPerDriver = new Map<string, Set<string>>()
for (const record of records) {
  const driver = get(record, 'Driver/Carrier')
  if (driver === '') continue
  const set = authoritiesPerDriver.get(driver) ?? new Set()
  set.add(get(record, 'MC Number'))
  authoritiesPerDriver.set(driver, set)
}
const spread = [...authoritiesPerDriver].filter(([, set]) => set.size > 1)
console.log(
  `${spread.length} of ${authoritiesPerDriver.size} driver name(s) appear under more than one authority`,
)
for (const [driver, set] of spread.slice(0, 12)) {
  console.log(`  ${driver.padEnd(30)} ${[...set].join(' + ')}`)
}

rule('TRUCK ↔ AUTHORITY')
const authoritiesPerTruck = new Map<string, Set<string>>()
for (const record of records) {
  const unit = get(record, 'Truck')
  if (unit === '') continue
  const set = authoritiesPerTruck.get(unit) ?? new Set()
  set.add(get(record, 'MC Number'))
  authoritiesPerTruck.set(unit, set)
}
const truckSpread = [...authoritiesPerTruck].filter(([, set]) => set.size > 1)
console.log(
  `${truckSpread.length} of ${authoritiesPerTruck.size} unit(s) appear under more than one authority`,
)
for (const [unit, set] of truckSpread.slice(0, 12)) {
  console.log(`  ${unit.padEnd(10)} ${[...set].join(' + ')}`)
}

rule('THE THREE HELD TRUCKS, AND WHAT THEY CARRY')
for (const held of truckPlan.held) {
  const mine = records.filter((r) => get(r, 'Truck') === held.unitNumber)
  const paid = mine.reduce(
    (sum, r) => sum + (cents(get(r, 'Load pay')) ?? 0),
    0,
  )
  console.log(
    `  ${held.unitNumber.padEnd(8)} ${String(mine.length).padStart(5)} load(s)  ` +
      `$${(paid / 100).toFixed(2).padStart(12)}  — ${held.reason}`,
  )

  // ── WHICH AUTHORITY SHOULD THE TRUCK ROW CARRY? ────────────────────────
  //
  // Two of the three are held for having NO authority in the trucks export,
  // so the answer is not in that file and has to come from the freight. It
  // does not come out clean: a unit runs under several MCs across the year,
  // which is the same finding as `TRUCK ↔ AUTHORITY` above.
  //
  // BOTH READINGS ARE PRINTED — where it ran MOST, and where it ran LAST —
  // because they can disagree, and a script that showed only one would be
  // making the choice while looking like it was reporting one. `Truck.
  // companyId` is a single column and somebody has to decide it.
  const byAuthority = tally(mine.map((r) => get(r, 'MC Number')))
  for (const [authority, count] of byAuthority) {
    console.log(
      `             ${String(count).padStart(5)}  ${authority === '' ? '(blank)' : authority}`,
    )
  }
  const dated = mine
    .map((r) => ({
      day: isoDate(get(r, 'PU date')),
      authority: get(r, 'MC Number'),
    }))
    .filter((row) => row.day !== null)
    .sort((a, b) => a.day!.localeCompare(b.day!))
  const last = dated.at(-1)
  console.log(
    `             last ran ${last?.day ?? '—'} under ${last?.authority ?? '—'}`,
  )
}

rule('MILES')
for (const column of ['Mile', 'Empty mile', 'Total miles']) {
  const raw = records.map((r) => get(r, column))
  const numeric = raw
    .filter((v) => v !== '' && /^-?\d+(\.\d+)?$/.test(v))
    .map(Number)
  console.log(
    `${column.padEnd(12)} ${String(numeric.length).padStart(6)} numeric  ` +
      `${String(raw.filter((v) => v === '').length).padStart(5)} blank  ` +
      `${String(numeric.filter((v) => v === 0).length).padStart(5)} zero  ` +
      `min ${Math.min(...numeric).toFixed(1)}  max ${Math.max(...numeric).toFixed(1)}`,
  )
}
// `Total miles` is not `Mile + Empty mile` on the first row, so say what it is.
const milesDisagree = records.filter((r) => {
  const loaded = Number(get(r, 'Mile'))
  const empty = Number(get(r, 'Empty mile'))
  const total = Number(get(r, 'Total miles'))
  return (
    Number.isFinite(loaded) &&
    Number.isFinite(empty) &&
    Number.isFinite(total) &&
    Math.abs(loaded + empty - total) > 1
  )
}).length
console.log(`Mile + Empty mile ≠ Total miles (±1) on ${milesDisagree} row(s)`)

// ── FOURTH PASS: THE KEYS A SEEDER WOULD ACTUALLY USE ─────────────────────
//
// The counts above matched a load's `Truck` on the unit number alone. The
// truck seeder does not: it keys on `(authority, unit)`, because two
// authorities may each number a truck 1024. The load history says units and
// drivers BOTH move between authorities, so the number that matters is how
// many loads resolve under the seeder's real key rather than under a laxer one.
//
// This is the "count the thing you are claiming, not a superset of it" rule
// pointed at my own first measurement.

rule('RESOLUTION UNDER THE SEEDER’S REAL KEY: (authority, unit)')
const COMPANY_OF: Readonly<Record<string, string>> = {
  'RAM Haulage LLC': 'RAM Haulage',
  'Dolphin Transport inc': 'Dolphins Transport',
}
const seededPairs = new Set(
  truckPlan.planned.map((t) => `${t.authority}|${nameKey(t.unitNumber)}`),
)
let pairResolved = 0
let pairUnknownAuthority = 0
let pairNoSuchUnit = 0
let pairNoTruck = 0
for (const record of records) {
  const unit = get(record, 'Truck')
  if (unit === '') {
    pairNoTruck++
    continue
  }
  const company = COMPANY_OF[get(record, 'MC Number')]
  if (!company) {
    pairUnknownAuthority++
    continue
  }
  if (seededPairs.has(`${company}|${nameKey(unit)}`)) pairResolved++
  else pairNoSuchUnit++
}
console.log(
  `${pairResolved} load(s) resolve to a seeded truck on (authority, unit)`,
)
console.log(
  `${pairNoSuchUnit} name a unit that authority has no seeded truck for`,
)
console.log(
  `${pairUnknownAuthority} are filed under an authority with no Company`,
)
console.log(`${pairNoTruck} name no truck at all`)
console.log(
  `\nby unit number alone it was ${matchedTrucks.length} unit(s) → ${loadsOf(matchedTrucks)} rows, ` +
    `which is the superset.`,
)

rule('DOES A MATCHED DRIVER’S LOAD AGREE WITH THEIR SEEDED AUTHORITY?')
let agree = 0
let disagree = 0
let unknownAuthority = 0
const disagreements = new Map<string, number>()
for (const record of records) {
  const name = get(record, 'Driver/Carrier')
  const driver = seededDrivers.get(nameKey(name))
  if (!driver) continue
  const company = COMPANY_OF[get(record, 'MC Number')]
  if (!company) {
    unknownAuthority++
    continue
  }
  if (company === driver.authority) agree++
  else {
    disagree++
    const key = `${name}: seeded ${driver.authority}, load ${company}`
    disagreements.set(key, (disagreements.get(key) ?? 0) + 1)
  }
}
console.log(`${agree} load(s) agree with the driver's seeded authority`)
console.log(`${disagree} disagree`)
console.log(
  `${unknownAuthority} are under an authority this system has no Company for`,
)
console.log('\nthe disagreements, by count:')
printTally(new Map([...disagreements].sort((a, b) => b[1] - a[1])), 15)

rule('IS THERE A DRIVER ID ANYWHERE IN THIS EXPORT?')
//
// The drivers export keys on `Driver ID` and the migration added
// `Driver.externalId` for it. If the load export carries no such column, then
// every load↔driver link has to be made on the NAME — which is the join this
// codebase refuses to do fuzzily, so it matters that the answer is stated.
console.log(
  header.filter((name) => /id/i.test(name)).length === 0
    ? 'no column with "id" in its name'
    : `columns with "id" in the name: ${header.filter((name) => /id/i.test(name)).join(', ')}`,
)
