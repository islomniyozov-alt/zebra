import { describe, expect, it } from 'vitest'
import { ClaudeError, MAX_OUTPUT_TOKENS, costMilliCents } from '@/lib/claude'
import { askGemini, isGeminiModel } from '@/lib/gemini'
import { askModel } from '@/lib/model-engine'

// ---------------------------------------------------------------------------
// THE GEMINI ADAPTER, OFFLINE.
//
// Every assertion here is about the REQUEST this builds and the failures it
// names — none of it needs a key or a network, which is the point: an engine
// swap that can only be checked by spending money is an engine swap nobody
// checks.
// ---------------------------------------------------------------------------

const reply = {
  candidates: [
    { content: { parts: [{ text: '{"ok":true}' }] }, finishReason: 'STOP' },
  ],
  usageMetadata: {
    promptTokenCount: 3_100,
    candidatesTokenCount: 640,
    cachedContentTokenCount: 900,
  },
}

/**
 * A FRESH Response per call, not one shared object.
 *
 * A Response body can be read exactly once, so a spy that hands the same
 * instance to two calls fails on the second with "Body is unusable" — which
 * looks like a bug in the adapter and is a bug in the test. Found by the one
 * test here that calls twice.
 */
function spy(body: unknown = reply, status = 200) {
  const calls: { url: string; init: RequestInit }[] = []
  const impl = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} })
    return new Response(JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json' },
    })
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

describe('the request it builds', () => {
  it('puts the model in the URL and the key in a HEADER', async () => {
    // Never a query parameter: a key in a URL lands in access logs, proxies
    // and browser history, and this one is billable.
    const { calls, impl } = spy()
    await askGemini({ ...ask(), model: 'gemini-3.6-flash', fetchImpl: impl })

    expect(calls[0]!.url).toBe(
      'https://generativelanguage.googleapis.com/v1beta/models/gemini-3.6-flash:generateContent',
    )
    expect(calls[0]!.url).not.toContain('key=')
    const headers = calls[0]!.init.headers as Record<string, string>
    expect(headers['x-goog-api-key']).toBe('test-key')
  })

  it('sends the system prompt as systemInstruction and the file inline', async () => {
    const { calls, impl } = spy()
    await askGemini({ ...ask(), fetchImpl: impl })
    const body = JSON.parse(String(calls[0]!.init.body))

    expect(body.systemInstruction.parts[0].text).toBe('system')
    expect(body.contents[0].parts[0].inlineData).toEqual({
      mimeType: 'application/pdf',
      data: 'JVBERi0xLjQK',
    })
    expect(body.contents[0].parts[1].text).toBe('prompt')
  })

  it('asks for JSON and the same output cap as the other engine', async () => {
    const { calls, impl } = spy()
    await askGemini({ ...ask(), fetchImpl: impl })
    const body = JSON.parse(String(calls[0]!.init.body))

    expect(body.generationConfig.responseMimeType).toBe('application/json')
    expect(body.generationConfig.maxOutputTokens).toBe(MAX_OUTPUT_TOKENS)
    expect(body.generationConfig.temperature).toBe(0)
  })
})

describe('the same guards, before the call', () => {
  it('refuses a document over the byte cap without sending it', async () => {
    const { calls, impl } = spy()
    await expect(
      askGemini({
        ...ask({ base64: 'A'.repeat(11 * 1024 * 1024) }),
        fetchImpl: impl,
      }),
    ).rejects.toMatchObject({ reason: 'document_too_large' })
    // THE HALF THAT MATTERS: nothing was sent, so nothing was billed.
    expect(calls).toHaveLength(0)
  })

  it('refuses a media type it cannot read', async () => {
    const { calls, impl } = spy()
    await expect(
      askGemini({ ...ask({ mimeType: 'text/csv' }), fetchImpl: impl }),
    ).rejects.toMatchObject({ reason: 'unsupported_media_type' })
    expect(calls).toHaveLength(0)
  })

  it('names a missing key rather than returning nothing', async () => {
    const { impl } = spy()
    await expect(
      askGemini({ ...ask({ apiKey: undefined }), fetchImpl: impl }),
    ).rejects.toMatchObject({ reason: 'no_api_key' })
  })
})

