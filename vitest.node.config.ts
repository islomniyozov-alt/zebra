import { defineConfig } from 'vitest/config'
import tsconfigPaths from 'vite-tsconfig-paths'

// Read-only against the database, or no database at all. Cheap enough to be
// part of `npm run check`.
export default defineConfig({
  plugins: [tsconfigPaths()],
  // ── `server-only` IS A BUILD MARKER, NOT A RUNTIME ─────────────────────
  //
  // It exists so that importing a server module from a client component is a
  // BUILD error rather than a runtime surprise, and it does that by throwing
  // when anything but a server bundler resolves it. Under vitest that means
  // any module reachable from `auth-context` — every route handler in this
  // application — cannot be imported at all.
  //
  // WHICH IS WHY NOTHING HAD EVER TESTED A ROUTE HANDLER HERE, and why a
  // 1MB body limit shipped to production inside one. The marker was doing its
  // job at build time and quietly deciding what was testable.
  //
  // Aliased to an empty module for the node project ONLY. The workers project
  // runs on workerd and the integration project against real Postgres; neither
  // needs this and neither gets it.
  resolve: {
    alias: {
      'server-only': new URL('./tests/server-only-shim.ts', import.meta.url)
        .pathname,
    },
  },
  test: {
    name: 'node',
    // `.tsx` FOR COMPONENT TESTS, WHICH DECLARE THEIR OWN ENVIRONMENT.
    //
    // The default here stays `node`. jsdom is opted into per FILE, with a
    // `@vitest-environment jsdom` docblock, so a DOM is built only for the
    // handful of tests that need one and every other test in this project runs
    // exactly as it did.
    //
    // THE OTHER TWO PROJECTS ARE UNTOUCHED. `vitest.workers.config.ts` runs on
    // workerd and `vitest.integration.config.ts` against real Postgres; neither
    // includes `.tsx` and neither knows jsdom exists. A DOM leaking into either
    // would be a test environment pretending to be a runtime that is not there.
    include: ['tests/*.test.ts', 'tests/*.test.tsx'],
    setupFiles: ['tests/setup.ts'],
    testTimeout: 60_000,
    hookTimeout: 120_000,
  },
})
