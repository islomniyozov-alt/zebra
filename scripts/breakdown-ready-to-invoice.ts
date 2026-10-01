import { neonConfig } from '@neondatabase/serverless'
import { createPrismaClient } from '@/lib/db'
import { runInOrg } from '@/lib/tenancy'
import { unattributed } from '@/lib/audit'

// ---------------------------------------------------------------------------
// WHO THE READY-TO-INVOICE QUEUE IS ACTUALLY WAITING ON.
//
//   npx tsx -r dotenv/config scripts/breakdown-ready-to-invoice.ts
//   npx tsx -r dotenv/config scripts/breakdown-ready-to-invoice.ts --production
//
// READ ONLY ON EVERY PATH. No transaction writes, no flags that write, nothing
// to pass that could.
//
// Owner's ruling 2, 2026-10-01: nothing is corrected anywhere until this table
// has been read on PRODUCTION through `zebra_ci_readonly`.
//
// ── IT REFUSES ANY PRODUCTION ROLE BUT THE READ-ONLY ONE ────────────────
//
// The ruling names the role. A ruling that names a credential and is then run
// with a different one is a ruling nobody followed, so this ENFORCES it rather
// than trusting it: `--production` with anything other than `zebra_ci_readonly`
// stops before a single statement.
//
// That is not theatre. The connection string on a developer machine is
// `neondb_owner` — write-capable on the production branch — and a SELECT typed
// one character wrong under that role is an UPDATE that runs. `zebra_ci_readonly`
// has SELECT and BYPASSRLS and nothing else (see
// `.github/workflows/deploy-production.yml`), which means the worst outcome
// available to this script is a wrong answer rather than a wrong database.
//
// BYPASSRLS IS WHY THE ORGANIZATION IS NAMED OUT LOUD. That role can see every
// tenant's rows, so the only thing standing between this table and a mixture
// of two carriers' freight is the `runInOrg` boundary — and the org it set is
// printed before any number, so a reader can see which carrier they are
// looking at.
//
// ── THE CUTOVER COLUMN ──────────────────────────────────────────────────
//
// `after` counts the loads in each row booked on or after BOOKS_CUTOVER. It is
// the column that separates "a backlog somebody is working through" from
// "freight that has been arriving in this state since the books moved". A row
// of 637 with 637 after the cutover is a live process writing rows nobody can
// action; 637 with 0 is an archive.
// ---------------------------------------------------------------------------

neonConfig.webSocketConstructor ??= WebSocket

/** Owner's ruling, 2026-10-01. The day the books moved to Zebra. */
const BOOKS_CUTOVER = new Date(Date.UTC(2026, 8, 13))

/** The only production role this script will speak to. Owner's ruling. */
const READONLY_ROLE = 'zebra_ci_readonly'

const PRODUCTION = process.argv.includes('--production')

// ── ITS OWN ENVIRONMENT VARIABLE, AND NO FALLBACK ────────────────────────
//
// `--production` reads `PROD_READONLY_DATABASE_URL` and NOTHING ELSE. It does
// not fall back to `PROD_DIRECT_DATABASE_URL`, which on a developer machine is
// `neondb_owner` and write-capable on the production branch.
//
// A SEPARATE NAME RATHER THAN A CHECK ON THE SAME ONE, because `.env` already
// defines the owner string and `dotenv` does not overwrite a variable the
// shell has already set — so "export the read-only one over the top" depends
// on load order to be safe. A different name cannot be shadowed by accident:
// if the read-only string is absent, this stops.
const url = PRODUCTION
  ? process.env.PROD_READONLY_DATABASE_URL
  : process.env.DIRECT_DATABASE_URL
if (!url) {
  throw new Error(
    PRODUCTION
      ? 'No PROD_READONLY_DATABASE_URL.\n\n' +
        `Owner ruling 2026-10-01: production is read through ${READONLY_ROLE}.\n` +
        'This script does NOT fall back to PROD_DIRECT_DATABASE_URL — that is\n' +
        'the owner role, and a SELECT under a write-capable credential is one\n' +
        'typo from an UPDATE.\n\n' +
        'PowerShell:\n' +
        `  $env:PROD_READONLY_DATABASE_URL = "<${READONLY_ROLE} string>"\n` +
        '  npx tsx -r dotenv/config scripts/breakdown-ready-to-invoice.ts --production'
      : 'No DIRECT_DATABASE_URL. Refusing to guess one.',
  )
}

