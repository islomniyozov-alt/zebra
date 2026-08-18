import { neonConfig, Pool } from '@neondatabase/serverless'
import { readFileSync } from 'node:fs'

// ---------------------------------------------------------------------------
// THE CARRIER'S FACILITY BOOK, IMPORTED ONCE.
//
// 3,599 street-level facilities out of the Datatruck locations export, keyed
// by the code Relay paperwork prints. Once they are here, a trip CSV naming
// "MEM1" and a booking email naming "MEM1" both resolve to the same dock with
// its street address, instead of minting a location per spelling.
//
//   node -r dotenv/config scripts/seed-facilities.mjs                 (dry run)
//   node -r dotenv/config scripts/seed-facilities.mjs --write --yes
//
// READ-ONLY UNLESS TOLD TWICE, the same posture as sweep-test-rows.mjs. This
// writes thousands of rows into a tenant's location book; a script that did
// that on a bare invocation would be one tab-completion away from doing it to
// the wrong organization.
//
// IT PRINTS THE TARGET FIRST. Flag 59: a production command that names a
// variable a dev terminal can satisfy is a coin flip that reports heads. This
// one says which host and which organization before it touches anything.
//
// IDEMPOTENT BY CONSTRUCTION, not by checking. `(organizationId,
// facilityCode)` is unique, so the upsert has nowhere to put a duplicate:
// re-running updates addresses that changed and leaves the rest alone. That is
// a property of the schema rather than a promise made by this file.
// ---------------------------------------------------------------------------

const SEED = process.argv.includes('--file')
  ? process.argv[process.argv.indexOf('--file') + 1]
  : 'corpus/relay-trips/facilities-seed.csv'

const WRITE = process.argv.includes('--write') && process.argv.includes('--yes')

const url = process.env.DIRECT_DATABASE_URL
if (!url) {
  console.error('DIRECT_DATABASE_URL is not set. Nothing to seed.')
  process.exit(1)
}

const organizationId = process.env.SEED_ORGANIZATION_ID ?? null

neonConfig.poolQueryViaFetch = false
const pool = new Pool({ connectionString: url })

const host = new URL(url).hostname
console.log('')
console.log(`Target: ${host}`)
console.log(`Source: ${SEED}`)
console.log(`Mode:   ${WRITE ? 'WRITE' : 'read-only'}`)
console.log('')

// --- the tenant -----------------------------------------------------------
//
// Named explicitly or resolved to the only one there is. A seed that picked
// "the first organization" on a multi-tenant database would be a coin flip
// with someone else's location book.
const orgs = await pool.query(
  'select id, name from "Organization" where "isActive" = true order by "createdAt" asc',
)

let org = null
if (organizationId) {
  org = orgs.rows.find((row) => row.id === organizationId) ?? null
  if (!org) {
    console.error(`No active organization with id ${organizationId}.`)
    await pool.end()
    process.exit(1)
  }
} else if (orgs.rows.length === 1) {
  org = orgs.rows[0]
} else {
  console.error(
    `${orgs.rows.length} active organizations. Set SEED_ORGANIZATION_ID to say which.`,
  )
  for (const row of orgs.rows) console.error(`  ${row.id}  ${row.name}`)
  await pool.end()
  process.exit(1)
}

console.log(`Organization: ${org.name} (${org.id})`)
console.log('')

// --- the file -------------------------------------------------------------

/** A CSV line, respecting quoted commas. The addresses are full of them. */
function splitCsvLine(line) {
  const out = []
  let field = ''
  let quoted = false
  for (let index = 0; index < line.length; index++) {
    const ch = line[index]
    if (quoted) {
      if (ch === '"' && line[index + 1] === '"') {
        field += '"'
        index++
      } else if (ch === '"') {
        quoted = false
      } else {
        field += ch
      }
    } else if (ch === '"') {
      quoted = true
    } else if (ch === ',') {
      out.push(field)
      field = ''
    } else {
      field += ch
    }
  }
  out.push(field)
  return out.map((value) => value.trim())
}

const lines = readFileSync(SEED, 'utf8')
  .split(/\r?\n/)
  .filter((line) => line.trim() !== '')

const header = splitCsvLine(lines[0]).map((name) => name.toLowerCase())
const want = ['facility_code', 'address', 'city', 'state']
const missing = want.filter((name) => !header.includes(name))
if (missing.length > 0) {
  console.error(`The file is missing column(s): ${missing.join(', ')}`)
  await pool.end()
  process.exit(1)
}

const at = Object.fromEntries(want.map((name) => [name, header.indexOf(name)]))

const rows = []
const skipped = []

for (const line of lines.slice(1)) {
  const cells = splitCsvLine(line)
  const code = (cells[at.facility_code] ?? '').trim()
  if (code === '') {
    skipped.push(line.slice(0, 60))
    continue
  }
  rows.push({
    code,
    address: cells[at.address] ?? '',
    city: (cells[at.city] ?? '').trim() || null,
    state: (cells[at.state] ?? '').trim(),
  })
}

console.log(`${rows.length} facilities to import, ${skipped.length} skipped`)

// --- the same parsing the app uses ----------------------------------------
//
// Duplicated here as plain JS because this is a .mjs script and src/lib is
// TypeScript. `tests/facility-code.test.ts` asserts the two agree, so a change
// to one that is not made to the other fails by name rather than by producing
// a location book that disagrees with the importer that reads it.

