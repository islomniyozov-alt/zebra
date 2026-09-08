import { neonConfig } from '@neondatabase/serverless'
import { readFileSync } from 'node:fs'
import { createPrismaClient } from '@/lib/db'
import { asRecords, readXlsx } from '@/lib/datatruck/xlsx'
import {
  employmentFromColumn,
  planDrivers,
  type PlannedDriver,
} from '@/lib/datatruck/drivers'
import { openFirstPeriod } from '@/lib/asset-transfer'
import type { TxClient } from '@/lib/tenancy'
import { assertTenancy } from './datatruck-tenancy'
import type { PrismaClient } from '../src/generated/prisma/client'

// ---------------------------------------------------------------------------
// 54 REAL DRIVERS, AND WHAT EACH OF THEM IS PAID.
//
//   npx tsx -r dotenv/config scripts/seed-datatruck-drivers.ts            (preview)
//   npx tsx -r dotenv/config scripts/seed-datatruck-drivers.ts --write
//
// KEYED ON `Driver.externalId`, the column added by
// 20260907120000_driver_external_id for exactly this. Names were the
// alternative and they are unique across these 54 rows TODAY — which is the
// most comfortable way to be wrong, since it holds until somebody marries.
//
// THE PAY RULE IS THE POINT AND THE RISK. Each driver gets one
// `PERCENT_LINEHAUL` rule at a STATED `effectiveFrom` of 2026-08-01, never the
// date this script happened to run. `DriverPayRule` is versioned by effective
// date precisely so that historical settlements stay reproducible, so a rule
// dated by the clock would make every settlement before today unreproducible
// and every one after it depend on when somebody typed a command.
//
// AND THE DATE IS ASSERTED, NOT ASSUMED. If any load in the database picked up
// before 2026-08-01, this refuses to write: that load would settle against a
// pay rule that did not exist when it ran, which is the one failure a
// date-versioned pay table is built to make impossible.
// ---------------------------------------------------------------------------

neonConfig.webSocketConstructor ??= WebSocket
neonConfig.poolQueryViaFetch = false

const DEFAULT_EXPORT = 'corpus/datatruck/drivers_2026_09_07_10_11_36.xlsx'

const WRITE = process.argv.includes('--write')
const OVERWRITE = process.argv.includes('--overwrite')
const FILE =
  process.argv.find((argument) => argument.endsWith('.xlsx')) ?? DEFAULT_EXPORT

const ORGANIZATION_SLUG = 'zebra'

// ── WHICH DATABASE, AND HOW IT IS CHOSEN ──────────────────────────────────
//
// `--production` READS `PROD_DIRECT_DATABASE_URL` AND NOTHING ASSIGNS IT
// ANYWHERE. It is passed to `createPrismaClient` as an argument and never
// written into `DATABASE_URL` or `DIRECT_DATABASE_URL` — the fence in
// tests/prod-url-guard.test.ts asserts that literally, because on 2026-08-15
// an owner connection string reached production's `DATABASE_URL` by clipboard
// and only `db.ts` refusing anything without `zebra_app` turned a silent
// row-level-security bypass into a loud outage.
//
// THIS SCRIPT IS ONE OF THE FENCE'S FIRST TWO WRITERS. Every other name on
// that list either only SELECTs or is a walkthrough. The safety here is the
// same shape the maintenance readers use: preview is the default, `--write` is
// a second decision, and `assertTenancy` names the organization and refuses
// one it did not expect.
const PRODUCTION = process.argv.includes('--production')

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

/** The stated start of this fleet's recorded history. Never the run date. */
const EFFECTIVE_FROM = new Date('2026-08-01T00:00:00.000Z')
const EFFECTIVE_FROM_DAY = '2026-08-01'

/** Fields this seed owns on an existing Driver row. */
const MANAGED = ['phone', 'email', 'cdlNumber', 'cdlState'] as const
type Managed = (typeof MANAGED)[number]

function heading(text: string): void {
  console.log(`\n${text}`)
  console.log('─'.repeat(Math.max(text.length, 62)))
}

