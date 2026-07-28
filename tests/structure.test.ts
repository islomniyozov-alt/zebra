import { afterAll, describe, expect, it } from 'vitest'
import { Pool } from '@neondatabase/serverless'

// ---------------------------------------------------------------------------
// The guarantees the rls_and_isolation migration is supposed to leave behind,
// asserted against the live database rather than against the file that was
// meant to create them.
//
// The first test is the migration's own closing DO block, promoted out of the
// migration and into `npm run check`. In the migration it fires once, on the
// day it is applied. Here it fires on every check, so a table added by a later
// migration without a policy fails the build rather than waiting to be
// noticed.
//
// Read-only, and fast enough to belong in `check`.
// ---------------------------------------------------------------------------

const pool = new Pool({ connectionString: process.env.DIRECT_DATABASE_URL })

afterAll(async () => {
  await pool.end()
})

const query = async <T>(sql: string): Promise<T[]> =>
  (await pool.query(sql)).rows as T[]

describe('row-level security', () => {
  it('is enabled, forced and policied on every table carrying a tenant', async () => {
    const rows = await query<{
      relname: string
      enabled: boolean
      forced: boolean
      policies: number
    }>(`
      SELECT c.relname,
             c.relrowsecurity      AS enabled,
             c.relforcerowsecurity AS forced,
             (SELECT count(*) FROM pg_policy p
               WHERE p.polrelid = c.oid AND p.polname = 'org_isolation')::int AS policies
        FROM pg_class c
        JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE n.nspname = 'public'
         AND c.relkind = 'r'
         AND (
           c.relname = 'Organization'
           OR EXISTS (
             SELECT 1 FROM pg_attribute a
              WHERE a.attrelid = c.oid
                AND a.attname = 'organizationId'
                AND a.attnum > 0
                AND NOT a.attisdropped
           )
         )
       ORDER BY c.relname
    `)

    // If this is ever zero the query is wrong, and a query that finds nothing
    // would otherwise report perfect compliance.
    expect(rows.length).toBeGreaterThan(30)

    const incomplete = rows
      .filter((r) => !r.enabled || !r.forced || r.policies !== 1)
      .map(
        (r) =>
          `${r.relname} (enabled=${r.enabled} forced=${r.forced} policies=${r.policies})`,
      )

    expect(incomplete).toEqual([])
  })

  it('leaves exactly the tables that cannot carry a tenant unprotected', async () => {
    const rows = await query<{ relname: string }>(`
      SELECT c.relname
        FROM pg_class c
        JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE n.nspname = 'public' AND c.relkind = 'r' AND NOT c.relrowsecurity
       ORDER BY c.relname
    `)

    // User and Session are cross-organization by nature: one person holds
    // memberships in several organizations, and login has to find a user by
    // email before any organization is known. _prisma_migrations is the
    // owner's bookkeeping and the app has no privileges on it at all.
    // Anything else appearing here is a table that lost its wall.
    expect(rows.map((r) => r.relname)).toEqual([
      'Session',
      'User',
      '_prisma_migrations',
    ])
  })

  it('has an org_isolation policy that governs writes as well as reads', async () => {
    // FOR ALL with no WITH CHECK: Postgres reuses USING as the write check.
    // A policy that grew a permissive WITH CHECK would still pass the read
    // tests above while allowing rows to be written into another tenant.
    const rows = await query<{
      relname: string
      cmd: string
      withcheck: string | null
    }>(`
      SELECT c.relname, p.polcmd::text AS cmd, pg_get_expr(p.polwithcheck, p.polrelid) AS withcheck
        FROM pg_policy p
        JOIN pg_class c ON c.oid = p.polrelid
       WHERE p.polname = 'org_isolation'
       ORDER BY c.relname
    `)

    const wrong = rows
      .filter((r) => r.cmd !== '*' || r.withcheck !== null)
      .map((r) => `${r.relname} (cmd=${r.cmd} withCheck=${r.withcheck})`)

    expect(wrong).toEqual([])
  })
})

