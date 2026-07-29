import { defineConfig } from 'vitest/config'

// Three projects, split by what they need and what they touch.
//
//   node        — no database writes. Structure audits and pure logic.
//   workers     — runs inside workerd, the engine the deployment uses. This is
//                 where password hashing is proven, because bcrypt and
//                 @node-rs/argon2 both work in `next dev` and neither exists
//                 on Workers.
//   integration — writes to a real Neon branch, then cleans up.
//
// `npm run check` runs the first two. `npm test` runs all three.
export default defineConfig({
  test: {
    projects: [
      'vitest.node.config.ts',
      'vitest.workers.config.ts',
      'vitest.integration.config.ts',
    ],
  },
})
