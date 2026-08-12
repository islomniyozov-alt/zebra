import { describe, expect, it } from 'vitest'
import {
  ClaudeError,
  EXTRACTION_MODEL,
  MAX_OUTPUT_TOKENS,
  costMilliCents,
} from '@/lib/claude'
import { askGemini, isGeminiModel } from '@/lib/gemini'
import { FALLBACK_MODEL, askModel, isOutage } from '@/lib/model-engine'

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
    // THE ORDER IS THE CACHE. Gemini caches a leading prefix implicitly, so
    // the stable text goes first and the unique document last; the other way
    // round makes every call's prefix unique and nothing ever hits.
    expect(body.contents[0].parts[0].text).toBe('prompt')
    expect(body.contents[0].parts[1].inlineData).toEqual({
      mimeType: 'application/pdf',
      data: 'JVBERi0xLjQK',
    })
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

  it('follows the DEFAULT when no model is asked for', async () => {
    // THE BUG THIS REPLACES. The first version of this test asserted that no
    // model meant Anthropic — which was the letter of the routing and not its
    // intent, so it went green through the day the default became a Gemini
    // model. Every default extraction then 404'd: the call went to
    // api.anthropic.com carrying `gemini-3.6-flash`.
    //
    // Asserted against the constant rather than a name, so this test follows
    // the default wherever the owner moves it.
    const { calls, impl } = spy()
    await askModel({ ...ask(), fetchImpl: impl })
    const host = isGeminiModel(EXTRACTION_MODEL)
      ? 'generativelanguage.googleapis.com'
      : 'api.anthropic.com'
    expect(calls[0]!.url).toContain(host)
  })

  it('and an explicitly named Anthropic model still goes to Anthropic', async () => {
    const { calls, impl } = spy({
      content: [{ type: 'text', text: '{"ok":true}' }],
      usage: { input_tokens: 10, output_tokens: 10 },
      model: 'claude-sonnet-5',
      stop_reason: 'end_turn',
    })
    await askModel({
      ...ask(),
      model: 'claude-haiku-4-5-20251001',
      fetchImpl: impl,
    })
    await askModel({ ...ask(), model: 'claude-sonnet-5', fetchImpl: impl })
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
    ).toBe(900_000)
    expect(
      costMilliCents(
        { inputTokens: 1_000_000, outputTokens: 1_000_000 },
        'gemini-3.5-flash-lite',
      ),
    ).toBe(280_000)
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

// ---------------------------------------------------------------------------
// THE FALLBACK (owner's ruling, after a 429 stopped a walkthrough).
//
// A quota or a dropped connection means nobody read the document, and retrying
// on Sonnet beats telling a dispatcher to try again. A BAD ANSWER is not an
// outage — that is the pair, and it is the whole rule.
// ---------------------------------------------------------------------------

/** A spy whose first call fails and whose second succeeds. */
function failingThenOk(first: Response | Error) {
  const calls: { url: string; init: RequestInit }[] = []
  const impl = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} })
    if (calls.length === 1) {
      if (first instanceof Error) throw first
      return first.clone()
    }
    return new Response(
      JSON.stringify({
        content: [{ type: 'text', text: '{"ok":"from sonnet"}' }],
        usage: { input_tokens: 100, output_tokens: 50 },
        model: 'claude-sonnet-5',
        stop_reason: 'end_turn',
      }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    )
  }) as unknown as typeof fetch
  return { calls, impl }
}

const quota = () =>
  new Response(
    JSON.stringify({ error: { code: 429, message: 'quota exceeded' } }),
    { status: 429, headers: { 'content-type': 'application/json' } },
  )

describe('the fallback FIRES', () => {
  it('on a 429, and the answer comes from Sonnet', async () => {
    const { calls, impl } = failingThenOk(quota())
    const answer = await askModel({ ...ask(), fetchImpl: impl })

    expect(calls).toHaveLength(2)
    expect(calls[0]!.url).toContain('generativelanguage.googleapis.com')
    expect(calls[1]!.url).toContain('api.anthropic.com')
    expect(answer.text).toBe('{"ok":"from sonnet"}')
    expect(answer.model).toBe('claude-sonnet-5')
  })

  it('and RECORDS THE SWAP — model alone would not show it', async () => {
    // The requirement in one assertion: who answered, who was asked, and why.
    const { impl } = failingThenOk(quota())
    const answer = await askModel({ ...ask(), fetchImpl: impl })

    expect(answer.fellBackFrom).toEqual({
      model: EXTRACTION_MODEL,
      reason: 'http_error',
      status: 429,
    })
  })

  it('on a 503, because an outage is theirs and not ours', async () => {
    const { calls, impl } = failingThenOk(
      new Response('upstream', { status: 503 }),
    )
    await askModel({ ...ask(), fetchImpl: impl })
    expect(calls).toHaveLength(2)
  })

  it('and on a fetch that never reached the other end', async () => {
    const { calls, impl } = failingThenOk(new TypeError('network failure'))
    const answer = await askModel({ ...ask(), fetchImpl: impl })
    expect(calls).toHaveLength(2)
    expect(answer.model).toBe(FALLBACK_MODEL)
  })
})

