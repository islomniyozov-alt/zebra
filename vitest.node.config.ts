import { defineConfig } from 'vitest/config'
import tsconfigPaths from 'vite-tsconfig-paths'

// Read-only against the database, or no database at all. Cheap enough to be
// part of `npm run check`.
export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    name: 'node',
    include: ['tests/*.test.ts'],
    setupFiles: ['tests/setup.ts'],
    testTimeout: 60_000,
    hookTimeout: 120_000,
  },
})