/**
 * The assertion the ruling asked for, run before anything is written.
 *
 * A load that picked up before the pay rules start is a load whose settlement
 * would reach back past every rule this seed creates and find nothing. That is
 * not a warning: `driver-pay.ts` would either refuse it or pay it under a rule
 * chosen by accident, and both are wrong in a way that only shows up in
 * somebody's wages.
 */
async function assertNoEarlierFreight(db: PrismaClient): Promise<void> {
  const earliest = await db.loadStop.findFirst({
    where: { type: 'PICKUP', scheduledAt: { lt: EFFECTIVE_FROM } },
    orderBy: { scheduledAt: 'asc' },
    select: {
      scheduledAt: true,
      load: { select: { loadNumber: true, referenceNumber: true } },
    },
  })

  if (!earliest) {
    console.log(
      `  OK — no load picks up before ${EFFECTIVE_FROM_DAY}, so every pay rule this`,
    )
    console.log('       seed writes covers the whole life of every load.')
    return
  }

  const count = await db.loadStop.count({
    where: { type: 'PICKUP', scheduledAt: { lt: EFFECTIVE_FROM } },
  })

  throw new Error(
    `REFUSING TO WRITE. ${count} load stop(s) pick up before ${EFFECTIVE_FROM_DAY}. ` +
      `The earliest is load ${earliest.load.loadNumber} (${earliest.load.referenceNumber ?? 'no reference'}) ` +
      `at ${earliest.scheduledAt?.toISOString() ?? '(no date)'}.\n\n` +
      `Every pay rule this seed writes starts on ${EFFECTIVE_FROM_DAY}. A load that ran ` +
      `before that would settle against no rule at all. Either the effective date is ` +
      `wrong, or those loads are, and a seed is not the place to decide which.`,
  )
}

