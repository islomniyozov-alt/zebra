import { describe, expect, it } from 'vitest'
import { NOTHING_READ, cdlPrefill, readCdl } from '@/lib/cdl'
import type { ExtractedCdl } from '@/lib/cdl'

// ---------------------------------------------------------------------------
// THE CDL PREFILL, WHICH IS ALL THAT EXISTS OF THE READER TODAY.
//
// The flow is real and the read is not: there is no CDL in the corpus, and
// writing a prompt against no document is tuning against the model's own
// answers. So what is testable now is the SHAPE — what a read turns into when
// it comes back, and what it must not turn into when it comes back empty.
// ---------------------------------------------------------------------------

const field = <T>(value: T) => ({ value, confidence: 'high' as const })

const read = (over: Partial<ExtractedCdl> = {}): ExtractedCdl => ({
  ...NOTHING_READ,
  ...over,
})

describe('the reader, until a real card exists', () => {
  it('says it is not implemented rather than returning an empty success', async () => {
    // The difference decides what a dispatcher does next: "we cannot read yet"
    // means enter it by hand, "nothing on the card" means photograph it again.
    expect(await readCdl({ base64: 'x', mimeType: 'image/jpeg' })).toEqual({
      ok: false,
      reason: 'not_implemented',
    })
  })
})

describe('turning a licence into form values', () => {
  it('fills nothing from a read that found nothing', () => {
    // NOT empty strings. A blank the reader supplied and a blank nobody
    // touched look identical in a form and mean different things; only one of
    // them is a value somebody agreed to.
    expect(cdlPrefill(NOTHING_READ)).toEqual({})
  })

  it('carries only the fields the card actually yielded', () => {
    expect(
      cdlPrefill(
        read({ licenceNumber: field('WDL-4471'), state: field('WA') }),
      ),
    ).toEqual({ cdlNumber: 'WDL-4471', cdlState: 'WA' })
  })

  it('splits a printed name into given and family', () => {
    expect(cdlPrefill(read({ fullName: field('Islom Niyozov') }))).toEqual({
      firstName: 'Islom',
      lastName: 'Niyozov',
    })
  })

  it('treats every word but the last as the given name', () => {
    expect(cdlPrefill(read({ fullName: field('Juan Carlos Mendez') }))).toEqual(
      {
        firstName: 'Juan Carlos',
        lastName: 'Mendez',
      },
    )
  })

  it('puts a single word in both rather than inventing a surname', () => {
    // A blank surname would be a required field the reader emptied.
    expect(cdlPrefill(read({ fullName: field('Prince') }))).toEqual({
      firstName: 'Prince',
      lastName: 'Prince',
    })
  })

  // THE SPLIT IS WRONG FOR SOME NAMES AND THAT IS ACCEPTED, not hidden. This
  // test states the known-wrong case so nobody "fixes" it by adding a list of
  // particles, which is how a name rule becomes a rule about whose names are
  // normal. The value lands in an editable field for exactly this reason.
  it('gets a compound surname wrong, into a field a human then corrects', () => {
    expect(cdlPrefill(read({ fullName: field('Ana de la Cruz') }))).toEqual({
      firstName: 'Ana de la',
      lastName: 'Cruz',
    })
  })

  it('ignores surrounding whitespace on a scanned name', () => {
    expect(cdlPrefill(read({ fullName: field('  Ahmad  Karimov ') }))).toEqual({
      firstName: 'Ahmad',
      lastName: 'Karimov',
    })
  })
})
