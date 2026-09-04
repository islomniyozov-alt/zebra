import { defineConfig } from 'vitest/config'
import FailureLogReporter from './tests/failure-reporter'

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
    // THE FAILURE LOG BELONGS AT THE ROOT, AND THAT IS THE WHOLE BUG.
    //
    // `reporters` is a root-level option. It was declared in
    // `vitest.integration.config.ts`, which is a PROJECT config, where vitest
    // ignores it — so the reporter was never instantiated and the first red
    // gate after it shipped produced no log at all. The instrument built to
    // preserve evidence after a crash was itself unverified in the only
    // configuration that runs.
    //
    // It had been proven with `--reporter=<path>` on the command line, which
    // works and is not how anything invokes it. Flag 87 twice over: a fix for
    // "the diagnosis was destroyed by how it was reported", verified in a
    // configuration nobody uses.
    //
    // AT THE ROOT IT COVERS EVERY PROJECT, which is more than was asked for and
    // correct: `npm run check` loses runs to dropped sockets too, and a named
    // list of what failed is worth as much there.
    reporters: ['default', new FailureLogReporter()],
  },
})
