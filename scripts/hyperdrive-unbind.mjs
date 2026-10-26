// ---------------------------------------------------------------------------
// ROLLBACK, ONE STEP (AGENTS.md; §6.10 production section; owner's cutover
// ruling 2026-10-26): take production OFF Hyperdrive by removing exactly the
// `hyperdrive` block under `env.production` in wrangler.jsonc. The code falls
// back to the Neon path by itself when the binding is absent, and the tests
// accept either state — so after this script the only steps left are commit,
// push, dispatch production:
//
//   node scripts/hyperdrive-unbind.mjs \
//     && git commit -am "Rollback: production off Hyperdrive (unbind env.production)" \
//     && git push origin main \
//     && gh workflow run deploy-production.yml --ref main -f confirm=production
//
// It refuses when production is not bound, so it cannot be run twice by
// mistake and cannot touch dev's top-level binding: dev's id is asserted
// unchanged before anything is written.
// ---------------------------------------------------------------------------
import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { boundHyperdriveId } from './hyperdrive-config.mjs'

/** The comment that opens production's block; the block ends at its `],`. */
export const PRODUCTION_BLOCK_MARKER = "// HYPERDRIVE, PRODUCTION'S OWN CONFIG"

/**
 * wrangler.jsonc without production's hyperdrive block. Pure: returns the
 * new text, throws when production is not bound or the file does not have
 * the shape this expects — nothing is guessed.
 */
export function unbindProduction(jsonc) {
  const before = {
    dev: boundHyperdriveId(jsonc, 'dev'),
    production: boundHyperdriveId(jsonc, 'production'),
  }
  if (!before.production)
    throw new Error(
      'production is not bound to a Hyperdrive config: nothing to unbind',
    )
  const lines = jsonc.split('\n')
  const starts = lines
    .map((line, i) => (line.includes(PRODUCTION_BLOCK_MARKER) ? i : -1))
    .filter((i) => i >= 0)
  if (starts.length !== 1)
    throw new Error(
      `expected the marker exactly once, found ${starts.length}: ${PRODUCTION_BLOCK_MARKER}`,
    )
  const start = starts[0]
  const open = lines.findIndex(
    (line, i) => i > start && /^\s*"hyperdrive":\s*\[\s*$/.test(line),
  )
  if (open < 0 || open - start > 20)
    throw new Error('the marker is not followed by a "hyperdrive": [ line')
  const close = lines.findIndex(
    (line, i) => i > open && /^\s*\],?\s*$/.test(line),
  )
  if (close < 0 || close - open > 10)
    throw new Error('the "hyperdrive" array does not close where expected')
  // The block, plus one blank line after it if there is one.
  const end = lines[close + 1]?.trim() === '' ? close + 1 : close
  const after = [...lines.slice(0, start), ...lines.slice(end + 1)].join('\n')
  const result = {
    dev: boundHyperdriveId(after, 'dev'),
    production: boundHyperdriveId(after, 'production'),
  }
  if (result.production !== null)
    throw new Error('production is still bound after the removal — not written')
  if (result.dev !== before.dev)
    throw new Error('dev’s binding changed — not written')
  return after
}

const invokedDirectly =
  process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]
if (invokedDirectly) {
  const path = 'wrangler.jsonc'
  const jsonc = readFileSync(path, 'utf8')
  let after
  try {
    after = unbindProduction(jsonc)
  } catch (error) {
    console.error(`hyperdrive-unbind: ${error.message} — NOT OK`)
    process.exit(1)
  }
  writeFileSync(path, after)
  console.log(
    `hyperdrive-unbind: production's hyperdrive block removed from ${path}; dev's binding ${boundHyperdriveId(after, 'dev')} untouched — OK. Commit, push, dispatch production.`,
  )
}