describe('the fallback DOES NOT FIRE', () => {
  it('on an answer the parser will reject — a bad answer is not an outage', async () => {
    // THE OTHER HALF OF THE PAIR. Gemini answered; the answer is rubbish; the
    // parse fails downstream. Paying a second engine to disagree is not a
    // fallback, and the run must attribute the failure to the engine that
    // produced it.
    const { calls, impl } = spy({
      candidates: [
        {
          content: { parts: [{ text: 'not json at all' }] },
          finishReason: 'STOP',
        },
      ],
      usageMetadata: { promptTokenCount: 100, candidatesTokenCount: 5 },
    })
    const answer = await askModel({ ...ask(), fetchImpl: impl })

    expect(calls).toHaveLength(1)
    expect(calls[0]!.url).toContain('generativelanguage.googleapis.com')
    expect(answer.text).toBe('not json at all')
    expect(answer.model).toBe(EXTRACTION_MODEL)
    expect(answer.fellBackFrom).toBeUndefined()
  })

  it('on a truncated answer — the engine answered, at length', async () => {
    const { calls, impl } = failingThenOk(
      new Response(
        JSON.stringify({
          candidates: [
            {
              content: { parts: [{ text: '{"a"' }] },
              finishReason: 'MAX_TOKENS',
            },
          ],
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
    )
    await expect(askModel({ ...ask(), fetchImpl: impl })).rejects.toMatchObject(
      { reason: 'truncated' },
    )
    expect(calls).toHaveLength(1)
  })

  it('on a 404 — a wrong model name is configuration, not an outage', async () => {
    // Falling back here would hide a broken deployment behind a working system
    // and a larger bill.
    const { calls, impl } = failingThenOk(
      new Response('no such model', { status: 404 }),
    )
    await expect(askModel({ ...ask(), fetchImpl: impl })).rejects.toMatchObject(
      { reason: 'http_error', status: 404 },
    )
    expect(calls).toHaveLength(1)
  })

  it('and NEVER for an explicitly named model, so a measurement stays honest', async () => {
    // The engine table names one model per column. A silent swap there would
    // make a column secretly Sonnet — a measurement reporting the wrong engine
    // is worse than one that stops.
    const { calls, impl } = failingThenOk(quota())
    await expect(
      askModel({ ...ask(), model: 'gemini-3.5-flash-lite', fetchImpl: impl }),
    ).rejects.toMatchObject({ status: 429 })
    expect(calls).toHaveLength(1)
  })
})

describe('what counts as an outage', () => {
  it('sorts the reasons without needing a network', () => {
    expect(isOutage(new TypeError('socket hang up'))).toBe(true)
    expect(isOutage(new ClaudeError('http_error', '429', 429))).toBe(true)
    expect(isOutage(new ClaudeError('http_error', '500', 500))).toBe(true)
    expect(isOutage(new ClaudeError('http_error', '404', 404))).toBe(false)
    expect(isOutage(new ClaudeError('truncated', 'too long'))).toBe(false)
    expect(isOutage(new ClaudeError('refused', 'blocked'))).toBe(false)
    expect(isOutage(new ClaudeError('no_api_key', 'unset'))).toBe(false)
  })
})

describe('a pasted booking is text, not a file', () => {
  it('sends the words as a text part on Gemini', async () => {
    // Phase 6 §1.2: a pasted prompt is a document, so it rides the same mint
    // and the same extraction. But base64ing language into an inlineData blob
    // asks a reader to open a file that is already words.
    const { calls, impl } = spy()
    await askGemini({
      ...ask({
        mimeType: 'text/plain',
        base64: btoa('Amazon load 48291, Chicago IL to Gary IN'),
      }),
      fetchImpl: impl,
    })
    const body = JSON.parse(String(calls[0]!.init.body))
    const parts = body.contents[0].parts
    expect(
      parts.some((part: { inlineData?: unknown }) => part.inlineData),
    ).toBe(false)
    expect(parts[1].text).toBe('Amazon load 48291, Chicago IL to Gary IN')
  })

  it('and on Anthropic, so one contract covers a PDF and a paste', async () => {
    const { calls, impl } = spy({
      content: [{ type: 'text', text: '{"ok":true}' }],
      usage: { input_tokens: 10, output_tokens: 10 },
      model: 'claude-sonnet-5',
      stop_reason: 'end_turn',
    })
    await askModel({
      ...ask({ mimeType: 'text/plain', base64: btoa('pasted words') }),
      model: 'claude-sonnet-5',
      fetchImpl: impl,
    })
    const body = JSON.parse(String(calls[0]!.init.body))
    const parts = body.messages[0].content
    expect(
      parts.some((part: { type: string }) => part.type === 'document'),
    ).toBe(false)
    expect(parts[0]).toEqual({ type: 'text', text: 'pasted words' })
  })

  it('and a type neither engine reads is still refused', async () => {
    const { calls, impl } = spy()
    await expect(
      askGemini({ ...ask({ mimeType: 'text/csv' }), fetchImpl: impl }),
    ).rejects.toMatchObject({ reason: 'unsupported_media_type' })
    expect(calls).toHaveLength(0)
  })
})
