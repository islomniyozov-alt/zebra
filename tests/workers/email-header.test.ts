import { describe, expect, it } from 'vitest'
import { emailConfigFromEnv } from '@/lib/email'

// ---------------------------------------------------------------------------
// WHAT ACTUALLY MAKES A HEADER VALUE ILLEGAL — asked of workerd, which is the
// only runtime whose answer matters.
//
// Production's reset mail died on:
//
//   [zebra.email] could not reach Resend {"error": "Invalid header value."}
//
// The obvious explanation was a trailing newline on `RESEND_API_KEY`, the
// ordinary residue of setting a secret through a shell. THAT EXPLANATION IS
// WRONG, and this file is where it was disproved: workerd accepts a trailing
// newline in a header value quite happily. So does undici. A key with one is
// untidy, not fatal.
//
// What does throw is an illegal character INSIDE the value — a newline in the
// middle, most plausibly from a key pasted across two lines or from a whole
// shell command landing in the secret, which has happened four times on this
// project already.
//
// The trim in `emailConfigFromEnv` is therefore hygiene rather than the
// repair. The repair is re-setting the secret, and the thing that points at it
// is the `misconfigured` reason rather than `unreachable`.
// ---------------------------------------------------------------------------

const TRAILING = ['re_secret', ''].join('\n')
const INTERNAL = ['re_sec', 'ret'].join('\n')

describe('what workerd will and will not put in a header', () => {
  it('tolerates a trailing newline — so that was NOT the production fault', () => {
    expect(
      () => new Headers({ authorization: `Bearer ${TRAILING}` }),
    ).not.toThrow()
  })

  it('refuses a newline in the middle — which is the shape that did fail', () => {
    expect(() => new Headers({ authorization: `Bearer ${INTERNAL}` })).toThrow()
  })
})

describe('the config reader', () => {
  it('trims the untidy case, because a key never means its own whitespace', () => {
    expect(emailConfigFromEnv({ RESEND_API_KEY: TRAILING })?.apiKey).toBe(
      're_secret',
    )
  })

  it('does not pretend to rescue the broken one', () => {
    // Trimming a value that is wrong in the middle would produce a key that
    // still fails, one layer further from the cause. It is left alone so the
    // `misconfigured` reason and the log line survive to name the secret.
    const config = emailConfigFromEnv({ RESEND_API_KEY: INTERNAL })
    expect(config?.apiKey).toBe(INTERNAL)
    expect(
      () => new Headers({ authorization: `Bearer ${config?.apiKey}` }),
    ).toThrow()
  })
})
