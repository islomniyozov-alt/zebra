import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

// ---------------------------------------------------------------------------
// `pg-cloudflare` SHIPS IN EVERY BUNDLE AND IS SELECTED ONLY ON DEV (§6.10,
// GAPS 36). It is pg's TCP-socket module for workerd: third-party, pinned,
// and carried into the server function by name because Next's Linux trace
// left it out and CI's dev bundle failed on it. Dev and production share one
// bundle, so it ships to production too — dormant there, because production
// has no HYPERDRIVE binding and `db.ts` keeps the Neon path. These hold the
// three things that keep it that way.
// ---------------------------------------------------------------------------

describe('pg’s Workers socket shim', () => {
  it('is pinned exactly, beside the pg it serves', () => {
    const pkg = JSON.parse(readFileSync('package.json', 'utf8')) as {
      dependencies: Record<string, string>
    }
    expect(pkg.dependencies['pg-cloudflare']).toBe('1.4.1')
    expect(pkg.dependencies['pg']).toBe('8.16.3')
    expect(pkg.dependencies['@prisma/adapter-pg']).toBe('7.9.1')
  })

  it('is carried into the server bundle by name, not left to the trace', () => {
    const config = readFileSync('next.config.ts', 'utf8')
    expect(config).toMatch(
      /outputFileTracingIncludes:\s*\{\s*'\/\*\*': \['\.\/node_modules\/pg-cloudflare\/\*\*\/\*'\]/,
    )
  })

  it('the deploy gives OpenNext’s proxy a localhost stand-in, never a credential', () => {
    // CI run 39937644153: `opennextjs-cloudflare deploy` starts wrangler's
    // platform proxy to read env, and the proxy refuses without a local
    // Hyperdrive string. The stand-in is 127.0.0.1 and passed to that one
    // spawn; a value already in the environment wins.
    const deploy = readFileSync('scripts/deploy.mjs', 'utf8')
    expect(deploy).toContain(
      "'postgresql://deploy-placeholder:unused@127.0.0.1:5432/unused'",
    )
    expect(deploy).toMatch(
      /CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_HYPERDRIVE:\s*process\.env\.CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_HYPERDRIVE \?\?\s*HYPERDRIVE_DEPLOY_STAND_IN/,
    )
    expect(deploy).toMatch(/'deploy',[\s\S]*?message,\s*\],\s*deployEnv,\s*\)/)
  })

  it('is reachable only through the binding, which production does not have', () => {
    const db = readFileSync('src/lib/db.ts', 'utf8')
    // The pg path is chosen by the binding and by nothing else.
    expect(db).toMatch(
      /const hyperdrive = hyperdriveConnectionString\(\)\s*return hyperdrive\s*\?\s*createPrismaClient\(requireHyperdriveString\(hyperdrive\), 'hyperdrive'\)/,
    )
    const wrangler = readFileSync('wrangler.jsonc', 'utf8')
      .split('\n')
      .map((line) => (line.trimStart().startsWith('//') ? '' : line))
      .join('\n')
      .replace(/,(\s*[}\]])/g, '$1')
    const config = JSON.parse(wrangler) as {
      env?: Record<string, { hyperdrive?: unknown }>
    }
    expect(config.env?.production?.hyperdrive).toBeUndefined()
  })
})
