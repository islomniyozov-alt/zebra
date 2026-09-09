import { neonConfig } from '@neondatabase/serverless'
import { createPrismaClient } from '@/lib/db'
import { addCompany } from '@/lib/companies'
import { assertTenancy } from './datatruck-tenancy'
import type { PrismaClient } from '../src/generated/prisma/client'

// ---------------------------------------------------------------------------
// THE THREE AUTHORITIES THE LOAD HISTORY RUNS UNDER AND THIS SYSTEM HAS NEVER
// HEARD OF.
//
//   npx tsx -r dotenv/config scripts/seed-datatruck-authorities.ts            (preview)
//   npx tsx -r dotenv/config scripts/seed-datatruck-authorities.ts --write
//   npx tsx -r dotenv/config scripts/seed-datatruck-authorities.ts --production --write
//
// The Datatruck export names five MC holders. Two of them are the live
// carriers — RAM Haulage and Dolphins Transport. The other three carry 2,757
// loads and $2.77M of real freight between them and exist nowhere in Zebra:
// `Midwest Global Logistics LLC` is a string inside `trucks.ts` that the truck
// seed used to REFUSE rows, and the other two were never noticed at all.
//
// ── THEY ARE CREATED RETIRED, WHICH IS NOT THE SAME AS INACTIVE ──────────
//
// `Company.retired` (20260908210000_company_retired) exists because
// `isActive: false` gets this nearly right and fails in one place that
// matters: the load list's authority filter uses the same predicate as the
// create-load select, so deactivating these three would hide their 2,757 loads
// behind a filter chip that is no longer rendered. Retired rows therefore stay
// `isActive: true` and are excluded from new work by `SELECTABLE_AUTHORITY`,
// which is the one predicate all nine creation screens ask.
//
// ── A PREREQUISITE, NOT A CONVENIENCE ────────────────────────────────────
//
// Nothing about the load import can start until these rows exist: 2,757 loads
// have nowhere to be filed, and truck 9587's 344 loads are held by the truck
// seed for want of exactly one of these companies. This is the first of three
// steps that come before any load seeder is written.
//
// ── WHICH DATABASE, AND HOW IT IS CHOSEN ────────────────────────────────
//
// `--production` READS `PROD_DIRECT_DATABASE_URL` AND NOTHING ASSIGNS IT
// ANYWHERE. It is passed to `createPrismaClient` as an argument and never
// written into `DATABASE_URL` or `DIRECT_DATABASE_URL` — the same arrangement
// the other two Datatruck writers make, for the reason
// tests/prod-url-guard.test.ts records about 2026-08-15.
//
// Preview is the default. `--write` is a second decision. `assertTenancy`
// names the organization, names the companies already there, and refuses an
// organization id it did not expect — because this connection is the database
// owner and carries BYPASSRLS, so nothing downstream would catch a
// wrong-tenant write.
// ---------------------------------------------------------------------------

neonConfig.webSocketConstructor ??= WebSocket
neonConfig.poolQueryViaFetch = false

const WRITE = process.argv.includes('--write')
const PRODUCTION = process.argv.includes('--production')

const ORGANIZATION_SLUG = 'zebra'

/** Stated by the owner who ran the migration ritual, not discovered here. */
const PRODUCTION_ORGANIZATION_ID = 'cmsbsc82y0000nsvsa6yffuyh'

/**
 * The three, spelled as the export spells them.
 *
 * NAME MATCHING IS EXACT AND STATED, never fuzzy — the same rule
 * `AUTHORITY_BY_MC` in `trucks.ts` is written around. `mcNumber` is left null
 * rather than invented: the export's column is called `MC Number` and holds a
 * carrier NAME, so this system has never seen an actual MC number for any of
 * them, and a made-up one would print on documents.
 */
const RETIRED_AUTHORITIES: readonly {
  name: string
  loads: number
  note: string
}[] = [
  {
    name: 'Midwest Global Logistics LLC',
    loads: 2156,
    note: 'already named in RETIRED_MC in trucks.ts; truck 9587 is held for it',
  },
  {
    name: 'American Soldier Transport LLC',
    loads: 599,
    note: 'not known to this codebase at all before the load profile',
  },
  {
    name: 'AG FREIGHT INC',
    loads: 2,
    note: 'two loads, both $0.00 — kept so the pair has somewhere to land',
  },
]

function heading(text: string): void {
  console.log(`\n${text}`)
  console.log('─'.repeat(Math.max(text.length, 60)))
}

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

/**
 * The plan limit is a paid lever, and this seed does not pull it.
 *
 * `addCompany` refuses past `Organization.maxCompanies`, correctly — a tenant
 * on a three-authority plan that can quietly have six is not on a plan. So
 * this reports the arithmetic and REFUSES rather than raising the limit
 * itself: the exact statement is printed for the owner to run, which is the
 * standing rule for a column that governs what a customer is sold.
 */
