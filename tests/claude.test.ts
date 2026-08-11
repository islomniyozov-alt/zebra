import { describe, expect, it } from 'vitest'
import {
  ClaudeError,
  EXTRACTION_MODEL,
  MAX_DOCUMENT_BASE64_BYTES,
  MAX_OUTPUT_TOKENS,
  askAboutDocument,
  costCents,
  costMilliCents,
  formatCostMilliCents,
} from '@/lib/claude'
import { MAX_UPLOAD_BYTES } from '@/lib/documents'

// ---------------------------------------------------------------------------
// THE CALL (Phase 5 §1.2).
//
// No network here: `fetchImpl` is injected, so these assert the REQUEST this
// module builds and the refusals it makes before spending anything. §5 asks for
// "the token cap proven by a document that exceeds it failing cleanly" — the
// proof is that the fetch never happens.
// ---------------------------------------------------------------------------

const ok = (body: unknown) =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  })

const reply = {
  content: [{ type: 'text', text: '{"ok":true}' }],
  usage: { input_tokens: 4_210, output_tokens: 880 },
  model: EXTRACTION_MODEL,
}

/** Records what the module tried to send. */
function spy(response: Response = ok(reply)) {
  const calls: { url: string; init: RequestInit }[] = []
  const impl = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} })
    return response
  }) as unknown as typeof fetch
  return { calls, impl }
}

const ask = (over: Record<string, unknown> = {}) => ({
  base64: 'JVBERi0xLjQK',
  mimeType: 'application/pdf',
  system: 'system',
  prompt: 'prompt',
  apiKey: 'test-key',
  ...over,
})

describe('the request', () => {
  it('names the model constant, not a literal', async () => {
    // §1.2: "model string a named constant, not scattered". If this ever fails
    // it is because somebody typed a model name into the body.
    const { calls, impl } = spy()
    await askAboutDocument({ ...ask(), fetchImpl: impl })

    const body = JSON.parse(String(calls[0]!.init.body))
    expect(body.model).toBe(EXTRACTION_MODEL)
    expect(body.max_tokens).toBe(MAX_OUTPUT_TOKENS)
  })

  it('sends a PDF as a document and an image as an image', async () => {
    const pdf = spy()
    await askAboutDocument({ ...ask(), fetchImpl: pdf.impl })
    expect(
      JSON.parse(String(pdf.calls[0]!.init.body)).messages[0].content[0].type,
    ).toBe('document')

    const png = spy()
    await askAboutDocument({
      ...ask({ mimeType: 'image/png' }),
      fetchImpl: png.impl,
    })
    expect(
      JSON.parse(String(png.calls[0]!.init.body)).messages[0].content[0].type,
    ).toBe('image')
  })

  it('carries the key in a header and never in the body', async () => {
    const { calls, impl } = spy()
    await askAboutDocument({ ...ask(), fetchImpl: impl })

    const headers = calls[0]!.init.headers as Record<string, string>
    expect(headers['x-api-key']).toBe('test-key')
    expect(headers['anthropic-version']).toBe('2023-06-01')
    expect(String(calls[0]!.init.body)).not.toContain('test-key')
  })
})

describe('what it refuses before spending anything', () => {
  it('a document over the cap — and the fetch never happens', async () => {
    // The cap is enforced BEFORE the call. A cap that only limited the
    // response would still let a 90-page scan cost real money on the way in.
    const { calls, impl } = spy()
    const oversized = 'A'.repeat(MAX_DOCUMENT_BASE64_BYTES + 1)

    await expect(
      askAboutDocument({ ...ask({ base64: oversized }), fetchImpl: impl }),
    ).rejects.toThrow(ClaudeError)
    expect(calls).toEqual([])
  })

  it('and the cap sits below what the pipeline will happily store', async () => {
    // documents.ts accepts 25MB. Extraction is the thing that declines, so a
    // document too big to read is still a document you can keep.
    expect(MAX_DOCUMENT_BASE64_BYTES).toBeLessThan(MAX_UPLOAD_BYTES)
  })

  it('a media type that cannot be read', async () => {
    const { calls, impl } = spy()
    await expect(
      askAboutDocument({
        ...ask({ mimeType: 'image/tiff' }),
        fetchImpl: impl,
      }),
    ).rejects.toMatchObject({ reason: 'unsupported_media_type' })
    expect(calls).toEqual([])
  })

  it('a worker with no key, by name rather than silently', async () => {
    const { calls, impl } = spy()
    await expect(
      askAboutDocument({
        base64: 'JVBERi0K',
        mimeType: 'application/pdf',
        system: 's',
        prompt: 'p',
        apiKey: '',
        fetchImpl: impl,
      }),
    ).rejects.toMatchObject({ reason: 'no_api_key' })
    expect(calls).toEqual([])
  })
})

