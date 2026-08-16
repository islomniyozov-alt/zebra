import { describe, expect, it } from 'vitest'
import {
  byDocumentLikelihood,
  documentToRead,
  isDecoration,
  MAX_FORWARDED_ATTACHMENTS,
  MAX_FORWARDED_TOTAL_BYTES,
  type AttachmentFacts,
} from '@/lib/inbound-email-payload'

// ---------------------------------------------------------------------------
// A SIGNATURE LOGO IS NOT A RATE CONFIRMATION.
//
// On 2026-08-16 a real Relay booking was read as every field null, four times
// across two days, and the queue showed it as an ordinary message. The reader
// had been handed a Gmail signature logo instead of the booking, because the
// route preferred "the first attachment whose type looks readable" and the
// worker forwarded only the first match it found.
//
// The proof was in the token counts: 4294 input tokens on a 2052-character
// booking and 4294 on a 211-character "Hello Test 2" — identical cost for
// wildly different documents, because the document was never in the request.
// What came back was `brokerName: "RAM HAULAGE"` at high confidence: our own
// carrier's name, read off our own logo.
//
// THE REAL PART, from the stored .eml, is the fixture below.
// ---------------------------------------------------------------------------

/** The actual signature logo, as the message declared it. */
const LOGO: AttachmentFacts = {
  mimeType: 'image/png',
  disposition: 'inline',
  inlineReferenced: true,
}

/** A rate confirmation as a broker actually sends one. */
const RATECON: AttachmentFacts = {
  mimeType: 'application/pdf',
  disposition: 'attachment',
  inlineReferenced: false,
}

/** A photographed or scanned rate confirmation. */
const PHOTO: AttachmentFacts = {
  mimeType: 'image/jpeg',
  disposition: 'attachment',
  inlineReferenced: false,
}

describe('what counts as decoration', () => {
  it('the logo that caused all this', () => {
    expect(isDecoration(LOGO)).toBe(true)
  })

  it('an inline part even when the HTML does not point at it', () => {
    expect(isDecoration({ ...LOGO, inlineReferenced: false })).toBe(true)
  })

  it('a cid-referenced part even when it declares no disposition', () => {
    // Some clients omit Content-Disposition entirely; the cid reference is
    // the stronger of the two signals and stands on its own.
    expect(isDecoration({ ...LOGO, disposition: null })).toBe(true)
  })

  it('but not a real attachment', () => {
    expect(isDecoration(RATECON)).toBe(false)
    expect(isDecoration(PHOTO)).toBe(false)
  })

  // SIZE IS NOT A SIGNAL AND IS NOT CONSULTED. The logo was 37KB against a
  // 12.7KB HTML body — three times the weight of what it decorates. Any floor
  // low enough to admit a photographed ratecon would have admitted it.
  it('does not ask how big anything is', () => {
    expect(Object.keys(LOGO)).not.toContain('bytes')
    expect(isDecoration.length).toBe(1)
  })
})

describe('which document gets read', () => {
  it('the body, when all that came with it was decoration', () => {
    // THE CASE THAT WAS BROKEN. Before this rule, the answer was the logo.
    expect(documentToRead([LOGO])).toBeNull()
  })

  it('the PDF, always, even behind a logo', () => {
    expect(documentToRead([LOGO, RATECON])).toBe(RATECON)
    expect(documentToRead([RATECON, LOGO])).toBe(RATECON)
  })

  it('the PDF even when a real image also came along', () => {
    expect(documentToRead([PHOTO, RATECON])).toBe(RATECON)
  })

  it('a photographed ratecon when there is no PDF', () => {
    expect(documentToRead([LOGO, PHOTO])).toBe(PHOTO)
  })

  it('nothing at all when nothing came with it', () => {
    expect(documentToRead([])).toBeNull()
  })
})

describe('what the caps drop, when they have to drop something', () => {
  it('keeps the document and drops the decoration', () => {
    // A cap that trimmed in arrival order would discard the ratecon because a
    // logo reached the limit first — today's bug at a different threshold.
    const arrived = [LOGO, LOGO, RATECON, LOGO]
    const kept = [...arrived].sort(byDocumentLikelihood).slice(0, 2)
    expect(kept[0]).toBe(RATECON)
  })

  it('prefers a real image over an inline one', () => {
    const kept = [LOGO, PHOTO].sort(byDocumentLikelihood)
    expect(kept[0]).toBe(PHOTO)
  })

  it('has caps that are stated rather than implied', () => {
    expect(MAX_FORWARDED_ATTACHMENTS).toBe(6)
    expect(MAX_FORWARDED_TOTAL_BYTES).toBe(10 * 1024 * 1024)
  })
})