const role = new URL(url).username
if (PRODUCTION && role !== READONLY_ROLE) {
  throw new Error(
    `REFUSED. --production requires the ${READONLY_ROLE} role and ` +
      `PROD_READONLY_DATABASE_URL carries ${role}.\n\n` +
      'Owner ruling 2026-10-01: this table is read on production through the\n' +
      'read-only role. That role has SELECT and BYPASSRLS and nothing else, so\n' +
      'the worst outcome available to this script is a wrong answer rather than\n' +
      'a wrong database.',
  )
}
if (!PRODUCTION && /prod/i.test(url)) {
  throw new Error(
    'That url looks like production. Pass --production to say so.',
  )
}

const db = createPrismaClient(url)

console.log(`target    ${PRODUCTION ? 'PRODUCTION' : 'DEV'}`)
console.log(`host      ${new URL(url).hostname}`)
console.log(`role      ${role}`)
console.log(`cutover   ${BOOKS_CUTOVER.toISOString().slice(0, 10)}`)

// ── THE ORGANIZATION, BY SLUG, BEFORE ANY NUMBER ──────────────────────────
//
// NAMED RATHER THAN ASSUMED. The first version required exactly one
// organization to exist and refused on dev, which holds TWO: `zebra` and
// `isolation-counterpart`, the fixture the RLS tests seed a second tenant into.
// "There is only one" was true of production and false of the machine this
// runs on — and under a BYPASSRLS role, picking the wrong one is how two
// carriers' freight ends up in one table.
//
// So the slug is stated. It is the same on both environments, it is checked,
// and it is printed with the id beside it.
const ORG_SLUG = 'zebra'
const org = await db.organization.findFirst({
  where: { slug: ORG_SLUG },
  select: { id: true, name: true, slug: true },
})
if (!org) {
  const all = await db.organization.findMany({ select: { slug: true } })
  throw new Error(
    `No organization with slug "${ORG_SLUG}". Found: ` +
      `${all.map((o) => o.slug).join(', ') || 'none'}.`,
  )
}
console.log(`org       ${org.name} (slug ${org.slug})`)
console.log(`          ${org.id}`)

const dollars = (cents: number) =>
  `$${(cents / 100).toLocaleString('en-US', { maximumFractionDigits: 0 })}`

