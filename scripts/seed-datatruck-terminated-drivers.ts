import { neonConfig } from '@neondatabase/serverless'
import { readFileSync } from 'node:fs'
import { createPrismaClient } from '@/lib/db'
import { asRecords, readXlsx } from '@/lib/datatruck/xlsx'
import {
  parseLicenceExpiry,
  planDrivers,
  type PlannedDriver,
} from '@/lib/datatruck/drivers'
import { assertTenancy } from './datatruck-tenancy'

// ---------------------------------------------------------------------------
// 69 PEOPLE WHO USED TO DRIVE HERE, BECAUSE 4,118 LOADS ARE THEIRS.
//
//   npx tsx -r dotenv/config scripts/seed-datatruck-terminated-drivers.ts            (preview)
//   npx tsx -r dotenv/config scripts/seed-datatruck-terminated-drivers.ts --write
//   npx tsx -r dotenv/config scripts/seed-datatruck-terminated-drivers.ts --production --write
//
// A load needs a driver to point at. The Datatruck history names 155 drivers
// and the active roster covers 49 of them; this export covers 67 more. Without
// these rows those loads import with nobody on them, and "who drove this" stops
// being answerable for a third of a year's freight.
//
// ── THE SAME KEY AND THE SAME PLANNER AS THE ACTIVE 54 ────────────────────
//
// Keyed on `Driver.externalId` from the export's `Driver ID`, exactly as the
// active seed is, and planned by the same `planDrivers` — same authority
// table, same pay parsing, same licence handling. A second planner would be a
// second set of rules for the same file format, and they would drift.
//
// The two sets are DISJOINT and that was measured, not assumed: zero of these
// 69 ids appear on the active roster and zero of the names do either.
//
// ── WHAT THIS DOES NOT WRITE, AND WHY EACH ────────────────────────────────
//
// NO PAY RULES. The active seed gives every driver a `PERCENT_LINEHAUL` rule
// dated 2026-08-01. Writing one for somebody terminated in January 2026 would
// be a rule that never governed anything, sitting in a versioned pay table
// where a future settlement run could pick it up. The owner's standing ruling
// on the load import says it in one line: applying rules dated 2026-08-01 to
// 2025 freight would invent a year of wages.
//
// NO CDL COMPLIANCE ITEMS. 64 of the 69 carry a licence expiry and most are in
// the past. Seeding them would put ~60 permanently-breached rows into the
// safety queue for people who do not work here — the same argument the truck
// seed makes about Datatruck's expired-registration warnings: a table whose
// every row is a breach nobody can act on.
//
// NO ASSET-HISTORY PERIODS. `AssetAssignment` answers "which authority ran
// this asset, when". An OPEN period would claim these people currently drive
// for a carrier, which is false. A CLOSED one would need a start date, and the
// export gives a hire date on 6 of 69 — so every other period would begin on a
// date this script made up. The drift backstop is taught to skip inactive
// drivers instead; see `findAuthorityDrift`.
//
// ── WHICH DATABASE ────────────────────────────────────────────────────────
//
// `--production` READS `PROD_DIRECT_DATABASE_URL` and nothing assigns it
// anywhere, the same arrangement the other three Datatruck writers make.
// Preview is the default, `--write` is a second decision, and `assertTenancy`
// names the organization and refuses one it did not expect — this connection
// is the database owner and carries BYPASSRLS, so nothing downstream would
// catch a wrong-tenant write.
// ---------------------------------------------------------------------------

neonConfig.webSocketConstructor ??= WebSocket
neonConfig.poolQueryViaFetch = false

const DEFAULT_EXPORT = 'corpus/datatruck/drivers_2026_09_09_07_36_17.xlsx'

const WRITE = process.argv.includes('--write')
const PRODUCTION = process.argv.includes('--production')
const FILE =
  process.argv.find((argument) => argument.endsWith('.xlsx')) ?? DEFAULT_EXPORT

const ORGANIZATION_SLUG = 'zebra'

