import { defineConfig } from 'vitest/config'
import { cloudflarePool } from '@cloudflare/vitest-pool-workers'
import tsconfigPaths from 'vite-tsconfig-paths'

// Runs inside workerd — the same engine the deployed Worker runs on, not a
// Node emulation of it. No database here: Neon needs a socket these tests
// have no business opening.
//
// Vitest 4 takes a pool initializer object rather than a package name, and
// @cloudflare's `defineWorkersConfig` helper was removed in 0.13. Hence
// `cloudflarePool(...)` rather than either of the shapes the older docs show.
export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    name: 'workers',
    include: ['tests/workers/**/*.test.ts'],
    pool: cloudflarePool({
      miniflare: {
        // Matched to wrangler.jsonc. Testing against a different runtime date
        // than the one deployed would defeat the point.
        compatibilityDate: '2026-07-22',
        compatibilityFlags: ['nodejs_compat'],
      },
    }),
  },
})
