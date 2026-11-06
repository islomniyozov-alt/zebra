import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { parseWranglerConfig } from '../scripts/hyperdrive-config.mjs'

// ---------------------------------------------------------------------------
// THE TWO WORKERS NAME THE SAME NON-SECRET R2 VALUES, EACH IN ITS OWN BLOCK.
//
// `R2_ACCOUNT_ID` and `R2_ENDPOINT` are not credentials — the account id is
// what `wrangler whoami` prints and the endpoint is derived from it — and they
// moved to production's `vars` in `8e553f9` (2026-08-15) because a secret's
// value cannot be read back: production R2 had failed every call on a
// malformed endpoint nobody could see. Dev stayed a secret until GAPS 41
// (2026-11-05). `vars` do not inherit into a named environment, so each block
// must carry both, and the same validation `8e553f9` ran by hand runs here.
// ---------------------------------------------------------------------------

const config = parseWranglerConfig(readFileSync('wrangler.jsonc', 'utf8'))
const BLOCKS: [name: string, vars: Record<string, string>][] = [
  ['dev', config.vars ?? {}],
  ['production', config.env?.production?.vars ?? {}],
]

describe.each(BLOCKS)('the %s vars block', (name, vars) => {
  it('names the R2 account id and endpoint itself', () => {
    expect(vars.R2_ACCOUNT_ID, `${name}: R2_ACCOUNT_ID`).toMatch(
      /^[0-9a-f]{32}$/,
    )
    expect(vars.R2_ENDPOINT, `${name}: R2_ENDPOINT`).toBeTypeOf('string')
  })

  it('has an endpoint that parses, on R2, for that account', () => {
    const url = new URL(vars.R2_ENDPOINT ?? '')
    expect(url.protocol).toBe('https:')
    expect(url.host).toBe(`${vars.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`)
    // The composed PUT url `r2.ts` builds parses too — the first production
    // deploy shipped an endpoint with a dotenv banner inside it.
    expect(() => new URL(`${url.origin}/zebra-docs/some/key`)).not.toThrow()
  })
})

describe('across the two blocks', () => {
  it('the account is one account: same id, same endpoint', () => {
    const [, dev] = BLOCKS[0]!
    const [, production] = BLOCKS[1]!
    expect(dev.R2_ACCOUNT_ID).toBe(production.R2_ACCOUNT_ID)
    expect(dev.R2_ENDPOINT).toBe(production.R2_ENDPOINT)
  })

  it('and only the BUCKET differs between them', () => {
    const [, dev] = BLOCKS[0]!
    const [, production] = BLOCKS[1]!
    expect(dev.R2_BUCKET).toBe('zebra-docs-dev')
    expect(production.R2_BUCKET).toBe('zebra-docs')
  })
})
