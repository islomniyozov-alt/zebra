import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  BUNDLE_BUDGET_BYTES,
  gzipBytesFrom,
  verdict,
  WORKERS_LIMIT_BYTES,
} from '../scripts/bundle-size.mjs'

// ---------------------------------------------------------------------------
// THE BUNDLE FITS THE PLAN WITH 10% TO SPARE, AND DORMANT CODE COUNTS (owner's
// ruling, 2026-10-23). The deploy measures the built Worker with a wrangler
// dry run between the build and the upload, and refuses above the budget.
// ---------------------------------------------------------------------------

describe('the worker bundle budget', () => {
  it('is the Workers Paid limit, 10 MB compressed, minus 10%', () => {
    expect(WORKERS_LIMIT_BYTES).toBe(10_000_000)
    expect(BUNDLE_BUDGET_BYTES).toBe(9_000_000)
  })

  it('reads the gzip size wrangler prints', () => {
    // The production upload at fdc7fcc, from its own deploy log.
    expect(
      gzipBytesFrom('Total Upload: 25823.48 KiB / gzip: 5962.79 KiB'),
    ).toBe(Math.round(5962.79 * 1024))
    expect(
      gzipBytesFrom(
        '\x1b[2mTotal Upload: 1.00 KiB / gzip: 0.50 KiB\x1b[0m\n--dry-run: exiting now.',
      ),
    ).toBe(512)
    expect(gzipBytesFrom('no size here')).toBeNull()
  })

  it('passes under the budget, fails over it, and fails when it cannot tell', () => {
    expect(verdict(6_162_186).ok).toBe(true)
    expect(verdict(BUNDLE_BUDGET_BYTES).ok).toBe(true)
    expect(verdict(BUNDLE_BUDGET_BYTES + 1).ok).toBe(false)
    expect(verdict(BUNDLE_BUDGET_BYTES + 1).line).toMatch(/OVER .* NOT OK/)
    expect(verdict(null).ok).toBe(false)
  })

  it('the deploy measures between the build and the upload, and refuses over budget', () => {
    const deploy = readFileSync('scripts/deploy.mjs', 'utf8')
    expect(deploy).toMatch(
      /run\(\['opennextjs-cloudflare', 'build'\]\)[\s\S]*?const \{ ok, line \} = verdict\(measure\(\{ production \}\)\)[\s\S]*?if \(!ok\) process\.exit\(1\)[\s\S]*?'opennextjs-cloudflare',\s*'deploy'/,
    )
  })
})