/** Stated by the owner who ran the migration ritual, not discovered here. */
const PRODUCTION_ORGANIZATION_ID = 'cmsbsc82y0000nsvsa6yffuyh'

function target() {
  const url = PRODUCTION
    ? process.env.PROD_DIRECT_DATABASE_URL
    : process.env.DIRECT_DATABASE_URL
  if (!url) {
    throw new Error(
      PRODUCTION
        ? 'PROD_DIRECT_DATABASE_URL is not set.'
        : 'DIRECT_DATABASE_URL is not set.',
    )
  }
  return {
    url,
    label: PRODUCTION ? 'PRODUCTION' : 'DEV',
    host: new URL(url).hostname,
    expectOrganizationId: PRODUCTION ? PRODUCTION_ORGANIZATION_ID : null,
  }
}

function heading(text: string): void {
  console.log(`\n${text}`)
  console.log('─'.repeat(Math.max(text.length, 60)))
}

/**
 * The termination date, where the export carries one.
 *
 * REUSES THE LICENCE PARSER, which is named for the licence and is really
 * Datatruck's one date format — `Apr 11, 2031`, stated and nothing else. A
 * second parser for the same format is a second thing to get wrong; the name
 * is the only argument against reuse and it is a weaker argument than that.
 *
 * NEVER `new Date(text)`. The same rule `med-dates.ts` states: it happens to
 * work in V8 and is not a contract, and a date parsed wrongly here files a
 * person's last day in the wrong year.
 */
function terminationOf(raw: string): {
  iso: string | null
  why: string | null
} {
  if (raw.trim() === '') return { iso: null, why: null }
  const parsed = parseLicenceExpiry(raw)
  return parsed.ok
    ? { iso: parsed.iso, why: null }
    : { iso: null, why: `${JSON.stringify(raw)} — ${parsed.why}` }
}

interface Row {
  planned: PlannedDriver
  terminationIso: string | null
  terminationProblem: string | null
}

