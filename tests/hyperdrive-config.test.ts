import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  boundHyperdriveId,
  describeReadBack,
  hyperdriveVerdict,
} from '../scripts/hyperdrive-config.mjs'

// ---------------------------------------------------------------------------
// THE HYPERDRIVE CONFIG IS READ BACK, PER TARGET (§6.10, 2026-10-23). The
// binding's string cannot name the origin role or say whether caching is off;
// Cloudflare's answer can, and the sweep (dev) and the deploy (its target)
// both refuse on the wrong one. Held here without a network.
// ---------------------------------------------------------------------------

describe('which config a target binds', () => {
  it('reads dev from the top level and production from env.production, never crossing', () => {
    const jsonc = `{
      // dev
      "hyperdrive": [{ "binding": "HYPERDRIVE", "id": "d".repeat(32) }],
      "env": { "production": { "hyperdrive": [{ "binding": "HYPERDRIVE", "id": "p".repeat(32) }] } },
    }`
      .replace(/"d"\.repeat\(32\)/, `"${'d'.repeat(32)}"`)
      .replace(/"p"\.repeat\(32\)/, `"${'p'.repeat(32)}"`)
    expect(boundHyperdriveId(jsonc, 'dev')).toBe('d'.repeat(32))
    expect(boundHyperdriveId(jsonc, 'production')).toBe('p'.repeat(32))
    const devOnly = `{ "hyperdrive": [{ "binding": "HYPERDRIVE", "id": "${'d'.repeat(32)}" }], "env": { "production": {} } }`
    expect(boundHyperdriveId(devOnly, 'production')).toBeNull()
  })

  it('the repository binds the dev config at the top level; production binds its own config or nothing — never dev’s', () => {
    // ROLLBACK IS ONE STEP (AGENTS.md, owner's cutover ruling 2026-10-26):
    // removing production's block must not fail this test, or the rollback
    // would need a test change and a second commit. So production is either
    // its own id or unbound; what is refused is dev's id under production.
    const jsonc = readFileSync('wrangler.jsonc', 'utf8')
    expect(boundHyperdriveId(jsonc, 'dev')).toBe(
      '4395e48e858b4d1ca4a5ea2fdd2610c9',
    )
    const production = boundHyperdriveId(jsonc, 'production')
    expect([null, 'e7286f158be4460698caa507231685e8']).toContain(production)
    expect(production).not.toBe(boundHyperdriveId(jsonc, 'dev'))
  })
})

describe('who asks', () => {
  it('the deploy reads its target’s config back after the build and refuses before the size check', () => {
    const deploy = readFileSync('scripts/deploy.mjs', 'utf8')
    expect(deploy).toMatch(
      /run\(\['opennextjs-cloudflare', 'build'\]\)[\s\S]*?const target = production \? 'production' : 'dev'\s*const readBack = readBackHyperdrive\(target\)[\s\S]*?if \(!readBack\.ok\) process\.exit\(1\)[\s\S]*?verdict\(measure\(\{ production \}\)\)/,
    )
  })

  it('the sweep reads dev’s back through the same module', () => {
    const sweep = readFileSync('scripts/sweep.mjs', 'utf8')
    expect(sweep).toContain("readBackHyperdrive('dev')")
    expect(sweep).toMatch(/from '\.\/hyperdrive-config\.mjs'/)
  })
})

describe('the verdict', () => {
  it('passes zebra_app with caching disabled, names every other answer, refuses silence', () => {
    const good = hyperdriveVerdict('id', {
      origin: { user: 'zebra_app', host: 'ep-x.neon.tech' },
      caching: { disabled: true },
    })
    expect(good).toMatchObject({ ok: true, originHost: 'ep-x.neon.tech' })
    expect(describeReadBack('dev', good)).toMatch(
      /origin user zebra_app at ep-x\.neon\.tech, caching disabled true\. OK\./,
    )
    const owner = hyperdriveVerdict('id', {
      origin: { user: 'neondb_owner' },
      caching: { disabled: true },
    })
    expect(owner.reason).toMatch(/origin user is neondb_owner, not zebra_app/)
    expect(describeReadBack('production', owner)).toMatch(/REFUSED.*NOT OK\./)
    expect(
      hyperdriveVerdict('id', {
        origin: { user: 'zebra_app' },
        caching: { disabled: false },
      }).reason,
    ).toMatch(/caching is not disabled/)
    expect(hyperdriveVerdict('id', null).ok).toBe(false)
  })

  it('no answer names itself, with what wrangler said — never the config’s shape', () => {
    // 2026-10-26: CI's deploy token could not read Hyperdrive; the verdict
    // said "origin user is unknown, not zebra_app; query caching is not
    // disabled" about a config nobody had seen. The cause has to be the line.
    const silent = hyperdriveVerdict(
      'id',
      null,
      'Authentication error [code: 10000]',
    )
    expect(silent.ok).toBe(false)
    expect(silent.reason).toBe(
      'Cloudflare returned no config — wrangler said: Authentication error [code: 10000]',
    )
    expect(silent.reason).not.toMatch(/origin user|caching/)
    expect(hyperdriveVerdict('id', null).reason).toBe(
      'Cloudflare returned no config',
    )
    expect(describeReadBack('dev', silent)).toMatch(
      /REFUSED: Cloudflare returned no config — wrangler said: Authentication error/,
    )
  })
})