describe('the answer', () => {
  it('returns the text and maps usage onto the shared counters', async () => {
    const { impl } = spy()
    const answer = await askGemini({
      ...ask(),
      model: 'gemini-3.6-flash',
      fetchImpl: impl,
    })
    expect(answer.text).toBe('{"ok":true}')
    expect(answer.model).toBe('gemini-3.6-flash')
    expect(answer.usage).toEqual({
      inputTokens: 3_100,
      outputTokens: 640,
      cacheWriteTokens: 0,
      cacheReadTokens: 900,
    })
  })

  it('names TRUNCATION rather than letting it become bad JSON', async () => {
    // The Anthropic side learned this the expensive way: a cut-off answer
    // reported as `not_json` three layers later sent a session hunting for
    // prose the model never wrote.
    const { impl } = spy({
      candidates: [
        {
          content: { parts: [{ text: '{"brokerName": {"value": "Cas' }] },
          finishReason: 'MAX_TOKENS',
        },
      ],
      usageMetadata: { promptTokenCount: 900, candidatesTokenCount: 8_192 },
    })
    await expect(
      askGemini({ ...ask(), fetchImpl: impl }),
    ).rejects.toMatchObject({ reason: 'truncated' })
  })

  it('names a blocked prompt as a refusal, not a network problem', async () => {
    const { impl } = spy({ promptFeedback: { blockReason: 'SAFETY' } })
    await expect(
      askGemini({ ...ask(), fetchImpl: impl }),
    ).rejects.toMatchObject({ reason: 'refused' })
  })

  it('and an HTTP error carries the status', async () => {
    const { impl } = spy({ error: { message: 'nope' } }, 429)
    const error = await askGemini({ ...ask(), fetchImpl: impl }).catch(
      (thrown: unknown) => thrown,
    )
    expect(error).toBeInstanceOf(ClaudeError)
    expect(error).toMatchObject({ reason: 'http_error', status: 429 })
  })
})

describe('the routing seam', () => {
  it('sends a gemini- model to Gemini', async () => {
    const { calls, impl } = spy()
    await askModel({
      ...ask(),
      model: 'gemini-3.5-flash-lite',
      fetchImpl: impl,
    })
    expect(calls[0]!.url).toContain('generativelanguage.googleapis.com')
  })

  it('and everything else to Anthropic, including no model at all', async () => {
    const { calls, impl } = spy({
      content: [{ type: 'text', text: '{"ok":true}' }],
      usage: { input_tokens: 10, output_tokens: 10 },
      model: 'claude-sonnet-5',
      stop_reason: 'end_turn',
    })
    await askModel({ ...ask(), fetchImpl: impl })
    await askModel({
      ...ask(),
      model: 'claude-haiku-4-5-20251001',
      fetchImpl: impl,
    })
    expect(calls[0]!.url).toContain('api.anthropic.com')
    expect(calls[1]!.url).toContain('api.anthropic.com')
  })

  it('routes on the NAME and nothing else', () => {
    expect(isGeminiModel('gemini-3.6-flash')).toBe(true)
    expect(isGeminiModel('claude-sonnet-5')).toBe(false)
    expect(isGeminiModel('')).toBe(false)
  })
})

describe('what a Gemini call costs', () => {
  it('prices each Gemini row at its own rate', () => {
    expect(
      costMilliCents(
        { inputTokens: 1_000_000, outputTokens: 1_000_000 },
        'gemini-3.6-flash',
      ),
    ).toBe(280_000)
    expect(
      costMilliCents(
        { inputTokens: 1_000_000, outputTokens: 1_000_000 },
        'gemini-3.5-flash-lite',
      ),
    ).toBe(50_000)
  })

  it('and an unpriced model still falls to the DEAREST on file', () => {
    // The rule survives adding four cheap rows: computed from the table now,
    // not named, or the fallback would quietly become the cheapest one here.
    expect(
      costMilliCents(
        { inputTokens: 1_000_000, outputTokens: 1_000_000 },
        'gemini-9-imaginary',
      ),
    ).toBe(1_800_000)
  })
})