const STATE_CODES = {
  alabama: 'AL',
  alaska: 'AK',
  arizona: 'AZ',
  arkansas: 'AR',
  california: 'CA',
  colorado: 'CO',
  connecticut: 'CT',
  delaware: 'DE',
  'district of columbia': 'DC',
  florida: 'FL',
  georgia: 'GA',
  hawaii: 'HI',
  idaho: 'ID',
  illinois: 'IL',
  indiana: 'IN',
  iowa: 'IA',
  kansas: 'KS',
  kentucky: 'KY',
  louisiana: 'LA',
  maine: 'ME',
  maryland: 'MD',
  massachusetts: 'MA',
  michigan: 'MI',
  minnesota: 'MN',
  mississippi: 'MS',
  missouri: 'MO',
  montana: 'MT',
  nebraska: 'NE',
  nevada: 'NV',
  'new hampshire': 'NH',
  'new jersey': 'NJ',
  'new mexico': 'NM',
  'new york': 'NY',
  'north carolina': 'NC',
  'north dakota': 'ND',
  ohio: 'OH',
  oklahoma: 'OK',
  oregon: 'OR',
  pennsylvania: 'PA',
  'rhode island': 'RI',
  'south carolina': 'SC',
  'south dakota': 'SD',
  tennessee: 'TN',
  texas: 'TX',
  utah: 'UT',
  vermont: 'VT',
  virginia: 'VA',
  washington: 'WA',
  'west virginia': 'WV',
  wisconsin: 'WI',
  wyoming: 'WY',
  'puerto rico': 'PR',
}

function stateCode(value) {
  const trimmed = String(value ?? '').trim()
  if (trimmed === '') return null
  if (/^[A-Za-z]{2}$/.test(trimmed)) return trimmed.toUpperCase()
  return STATE_CODES[trimmed.toLowerCase()] ?? null
}

function parseSeedAddress(address) {
  const text = String(address ?? '').trim()
  if (text === '') return { addressLine1: null, postalCode: null }
  const street = text.split(',')[0].trim()
  // THE ZIP IS THE ONE AFTER THE STATE, not the first five digits in the
  // string. A dry run over the real export caught this: "11077 US-190,
  // Hammond, LA 70401, USA" gave 11077 — the STREET NUMBER — as a
  // postcode, and it would have done so for 451 of 3,383 rows. Anchoring
  // on the two-letter state is what makes it the postcode rather than a
  // number that happens to be five digits long.
  const zip = /\b[A-Za-z]{2}\s+(\d{5})(?:-\d{4})?\b/.exec(text)
  return {
    addressLine1: street === '' ? null : street,
    postalCode: zip?.[1] ?? null,
  }
}

// --- what would change ----------------------------------------------------

const unknownStates = new Set()
const prepared = rows.map((row) => {
  const state = stateCode(row.state)
  if (state === null && row.state !== '') unknownStates.add(row.state)
  const { addressLine1, postalCode } = parseSeedAddress(row.address)
  return {
    facilityCode: row.code,
    // The code IS the name here. These facilities are known by it on every
    // piece of paper the office handles, and a dispatcher searching "MEM1"
    // should find it by the string they typed.
    name: row.code,
    addressLine1,
    city: row.city,
    state,
    postalCode,
  }
})

const existing = await pool.query(
  'select "facilityCode" from "Location" where "organizationId" = $1 and "facilityCode" is not null',
  [org.id],
)
const already = new Set(existing.rows.map((row) => row.facilityCode))
const fresh = prepared.filter((row) => !already.has(row.facilityCode))

console.log(
  `  ${fresh.length} new, ${prepared.length - fresh.length} already present`,
)
if (unknownStates.size > 0) {
  console.log('')
  console.log(`  ${unknownStates.size} state name(s) this could not read:`)
  for (const name of [...unknownStates].slice(0, 8)) console.log(`    ${name}`)
  console.log('  Those rows import with a null state, which is a fact rather')
  console.log('  than a guess — a wrong state moves a dock into another zone.')
}
console.log('')
console.log('  First three, as they would be written:')
for (const row of prepared.slice(0, 3))
  console.log(`    ${JSON.stringify(row)}`)
console.log('')

if (!WRITE) {
  console.log('Read-only. Re-run with --write --yes to import them.')
  await pool.end()
  process.exit(0)
}

// --- the write ------------------------------------------------------------

let written = 0
for (const row of prepared) {
  await pool.query(
    `insert into "Location"
       ("id", "organizationId", "facilityCode", "name", "addressLine1",
        "city", "state", "postalCode", "createdAt", "updatedAt")
     values (gen_random_uuid()::text, $1, $2, $3, $4, $5, $6, $7, now(), now())
     on conflict ("organizationId", "facilityCode") do update set
       "name" = excluded."name",
       "addressLine1" = excluded."addressLine1",
       "city" = excluded."city",
       "state" = excluded."state",
       "postalCode" = excluded."postalCode",
       "updatedAt" = now()`,
    [
      org.id,
      row.facilityCode,
      row.name,
      row.addressLine1,
      row.city,
      row.state,
      row.postalCode,
    ],
  )
  written++
  if (written % 500 === 0) console.log(`  ${written}/${prepared.length}`)
}

console.log('')
console.log(`Imported ${written} facilities into ${org.name}.`)
await pool.end()