async function main(): Promise<void> {
  const bytes = new Uint8Array(readFileSync(FILE))
  const records = asRecords(await readXlsx(bytes))
  const plan = planDrivers(records)
  const where = target()

  // The planner does not read these two columns, so they are matched back onto
  // its output by `Driver ID` — the same key everything else here uses.
  const terminationByExternalId = new Map(
    records.map((record) => [
      (record['Driver ID'] ?? '').trim(),
      (record['Termination date'] ?? '').trim(),
    ]),
  )
  const rows: Row[] = plan.planned.map((planned) => {
    const parsed = terminationOf(
      terminationByExternalId.get(planned.externalId) ?? '',
    )
    return {
      planned,
      terminationIso: parsed.iso,
      terminationProblem: parsed.why,
    }
  })

  console.log(`export  ${FILE} (${bytes.length} bytes, ${plan.read} data rows)`)
  console.log(`mode    ${WRITE ? 'WRITE' : 'preview only'}`)

  const db = createPrismaClient(where.url)
  try {
    const tenancy = await assertTenancy(db, {
      label: where.label,
      host: where.host,
      slug: ORGANIZATION_SLUG,
      expectOrganizationId: where.expectOrganizationId,
    })

    heading('COUNTS')
    const byAuthority = new Map<string, number>()
    for (const row of rows) {
      byAuthority.set(
        row.planned.authority,
        (byAuthority.get(row.planned.authority) ?? 0) + 1,
      )
    }
    for (const [authority, count] of [...byAuthority].sort()) {
      console.log(`  ${String(count).padStart(3)}  ${authority}`)
    }
    console.log(
      `  ${String(rows.length).padStart(3)}  total to seed, all INACTIVE`,
    )

    const dated = rows.filter((r) => r.terminationIso !== null).length
    console.log(
      `\n  termination date on ${dated} of ${rows.length}; ` +
        `${rows.length - dated} have none and get null`,
    )
    const badDates = rows.filter((r) => r.terminationProblem !== null)
    for (const row of badDates) {
      console.log(
        `  UNPARSED ${row.planned.firstName} ${row.planned.lastName}: ${row.terminationProblem}`,
      )
    }

    heading(`HELD — ${plan.held.length} rows this seed will not write`)
    for (const held of plan.held) {
      console.log(`  ${held.externalId.padEnd(6)} ${held.who}`)
      console.log(`         ${held.reason}`)
    }

    // ── AGAINST WHAT IS ALREADY THERE ───────────────────────────────────
    //
    // Counted before the write rather than discovered during it, and counted
    // on the KEY the write uses — `externalId` — rather than on names, which
    // is the superset mistake this project has made before.
    const existing = await db.driver.findMany({
      where: {
        organizationId: tenancy.organizationId,
        externalId: { in: rows.map((r) => r.planned.externalId) },
      },
      select: { id: true, externalId: true, status: true },
    })
    const existingByExternalId = new Map(
      existing.map((row) => [row.externalId ?? '', row]),
    )
    console.log(
      `\n  ${existing.length} of ${rows.length} already exist by Driver ID; ` +
        `${rows.length - existing.length} would be created`,
    )

    heading('NOT WRITTEN, ON PURPOSE')
    console.log('  Pay rules      a rule dated 2026-08-01 for somebody')
    console.log('                 terminated in January 2026 never governed')
    console.log('                 anything. No historical wages are invented.')
    console.log('  CDL items      64 of 69 carry an expiry, most of them past.')
    console.log('                 Seeding them builds a safety queue whose')
    console.log('                 every row is a breach nobody can act on.')
    console.log('  Asset history  an OPEN period would claim these people')
    console.log('                 currently drive; a CLOSED one needs a start')
    console.log('                 date the export gives on 6 of 69.')

    if (!WRITE) {
      heading('NOTHING WAS WRITTEN')
      console.log(
        `  ${rows.length - existing.length} driver row(s) would be created, INACTIVE.`,
      )
      console.log('  Re-run with --write once the above is agreed.')
      return
    }

    heading('WRITING')
    let created = 0
    let unchanged = 0
    for (const row of rows) {
      const already = existingByExternalId.get(row.planned.externalId)
      if (already) {
        unchanged++
        continue
      }

      const companyId = tenancy.companies.find(
        (company) => company.name === row.planned.authority,
      )?.id
      if (!companyId) {
        // Named rather than thrown: one missing authority should not abandon
        // the run half-written, and the retired three are exactly the rows
        // that would hit this if the authorities seed had not been run first.
        console.log(
          `  SKIPPED  ${row.planned.firstName} ${row.planned.lastName} — no company named ${row.planned.authority}`,
        )
        continue
      }

      await db.driver.create({
        data: {
          organizationId: tenancy.organizationId,
          companyId,
          externalId: row.planned.externalId,
          firstName: row.planned.firstName,
          lastName: row.planned.lastName,
          phone: row.planned.phone,
          email: row.planned.email,
          cdlNumber: row.planned.cdlNumber,
          cdlState: row.planned.cdlState,
          // INACTIVE IS THE WHOLE POINT. `ASSIGNABLE_DRIVER` filters on it, so
          // this is what keeps 69 people who left out of the dispatch board,
          // the create-load select and the load assignment picker.
          status: 'INACTIVE',
          driverType: row.planned.driverType,
          ...(row.terminationIso
            ? {
                terminationDate: new Date(
                  `${row.terminationIso}T00:00:00.000Z`,
                ),
              }
            : {}),
        },
      })
      created++
      console.log(
        `  created  ${row.planned.firstName} ${row.planned.lastName}  ` +
          `${row.planned.authority}  ${row.terminationIso ?? 'no termination date'}`,
      )
    }

    heading('WRITTEN')
    console.log(`  ${created} created INACTIVE, ${unchanged} already there`)
    console.log('  0 pay rules, 0 compliance items, 0 asset-history periods')
  } finally {
    await db.$disconnect()
  }
}

await main()
