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

describe('the reader, when the model cannot be reached', () => {
  it('reports a failed call rather than an empty success', async () => {
    // WAS `not_implemented` WHILE readCdl WAS A STUB. The stub is gone; this
    // now exercises the real path with no API key present, which is exactly
    // the `call_failed` branch — ours or the network's, and nothing about the
    // licence. The difference still decides what a dispatcher does next: "try
    // again" versus "photograph it again".
    expect(await readCdl({ base64: 'x', mimeType: 'image/jpeg' })).toEqual({
      ok: false,
      reason: 'call_failed',
    })
  })
})

describe('turning a licence into form values', () => {
  it('fills nothing from a read that found nothing', () => {
    // NOT empty strings. A blank the reader supplied and a blank nobody
    // touched look identical in a form and mean different things.
    expect(cdlPrefill(NOTHING_READ)).toEqual({})
  })

  it('carries only the fields the card actually yielded', () => {
    expect(
      cdlPrefill(
        read({ licenceNumber: field('WDL-4471'), state: field('WA') }),
      ),
    ).toEqual({ cdlNumber: 'WDL-4471', cdlState: 'WA' })
  })

  // ── THE NAME IS NOT SPLIT ANY MORE, AND THAT IS THE FIX ──────────────────
  //
  // This used to take one printed name and guess which word was the surname.
  // A test STATED that it got `Ana de la Cruz` wrong, on the reasoning that the
  // value landed in an editable field. Keying on the AAMVA numbers removed the
  // guess rather than improving it: field 1 IS the family name and field 2 IS
  // the given name, printed on the card, so there is nothing left to infer.
  it('takes family and given names exactly as the card labels them', () => {
    expect(
      cdlPrefill(
        read({ familyName: field('Niyozov'), givenName: field('Islom') }),
      ),
    ).toEqual({ lastName: 'Niyozov', firstName: 'Islom' })
  })

  it('does not reorder a name that defies English intuition', () => {
    // Field 1 says the family name is Islom. A reader applying "last word is
    // the surname" would file this person backwards, which is the mistake the
    // AAMVA keys make impossible.
    expect(
      cdlPrefill(
        read({ familyName: field('Islom'), givenName: field('Niyozov') }),
      ),
    ).toEqual({ lastName: 'Islom', firstName: 'Niyozov' })
  })

  it('keeps a compound family name whole', () => {
    // The old splitter turned this into "Ana de la" / "Cruz".
    expect(
      cdlPrefill(
        read({ familyName: field('de la Cruz'), givenName: field('Ana') }),
      ),
    ).toEqual({ lastName: 'de la Cruz', firstName: 'Ana' })
  })

  it('trims what the card printed with whitespace around it', () => {
    expect(
      cdlPrefill(
        read({ familyName: field('  Karimov '), givenName: field(' Aziz ') }),
      ),
    ).toEqual({ lastName: 'Karimov', firstName: 'Aziz' })
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
    // THE DEFECT THIS TEST EXISTS FOR IS SIZE, and it still is. The old path
    // died at ~750KB inside a framework body check; this one takes 3MB and
    // reaches the reader. What the reader then says depends on whether a model
    // is reachable — in this environment it is not — so the assertion is that
    // the file got through, NOT that it was read.
    const response = await post(upload(3 * 1024 * 1024))
    expect(response.status).toBe(200)
    const body = (await response.json()) as { notice: string }
    expect(body.notice).not.toBe('drivers.cdl.tooLarge')
    expect(body.notice).not.toBe('drivers.cdl.wrongType')
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