function preview(
  plan: ReturnType<typeof planDrivers>,
  /** `authority/unit` — the same key the write matches on. */
  truckKeys: Set<string>,
  /** Unit numbers under any authority, to tell "missing" from "elsewhere". */
  anyUnit: Set<string>,
): void {
  const { planned, held } = plan

  heading('COUNTS')
  const byAuthority = new Map<string, number>()
  for (const driver of planned) {
    byAuthority.set(
      driver.authority,
      (byAuthority.get(driver.authority) ?? 0) + 1,
    )
  }
  for (const [authority, count] of [...byAuthority].sort()) {
    console.log(`  ${String(count).padStart(3)}  ${authority}`)
  }
  console.log(
    `  ${String(planned.length).padStart(3)}  total to seed, of ${plan.read} rows read`,
  )

  console.log('')
  const withCdl = planned.filter((d) => d.cdlNumber).length
  const withState = planned.filter((d) => d.cdlState).length
  const withExpiry = planned.filter((d) => d.cdlExpiresAt).length
  console.log(`  cdlNumber    present on ${withCdl}/${planned.length}`)
  console.log(
    `  cdlState     present on ${withState}/${planned.length}, null on ${planned.length - withState}`,
  )
  console.log(
    `  expiry       present on ${withExpiry}/${planned.length} — that many CDL ComplianceItems`,
  )

  // ── THE THREE THE RULING ASKED TO SEE BY NAME ───────────────────────────
  const small = planned
    .filter((d) => d.payBps < 1000)
    .sort((a, b) => a.payBps - b.payBps)
  heading(`PERCENTAGES UNDER 10% — ${small.length}, seeded exactly as printed`)
  for (const d of small) {
    console.log(
      `  ${(d.payBps / 100).toFixed(0).padStart(2)}%  ${`${d.firstName} ${d.lastName}`.padEnd(24)} ` +
        `id=${d.externalId.padEnd(5)} truck=${d.truckUnit ?? '(none)'}  ${d.authority}`,
    )
  }
  console.log(
    '  Not corrected and not refused. They parse, so they are what the',
  )
  console.log('  export says; whether they are right is a ruling, not a parse.')

  const bands = {
    'under 10%': 0,
    '10–59%': 0,
    '60–87%': 0,
    '88–90%': 0,
    'over 90%': 0,
  }
  for (const d of planned) {
    const p = d.payBps / 100
    if (p < 10) bands['under 10%']++
    else if (p < 60) bands['10–59%']++
    else if (p < 88) bands['60–87%']++
    else if (p <= 90) bands['88–90%']++
    else bands['over 90%']++
  }
  console.log('')
  for (const [band, n] of Object.entries(bands)) {
    if (n) console.log(`  ${band.padEnd(10)} ${n}`)
  }

  // ── WHY A DRIVER MIGHT NOT GET THEIR TRUCK ──────────────────────────────
  //
  // MEASURED ON THE SAME KEY THE WRITE USES, which is `(authority, unit)` and
  // not the unit alone. The first version of this block asked only whether the
  // unit number existed ANYWHERE and reported 3 unmatched — then the write
  // linked 32 of 47, because 12 more drivers name a real truck belonging to
  // the OTHER authority. An instrument that measures a superset of the thing
  // it is reporting on tells you a comfortable number; these two now agree by
  // construction.
  const withUnit = planned.filter((d) => d.truckUnit)
  const missing = withUnit.filter((d) => !anyUnit.has(d.truckUnit!))
  const crossAuthority = withUnit.filter(
    (d) =>
      anyUnit.has(d.truckUnit!) &&
      !truckKeys.has(`${d.authority}/${d.truckUnit}`),
  )

  heading(`TRUCK UNIT NOT SEEDED AT ALL — ${missing.length}`)
  for (const d of missing) {
    console.log(
      `  unit ${(d.truckUnit ?? '').padEnd(6)} ${`${d.firstName} ${d.lastName}`.padEnd(26)} id=${d.externalId}  ${d.authority}`,
    )
  }

  heading(`TRUCK BELONGS TO THE OTHER AUTHORITY — ${crossAuthority.length}`)
  for (const d of crossAuthority) {
    console.log(
      `  unit ${(d.truckUnit ?? '').padEnd(6)} ${`${d.firstName} ${d.lastName}`.padEnd(26)} driver files under ${d.authority}`,
    )
  }
  console.log('')
  console.log('  The export disagrees with itself on these: the driver row and')
  console.log('  the truck row name different carriers. NOT resolved here —')
  console.log('  picking one would be this system deciding which authority ran')
  console.log(
    '  the freight, which is the question the record exists to answer.',
  )

  const noTruck = planned.filter((d) => !d.truckUnit).length
  const linkable = withUnit.length - missing.length - crossAuthority.length
  console.log('')
  console.log(
    `  ${linkable} of ${planned.length} drivers will be linked to a truck ` +
      `(${noTruck} name none, ${missing.length} name a held truck, ${crossAuthority.length} cross-authority).`,
  )

  // ── NO LICENCE STATE ────────────────────────────────────────────────────
  const stateless = planned.filter((d) => !d.cdlState)
  heading(`NO CDL STATE — ${stateless.length}, and nothing infers one`)
  console.log(
    `  ${stateless.map((d) => `${d.firstName} ${d.lastName} (${d.externalId})`).join(', ')}`,
  )
  console.log('')
  console.log('  cdlState stays null on every one. Not from the area code, not')
  console.log('  from the authority, not from where the others are licensed.')

  // ── PAY CLASS, DERIVED — AND EVERY DISAGREEMENT NAMED ───────────────────
  //
  // The ruling: 85% and above is an owner-operator, below is a company driver,
  // read off the percentage rather than off `Driver Type`. That column is a
  // payroll label — 21 rows marked company_driver are paid 88-90%. Deriving
  // quietly would be this system overruling a human-entered field in silence,
  // so the ones it overrules are listed here in full.
  const derivedCounts = new Map<string, number>()
  for (const d of planned) {
    derivedCounts.set(
      d.employmentType,
      (derivedCounts.get(d.employmentType) ?? 0) + 1,
    )
  }
  heading('PAY CLASS, DERIVED FROM THE TARIFF')
  for (const [type, n] of [...derivedCounts].sort()) {
    console.log(`  ${String(n).padStart(3)}  ${type}`)
  }

  const disagreeing = planned.filter((d) => {
    const declared = employmentFromColumn(d.declaredType)
    return declared !== null && declared !== d.employmentType
  })
  heading(
    `DERIVED TYPE DISAGREES WITH THE EXPORT'S COLUMN — ${disagreeing.length}`,
  )
  for (const d of disagreeing) {
    console.log(
      `  ${`${d.firstName} ${d.lastName}`.padEnd(28)} id=${d.externalId.padEnd(5)} ` +
        `${String(d.payBps / 100).padStart(5)}%  column=${(d.declaredType ?? '').padEnd(15)} -> ${d.employmentType}`,
    )
  }
  console.log('')
  console.log('  Editable per driver on screen. The column is not deleted or')
  console.log('  corrected in Datatruck by this seed — only disagreed with,')
  console.log('  in writing.')

  const corrected = planned.filter((d) => d.corrections.length > 0)
  heading(`REWRITES — ${corrected.length} rows`)
  for (const d of corrected) {
    for (const note of d.corrections) {
      console.log(`  ${`${d.firstName} ${d.lastName}`.padEnd(24)} ${note}`)
    }
  }

  heading(`HELD — ${held.length} rows this seed will not write`)
  for (const h of held) {
    console.log(
      `  id=${h.externalId.padEnd(5)} ${h.who.padEnd(24)} ${h.reason}`,
    )
  }
  if (held.length === 0) console.log('  none — all 54 rows parse.')
}

