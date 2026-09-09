import { neonConfig } from '@neondatabase/serverless'
import { readFileSync } from 'node:fs'
import { createPrismaClient } from '@/lib/db'
import { asRecords, readXlsx } from '@/lib/datatruck/xlsx'
import { planTrucks, type PlannedTruck } from '@/lib/datatruck/trucks'
import { assertTenancy } from './datatruck-tenancy'
import type { ComplianceType } from '../src/generated/prisma/client'

// ---------------------------------------------------------------------------
// THE REST OF THE FLEET, AND THE THREE DATES THE FIRST EXPORT NEVER CARRIED.
//
//   npx tsx -r dotenv/config scripts/seed-datatruck-all-trucks.ts            (preview)
//   npx tsx -r dotenv/config scripts/seed-datatruck-all-trucks.ts --write
//   npx tsx -r dotenv/config scripts/seed-datatruck-all-trucks.ts --production --write
//
// The all-trucks export holds 113 units where the first held 49. The extra 64
// are trucks that left the fleet, and 55 of them are named by the load history
// — 4,179 loads currently importing with a driver and no truck.
//
// ── THE EXTRAS ARRIVE OUT OF SERVICE, WITH NO ASSET HISTORY ──────────────
//
// The same shape as the terminated drivers, for the same reasons. An OPEN
// `AssetAssignment` would claim these trucks currently run for a carrier,
// which is false; a CLOSED one needs a start date this export does not carry.
// `findAuthorityDrift` skips them the way it skips inactive drivers.
//
// `TruckStatus` HAS NO `INACTIVE`, so OUT_OF_SERVICE is the honest value:
// AVAILABLE would put a sold truck on the dispatch board, and SOLD claims a
// disposal nobody recorded.
//
// ── COMPLIANCE FROM THE THREE DATES, ON EVERY TRUCK THAT HAS THEM ────────
//
// Registration, annual inspection and insurance — the owner's ruling covers
// live and out-of-service trucks alike, because a lapsed registration on a
// truck that left the fleet is history worth having. That is the opposite call
// to the one the driver seeds made about CDLs, and deliberately: a driver's
// expired licence is a person's private document, while a truck's expired
// registration is the fleet's own record of a vehicle it ran.
//
// ── WHERE A UNIT EXISTS ALREADY: ADD MISSING, REPLACE NOTHING ────────────
//
// The 49 already seeded keep every value they have. What they gain is the
// three dates, which the first export did not carry at all.
// ---------------------------------------------------------------------------

neonConfig.webSocketConstructor ??= WebSocket
neonConfig.poolQueryViaFetch = false

const DEFAULT_EXPORT = 'corpus/datatruck/trucks_2026_09_09_09_52_34.xlsx'

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
  console.log('─'.repeat(Math.max(text.length, 62)))
}

const unitKey = (text: string) => text.trim().toLowerCase().replace(/\s+/g, ' ')

/** The three dates, and the compliance row each becomes. */
const EXPIRIES: readonly {
  field: 'registrationExpiry' | 'inspectionExpiry' | 'insuranceExpiry'
  type: ComplianceType
  label: string
}[] = [
  { field: 'registrationExpiry', type: 'REGISTRATION', label: 'registration' },
  {
    field: 'inspectionExpiry',
    type: 'ANNUAL_INSPECTION',
    label: 'annual inspection',
  },
  {
    field: 'insuranceExpiry',
    // LIABILITY, WHICH IS THE ONE A CARRIER MUST CARRY. The export says
    // "Insurance" and nothing more; cargo and physical damage are separate
    // policies with separate dates, and filing this as either would be a
    // guess about which policy expired.
    type: 'INSURANCE_LIABILITY',
    label: 'insurance',
  },
]

