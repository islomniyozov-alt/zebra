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
    setupFiles: ['tests/setup.ts'],
    // Each file holds one WebSocket to Neon and mutates shared tables.
    // Running them concurrently multiplies connections and invites the kind
    // of interference that gets blamed on the code under test.
    fileParallelism: false,
    testTimeout: 120_000,
    hookTimeout: 180_000,
  },
})
