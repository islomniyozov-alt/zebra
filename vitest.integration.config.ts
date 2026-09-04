import FailureLogReporter from './tests/failure-reporter'
import { defineConfig } from 'vitest/config'
import tsconfigPaths from 'vite-tsconfig-paths'
import { workerCount } from './tests/worker-db'

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
    // THE DEFAULT REPORTER PLUS ONE THAT SURVIVES A CRASH. Vitest renders its
    // failure list when the run ENDS; a process death mid-run means it never
    // renders, and the counts printed along the way say how many failed
    // without saying which. See tests/failure-log.ts.
    reporters: ['default', new FailureLogReporter()],
    // PARALLEL, BECAUSE EACH WORKER OWNS A DATABASE. The old note here said
    // running these concurrently "invites the kind of interference that gets
    // blamed on the code under test", and it was right about the shared
    // database it was written for — one worker's unscoped cleanup deleting
    // another's rows is precisely the failure that voided the a8e0c9f gate.
    // Workers no longer share tables, so there is nothing left to interfere
    // with. See tests/worker-db.ts.
    fileParallelism: true,
    // ONE SOURCE OF TRUTH, IMPORTED RATHER THAN RESTATED. This used to read
    // `Number(process.env.ZEBRA_TEST_WORKERS ?? '8')` under a comment claiming
    // it agreed with tests/worker-db.ts — two literals, one claim. They agreed
    // only because nobody had changed one; a worker without its own database
    // silently shares slot 1's, and slot 1's cleanup then deletes its rows.
    maxWorkers: workerCount(),
    testTimeout: 120_000,
    hookTimeout: 180_000,
  },
})