async function checkCapacity(
  db: PrismaClient,
  organizationId: string,
  toCreate: number,
): Promise<boolean> {
  const organization = await db.organization.findUniqueOrThrow({
    where: { id: organizationId },
    select: { maxCompanies: true },
  })
  const existing = await db.company.count({ where: { organizationId } })

  heading('THE PLAN LIMIT')
  console.log(`  maxCompanies  ${organization.maxCompanies}`)
  console.log(`  existing      ${existing}`)
  console.log(`  to create     ${toCreate}`)

  if (existing + toCreate <= organization.maxCompanies) {
    console.log(`  room for all ${toCreate}.`)
    return true
  }

  const needed = existing + toCreate
  console.log(
    `\n  REFUSED: ${needed} authorities will not fit in ${organization.maxCompanies}.`,
  )
  console.log('  This seed does not raise a plan limit. Run this yourself if')
  console.log('  the number is right, then run the seed again:\n')
  console.log(
    `    UPDATE "Organization" SET "maxCompanies" = ${needed} WHERE id = '${organizationId}';`,
  )
  return false
}

async function main(): Promise<void> {
  const where = target()

  console.log(`mode    ${WRITE ? 'WRITE' : 'preview only'}`)

  const db = createPrismaClient(where.url)
  try {
    const tenancy = await assertTenancy(db, {
      label: where.label,
      host: where.host,
      slug: ORGANIZATION_SLUG,
      expectOrganizationId: where.expectOrganizationId,
    })

    // ── IDEMPOTENT BY NAME, CASE-INSENSITIVELY ──────────────────────────
    //
    // `addCompany` already refuses a duplicate name that way, so a second run
    // would be three refusals rather than three duplicates. Checking here as
    // well is what lets the preview say "2 to create, 1 already there" instead
    // of reporting a refusal as a failure.
    const existing = await db.company.findMany({
      where: { organizationId: tenancy.organizationId },
      select: { id: true, name: true, retired: true },
    })
    const byName = new Map(
      existing.map((company) => [company.name.toLowerCase(), company]),
    )

    heading('THE THREE')
    const missing: (typeof RETIRED_AUTHORITIES)[number][] = []
    for (const authority of RETIRED_AUTHORITIES) {
      const already = byName.get(authority.name.toLowerCase())
      const standing = already
        ? already.retired
          ? 'exists, retired — nothing to do'
          : 'EXISTS AND IS NOT RETIRED — left alone, see below'
        : 'to create, retired'
      console.log(`  ${authority.name}`)
      console.log(
        `      ${String(authority.loads).padStart(5)} loads in the export  ·  ${standing}`,
      )
      console.log(`      ${authority.note}`)
      if (!already) missing.push(authority)
    }

    // A row that exists and is NOT retired is not this script's to change. It
    // could be an authority somebody added on purpose, and flipping a flag
    // that decides where new freight may be filed is a decision, not a repair.
    const liveClash = RETIRED_AUTHORITIES.filter((authority) => {
      const already = byName.get(authority.name.toLowerCase())
      return already !== undefined && !already.retired
    })
    for (const authority of liveClash) {
      const row = byName.get(authority.name.toLowerCase())!
      console.log(
        `\n  ${authority.name} is already a LIVE authority (${row.id}).`,
      )
      console.log('  This seed does not retire an existing carrier. If that is')
      console.log('  what you want, run it yourself:\n')
      console.log(
        `    UPDATE "Company" SET retired = true WHERE id = '${row.id}';`,
      )
    }

    heading('WHAT THIS CHANGES ON THE SCREENS')
    console.log('  create load, Relay import, new driver, new truck, new')
    console.log('  trailer, both asset transfers, new claim — NOT offered.')
    console.log('  load list authority filter, settlements, companies — shown.')
    console.log('  These three stay isActive: true, on purpose. That is what')
    console.log('  keeps their 2,757 loads reachable once they are imported.')

    if (missing.length === 0) {
      heading('NOTHING TO CREATE')
      console.log('  All three are already on this database.')
      return
    }

    const room = await checkCapacity(db, tenancy.organizationId, missing.length)

    if (!WRITE) {
      heading('NOTHING WAS WRITTEN')
      console.log(`  ${missing.length} authority row(s) would be created.`)
      console.log('  Re-run with --write once the above is agreed.')
      return
    }
    if (!room) {
      heading('NOTHING WAS WRITTEN')
      console.log('  The plan limit refused before any row was created.')
      return
    }

    heading('WRITING')
    for (const authority of missing) {
      const outcome = await db.$transaction((tx) =>
        addCompany(tx, tenancy.organizationId, {
          name: authority.name,
          retired: true,
        }),
      )
      console.log(
        outcome.ok
          ? `  created  ${authority.name}  ${outcome.id}`
          : `  REFUSED  ${authority.name}  ${outcome.reason}`,
      )
    }

    const after = await db.company.count({
      where: { organizationId: tenancy.organizationId },
    })
    console.log(`\n  ${after} authority row(s) on this organization now.`)
  } finally {
    await db.$disconnect()
  }
}

await main()
