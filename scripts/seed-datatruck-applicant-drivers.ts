import { neonConfig } from '@neondatabase/serverless'
import { readFileSync } from 'node:fs'
import { createPrismaClient } from '@/lib/db'
import { asRecords, readXlsx } from '@/lib/datatruck/xlsx'
import { planDrivers, type PlannedDriver } from '@/lib/datatruck/drivers'
import { assertTenancy } from './datatruck-tenancy'

// ---------------------------------------------------------------------------
// THE LAST 39 DRIVERS THE LOAD HISTORY NAMES, WHOM DATATRUCK CALLS APPLICANTS.
//
//   npx tsx -r dotenv/config scripts/seed-datatruck-applicant-drivers.ts            (preview)
//   npx tsx -r dotenv/config scripts/seed-datatruck-applicant-drivers.ts --write
//   npx tsx -r dotenv/config scripts/seed-datatruck-applicant-drivers.ts --production --write
//
// The all-drivers export holds 170 rows: the 54 active and the 69 terminated
// already seeded, plus 47 whose `Employee status` is `applicant`. That label
// is not descriptive — 39 of the 47 have driven real freight, up to 191 loads
// each, between 2024-12-28 and 2026-08-28. With these rows in, every one of
// the 155 driver names in the load history resolves.
//
// ── THE SELECTION RULE IS THE FREIGHT, NOT THE STATUS COLUMN ──────────────
//
// A row is seeded only when at least one load names it. That is why this seed
// reads the LOAD export as well as the driver one, which no other seed does.
//
// THE EIGHT WITH NO FREIGHT ARE LEFT OUT, by the owner's ruling: no load
// references them, and a driver row for somebody never employed is noise. The
// next export diff shows them as new, which is the honest state rather than a
// row created to make a diff quiet.
//
// ── INACTIVE IS AN INFERENCE AND THE REPORT SAYS SO ───────────────────────
//
// These rows carry NO termination date — unlike the terminated 69, where 43 of
// them did. So "they have stopped driving" is read from the absence of recent
// freight and from Datatruck's own `not_ready`, not from a date anybody wrote.
// Every report line names the inference in words rather than leaving the
// status to be discovered later as though it were a fact from the export.
//
// AND THE LIKELY EXCEPTIONS ARE CALLED OUT BY NAME. Two rows carry an assigned
// truck and one hauled eleven days before the export was taken; those are the
// three most likely to actually be current. Activating a driver is one
// reversible click on their page, which is the right place for that decision —
// this seed does not guess it.
//
// ── WHAT IT DOES NOT WRITE ────────────────────────────────────────────────
//
// The same three refusals as the terminated seed, for the same reasons: no pay
// rules, no CDL compliance items, no asset-history periods. Because no pay rule
// is written, an unreadable tariff decides only a LABEL here — so this is the
// one caller that asks `planDrivers` for `unreadableTariff: 'default'`, per the
// owner's ruling that holding a row over a label would strip a driver out of
// the import and leave their loads with nobody to attach to.
// ---------------------------------------------------------------------------

neonConfig.webSocketConstructor ??= WebSocket
neonConfig.poolQueryViaFetch = false

const DEFAULT_EXPORT = 'corpus/datatruck/all-drivers_2026_09_09_07_56_22.xlsx'
const ACTIVE_EXPORT = 'corpus/datatruck/drivers_2026_09_07_10_11_36.xlsx'
const TERMINATED_EXPORT = 'corpus/datatruck/drivers_2026_09_09_07_36_17.xlsx'
const LOADS_EXPORT = 'corpus/datatruck/loads-and-trips_2026_09_08_20_05_05.xlsx'

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

const read = async (path: string) =>
  asRecords(await readXlsx(new Uint8Array(readFileSync(path))))
const cell = (row: Record<string, string>, key: string) =>
  (row[key] ?? '').trim()

/** Exact, after collapsing case and whitespace. Never nearest-match. */
const nameKey = (text: string) => text.trim().toLowerCase().replace(/\s+/g, ' ')