describe('what it does with the answer', () => {
  it('returns the text and the usage', async () => {
    const { impl } = spy()
    const answer = await askAboutDocument({ ...ask(), fetchImpl: impl })
    expect(answer.text).toBe('{"ok":true}')
    expect(answer.usage).toEqual({ inputTokens: 4_210, outputTokens: 880 })
  })

  it('joins several text blocks rather than taking the first', async () => {
    const { impl } = spy(
      ok({
        content: [
          { type: 'text', text: '{"a":' },
          { type: 'text', text: '1}' },
        ],
        usage: { input_tokens: 1, output_tokens: 1 },
      }),
    )
    expect((await askAboutDocument({ ...ask(), fetchImpl: impl })).text).toBe(
      '{"a":1}',
    )
  })

  it('refuses an answer with no text at all', async () => {
    const { impl } = spy(ok({ content: [], usage: {} }))
    await expect(
      askAboutDocument({ ...ask(), fetchImpl: impl }),
    ).rejects.toMatchObject({ reason: 'no_text' })
  })

  it('carries the HTTP status through when the API refuses', async () => {
    const { impl } = spy(new Response('rate limited', { status: 429 }))
    await expect(
      askAboutDocument({ ...ask(), fetchImpl: impl }),
    ).rejects.toMatchObject({ reason: 'http_error', status: 429 })
  })
})

describe('what one document costs', () => {
  it('a worked example, checked by hand', () => {
    // §5 asks that the per-load cents be a measured fact. At 300¢ per million
    // input tokens and 1500¢ per million output:
    //
    //   4210 input  x 300  =  1,263,000
    //    880 output x 1500 =  1,320,000
    //                        ----------
    //                         2,583,000 millionths of a cent
    //                      =  2.583¢ -> 3¢ at whole cents
    const usage = { inputTokens: 4_210, outputTokens: 880 }
    expect(costCents(usage)).toBe(3)
    // Thousandths, because whole cents cannot tell 2.583 from 3.
    expect(costMilliCents(usage)).toBe(2_583)
    expect(formatCostMilliCents(costMilliCents(usage))).toBe('2.583¢')
  })

  it('a small document lands under a cent and says so honestly', () => {
    //   1500 x 300  = 450,000
    //    400 x 1500 = 600,000
    //                 -------
    //               1,050,000 millionths -> 1.05¢
    //
    // Whole cents would say 1, which is the same thing it says about 1.4¢.
    // Over a thousand loads a month those differ by $3.50, which is small and
    // is still the difference between a measured figure and a shrug.
    const usage = { inputTokens: 1_500, outputTokens: 400 }
    expect(costCents(usage)).toBe(1)
    expect(costMilliCents(usage)).toBe(1_050)
    expect(formatCostMilliCents(1_050)).toBe('1.050¢')
  })

  it('costs nothing for nothing', () => {
    expect(costCents({ inputTokens: 0, outputTokens: 0 })).toBe(0)
  })
})

describe('an answer that does not finish', () => {
  it('is TRUNCATED by name, not "not_json" three layers later', () => {
    // `stop_reason` was read into the response type and never checked, so an
    // answer cut off at the cap reached the strict parser as a broken string
    // and was reported as malformed JSON. True about the text, misleading
    // about the cause — and it cost a session and two golden-set runs to find.
    const calls: unknown[] = []
    const fetchImpl = (async (_url: string, init: RequestInit) => {
      calls.push(init)
      return new Response(
        JSON.stringify({
          content: [{ type: 'text', text: '{"brokerName": {"value": "Cas' }],
          usage: { input_tokens: 900, output_tokens: MAX_OUTPUT_TOKENS },
          stop_reason: 'max_tokens',
          model: 'claude-sonnet-5',
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      )
    }) as unknown as typeof fetch

    return expect(
      askAboutDocument({
        base64: 'JVBERi0=',
        mimeType: 'application/pdf',
        system: 'system',
        prompt: 'prompt',
        apiKey: 'test-key',
        fetchImpl,
      }),
    ).rejects.toMatchObject({ reason: 'truncated' })
  })
})
