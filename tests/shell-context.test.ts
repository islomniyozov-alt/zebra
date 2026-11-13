import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

// ---------------------------------------------------------------------------
// THE SHELL'S ONE READ, BY SOURCE (GAPS 42 item 3; migration 71; §6.10
// v10.93). The agreement itself is tests/integration/shell-context.test.ts;
// this pins where the read lives and that nothing reads around it.
// ---------------------------------------------------------------------------

const read = (...parts: string[]) =>
  readFileSync(join(process.cwd(), ...parts), 'utf8')

describe('one predicate, in the function, from the session row', () => {
  const sql = read(
    'prisma',
    'migrations',
    '20261112210000_migration_71',
    'migration.sql',
  )

  it('ties the preference to the session’s own user AND own organization', () => {
    expect(sql).toMatch(/p\."userId" = s\."userId"/)
    expect(sql).toMatch(/p\."organizationId" = s\."activeOrganizationId"/)
    expect(sql).toMatch(/p\."key" = 'density'/)
    // From the session row the hash found — never from an argument.
    expect(sql).toMatch(/WHERE s\."tokenHash" = token_hash/)
    expect(sql).not.toMatch(/organization_id\s+text\s*\)\s*RETURNS/)
  })

  it('is SECURITY DEFINER with its search_path pinned, STABLE, and zebra_app may execute it', () => {
    expect(sql).toMatch(
      /LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp/,
    )
    expect(sql).toMatch(
      /REVOKE ALL ON FUNCTION zebra_shell_context\(text\) FROM PUBLIC/,
    )
    expect(sql).toMatch(
      /GRANT EXECUTE ON FUNCTION zebra_shell_context\(text\) TO zebra_app/,
    )
  })
})

describe('the shell reads once, and the session is derived from that read', () => {
  const layout = read('src', 'app', '(app)', 'layout.tsx')
  const context = read('src', 'lib', 'auth-context.ts')
  const lib = read('src', 'lib', 'shell-context.ts')

  it('the operator shell takes the one read, timed, and nothing beside it', () => {
    expect(layout).toMatch(
      /const \{ value: shell, ms: sessionMs \} = await timed\(\(\) => getShellContext\(\)\)/,
    )
    expect(layout).not.toMatch(/ownAccountDb/)
    expect(layout).not.toMatch(/readDensity/)
    expect(layout).not.toMatch(/withCurrentOrg\('read', 'company'/)
    // The line keeps its fields; the two reads that no longer run are null,
    // never 0 — the sweep reads these.
    expect(layout).toMatch(/accountMs: null/)
    expect(layout).toMatch(/densityMs: null/)
  })

  it('getSession is the shell read’s session — one statement serves both', () => {
    expect(context).toMatch(/export const getShellContext = cache\(/)
    expect(context).toMatch(
      /resolveShellContext\(prisma, store\.get\(SESSION_COOKIE\)\?\.value\)/,
    )
    expect(context).toMatch(
      /export const getSession = cache\(\s*async \(\)[^{]*=>\s*\(await getShellContext\(\)\)\?\.session \?\? null/,
    )
    expect(context).not.toMatch(/resolveSession\(prisma/)
  })

  it('the validity checks are spelled as resolveSession spells them', () => {
    const session = read('src', 'lib', 'session.ts')
    for (const check of [
      /revoked_at !== null\) return null/,
      /expires_at\.getTime\(\) <= Date\.now\(\)\) return null/,
      /!row\.user_active\) return null/,
    ])
      expect(lib).toMatch(check)
    expect(session).toMatch(/session\.revokedAt !== null\) return null/)
    expect(session).toMatch(
      /session\.expiresAt\.getTime\(\) <= Date\.now\(\)\) return null/,
    )
    expect(session).toMatch(/!session\.user\.isActive\) return null/)
  })
})
