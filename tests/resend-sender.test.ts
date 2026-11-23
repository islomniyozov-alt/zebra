import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

// ---------------------------------------------------------------------------
// THE VERIFIED SENDER, ON BOTH WORKERS (BROKER-LOAD-BRIEF R6; owner's ruling
// 2026-11-23). `RESEND_FROM` is a var in wrangler.jsonc — top level for dev,
// `env.production` for production — and both read the verified domain. A
// worker that fell back to `onboarding@resend.dev` would deliver only to the
// Resend account's owner: a dispatcher's reset and a broker's packet would be
// refused, and the screen would not say so.
// ---------------------------------------------------------------------------

const SENDER = '"RESEND_FROM": "Zebra <billing@zebratms.com>"'

describe('the sender', () => {
  const config = readFileSync('wrangler.jsonc', 'utf8')

  it('is billing@zebratms.com on dev and on production', () => {
    const at = config.indexOf('"production"')
    expect(at).toBeGreaterThan(0)
    expect(config.slice(0, at)).toContain(SENDER)
    expect(config.slice(at)).toContain(SENDER)
  })

  it('names Resend’s shared address in no var', () => {
    expect(config).not.toMatch(/"RESEND_FROM":\s*"[^"]*resend\.dev/)
  })
})
