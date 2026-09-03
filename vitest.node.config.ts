import { defineConfig } from 'vitest/config'
import tsconfigPaths from 'vite-tsconfig-paths'

// Read-only against the database, or no database at all. Cheap enough to be
// part of `npm run check`.
export default defineConfig({
  plugins: [tsconfigPaths()],
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