async function write(
  db: PrismaClient,
  planned: PlannedDriver[],
  truckIdByKey: Map<string, string>,
): Promise<void> {
  const organization = await db.organization.findUnique({
    where: { slug: ORGANIZATION_SLUG },
    select: { id: true },
  })
  if (!organization)
    throw new Error(`No organization with slug ${ORGANIZATION_SLUG}.`)

  const companies = await db.company.findMany({
    where: { organizationId: organization.id },
    select: { id: true, name: true },
  })
  const companyByName = new Map(companies.map((c) => [c.name, c.id]))

  const unknown = [...new Set(planned.map((d) => d.authority))].filter(
    (name) => !companyByName.has(name),
  )
  if (unknown.length > 0) {
    throw new Error(`Authorities not in the database: ${unknown.join(', ')}.`)
  }

  let created = 0
  let updated = 0
  let unchanged = 0
  let rules = 0
  let compliance = 0
  let periods = 0
  let promoted = 0
  let linked = 0

  for (const driver of planned) {
    const companyId = companyByName.get(driver.authority)!
    const truckId = driver.truckUnit
      ? (truckIdByKey.get(`${companyId}/${driver.truckUnit}`) ?? null)
      : null

    let row = await db.driver.findFirst({
      where: { organizationId: organization.id, externalId: driver.externalId },
    })

    if (!row) {
      row = await db.driver.create({
        data: {
          organizationId: organization.id,
          companyId,
          externalId: driver.externalId,
          firstName: driver.firstName,
          lastName: driver.lastName,
          phone: driver.phone,
          email: driver.email,
          cdlNumber: driver.cdlNumber,
          cdlState: driver.cdlState,
          assignedTruckId: truckId,
          // DERIVED FROM THE TARIFF, per the ruling — see
          // `employmentFromTariff`. The export's `Driver Type` column is a
          // payroll label and is recorded in the report, not written here.
          employmentType: driver.employmentType,
          // STATUS IS NOT IMPORTED, same as the trucks. The export says 26
          // dispatched and 5 in_transit; Zebra's DriverStatus follows dispatch,
          // and a driver seeded DISPATCHED with no load is a board claiming
          // somebody is out when nothing sent them.
          //
          // THE RULING CAME ON 2026-09-07 and this comment used to say the
          // opposite: that whether company_owner meant OWNER_OPERATOR was a
          // ruling nobody had made, so the column kept its default. It has
          // been made, and it went the other way — the COLUMN is not the
          // signal at all. See `employmentFromTariff`.
        },
      })
      created++
      if (truckId) linked++
      console.log(
        `  created  ${driver.firstName} ${driver.lastName} (${driver.externalId})`,
      )
    } else {
      // Keyed by the managed set plus the truck link, so a typo in a field
      // name is a compile error rather than a column this seed silently
      // never writes.
      const changes: Partial<Record<Managed | 'assignedTruckId', string>> = {}
      for (const key of MANAGED) {
        const next = driver[key]
        if (next === null) continue
        const current = (row as unknown as Record<string, unknown>)[key] ?? null
        if (current === next) continue
        if (current !== null && !OVERWRITE) continue
        changes[key] = next
      }
      if (truckId && !row.assignedTruckId) changes['assignedTruckId'] = truckId

      if (Object.keys(changes).length === 0) {
        unchanged++
      } else {
        await db.driver.update({ where: { id: row.id }, data: changes })
        updated++
        console.log(
          `  updated  ${driver.firstName} ${driver.lastName}  ${Object.keys(changes).join(', ')}`,
        )
      }
    }

    // ── THE DERIVED PAY CLASS, ON A ROW THAT PREDATES THE RULING ────────
    //
    // The 54 dev rows were seeded before `employmentType` was derived, so they
    // all hold the schema default. Promoting them is the point of a re-run.
    //
    // ONLY FROM THE DEFAULT, THOUGH. If the stored value is anything else,
    // somebody chose it on the driver screen — the ruling says this is
    // editable per driver — and a seed that overwrote that would undo the
    // correction every time it ran. `--overwrite` is the deliberate way past.
    if (
      row.employmentType !== driver.employmentType &&
      (row.employmentType === 'OWNED' || OVERWRITE)
    ) {
      await db.driver.update({
        where: { id: row.id },
        data: { employmentType: driver.employmentType },
      })
      promoted++
      console.log(
        `  class    ${driver.firstName} ${driver.lastName}: ${row.employmentType} -> ${driver.employmentType} (${driver.payBps / 100}%)`,
      )
    }

    // ── THE PAY RULE ────────────────────────────────────────────────────
    //
    // Matched on (driver, type, effectiveFrom) so a re-run finds the rule it
    // wrote rather than stacking a second one on the same date. A driver with
    // two open rules for one day is a settlement that picks one by accident.
    //
    // AN EXISTING RULE IS NEVER REWRITTEN. If somebody has changed a driver's
    // percentage since the import, that is the newer truth, and versioning is
    // the whole point of this table — a correction arrives as a NEW row with a
    // later date, never as an edit to this one.
    const existingRule = await db.driverPayRule.findFirst({
      where: {
        driverId: row.id,
        type: 'PERCENT_LINEHAUL',
        effectiveFrom: EFFECTIVE_FROM,
      },
      select: { id: true, percentBps: true },
    })
    if (!existingRule) {
      await db.driverPayRule.create({
        data: {
          driverId: row.id,
          organizationId: organization.id,
          type: 'PERCENT_LINEHAUL',
          percentBps: driver.payBps,
          effectiveFrom: EFFECTIVE_FROM,
          notes: `Imported from Datatruck (driver ${driver.externalId}).`,
        },
      })
      rules++
    } else if (existingRule.percentBps !== driver.payBps) {
      console.log(
        `  NOTE     ${driver.firstName} ${driver.lastName}: rule on ${EFFECTIVE_FROM_DAY} is ` +
          `${(existingRule.percentBps ?? 0) / 100}%, export says ${driver.payBps / 100}% — left alone.`,
      )
    }

    // ── THE CDL EXPIRY, AS A COMPLIANCE ITEM ────────────────────────────
    //
    // This is what makes the expiry show up on the calendar and in the
    // notifications rather than sitting inert in a column. Only written when
    // the card actually carries a date — `expiresAt` is NOT NULL, and there is
    // no honest value to invent for the 8 rows without one.
    if (driver.cdlExpiresAt) {
      const expiresAt = new Date(`${driver.cdlExpiresAt}T00:00:00.000Z`)
      const existingItem = await db.complianceItem.findFirst({
        where: { driverId: row.id, type: 'CDL', deletedAt: null },
        select: { id: true },
      })
      if (!existingItem) {
        await db.complianceItem.create({
          data: {
            organizationId: organization.id,
            companyId,
            type: 'CDL',
            driverId: row.id,
            identifier: driver.cdlNumber,
            issuer: driver.cdlState,
            expiresAt,
          },
        })
        compliance++
      }
    }

    // ── ASSET HISTORY ───────────────────────────────────────────────────
    //
    // Drivers are assets in `AssetAssignment` exactly as trucks are, and
    // `findAuthorityDrift` checks them the same way. The trucks seed learned
    // this the hard way — 46 rows written around the service layer, all 46
    // caught by the backstop. Dated 2026-08-01, not the run date.
    const open = await db.assetAssignment.findFirst({
      where: { driverId: row.id, effectiveTo: null },
      select: { id: true },
    })
    if (!open) {
      await openFirstPeriod(
        db as unknown as TxClient,
        organization.id,
        companyId,
        { driverId: row.id },
        null,
        EFFECTIVE_FROM,
      )
      periods++
    }
  }

  heading('WRITTEN')
  console.log(
    `  ${created} drivers created, ${updated} updated, ${unchanged} unchanged`,
  )
  console.log(`  ${rules} pay rules at ${EFFECTIVE_FROM_DAY}`)
  console.log(`  ${compliance} CDL compliance items`)
  console.log(`  ${periods} asset-history periods from ${EFFECTIVE_FROM_DAY}`)
  console.log(`  ${linked} drivers linked to a seeded truck`)
  console.log(`  ${promoted} pay class(es) promoted from the schema default`)
}

