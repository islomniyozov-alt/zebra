import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { INBOUND_EMAIL_PAYLOAD_FIELDS } from '@/lib/inbound-email-payload'

// ---------------------------------------------------------------------------
// THE MAIL WORKER AND THE ENDPOINT AGREE, AND SO DOES THE SCRIPT THAT CLAIMS
// TO IMPERSONATE THE WORKER.
//
// `workers/email/index.ts` now imports the payload type, so drift between the
// worker and the route is a `tsc` error and needs no test. What tsc CANNOT see
// is `scripts/verify-inbound-email.mjs` — plain JavaScript, carrying a
// hand-written copy of the same object, and the only thing that ever proved
// this pipeline end to end (brief flag 49). A verify script that posts a shape
// the worker no longer sends reports success about a fiction.
//
// TWO DEPLOYMENTS, NOT ONE. `zebra-email` and `zebra` ship from separate
// commands, so the two halves genuinely can be out of step in production. This
// file cannot catch that — only a matching deploy can — but it can make sure
// the SOURCE never disagrees with itself.
// ---------------------------------------------------------------------------

const worker = readFileSync('workers/email/index.ts', 'utf8')
const script = readFileSync('scripts/verify-inbound-email.mjs', 'utf8')

/**
 * The object literal a file posts, sliced out so unrelated keys cannot count.
 *
 * Throws rather than asserting: this runs while the module loads, where a
 * failed `expect` reports as "no tests" instead of as the thing that broke.
 */
function postedBody(source: string, from: RegExp, to: string): string {
  const match = from.exec(source)
  if (!match) throw new Error(`could not find ${from} — the anchor moved`)
  const start = match.index
  const end = source.indexOf(to, start)
  if (end < 0) throw new Error(`could not find the end of the body (${to})`)
  return source.slice(start, end)
}

describe('every field of the payload appears in every copy of it', () => {
  it('has fields to check at all', () => {
    // A vacuous pass here would be the whole file's failure mode.
    expect(INBOUND_EMAIL_PAYLOAD_FIELDS.length).toBeGreaterThan(5)
  })

  const workerBody = postedBody(
    worker,
    /const body(\s*:\s*InboundEmailPayload)?\s*=\s*\{/,
    'const response =',
  )
  const scriptBody = postedBody(script, /body: JSON.stringify\(\{/, '})')

  it.each(INBOUND_EMAIL_PAYLOAD_FIELDS)('the mail worker sends %s', (field) => {
    expect(workerBody, `workers/email/index.ts never sets ${field}`).toMatch(
      new RegExp(`\\b${field}\\s*[,:]`),
    )
  })

  it.each(INBOUND_EMAIL_PAYLOAD_FIELDS)(
    'the verify script sends %s',
    (field) => {
      expect(
        scriptBody,
        `scripts/verify-inbound-email.mjs never sets ${field}`,
      ).toMatch(new RegExp(`\\b${field}\\s*:`))
    },
  )
})

describe('the worker is held to the type rather than to a memory of it', () => {
  it('imports the payload type instead of redeclaring the shape', () => {
    // `import type { … }` or an inline `type` modifier — the worker now also
    // imports RUNTIME rules from the same module, so the whole import is no
    // longer type-only.
    expect(worker).toContain('type InboundEmailPayload')
    expect(worker).toContain("from '../../src/lib/inbound-email-payload'")
  })

  // THE RULE IS SHARED, NOT COPIED. The worker orders candidates and the route
  // picks among them; if either reimplemented the judgment they would drift,
  // which is exactly how a signature logo came to be preferred over a booking.
  it('orders candidates with the shared rule rather than its own', () => {
    expect(worker).toContain('byDocumentLikelihood')
    expect(
      worker,
      'the worker must not decide what counts as decoration',
    ).not.toContain('function isDecoration')
  })

  it('and the route chooses with the same module', () => {
    const route = readFileSync('src/app/api/inbound-email/route.ts', 'utf8')
    expect(route).toContain('documentToRead(')
    expect(route, 'no second mime-type guess in the route').not.toContain(
      'image/)',
    )
  })

  it('annotates the body it posts with that type', () => {
    // Importing a type and not using it would satisfy the test above while
    // proving nothing.
    expect(worker).toMatch(/const body\s*:\s*InboundEmailPayload\s*=/)
  })

  it('and the route reads the same declaration', () => {
    const route = readFileSync('src/app/api/inbound-email/route.ts', 'utf8')
    expect(route).toMatch(/from '@\/lib\/inbound-email-payload'/)
    // The old local interface must be gone, not merely shadowed.
    expect(route).not.toMatch(/interface InboundEmailPayload/)
  })
})