await runInOrg(
  db,
  org.id,
  async (tx) => {
    // ── THE SAME PREDICATE THE QUEUE USES ──────────────────────────────
    //
    // Written out rather than imported, because `readyToInvoiceWhere` is a
    // Prisma object and this is one grouped statement. It is the same five
    // clauses: not closed history, POD in, a rate on it, not direct-settled,
    // on no invoice line.
    const rows = await tx.$queryRaw<
      {
        company: string
        customer: string
        settles: boolean
        loads: bigint
        after: bigint
        cents: bigint
      }[]
    >`
      SELECT
        c."name" AS company,
        COALESCE(cu."name", '(no customer)') AS customer,
        COALESCE(cu."settlesDirectly", false) AS settles,
        COUNT(*)::bigint AS loads,
        COUNT(*) FILTER (WHERE l."bookedAt" >= ${BOOKS_CUTOVER})::bigint AS after,
        SUM(l."totalRevenueCents")::bigint AS cents
      FROM "Load" l
      JOIN "Company" c ON c."id" = l."companyId"
      LEFT JOIN "Customer" cu ON cu."id" = l."customerId"
      WHERE l."deletedAt" IS NULL
        AND l."isCancelled" = false
        AND l."billingStatus" <> 'CLOSED_IN_DATATRUCK'
        AND l."operationalStatus" = 'POD_RECEIVED'
        AND l."totalRevenueCents" > 0
        AND l."directSettled" = false
        AND NOT EXISTS (
          SELECT 1 FROM "InvoiceLine" il WHERE il."loadId" = l."id"
        )
      GROUP BY c."name", cu."name", cu."settlesDirectly"
      ORDER BY COUNT(*) DESC
    `

    console.log('\n  READY TO INVOICE, BY COMPANY AND CUSTOMER\n')
    console.log(
      `  ${'company'.padEnd(22)} ${'customer'.padEnd(31)} ${'settles'.padEnd(7)} ${'loads'.padStart(5)} ${'after'.padStart(5)}  ${'value'.padStart(11)}`,
    )
    console.log(
      `  ${'-'.repeat(22)} ${'-'.repeat(31)} ${'-'.repeat(7)} ${'-'.repeat(5)} ${'-'.repeat(5)}  ${'-'.repeat(11)}`,
    )

    let totalLoads = 0
    let totalAfter = 0
    let totalCents = 0
    for (const row of rows) {
      totalLoads += Number(row.loads)
      totalAfter += Number(row.after)
      totalCents += Number(row.cents)
      console.log(
        `  ${row.company.slice(0, 22).padEnd(22)} ` +
          `${row.customer.slice(0, 31).padEnd(31)} ` +
          `${(row.settles ? 'YES' : 'no').padEnd(7)} ` +
          `${String(row.loads).padStart(5)} ` +
          `${String(row.after).padStart(5)}  ` +
          `${dollars(Number(row.cents)).padStart(11)}`,
      )
    }
    console.log(
      `  ${'-'.repeat(22)} ${'-'.repeat(31)} ${'-'.repeat(7)} ${'-'.repeat(5)} ${'-'.repeat(5)}  ${'-'.repeat(11)}`,
    )
    console.log(
      `  ${String(rows.length).padStart(22)} groups${' '.repeat(26)}${' '.repeat(7)} ` +
        `${String(totalLoads).padStart(5)} ${String(totalAfter).padStart(5)}  ` +
        `${dollars(totalCents).padStart(11)}`,
    )

    // ── THE CONDITIONAL SECOND TABLE, AS RULED ─────────────────────────
    //
    // Only when an AMAZON row shows `settlesDirectly = false`, because that is
    // the condition the ruling attached it to: if Amazon is mis-flagged then
    // the question is no longer about two loads, it is about which customer
    // records are right at all — and that question needs every name, not a
    // sample.
    const amazonMisflagged = rows.some(
      (row) => /amazon/i.test(row.customer) && !row.settles,
    )
    if (!amazonMisflagged) {
      console.log(
        '\n  No AMAZON row with settlesDirectly = false. The customer dump is',
      )
      console.log('  not printed — the ruling attached it to that condition.')
      return
    }

    console.log('\n  AMAZON APPEARS WITH settlesDirectly = false.')
    console.log('  Every customer, by name, as the ruling asks:\n')

    const customers = await tx.customer.findMany({
      select: {
        name: true,
        settlesDirectly: true,
        status: true,
        _count: { select: { loads: true } },
      },
      orderBy: [{ settlesDirectly: 'desc' }, { name: 'asc' }],
    })

    console.log(
      `  ${'customer'.padEnd(38)} ${'settles'.padEnd(7)} ${'status'.padEnd(10)} ${'loads'.padStart(6)}`,
    )
    console.log(
      `  ${'-'.repeat(38)} ${'-'.repeat(7)} ${'-'.repeat(10)} ${'-'.repeat(6)}`,
    )
    for (const customer of customers) {
      console.log(
        `  ${customer.name.slice(0, 38).padEnd(38)} ` +
          `${(customer.settlesDirectly ? 'YES' : 'no').padEnd(7)} ` +
          `${customer.status.padEnd(10)} ` +
          `${String(customer._count.loads).padStart(6)}`,
      )
    }
    console.log(
      `\n  ${String(customers.length)} customers, ` +
        `${String(customers.filter((c) => c.settlesDirectly).length)} flagged settlesDirectly.`,
    )
  },
  {
    timeoutMs: 180_000,
    attribution: unattributed(
      'scripts/breakdown-ready-to-invoice.ts — owner ruling 2026-10-01, ' +
        'read-only breakdown of the ready-to-invoice queue by company and ' +
        'customer with a books-cutover column. Nothing is corrected until ' +
        'this has been read on production.',
    ),
  },
)

await db.$disconnect()
console.log('')