describe('child-table triggers', () => {
  it('derives organizationId on every table that has no tenant of its own', async () => {
    const rows = await query<{ tbl: string; fn: string }>(`
      SELECT c.relname AS tbl, p.proname AS fn
        FROM pg_trigger t
        JOIN pg_class c ON c.oid = t.tgrelid
        JOIN pg_proc p ON p.oid = t.tgfoid
       WHERE NOT t.tgisinternal AND t.tgname = 'set_org'
       ORDER BY c.relname
    `)

    expect(Object.fromEntries(rows.map((r) => [r.tbl, r.fn]))).toEqual({
      CompanySettings: 'zebra_org_from_company',
      CustomerContact: 'zebra_org_from_customer',
      DriverPayRule: 'zebra_org_from_driver',
      InvoiceLine: 'zebra_org_from_invoice',
      LoadAccessorial: 'zebra_org_from_load',
      LoadAssignment: 'zebra_org_from_load',
      LoadStatusEvent: 'zebra_org_from_load',
      LoadStop: 'zebra_org_from_load',
      MembershipCompany: 'zebra_org_from_membership',
      PaymentApplication: 'zebra_org_from_payment',
      SettlementLine: 'zebra_org_from_settlement',
    })
  })

  it('fires only when the parent link or the copy is written', async () => {
    // A trigger with no column list fires on every UPDATE, including the ones
    // Postgres issues itself when a cascade nulls an unrelated FK. That made
    // deleting an Organization impossible — the trigger looked up a parent the
    // cascade had already removed. See migration 20260728233000.
    const rows = await query<{ tbl: string; columns: string[] }>(`
      SELECT c.relname AS tbl,
             array_remove(array_agg(a.attname ORDER BY a.attname), NULL) AS columns
        FROM pg_trigger t
        JOIN pg_class c ON c.oid = t.tgrelid
        LEFT JOIN LATERAL unnest(t.tgattr) AS cols(attnum) ON true
        LEFT JOIN pg_attribute a ON a.attrelid = c.oid AND a.attnum = cols.attnum
       WHERE NOT t.tgisinternal AND t.tgname = 'set_org'
       GROUP BY c.relname
       ORDER BY c.relname
    `)

    expect(rows.length).toBe(11)
    for (const row of rows) {
      expect(row.columns, `${row.tbl} fires on every UPDATE`).not.toEqual([])
      expect(row.columns, row.tbl).toContain('organizationId')
    }
  })

  it('pins the search_path on every SECURITY DEFINER function', async () => {
    // A SECURITY DEFINER function with a mutable search_path runs owner-level
    // code against whatever schema the caller puts in front of it.
    const rows = await query<{ proname: string; config: string[] | null }>(`
      SELECT p.proname, p.proconfig AS config
        FROM pg_proc p
        JOIN pg_namespace n ON n.oid = p.pronamespace
       WHERE n.nspname = 'public' AND p.prosecdef AND p.proname LIKE 'zebra_org_from_%'
       ORDER BY p.proname
    `)

    expect(rows.length).toBe(8)
    for (const row of rows) {
      expect(row.config, row.proname).toContain('search_path=public, pg_temp')
    }
  })
})

describe('constraints Prisma cannot express', () => {
  it('allows one open assignment period per asset', async () => {
    const rows = await query<{ indexname: string; indexdef: string }>(`
      SELECT indexname, indexdef FROM pg_indexes
       WHERE schemaname = 'public' AND indexname LIKE 'asset_open_period%'
       ORDER BY indexname
    `)

    expect(rows.map((r) => r.indexname)).toEqual([
      'asset_open_period_driver',
      'asset_open_period_trailer',
      'asset_open_period_truck',
    ])
    for (const row of rows) {
      expect(row.indexdef, row.indexname).toContain('UNIQUE INDEX')
      expect(row.indexdef, row.indexname).toContain('"effectiveTo" IS NULL')
    }
  })
})

describe('the application role', () => {
  it('cannot bypass what it is meant to be constrained by', async () => {
    const [role] = await query<{
      canlogin: boolean
      bypassrls: boolean
      superuser: boolean
      createrole: boolean
    }>(`
      SELECT rolcanlogin AS canlogin, rolbypassrls AS bypassrls,
             rolsuper AS superuser, rolcreaterole AS createrole
        FROM pg_roles WHERE rolname = 'zebra_app'
    `)

    expect(role).toBeDefined()
    expect(role).toMatchObject({
      canlogin: true,
      bypassrls: false,
      superuser: false,
      createrole: false,
    })
  })

  it('inherits nothing from a role that could bypass', async () => {
    const rows = await query<{ granted: string }>(`
      SELECT b.rolname AS granted
        FROM pg_auth_members m
        JOIN pg_roles b ON b.oid = m.roleid
        JOIN pg_roles r ON r.oid = m.member
       WHERE r.rolname = 'zebra_app'
    `)

    expect(rows.map((r) => r.granted)).toEqual([])
  })

  it('has no reach into migration bookkeeping', async () => {
    const [priv] = await query<{ migrations: boolean; loads: boolean }>(`
      SELECT has_table_privilege('zebra_app', '"_prisma_migrations"', 'SELECT') AS migrations,
             has_table_privilege('zebra_app', '"Load"', 'SELECT')               AS loads
    `)

    expect(priv).toMatchObject({ migrations: false, loads: true })
  })

  it('is the role the application actually connects as', async () => {
    // The wall only exists if the app is on the wrong side of it. An
    // isolation suite pointed at the owner passes vacuously.
    const app = new Pool({ connectionString: process.env.DATABASE_URL })
    try {
      const { rows } = await app.query<{ user: string; bypass: boolean }>(
        `SELECT current_user::text AS user,
                (SELECT rolbypassrls FROM pg_roles WHERE rolname = current_user) AS bypass`,
      )
      expect(rows[0]).toMatchObject({ user: 'zebra_app', bypass: false })
    } finally {
      await app.end()
    }
  })
})