async function main(): Promise<void> {
  const bytes = new Uint8Array(readFileSync(FILE))
  const plan = planDrivers(asRecords(await readXlsx(bytes)))
  const where = target()

  console.log(`export  ${FILE} (${bytes.length} bytes, ${plan.read} data rows)`)
  console.log(`mode    ${WRITE ? 'WRITE' : 'preview only'}`)

  const db = createPrismaClient(where.url)

  try {
    // THE TENANT IS NAMED BEFORE ANYTHING ELSE. This connection bypasses
    // row-level security, so nothing downstream would refuse a write into the
    // wrong organization — it would simply succeed and look right.
    await assertTenancy(db, {
      label: where.label,
      host: where.host,
      slug: ORGANIZATION_SLUG,
      expectOrganizationId: where.expectOrganizationId,
    })

    // READ FIRST, EVEN IN PREVIEW. The truck match and the date assertion are
    // both facts about the database, and a preview that guessed at them would
    // be describing a seed run that cannot happen.
    heading(
      `THE PAY RULES START ON ${EFFECTIVE_FROM_DAY} — CHECKING NO FREIGHT PREDATES THEM`,
    )
    await assertNoEarlierFreight(db)

    const trucks = await db.truck.findMany({
      where: { deletedAt: null },
      select: {
        id: true,
        unitNumber: true,
        companyId: true,
        company: { select: { name: true } },
      },
    })
    const truckIdByKey = new Map(
      trucks.map((t) => [`${t.companyId}/${t.unitNumber}`, t.id]),
    )
    // Keyed by company NAME here because that is what the plan carries;
    // `truckIdByKey` above is keyed by companyId because that is what the
    // write has. Two spellings of one key, and the preview must use the one
    // the plan speaks or it measures something else.
    const truckKeys = new Set(
      trucks.map((t) => `${t.company.name}/${t.unitNumber}`),
    )
    const anyUnit = new Set(trucks.map((t) => t.unitNumber))

    preview(plan, truckKeys, anyUnit)

    if (!WRITE) {
      heading('NOTHING WAS WRITTEN')
      console.log('  Re-run with --write once the above is agreed.')
      return
    }

    await write(db, plan.planned, truckIdByKey)
  } finally {
    await db.$disconnect()
  }
}

await main()
