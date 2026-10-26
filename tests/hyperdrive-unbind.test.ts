import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { boundHyperdriveId } from '../scripts/hyperdrive-config.mjs'
import {
  PRODUCTION_BLOCK_MARKER,
  unbindProduction,
} from '../scripts/hyperdrive-unbind.mjs'

// ---------------------------------------------------------------------------
// ROLLBACK IS ONE STEP (AGENTS.md, owner's cutover ruling 2026-10-26). The
// script that takes production off Hyperdrive is held against the real
// wrangler.jsonc: it removes exactly production's block, leaves dev's binding
// alone, refuses a second run, and the result still parses as the config.
// ---------------------------------------------------------------------------

describe('hyperdrive-unbind', () => {
  const jsonc = readFileSync('wrangler.jsonc', 'utf8')

  it('removes production’s block and nothing else', () => {
    expect(boundHyperdriveId(jsonc, 'production')).toBe(
      'e7286f158be4460698caa507231685e8',
    )
    const after = unbindProduction(jsonc)
    expect(boundHyperdriveId(after, 'production')).toBeNull()
    expect(boundHyperdriveId(after, 'dev')).toBe(
      boundHyperdriveId(jsonc, 'dev'),
    )
    expect(after).not.toContain(PRODUCTION_BLOCK_MARKER)
    expect(after).not.toContain('e7286f158be4460698caa507231685e8')
    // Everything else survives: the file shrinks by the block alone.
    const removed = jsonc.split('\n').length - after.split('\n').length
    expect(removed).toBeGreaterThan(10)
    expect(removed).toBeLessThan(25)
  })

  it('refuses when production is not bound — it cannot run twice', () => {
    const after = unbindProduction(jsonc)
    expect(() => unbindProduction(after)).toThrow(/not bound/)
  })

  it('refuses a file where the marker is not where the block is', () => {
    const moved = jsonc.replace(PRODUCTION_BLOCK_MARKER, '// moved')
    expect(() => unbindProduction(moved)).toThrow(/marker exactly once/)
  })
})