async function main(): Promise<void> {
  const bytes = new Uint8Array(readFileSync(FILE))
  const records = asRecords(await readXlsx(bytes))
  const plan = planTrucks(records)
  const where = target()

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
    const companyByName = new Map(
      tenancy.companies.map((company) => [company.name, company.id]),
    )

    const existing = await db.truck.findMany({
      where: { organizationId: tenancy.organizationId, deletedAt: null },
      select: { id: true, unitNumber: true, companyId: true },
    })
    const existingByUnit = new Map<string, (typeof existing)[number][]>()
    for (const truck of existing) {
      const key = unitKey(truck.unitNumber)
      existingByUnit.set(key, [...(existingByUnit.get(key) ?? []), truck])
    }

    const fresh: PlannedTruck[] = []
    const known: PlannedTruck[] = []
    for (const truck of plan.planned) {
      if (existingByUnit.has(unitKey(truck.unitNumber))) known.push(truck)
      else fresh.push(truck)
    }

    heading('THE PARTITION')
    console.log(`  ${String(plan.read).padStart(3)}  rows in the export`)
    console.log(
      `  ${String(known.length).padStart(3)}  units already here — add-missing only`,
    )
    console.log(
      `  ${String(fresh.length).padStart(3)}  new units — created OUT_OF_SERVICE`,
    )
    console.log(`  ${String(plan.held.length).padStart(3)}  held`)

    heading(`HELD — ${plan.held.length} rows this seed will not write`)
    for (const held of plan.held) {
      console.log(`  unit ${held.unitNumber.padEnd(8)} ${held.reason}`)
    }
    console.log(
      '\n  `Truck.companyId` is NOT NULL and this seed does not invent which',
    )
    console.log('  carrier is responsible for a vehicle. Named, not defaulted.')

    const withDates = plan.planned.filter((truck) =>
      EXPIRIES.some((expiry) => truck[expiry.field] !== null),
    )
    heading('COMPLIANCE THE THREE DATES WOULD CREATE')
    for (const expiry of EXPIRIES) {
      const rows = plan.planned.filter((truck) => truck[expiry.field] !== null)
      const past = rows.filter(
        (truck) =>
          (truck[expiry.field] ?? '') < new Date().toISOString().slice(0, 10),
      ).length
      console.log(
        `  ${expiry.label.padEnd(18)} ${String(rows.length).padStart(3)} truck(s), ${past} already expired`,
      )
    }
    console.log(
      `\n  ${withDates.length} of ${plan.planned.length} trucks carry at least one date.`,
    )
    console.log(
      '  Live and out-of-service alike, per the ruling: a lapsed registration',
    )
    console.log('  on a truck that left the fleet is history worth having.')

    const ownership = new Map<string, number>()
    for (const truck of plan.planned) {
      ownership.set(truck.ownership, (ownership.get(truck.ownership) ?? 0) + 1)
    }
    heading('OWNERSHIP')
    for (const [type, count] of ownership) {
      console.log(`  ${String(count).padStart(3)}  ${type}`)
    }

    if (!WRITE) {
      heading('NOTHING WAS WRITTEN')
      console.log(`  ${fresh.length} truck(s) would be created OUT_OF_SERVICE.`)
      console.log('  Re-run with --write once the above is agreed.')
      return
    }

    heading('WRITING')
    let created = 0
    let skipped = 0
    let complianceCreated = 0
    let filled = 0

    for (const truck of plan.planned) {
      const companyId = companyByName.get(truck.authority)
      if (!companyId) {
        console.log(
          `  SKIPPED  unit ${truck.unitNumber} — no company named ${truck.authority}`,
        )
        continue
      }

      const already = existingByUnit.get(unitKey(truck.unitNumber))?.[0]
      let truckId: string
      if (already) {
        truckId = already.id
        skipped++
        // ADD MISSING, REPLACE NOTHING. Only columns currently null are
        // written; anything already there is the newer truth.
        const current = await db.truck.findUniqueOrThrow({
          where: { id: already.id },
          select: {
            vin: true,
            make: true,
            model: true,
            year: true,
            plate: true,
            plateState: true,
          },
        })
        const data: Record<string, unknown> = {}
        if (current.vin === null && truck.vin) data['vin'] = truck.vin
        if (current.make === null && truck.make) data['make'] = truck.make
        if (current.model === null && truck.model) data['model'] = truck.model
        if (current.year === null && truck.year) data['year'] = truck.year
        if (current.plate === null && truck.plate) data['plate'] = truck.plate
        if (current.plateState === null && truck.plateState) {
          data['plateState'] = truck.plateState
        }
        if (Object.keys(data).length > 0) {
          await db.truck.update({ where: { id: already.id }, data })
          filled++
          console.log(
            `  filled   unit ${truck.unitNumber.padEnd(8)} ${Object.keys(data).join(', ')}`,
          )
        }
      } else {
        const row = await db.truck.create({
          data: {
            organizationId: tenancy.organizationId,
            companyId,
            unitNumber: truck.unitNumber,
            vin: truck.vin,
            make: truck.make,
            model: truck.model,
            year: truck.year,
            plate: truck.plate,
            plateState: truck.plateState,
            ownershipType: truck.ownership,
            // OUT OF SERVICE, WITH NO ASSET-HISTORY PERIOD. See the note at the
            // top: an open period would claim this truck currently runs.
            status: 'OUT_OF_SERVICE',
          },
          select: { id: true },
        })
        truckId = row.id
        created++
        console.log(
          `  created  unit ${truck.unitNumber.padEnd(8)} ${truck.authority}  OUT_OF_SERVICE`,
        )
      }

      // ── THE THREE COMPLIANCE ROWS ────────────────────────────────────
      //
      // Idempotent on (truck, type): a re-run finds the row it wrote rather
      // than stacking a second one, and an existing item is never rewritten —
      // if somebody has renewed a registration since the import, that is the
      // newer truth.
      for (const expiry of EXPIRIES) {
        const iso = truck[expiry.field]
        if (!iso) continue
        const present = await db.complianceItem.findFirst({
          where: { truckId, type: expiry.type, deletedAt: null },
          select: { id: true },
        })
        if (present) continue
        await db.complianceItem.create({
          data: {
            organizationId: tenancy.organizationId,
            companyId,
            type: expiry.type,
            truckId,
            expiresAt: new Date(`${iso}T00:00:00.000Z`),
          },
        })
        complianceCreated++
      }
    }

    heading('WRITTEN')
    console.log(
      `  ${created} trucks created OUT_OF_SERVICE, ${skipped} already there (${filled} gained a missing value)`,
    )
    console.log(`  ${complianceCreated} compliance items from the three dates`)
    console.log('  0 asset-history periods — the extras are not in service')
  } finally {
    await db.$disconnect()
  }
}

await main()
