import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as authContext from '@/lib/auth-context'
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

// ---------------------------------------------------------------------------
// THE PATH ITSELF, WHICH NOTHING WALKED — AND THAT IS WHY THIS SHIPPED BROKEN.
//
// The commit that built this flow said "dropping a card walks the whole path"
// and tested `cdlPrefill` and `readCdl` directly. Neither of them is the path.
// The upload, the body, the handler, the response — none of it was exercised
// by anything, and a 1.3MB PDF hit Next's 1MB server-action body limit and
// arrived as a bare 500 with the reason only in the Worker log.
//
// So these call the HANDLER, with bytes, at sizes that matter.
// ---------------------------------------------------------------------------
describe('the read handler, walked with real bytes', () => {
  // A SESSION, BECAUSE THE HANDLER CORRECTLY REFUSES WITHOUT ONE. The defect
  // being tested is downstream of auth — a body limit — so the session is
  // supplied rather than exercised, and the permission check keeps its own
  // test below.
  beforeEach(() => {
    vi.spyOn(authContext, 'requireSession').mockResolvedValue({
      userId: 'u1',
      organizationId: 'o1',
      role: 'OWNER',
      companyScopes: [],
      sessionId: 's1',
      expiresAt: new Date(Date.now() + 3_600_000),
    } as never)
  })
  afterEach(() => vi.restoreAllMocks())

  /** A file of a given size, the way a phone would hand one over. */
  const upload = (bytes: number, type = 'image/jpeg') =>
    new File([new Uint8Array(bytes)], 'cdl.jpg', { type })

  const post = async (file: File) => {
    const body = new FormData()
    body.append('file', file)
    const { POST } = await import('@/app/api/cdl/read/route')
    return POST(new Request('http://x/api/cdl/read', { method: 'POST', body }))
  }

  it('refuses a file past its own limit BEFORE reading the bytes', async () => {
    const { MAX_CDL_BYTES } = await import('@/app/api/cdl/read/route')
    const response = await post(upload(MAX_CDL_BYTES + 1))
    expect(response.status).toBe(413)
  })

  // THE SIZE THAT BROKE IT. A 4MB phone photo, downscaled by the browser to a
  // few hundred KB, is what actually arrives — but even undownscaled it must
  // reach the handler rather than dying in a framework body check. The old
  // path failed at ~750KB of ORIGINAL file, because base64 inflated it past a
  // 1MB action limit.
  it('accepts a phone-sized photograph', async () => {
    const response = await post(upload(3 * 1024 * 1024))
    expect(response.status).toBe(200)
    const body = (await response.json()) as { notice: string }
    // Nothing read yet, said as itself rather than as a failure.
    expect(body.notice).toBe('drivers.cdl.notReadingYet')
  })

  it('accepts a PDF, which is the file that broke on production', async () => {
    const response = await post(upload(1_320_563, 'application/pdf'))
    expect(response.status).toBe(200)
  })

  it('refuses a file that is neither photo nor PDF', async () => {
    const response = await post(upload(1024, 'text/csv'))
    expect(response.status).toBe(415)
  })

  it('refuses a request with no file at all', async () => {
    const { POST } = await import('@/app/api/cdl/read/route')
    const response = await POST(
      new Request('http://x/api/cdl/read', {
        method: 'POST',
        body: new FormData(),
      }),
    )
    expect(response.status).toBe(400)
  })
})
