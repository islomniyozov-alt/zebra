import { afterAll, describe, expect, it } from 'vitest'
import { Pool } from '@neondatabase/serverless'
import {
  GRANT_AUDIT_SQL,
  describeGrantDifferences,
  findGrantDifferences,
  type GrantRow,
} from '@/lib/grant-rule'

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

    // The three tables authentication needs before a tenant is known.
    //
    // User is cross-organization by nature: one person holds memberships in
    // several organizations, and login has to find them by email before any
    // organization is known. Session is what names the organization, so a
    // policy on it could never be satisfied. LoginAttempt is written before
    // anyone has proved anything at all.
    //
    // _prisma_migrations is the owner's bookkeeping; the app has no
    // privileges on it. Anything else appearing here lost its wall.
    // PasswordResetToken joins the set for the same reason as the rest: it is
    // issued and redeemed before anyone has proved who they are, and it cannot
    // carry a tenant because the request arrives with an email address and
    // nothing else.
    //
    // UnroutedEmail is the fifth, and it is the only one that is not about
    // authentication. A row is in it BECAUSE the question "which organization
    // claims this address?" was asked and answered NO — so there is no tenant
    // to scope to, and `org_isolation` on it could never be satisfied by the
    // connection that has to write it.
    //
    // IT IS HERE SO THAT "DELIVERED" AND "EXISTS NOWHERE" CANNOT BOTH BE TRUE.
    // `/api/inbound-email` answers 202 to mail nobody claims, deliberately: a
    // 4xx makes Cloudflare retry a message that can never route, and a bounce
    // tells a stranger which addresses exist. But 202 means the sending server
    // marks it delivered and stops trying, and until this table that
    // acknowledgement was a lie — the message went in a `console.warn`.
    //
    // WHAT IT COSTS, STATED: mail from strangers sits in a table with no wall.
    // It is write-only from one endpoint, no route reads it, and it holds a
    // message somebody sent to a public address. When the routing table of
    // flag 44 arrives, this becomes tenant-scoped and leaves this list.
    expect(rows.map((r) => r.relname)).toEqual([
      'LoginAttempt',
      'PasswordResetToken',
      'Session',
      'UnroutedEmail',
      'User',
      '_prisma_migrations',
    ])
  })

  it('does not let Session smuggle a tenant column past the audit', async () => {
    // Session carries `activeOrganizationId`, not `organizationId`, and the
    // name is the whole mechanism: it is the INPUT to row-level security, read
    // before any policy can apply. If someone ever renames it to the obvious
    // thing, the audit above starts demanding a policy that cannot exist —
    // and this test explains why before they spend an afternoon on it.
    const rows = await query<{ attname: string }>(`
      SELECT a.attname
        FROM pg_attribute a
        JOIN pg_class c ON c.oid = a.attrelid
        JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE n.nspname = 'public' AND c.relname = 'Session'
         AND a.attnum > 0 AND NOT a.attisdropped
       ORDER BY a.attname
    `)

    const names = rows.map((r) => r.attname)
    expect(names).toContain('activeOrganizationId')
    expect(names).not.toContain('organizationId')
  })

  it('lets a user read their own memberships, and only read them', async () => {
    // The one policy that is not org_isolation. Login has to discover which
    // organizations a user belongs to before it can scope to one, so
    // Membership answers to `app.current_user_id` as well.
    //
    // polcmd 'r' is SELECT. If this ever becomes '*', asserting a user id
    // would also let you WRITE a membership into any organization you named,
    // because a permissive policy without a command restriction supplies its
    // USING clause as the write check.
    const rows = await query<{
      relname: string
      cmd: string
      withcheck: string | null
    }>(`
      SELECT c.relname, p.polcmd::text AS cmd, pg_get_expr(p.polwithcheck, p.polrelid) AS withcheck
        FROM pg_policy p
        JOIN pg_class c ON c.oid = p.polrelid
       WHERE p.polname = 'own_membership'
       ORDER BY c.relname
    `)

    expect(rows.map((r) => r.relname)).toEqual([
      'Membership',
      'MembershipCompany',
    ])
    for (const row of rows) {
      expect(row.cmd, `${row.relname} is not SELECT-only`).toBe('r')
      expect(row.withcheck, row.relname).toBeNull()
    }
  })

  it('has no policies beyond the two the design accounts for', async () => {
    // A policy nobody remembers adding is a policy nobody reviewed.
    const rows = await query<{ polname: string }>(`
      SELECT DISTINCT p.polname
        FROM pg_policy p
        JOIN pg_class c ON c.oid = p.polrelid
        JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE n.nspname = 'public'
       ORDER BY p.polname
    `)

    expect(rows.map((r) => r.polname)).toEqual([
      'org_isolation',
      'own_membership',
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

  // ── AND THE POLICY MUST SAY THE RIGHT THING, NOT MERELY EXIST ──────────
  //
  // The test above counts policies. On 2026-09-10 that was not enough: four
  // new money tables each had `org_isolation` — so the count was 1 and this
  // file was green — while the expression read
  //
  //   current_setting('app.organization_id', true)
  //
  // a name NOTHING SETS. `current_setting` returns NULL for an unset name with
  // `missing_ok`, and `"organizationId" = NULL` is NULL rather than true, so
  // the policy denied every row including the tenant's own. Only the
  // integration isolation suite caught it, and only because it reads through
  // the app role.
  //
  // `withOrg` sets `app.current_org_id`. That is the one name, and this
  // asserts every policy uses it — failing by TABLE NAME, because "a policy is
  // wrong" sends somebody to read forty of them.
  //
  // WHY THIS BELONGS BESIDE THE COUNT RATHER THAN REPLACING IT: a table with
  // no policy and a table with a policy that can never be true are different
  // faults with different fixes, and the second is the one that looks fine.
  it('writes every org_isolation policy against app.current_org_id', async () => {
    const rows = await query<{ relname: string; qual: string | null }>(`
      SELECT c.relname,
             pg_get_expr(p.polqual, p.polrelid) AS qual
        FROM pg_policy p
        JOIN pg_class c ON c.oid = p.polrelid
        JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE n.nspname = 'public'
         AND p.polname = 'org_isolation'
       ORDER BY c.relname
    `)

    // A query that found nothing would report perfect compliance.
    expect(rows.length).toBeGreaterThan(30)

    // NAMED, NOT COUNTED. Each offender carries the expression it actually
    // has, so the fix is visible without opening the database.
    const wrong = rows
      .filter((row) => !(row.qual ?? '').includes('app.current_org_id'))
      .map((row) => `${row.relname}: ${row.qual ?? '(no qualifier)'}`)

    expect(wrong, `these policies do not read app.current_org_id`).toEqual([])
  })

  // THE OTHER HALF: no policy may read any OTHER session variable. The check
  // above passes a policy that reads the right name and a wrong one beside it,
  // which is exactly the shape a careless fix would leave behind.
  it('reads no session variable other than app.current_org_id', async () => {
    const rows = await query<{ relname: string; qual: string | null }>(`
      SELECT c.relname,
             pg_get_expr(p.polqual, p.polrelid) AS qual
        FROM pg_policy p
        JOIN pg_class c ON c.oid = p.polrelid
        JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE n.nspname = 'public'
         AND p.polname = 'org_isolation'
       ORDER BY c.relname
    `)

    const settings = new Map<string, string[]>()
    for (const row of rows) {
      for (const found of (row.qual ?? '').matchAll(
        /current_setting\(\s*'([^']+)'/g,
      )) {
        const name = found[1]!
        if (name === 'app.current_org_id') continue
        settings.set(name, [...(settings.get(name) ?? []), row.relname])
      }
    }

    const offenders = [...settings].map(
      ([name, tables]) => `${name} on ${tables.join(', ')}`,
    )
    expect(offenders, 'unexpected session variables in org_isolation').toEqual(
      [],
    )
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
      ClaimNote: 'zebra_org_from_claim',
      ClaimParty: 'zebra_org_from_claim',
      CompanySettings: 'zebra_org_from_company',
      CustomerContact: 'zebra_org_from_customer',
      DriverPayRule: 'zebra_org_from_driver',
      InspectionViolation: 'zebra_org_from_inspection',
      InvoiceLine: 'zebra_org_from_invoice',
      LoadAccessorial: 'zebra_org_from_load',
      LoadAssignment: 'zebra_org_from_load',
      LoadStatusEvent: 'zebra_org_from_load',
      LoadStop: 'zebra_org_from_load',
      MembershipCompany: 'zebra_org_from_membership',
      PaymentApplication: 'zebra_org_from_payment',
      PaymentLoadApplication: 'zebra_org_from_payment_load',
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

    expect(rows.length).toBe(15)
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
       WHERE n.nspname = 'public' AND p.prosecdef AND p.proname LIKE 'zebra\_%'
       ORDER BY p.proname
    `)

    // `zebra_%`, not `zebra_org_from_%`. The narrower pattern was written when
    // every SECURITY DEFINER function derived a tenant; step 5 added
    // `zebra_dataqs_violation_matches`, which is owner-level code the old
    // filter would have skipped. Escaped, because `_` is a wildcard in LIKE.
    //
    // NAMED, not counted. "expected 12 to be 11" sends somebody to `pg_proc`
    // to find out which one appeared; this says so.
    expect(rows.map((r) => r.proname)).toEqual([
      'zebra_dataqs_violation_matches',
      'zebra_org_from_claim',
      'zebra_org_from_company',
      'zebra_org_from_customer',
      'zebra_org_from_driver',
      'zebra_org_from_inspection',
      'zebra_org_from_invoice',
      'zebra_org_from_load',
      'zebra_org_from_membership',
      'zebra_org_from_payment',
      'zebra_org_from_payment_load',
      'zebra_org_from_settlement',
    ])
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

  it('refuses a roadside inspection that is of nothing', async () => {
    // All three subject columns are nullable — Level III is driver-only, Level
    // V is vehicle-only — so no NOT NULL can express "at least one". A row with
    // all three null would appear on no panel and could never be found again.
    const rows = await query<{ conname: string; def: string }>(`
      SELECT con.conname, pg_get_constraintdef(con.oid) AS def
        FROM pg_constraint con
        JOIN pg_class c ON c.oid = con.conrelid
       WHERE c.relname = 'RoadsideInspection' AND con.contype = 'c'
       ORDER BY con.conname
    `)

    const subject = rows.find((r) => r.conname === 'inspection_has_a_subject')
    expect(subject, rows.map((r) => r.conname).join(', ')).toBeDefined()
    expect(subject?.def).toContain('num_nonnulls')
  })

  it('keeps a DataQs outcome and its status in step', async () => {
    // Status is where the challenge is; outcome is what came of it. A SUBMITTED
    // challenge carrying an outcome, or a CLOSED one carrying none, is a row
    // nobody can read — and "closed" stops meaning anything. Prisma has no way
    // to say "these two agree", so it is a CHECK.
    const rows = await query<{ conname: string; def: string }>(`
      SELECT con.conname, pg_get_constraintdef(con.oid) AS def
        FROM pg_constraint con
        JOIN pg_class c ON c.oid = con.conrelid
       WHERE c.relname = 'DataQsChallenge' AND con.contype = 'c'
       ORDER BY con.conname
    `)

    const matched = rows.find(
      (r) => r.conname === 'dataqs_outcome_matches_status',
    )
    expect(matched, rows.map((r) => r.conname).join(', ')).toBeDefined()
    expect(matched?.def).toContain('outcome')
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

  // EVERY PRIVILEGE TYPE, NOT JUST SELECT, AND SCHEMA-QUALIFIED.
  //
  // This asserted `SELECT` alone, which would have watched a `GRANT INSERT` or
  // a `GRANT ALL` land without a word. It is now the whole set, because the
  // way this actually broke was a blanket grant: 20260728224900 says
  // `GRANT ... ON ALL TABLES IN SCHEMA public TO zebra_app` and then revokes on
  // `"_prisma_migrations"` UNQUALIFIED, resolving through search_path. Running
  // migrations with a non-public search_path — which happened on 2026-08-20
  // while measuring schema-per-worker — grants on public's copy and revokes on
  // somebody else's. The test caught it; it caught it by luck of asking about
  // SELECT, which is the one the blanket grant happened to include.
  //
  // `public.` is spelled out here for the same reason: an unqualified name in
  // an assertion about a search_path bug is the bug in the assertion.
  // ------------------------------------------------------------------------
  // FLAG 81, AS AN ASSERTION RATHER THAN A NOTE.
  //
  // The check below this one names ONE table. This names every table there is,
  // and derives what each should carry from the migration rather than from a
  // list somebody keeps — because a maintained list rots exactly the way the
  // grants did, and a blind spot that is written down is still a blind spot.
  //
  // The same rule runs against PRODUCTION from `scripts/check-grants.mjs`,
  // which is where `PROD_DIRECT_DATABASE_URL` may be read. One rule, two
  // callers, two databases: that is what closes "dev and production disagree"
  // without putting a production connection string inside the test suite.
  // ------------------------------------------------------------------------
  it('grants zebra_app exactly what the migration established, on every table', async () => {
    const rows = await query<GrantRow>(GRANT_AUDIT_SQL)

    // THE CONTROL. An empty result would satisfy "no differences" perfectly,
    // which is the shape of failure this session has hit twice.
    expect(
      rows.length,
      'no tables found — this is not the right database',
    ).toBeGreaterThan(40)

    const differences = findGrantDifferences(rows)
    expect(
      differences,
      differences.length > 0
        ? `grants differ from the migration — a change made outside a ` +
            `migration is invisible to every other check here:
` +
            describeGrantDifferences(differences)
        : '',
    ).toEqual([])
  })

  it('has no reach into migration bookkeeping', async () => {
    const [priv] = await query<Record<string, boolean>>(`
      SELECT has_table_privilege('zebra_app', 'public."_prisma_migrations"', 'SELECT')     AS m_select,
             has_table_privilege('zebra_app', 'public."_prisma_migrations"', 'INSERT')     AS m_insert,
             has_table_privilege('zebra_app', 'public."_prisma_migrations"', 'UPDATE')     AS m_update,
             has_table_privilege('zebra_app', 'public."_prisma_migrations"', 'DELETE')     AS m_delete,
             has_table_privilege('zebra_app', 'public."_prisma_migrations"', 'TRUNCATE')   AS m_truncate,
             has_table_privilege('zebra_app', 'public."_prisma_migrations"', 'REFERENCES') AS m_references,
             has_table_privilege('zebra_app', 'public."_prisma_migrations"', 'TRIGGER')    AS m_trigger,
             has_table_privilege('zebra_app', 'public."Load"', 'SELECT')                   AS loads
    `)

    const held = Object.entries(priv!)
      .filter(([key, value]) => key.startsWith('m_') && value)
      .map(([key]) => key.slice(2))

    expect(held, 'zebra_app holds privileges on migration bookkeeping').toEqual(
      [],
    )
    // THE CONTROL. Without it, a connection that could see nothing at all
    // would pass this test by having no privileges anywhere.
    expect(priv!.loads).toBe(true)
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
