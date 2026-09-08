import type { PrismaClient } from '../src/generated/prisma/client'

// ---------------------------------------------------------------------------
// WHICH TENANT IS ABOUT TO BE WRITTEN INTO, SAID OUT LOUD BEFORE IT IS.
//
// ── ROW-LEVEL SECURITY IS NOT WATCHING THIS CONNECTION ────────────────────
//
// The seeds connect as the DATABASE OWNER, because they write for an
// organization they are not a member of. The owner carries BYPASSRLS. So the
// mechanism that makes every other wrong-tenant write in this system
// impossible is, here, simply absent — and a hundred rows landing in the wrong
// organization would succeed, look correct, and be discovered by somebody
// noticing a truck they do not own.
//
// THIS FILE IS THE THING THAT STANDS IN FOR IT. It names the organization and
// the companies before a write, reports what is already there, and refuses
// outright when the resolved organization is not the one the caller expected.
//
// IT TAKES A CLIENT RATHER THAN FINDING A URL, deliberately: the production
// connection string is read in the seed itself and named on the allowlist in
// tests/prod-url-guard.test.ts. A helper that reached for the variable would
// become an unlisted fourth reader of it — the fence scans every file in this
// directory for the name, and the right way past a fence is never to route
// around it.
// ---------------------------------------------------------------------------

export interface TenancyReport {
  organizationId: string
  companies: { id: string; name: string }[]
}

/**
 * Name the tenant, count what is there, and refuse a surprise.
 *
 * `expectOrganizationId` is null for dev — where a wrong write is an
 * inconvenience — and stated for production, where it is the only check
 * between a mistake and a hundred plausible-looking rows.
 */
export async function assertTenancy(
  db: PrismaClient,
  options: {
    label: string
    host: string
    slug: string
    expectOrganizationId: string | null
  },
): Promise<TenancyReport> {
  const heading = `TARGET: ${options.label}`
  console.log(`\n${heading}`)
  console.log('═'.repeat(Math.max(heading.length, 62)))
  console.log(`  host          ${options.host}`)

  const organization = await db.organization.findUnique({
    where: { slug: options.slug },
    select: { id: true, name: true, slug: true },
  })
  if (!organization) {
    throw new Error(
      `No organization with slug ${options.slug} on ${options.label}.`,
    )
  }

  console.log(`  organization  ${organization.name}`)
  console.log(`                slug ${organization.slug}`)
  console.log(`                id   ${organization.id}`)

  // ── THE REFUSAL THAT MATTERS ──────────────────────────────────────────
  //
  // A SLUG IS NOT AN IDENTITY. Both databases have an organization called
  // `zebra`, so resolving by slug succeeds on either one and tells you
  // nothing about which you reached. The id is the thing that differs, and it
  // is stated by the person who ran the ritual rather than discovered here —
  // a check that learned its expectation from the database it is checking
  // would agree with whatever it found.
  if (
    options.expectOrganizationId &&
    organization.id !== options.expectOrganizationId
  ) {
    throw new Error(
      `REFUSING TO WRITE. Expected organization ${options.expectOrganizationId} ` +
        `on ${options.label}, found ${organization.id} (${organization.name}, ` +
        `slug ${organization.slug}).\n\n` +
        `This connection runs as the database owner and BYPASSES row-level ` +
        `security, so nothing downstream would refuse a write into the wrong ` +
        `tenant. Check which database this is pointed at before anything else.`,
    )
  }
  if (options.expectOrganizationId) {
    console.log(
      `                ✓ matches the expected production organization`,
    )
  }

  const companies = await db.company.findMany({
    where: { organizationId: organization.id },
    orderBy: { name: 'asc' },
    select: { id: true, name: true },
  })

  console.log(`\n  companies it may write into (${companies.length}):`)
  for (const company of companies) {
    console.log(`    ${company.name.padEnd(22)} ${company.id}`)
  }

  // ── WHAT IS ALREADY THERE ─────────────────────────────────────────────
  //
  // A seed reporting "46 created" against a database that already held 46 is
  // a different event from one against an empty table, and the counts are the
  // only way to tell before the fact.
  const where = { organizationId: organization.id }
  const [trucks, drivers, seededDrivers, payRules, compliance, periods] =
    await Promise.all([
      db.truck.count({ where: { ...where, deletedAt: null } }),
      db.driver.count({ where: { ...where, deletedAt: null } }),
      db.driver.count({ where: { ...where, externalId: { not: null } } }),
      db.driverPayRule.count({ where }),
      db.complianceItem.count({ where: { ...where, type: 'CDL' } }),
      db.assetAssignment.count({ where: { ...where, effectiveTo: null } }),
    ])

  console.log('\n  already in this organization:')
  console.log(`    trucks (live)               ${trucks}`)
  console.log(`    drivers (live)              ${drivers}`)
  console.log(`    drivers with an externalId  ${seededDrivers}`)
  console.log(`    driver pay rules            ${payRules}`)
  console.log(`    CDL compliance items        ${compliance}`)
  console.log(`    open asset-history periods  ${periods}`)

  return { organizationId: organization.id, companies }
}
