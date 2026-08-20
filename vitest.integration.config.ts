import { defineConfig } from 'vitest/config'
import tsconfigPaths from 'vite-tsconfig-paths'

// These write to a real Neon branch and clean up after themselves. Separated
// so `npm run check` stays something you can run without thinking about what
// it will do to the database.
export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    name: 'integration',
    include: ['tests/integration/**/*.test.ts'],
    // ORDER MATTERS. The routing file rewrites the connection strings; the
    // shared file then validates whatever it finds. Reversed, the shared file
    // would refuse the un-rewritten database or bless the wrong one.
    setupFiles: ['tests/setup-integration.ts', 'tests/setup.ts'],
    // ONE RUNNER PER DATABASE. `globalSetup` runs exactly once per run, in the
    // main process, before any worker — so a bare `vitest` pays it too, which
    // `setupFiles` (once per FILE, own process) could never enforce.
    globalSetup: ['tests/integration-lock.ts'],
    // PARALLEL, BECAUSE EACH WORKER OWNS A DATABASE. The old note here said
    // running these concurrently "invites the kind of interference that gets
    // blamed on the code under test", and it was right about the shared
    // database it was written for — one worker's unscoped cleanup deleting
    // another's rows is precisely the failure that voided the a8e0c9f gate.
    // Workers no longer share tables, so there is nothing left to interfere
    // with. See tests/worker-db.ts.
    fileParallelism: true,
    // ONE SOURCE OF TRUTH with the database count in tests/worker-db.ts; a
    // worker without its own database would silently share slot 1's.
    maxWorkers: Number(process.env.ZEBRA_TEST_WORKERS ?? '8'),
    testTimeout: 120_000,
    hookTimeout: 180_000,
  },
})
