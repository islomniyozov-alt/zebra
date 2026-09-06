import { neonConfig, Pool } from '@neondatabase/serverless'

// ---------------------------------------------------------------------------
// WHY DOES THE AUTHORITY FILTER SHOW THREE OF FIVE?
//
// The topbar's list comes from one query in the app layout:
//
//   where: { isActive: true, ...(companyScopes.length ? { id: { in: … } } : {}) }
//
// So a company can be missing for exactly two reasons — it is not active, or
// the viewer's membership is scoped to a subset — and they are very different
// findings. Inactive is data somebody set; a scope is a permission. One of them
// would be a defect worth fixing rather than deleting alongside the control.
//
// ASKS ONLY. Every statement is a SELECT; the fence in
// tests/prod-url-guard.test.ts holds it to that by name.
//
//   node -r dotenv/config scripts/inspect-authorities.mjs            # prod
//   ZEBRA_TARGET=dev node -r dotenv/config scripts/inspect-authorities.mjs
// ---------------------------------------------------------------------------

const dev = process.env.ZEBRA_TARGET === 'dev'
const connectionString = dev
  ? process.env.DIRECT_DATABASE_URL
  : process.env.PROD_DIRECT_DATABASE_URL

if (!connectionString) {
  console.error('No connection string in the environment.')
  process.exit(1)
}

neonConfig.webSocketConstructor ??= WebSocket
neonConfig.poolQueryViaFetch = false
const pool = new Pool({ connectionString, max: 1 })
const rows = async (text) => (await pool.query(text)).rows

try {
  console.log(`Reading ${dev ? 'DEV' : 'PRODUCTION'}.`)

  const companies = await rows(`
    select o.name as organization, c.name, c."isActive", c."createdAt"::date as created,
           (select count(*) from "Load" l where l."companyId" = c.id and l."deletedAt" is null)::int as loads
    from "Company" c
    join "Organization" o on o.id = c."organizationId"
    order by o.name, c."isActive" desc, c.name
  `)
  console.log('\nEvery company row:')
  console.table(companies)

  // WHOSE VIEW IS NARROWED. An empty companyScopes means "all of them"; a
  // populated one is a membership deliberately limited.
  const members = await rows(`
    select u.email, u.name, m.role,
           (select count(*) from "MembershipCompany" mc
             where mc."membershipId" = m.id)::int as scoped_to
    from "Membership" m
    join "User" u on u.id = m."userId"
    order by u.email
  `)
  console.log('\nMemberships (scoped_to 0 means every company):')
  console.table(members)
} finally {
  await pool.end().catch(() => {})
}