/** `Sep 09, 2026` → `2026-09-09`. Never `new Date(text)`; see med-dates.ts. */
const MONTHS: Readonly<Record<string, number>> = {
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
function isoDay(text: string): string | null {
  const match = /^([A-Z][a-z]{2}) (\d{2}), (\d{4})/.exec(text.trim())
  const month = match ? MONTHS[match[1]!] : undefined
  return match && month
    ? `${match[3]}-${String(month).padStart(2, '0')}-${match[2]}`
    : null
}

interface Freight {
  loads: number
  lastDay: string | null
}

interface Candidate {
  planned: PlannedDriver
  freight: Freight
  assignedTruck: string | null
}

async function main(): Promise<void> {
  const bytes = new Uint8Array(readFileSync(FILE))
  const all = asRecords(await readXlsx(bytes))
  const where = target()

  // ── WHO IS ALREADY IN, BY THE KEY THE SEEDS USE ────────────────────────
  //
  // Read from the two export files rather than from the database, because they
  // are what produced those rows and this comparison must not depend on which
  // database is being previewed.
  const seededIds = new Set([
    ...(await read(ACTIVE_EXPORT)).map((row) => cell(row, 'Driver ID')),
    ...(await read(TERMINATED_EXPORT)).map((row) => cell(row, 'Driver ID')),
  ])

  // ── THE FREIGHT, WHICH IS THE SELECTION RULE ───────────────────────────
  const loads = await read(LOADS_EXPORT)
  const freightByName = new Map<string, Freight>()
  for (const load of loads) {
    const name = nameKey(cell(load, 'Driver/Carrier'))
    if (name === '') continue
    const seen = freightByName.get(name) ?? { loads: 0, lastDay: null }
    seen.loads += 1
    const day = isoDay(cell(load, 'PU date'))
    if (day && (seen.lastDay === null || day > seen.lastDay)) seen.lastDay = day
    freightByName.set(name, seen)
  }

  // Planned from the WHOLE file, then filtered — so the held list below is
  // about the rows this seed would take, and the planner sees every row it
  // would have to reject for a reason other than the selection rule.
  const extraRecords = all.filter(
    (row) => !seededIds.has(cell(row, 'Driver ID')),
  )
  const plan = planDrivers(extraRecords, { unreadableTariff: 'default' })

  const truckByExternalId = new Map(
    extraRecords.map((row) => [
      cell(row, 'Driver ID'),
      cell(row, 'Assigned truck'),
    ]),
  )

  const candidates: Candidate[] = []
  const noFreight: PlannedDriver[] = []
  for (const planned of plan.planned) {
    const freight = freightByName.get(
      nameKey(`${planned.firstName} ${planned.lastName}`),
    )
    if (!freight) {
      noFreight.push(planned)
      continue
    }
    candidates.push({
      planned,
      freight,
      assignedTruck: truckByExternalId.get(planned.externalId) || null,
    })
  }
  candidates.sort((a, b) => b.freight.loads - a.freight.loads)

  console.log(
    `export  ${FILE} (${bytes.length} bytes, ${all.length} data rows)`,
  )
  console.log(`mode    ${WRITE ? 'WRITE' : 'preview only'}`)

  const db = createPrismaClient(where.url)
  try {
    const tenancy = await assertTenancy(db, {
      label: where.label,
      host: where.host,
      slug: ORGANIZATION_SLUG,
      expectOrganizationId: where.expectOrganizationId,
    })

    heading('THE PARTITION')
    console.log(
      `  ${String(all.length).padStart(3)}  rows in the all-drivers export`,
    )
    console.log(
      `  ${String(seededIds.size).padStart(3)}  already seeded (active + terminated)`,
    )
    console.log(
      `  ${String(extraRecords.length).padStart(3)}  in neither, all of them "applicant"`,
    )
    console.log(
      `  ${String(candidates.length).padStart(3)}  of those are named by at least one load — TO SEED`,
    )
    console.log(
      `  ${String(noFreight.length).padStart(3)}  named by no load — LEFT OUT, per the ruling`,
    )

    heading('LEFT OUT — no load references them')
    for (const driver of noFreight) {
      console.log(
        `  id ${driver.externalId.padEnd(5)} ${`${driver.firstName} ${driver.lastName}`.padEnd(28)} ${driver.authority}`,
      )
    }
    console.log(
      '\n  A driver row for somebody never employed is noise. The next export',
    )
    console.log('  diff shows them as new, which is the honest state.')

    // ── THE ONES MOST LIKELY TO ACTUALLY BE CURRENT ────────────────────
    //
    // Called out by name so a human decides, because this seed's INACTIVE is
    // an inference and these three are where it is most likely wrong.
    const withTruck = candidates.filter((c) => c.assignedTruck !== null)
    const mostRecent = [...candidates]
      .filter((c) => c.freight.lastDay !== null)
      .sort((a, b) => (b.freight.lastDay! > a.freight.lastDay! ? 1 : -1))[0]

    heading('CHECK THESE BY HAND — they may still be driving')
    for (const candidate of withTruck) {
      console.log(
        `  ${`${candidate.planned.firstName} ${candidate.planned.lastName}`.padEnd(28)} ` +
          `assigned truck ${candidate.assignedTruck}  ` +
          `${candidate.freight.loads} loads, last ${candidate.freight.lastDay ?? '—'}`,
      )
    }
    if (mostRecent) {
      console.log(
        `  ${`${mostRecent.planned.firstName} ${mostRecent.planned.lastName}`.padEnd(28)} ` +
          `MOST RECENT HAULER — last load ${mostRecent.freight.lastDay}`,
      )
    }
    console.log(
      '\n  All of them are seeded INACTIVE. If any is current, activating them',
    )
    console.log('  is one reversible click on the driver page.')

    const defaulted = candidates.filter((c) => c.planned.payBps === null)
    heading(`TARIFF WOULD NOT READ — ${defaulted.length}, seeded anyway`)
    for (const candidate of defaulted) {
      console.log(
        `  ${`${candidate.planned.firstName} ${candidate.planned.lastName}`.padEnd(28)} ${candidate.planned.corrections.join('; ')}`,
      )
    }
    console.log(
      '\n  No pay rule is written for any of these rows, so the tariff decides',
    )
    console.log(
      '  only a label. Employment falls to the schema default. Holding a row',
    )
    console.log(
      '  over a label would leave its loads with nobody to attach to.',
    )

    heading(`HELD — ${plan.held.length} rows this seed will not write`)
    for (const held of plan.held) {
      console.log(`  ${held.externalId.padEnd(6)} ${held.who}`)
      console.log(`         ${held.reason}`)
    }

    const existing = await db.driver.findMany({
      where: {
        organizationId: tenancy.organizationId,
        externalId: { in: candidates.map((c) => c.planned.externalId) },
      },
      select: { externalId: true },
    })
    const existingIds = new Set(existing.map((row) => row.externalId ?? ''))
    console.log(
      `\n  ${existing.length} of ${candidates.length} already exist by Driver ID; ` +
        `${candidates.length - existing.length} would be created`,
    )

    heading('NOT WRITTEN, ON PURPOSE')
    console.log('  Pay rules      no historical wages are invented.')
    console.log('  CDL items      a queue whose every row is a breach.')
    console.log('  Asset history  no start date the export can support.')

    heading(`TO SEED — ${candidates.length}, all INACTIVE`)
    for (const candidate of candidates) {
      console.log(
        `  ${`${candidate.planned.firstName} ${candidate.planned.lastName}`.padEnd(28)} ` +
          `applicant in Datatruck, drove ${candidate.freight.loads} loads, no end date` +
          `${existingIds.has(candidate.planned.externalId) ? '  (already there)' : ''}`,
      )
    }

    if (!WRITE) {
      heading('NOTHING WAS WRITTEN')
      console.log(
        `  ${candidates.length - existing.length} driver row(s) would be created, INACTIVE.`,
      )
      console.log('  Re-run with --write once the above is agreed.')
      return
    }

    heading('WRITING')
    let created = 0
    let unchanged = 0
    for (const candidate of candidates) {
      if (existingIds.has(candidate.planned.externalId)) {
        unchanged++
        continue
      }

      const companyId = tenancy.companies.find(
        (company) => company.name === candidate.planned.authority,
      )?.id
      if (!companyId) {
        console.log(
          `  SKIPPED  ${candidate.planned.firstName} ${candidate.planned.lastName} — no company named ${candidate.planned.authority}`,
        )
        continue
      }

      await db.driver.create({
        data: {
          organizationId: tenancy.organizationId,
          companyId,
          externalId: candidate.planned.externalId,
          firstName: candidate.planned.firstName,
          lastName: candidate.planned.lastName,
          phone: candidate.planned.phone,
          email: candidate.planned.email,
          cdlNumber: candidate.planned.cdlNumber,
          cdlState: candidate.planned.cdlState,
          // INACTIVE, AND NO TERMINATION DATE. The export gives none, and a
          // date invented here would be indistinguishable later from one
          // Datatruck actually recorded.
          status: 'INACTIVE',
          driverType: candidate.planned.driverType,
          // THE INFERENCE, ON THE ROW ITSELF. Whoever opens this driver in six
          // months should not have to find this script to learn why they are
          // inactive with no end date.
          notes:
            `Imported from Datatruck (driver ${candidate.planned.externalId}). ` +
            `Applicant in Datatruck, drove ${candidate.freight.loads} loads` +
            `${candidate.freight.lastDay ? ` to ${candidate.freight.lastDay}` : ''}, ` +
            `no end date — INACTIVE is an inference, not a recorded fact.`,
        },
      })
      created++
      console.log(
        `  created  ${`${candidate.planned.firstName} ${candidate.planned.lastName}`.padEnd(28)} ` +
          `applicant in Datatruck, drove ${candidate.freight.loads} loads, no end date`,
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
