import { neonConfig } from '@neondatabase/serverless'
import { createPrismaClient } from '@/lib/db'
import { FLEET_COMPLIANCE_TYPES } from '@/lib/compliance'

// ---------------------------------------------------------------------------
// LIABILITY AND CARGO BELONG TO THE CARRIER. COLLAPSE THE PER-TRUCK COPIES.
//
//   npx tsx -r dotenv/config scripts/migrate-insurance-to-company.ts --production
//   npx tsx -r dotenv/config scripts/migrate-insurance-to-company.ts --production --apply
//
// ── WHAT PRODUCTION ACTUALLY HELD ────────────────────────────────────────
//
// 25 insurance compliance items, every one attached to a truck, and grouping
// them by (company, type, expiry) gives FIVE:
//
//     17  Dolphins Transport  liability  2025-10-21
//      5  RAM Haulage         liability  2025-10-21
//      1  Dolphins Transport  liability  2025-11-08
//      1  Dolphins Transport  liability  2025-11-23
//      1  Dolphins Transport  liability  2025-12-12
//
// Two fleet policies stored twenty-two times. The all-trucks seed wrote them
// that way because that is where the export put the date — one column per
// truck row — and a per-truck copy is what the export's shape implies rather
// than what an insurance policy is.
//
// THE COST IS NOT STORAGE. Renewing one policy meant editing twenty-two rows,
// and a safety queue listing twenty-two identical alarms on one date is a
// queue somebody learns to scroll past.
//
// ── ONE POLICY PER (COMPANY, TYPE, EXPIRY), AND THE COPIES SOFT-DELETED ──
//
// The survivor is the OLDEST row of each group — whichever the seed wrote
// first — promoted by having its asset link cleared. Promoting rather than
// creating-and-deleting keeps the row's id, its created date and any documents
// already filed against it.
//
// Soft delete on the rest, like every other removal in this migration: the
// rows stay and `deletedAt` says they are gone, so a wrong collapse is
// reversible without a backup.
//
// PHYSICAL DAMAGE IS LEFT ALONE. It insures a particular vehicle for a
// particular value and is per-truck by nature; `FLEET_COMPLIANCE_TYPES` says
// which two this touches and this script asks that list rather than restating
// it.
// ---------------------------------------------------------------------------

neonConfig.webSocketConstructor ??= WebSocket
neonConfig.poolQueryViaFetch = false

const APPLY = process.argv.includes('--apply')
const PRODUCTION = process.argv.includes('--production')

/** Stated by the owner who ran the migration ritual, not discovered here. */
const PRODUCTION_ORGANIZATION_ID = 'cmsbsc82y0000nsvsa6yffuyh'

const ORGANIZATION_SLUG = 'zebra'

function target() {
  const url = PRODUCTION
    ? process.env.PROD_DIRECT_DATABASE_URL
    : process.env.DIRECT_DATABASE_URL
  if (!url) throw new Error('No connection string for that target.')
  return { url, label: PRODUCTION ? 'PRODUCTION' : 'DEV' }
}

const day = (at: Date) => at.toISOString().slice(0, 10)

async function main(): Promise<void> {
  const where = target()
  const db = createPrismaClient(where.url)
  console.log(`target  ${where.label} (${new URL(where.url).hostname})`)
  console.log(`mode    ${APPLY ? 'APPLY' : 'dry run'}`)

  try {
    const organization = await db.organization.findUnique({
      where: { slug: ORGANIZATION_SLUG },
      select: { id: true, name: true },
    })
    if (!organization) throw new Error(`No organization ${ORGANIZATION_SLUG}.`)
    if (PRODUCTION && organization.id !== PRODUCTION_ORGANIZATION_ID) {
      throw new Error(
        `Organization is ${organization.id}, not the expected ${PRODUCTION_ORGANIZATION_ID}.`,
      )
    }
    console.log(`org     ${organization.name} (${organization.id})\n`)

    const attached = await db.complianceItem.findMany({
      where: {
        organizationId: organization.id,
        deletedAt: null,
        type: { in: [...FLEET_COMPLIANCE_TYPES] },
        truckId: { not: null },
      },
      select: {
        id: true,
        type: true,
        expiresAt: true,
        companyId: true,
        createdAt: true,
        identifier: true,
        issuer: true,
        company: { select: { name: true } },
        _count: { select: { documents: true } },
      },
      orderBy: { createdAt: 'asc' },
    })

    if (attached.length === 0) {
      console.log('No per-truck fleet-insurance rows. Nothing to collapse.')
      return
    }

    // ── GROUPED BY WHAT MAKES A POLICY ONE POLICY ──────────────────────
    const groups = new Map<string, typeof attached>()
    for (const item of attached) {
      const key = `${item.companyId}|${item.type}|${day(item.expiresAt)}`
      groups.set(key, [...(groups.get(key) ?? []), item])
    }

    console.log(
      `${attached.length} per-truck row(s) -> ${groups.size} policy(ies)\n`,
    )
    let wouldDelete = 0
    let documentsAtRisk = 0
    for (const [, items] of groups) {
      const survivor = items[0]!
      const rest = items.slice(1)
      wouldDelete += rest.length
      const withDocuments = rest.filter((i) => i._count.documents > 0)
      documentsAtRisk += withDocuments.length
      console.log(
        `  ${survivor.company.name.padEnd(24)} ${survivor.type.padEnd(20)} ${day(survivor.expiresAt)}`,
      )
      console.log(
        `      keep ${survivor.id} (created ${survivor.createdAt.toISOString().slice(0, 16)}), detach from its truck`,
      )
      console.log(`      soft-delete ${rest.length} duplicate(s)`)
      if (withDocuments.length > 0) {
        console.log(
          `      WARNING: ${withDocuments.length} of them carry documents — ${withDocuments.map((i) => i.id).join(', ')}`,
        )
      }
    }

    console.log(
      `\n  ${groups.size} row(s) promoted to the carrier, ${wouldDelete} soft-deleted`,
    )
    if (documentsAtRisk > 0) {
      console.log(
        `  ${documentsAtRisk} duplicate(s) carry a document and would be hidden with it.`,
      )
      console.log('  REFUSED. Move those documents first, or say to proceed.')
      return
    }
    console.log(
      '  0 duplicates carry documents, so nothing is hidden with one.',
    )

    if (!APPLY) {
      console.log('\nNothing was written. Re-run with --apply.')
      return
    }

    console.log('\nWRITING')
    let promoted = 0
    let removed = 0
    for (const [, items] of groups) {
      const survivor = items[0]!
      await db.complianceItem.update({
        where: { id: survivor.id },
        // PROMOTED, NOT RECREATED. Clearing the asset link is what makes this
        // row a fleet policy — the id, the created date and any documents
        // filed against it all survive.
        data: { truckId: null, trailerId: null, driverId: null },
      })
      promoted++
      for (const duplicate of items.slice(1)) {
        await db.complianceItem.update({
          where: { id: duplicate.id },
          data: { deletedAt: new Date() },
        })
        removed++
      }
    }
    console.log(`  ${promoted} promoted to the carrier`)
    console.log(`  ${removed} duplicate(s) soft-deleted`)
  } finally {
    await db.$disconnect()
  }
}

await main()
