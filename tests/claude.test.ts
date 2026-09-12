import { describe, expect, it } from 'vitest'
import {
  ClaudeError,
  MODEL_PRICES,
  EXTRACTION_MODEL,
  MAX_DOCUMENT_BASE64_BYTES,
  MAX_OUTPUT_TOKENS,
  askAboutDocument,
  configuredProvider,
  costCents,
  costMilliCents,
  defaultModelFor,
  formatCostMilliCents,
  pricesFor,
  providerOf,
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
    //
    // ── THE DEFAULT IS THE PROVIDER'S MODEL, NOT `EXTRACTION_MODEL` ───────
    //
    // CHANGED 2026-09-12 with the provider seam, and the old expectation was
    // asserting a bug. `EXTRACTION_MODEL` has named a GEMINI model since the
    // engine table, and this transport talks to Anthropic-compatible hosts —
    // so a default-model call from here put `gemini-3.6-flash` in a body sent
    // to api.anthropic.com, which is a 404 with a confusing message.
    //
    // `model-engine.ts` already carries a note about the same mistake at the
    // routing layer ("Every default extraction 404'd") and fixed it there; the
    // transport's own default was left pointing at Gemini, reachable by anyone
    // calling `askAboutDocument` directly. `defaultModelFor` resolves it
    // through the configured provider instead, which is a model this host can
    // actually answer for.
    const { calls, impl } = spy()
    await askAboutDocument({ ...ask(), fetchImpl: impl })

    const body = JSON.parse(String(calls[0]!.init.body))
    expect(body.model).toBe(defaultModelFor('application/pdf'))
    expect(body.model).not.toBe(EXTRACTION_MODEL)
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
    // Cache counts ride along at zero when nothing was cached — they are part
    // of what a call cost and are read whether or not caching was asked for.
    expect(answer.usage).toEqual({
      inputTokens: 4_210,
      outputTokens: 880,
      cacheWriteTokens: 0,
      cacheReadTokens: 0,
    })
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
    //
    // NAMED, not defaulted. These worked examples used to lean on
    // EXTRACTION_MODEL and broke the day the default became Gemini — correctly,
    // because the arithmetic had silently changed. A worked example states its
    // rate.
    const usage = { inputTokens: 4_210, outputTokens: 880 }
    expect(costCents(usage, 'claude-sonnet-5')).toBe(3)
    // Thousandths, because whole cents cannot tell 2.583 from 3.
    expect(costMilliCents(usage, 'claude-sonnet-5')).toBe(2_583)
    expect(formatCostMilliCents(costMilliCents(usage, 'claude-sonnet-5'))).toBe(
      '2.583¢',
    )
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
    expect(costCents(usage, 'claude-sonnet-5')).toBe(1)
    expect(costMilliCents(usage, 'claude-sonnet-5')).toBe(1_050)
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

describe('prompt caching and the price of a model', () => {
  it('marks the instructions cacheable and NEVER the document', () => {
    // The document is different every time and is most of the input; the
    // system block and the schema are the same bytes on every call. Caching
    // the wrong one costs 1.25x for nothing.
    const { impl, calls } = spy()
    return askAboutDocument({ ...ask(), cache: true, fetchImpl: impl }).then(
      () => {
        const body = JSON.parse(String(calls[0]!.init.body))
        expect(body.system[0].cache_control).toEqual({ type: 'ephemeral' })
        const parts = body.messages[0].content
        const document = parts.find(
          (part: { type: string }) =>
            part.type === 'document' || part.type === 'image',
        )
        expect(document.cache_control).toBeUndefined()
        // AND THE USER TEXT BLOCK IS NOT A BREAKPOINT EITHER. A marker caches
        // everything up to and including its block, and this one FOLLOWS the
        // document — the first version marked it and wrote every unique PDF
        // into the cache. 115,582 tokens written against 21,660 read is what
        // that looks like from the outside.
        expect(
          parts.find((part: { type: string }) => part.type === 'text')
            .cache_control,
        ).toBeUndefined()
      },
    )
  })

  it('sends no cache_control at all when caching is off', () => {
    const { impl, calls } = spy()
    return askAboutDocument({ ...ask(), fetchImpl: impl }).then(() => {
      const body = String(calls[0]!.init.body)
      expect(body).not.toContain('cache_control')
    })
  })

  it('prices a cache read at a tenth and a write at five quarters', () => {
    // Anthropic's published multiples, computed from the input rate rather
    // than typed, so the two cannot drift apart.
    const read = costMilliCents(
      { inputTokens: 0, outputTokens: 0, cacheReadTokens: 1_000_000 },
      'claude-sonnet-5',
    )
    const write = costMilliCents(
      { inputTokens: 0, outputTokens: 0, cacheWriteTokens: 1_000_000 },
      'claude-sonnet-5',
    )
    const plain = costMilliCents(
      { inputTokens: 1_000_000, outputTokens: 0 },
      'claude-sonnet-5',
    )
    expect(plain).toBe(300_000)
    expect(read).toBe(30_000)
    expect(write).toBe(375_000)
  })

  it('prices Haiku at its own rate, not Sonnet’s', () => {
    expect(
      costMilliCents(
        { inputTokens: 1_000_000, outputTokens: 1_000_000 },
        'claude-haiku-4-5-20251001',
      ),
    ).toBe(600_000)
  })

  it('and an UNPRICED model falls back to the dearest, never to free', () => {
    // A cost that is wrong is worse than one that is missing, and a zero would
    // report an unpriced model as free — which is the number somebody would
    // then make a decision on.
    expect(
      costMilliCents({ inputTokens: 1_000_000, outputTokens: 0 }, 'claude-x'),
    ).toBe(300_000)
  })
})

describe('the shipped default', () => {
  it('is Gemini 3.6 Flash, and a document costs what its rate says', () => {
    // The owner's ruling from the engine table. Asserted here because the
    // constant is the whole of the switch: one word moves the pipeline, and a
    // silent revert would otherwise be caught only by a cost line nobody read.
    expect(EXTRACTION_MODEL).toBe('gemini-3.6-flash')

    //   4210 input  x 150 =   631,500
    //   1270 output x 750 =   952,500
    //                        ---------
    //                        1,584,000 millionths -> 1.584¢
    expect(costMilliCents({ inputTokens: 4_210, outputTokens: 1_270 })).toBe(
      1_584,
    )
  })

  it('and Sonnet stays priced, because it stays the fallback', () => {
    expect(MODEL_PRICES['claude-sonnet-5']).toEqual({
      input: 300,
      output: 1_500,
    })
  })
})

// ---------------------------------------------------------------------------
// TWO HOSTS, ONE TRANSPORT (owner's ruling, 2026-09-12).
//
// The switch is a base URL, a key and a model name. What these guard is that
// it is ONLY those three: a document, a system block, a cache breakpoint and
// the answer's `usage` must come out identical, because the acceptance run
// attributes any difference in the numbers to the ENGINES. Two adapters that
// drifted would make that attribution false without making it look false.
// ---------------------------------------------------------------------------

describe('the provider seam', () => {
  it('sends a DeepSeek model to DeepSeek and everything else to Anthropic', () => {
    expect(providerOf('deepseek-v4-flash-vision-exp')).toBe('DEEPSEEK')
    expect(providerOf('deepseek-v4-pro')).toBe('DEEPSEEK')
    expect(providerOf('claude-sonnet-5')).toBe('ANTHROPIC')
  })

  // ── AN UNKNOWN NAME REFUSES, NAMING ITSELF (owner's ruling, 2026-09-12) ─
  //
  // THIS TEST ASSERTED THE OPPOSITE UNTIL TODAY. It expected an unrecognised
  // model to resolve to ANTHROPIC, on the argument that a 404 from a real host
  // beats a silent send to the wrong one. The ruling is that neither is
  // acceptable — and writing the old behaviour down is what showed why: a typo
  // in a DeepSeek model name was a real request BILLED TO ANTHROPIC for a
  // model nobody chose, answered by a 404 that named the wrong company.
  it('refuses an unknown model rather than falling back to Anthropic', () => {
    expect(() => providerOf('something-nobody-added')).toThrowError(ClaudeError)
    // NAMES THE VALUE. A refusal that says "unknown model" without saying
    // which one sends somebody to grep a config they cannot see from the log.
    expect(() => providerOf('depseek-v4-pro')).toThrowError(/"depseek-v4-pro"/)
    try {
      providerOf('depseek-v4-pro')
    } catch (error) {
      expect((error as ClaudeError).reason).toBe('unknown_model')
      // And says what WOULD have been accepted.
      expect((error as ClaudeError).message).toContain('deepseek-v4-pro')
    }
  })

  it('posts to the host the model belongs to, with that host’s key name', async () => {
    const deep = spy()
    await askAboutDocument({
      ...ask(),
      model: 'deepseek-v4-flash-vision-exp',
      fetchImpl: deep.impl,
    })
    expect(deep.calls[0]!.url).toBe(
      'https://api.deepseek.com/anthropic/v1/messages',
    )

    const anthropic = spy()
    await askAboutDocument({
      ...ask(),
      model: 'claude-sonnet-5',
      fetchImpl: anthropic.impl,
    })
    expect(anthropic.calls[0]!.url).toBe(
      'https://api.anthropic.com/v1/messages',
    )
  })

  it('names the variable the CONFIGURED provider needs when the key is missing', async () => {
    // A worker set to DeepSeek that says "ANTHROPIC_API_KEY is not set" sends
    // somebody to check the wrong secret — the failure this message exists to
    // prevent, and the reason it is built from the resolved provider.
    await expect(
      askAboutDocument({
        ...ask(),
        model: 'deepseek-v4-pro',
        apiKey: undefined,
      }),
    ).rejects.toMatchObject({
      reason: 'no_api_key',
      message: 'DEEPSEEK_API_KEY is not set on this worker.',
    })
  })

  it('sends the same body to both hosts, document block and all', async () => {
    const bodies = []
    for (const model of ['claude-sonnet-5', 'deepseek-v4-flash-vision-exp']) {
      const { calls, impl } = spy()
      await askAboutDocument({ ...ask(), model, cache: true, fetchImpl: impl })
      const body = JSON.parse(String(calls[0]!.init.body))
      // The model is the ONE field allowed to differ.
      delete body.model
      bodies.push(JSON.stringify(body))
      // And the headers, which are the compatibility claim itself.
      const headers = calls[0]!.init.headers as Record<string, string>
      expect(headers['anthropic-version']).toBe('2023-06-01')
      expect(headers['x-api-key']).toBe('test-key')
    }
    expect(bodies[0]).toBe(bodies[1])
  })

  it('reads the provider from config, and refuses to guess at a typo', () => {
    expect(configuredProvider(null, {})).toBe('ANTHROPIC')
    expect(configuredProvider(null, { LLM_PROVIDER: 'DEEPSEEK' })).toBe(
      'DEEPSEEK',
    )
    expect(configuredProvider(null, { LLM_PROVIDER: ' deepseek ' })).toBe(
      'DEEPSEEK',
    )
  })

  // ── A MISSPELLED PROVIDER REFUSES TOO ──────────────────────────────────
  //
  // Also the reverse of what this file asserted this morning. `console.warn`
  // on a Worker reaches a tail nobody is watching, so "warn and carry on as
  // ANTHROPIC" was a silent fallback with a log line attached.
  it('refuses a misspelled provider, and says what it was set to', () => {
    expect(() =>
      configuredProvider(null, { LLM_PROVIDER: 'DEEPSEK' }),
    ).toThrowError(/"DEEPSEK"/)
    try {
      configuredProvider(null, { LLM_PROVIDER: 'anthropc' })
    } catch (error) {
      expect((error as ClaudeError).reason).toBe('unknown_provider')
    }
  })

  // UNSET IS NOT MISSPELLED, and the difference is the whole reason this is
  // two cases. An absent variable is a deployment that has not been told —
  // which every environment was before the field existed. A wrong one is a
  // deployment that has been told something nobody can act on.
  it('still accepts an unset variable, which is not the same as a wrong one', () => {
    expect(configuredProvider(null, {})).toBe('ANTHROPIC')
    expect(configuredProvider(null, { LLM_PROVIDER: '' })).toBe('ANTHROPIC')
    expect(configuredProvider(null, { LLM_PROVIDER: '   ' })).toBe('ANTHROPIC')
  })

  // ── PER DOCUMENT TYPE, WITH `LLM_PROVIDER` AS THE FLOOR ────────────────
  //
  // The evidence arrived per type and pointed opposite ways: on licences the
  // engines tied 19/19 for half the money, on a medical card the cheaper one
  // was wrong three times in five. A global switch would force one answer to
  // two questions.
  it('lets one document type differ from the rest', () => {
    const env = { LLM_PROVIDER: 'ANTHROPIC', LLM_PROVIDER_CDL: 'DEEPSEEK' }
    expect(configuredProvider('cdl', env)).toBe('DEEPSEEK')
    expect(configuredProvider('medical', env)).toBe('ANTHROPIC')
    expect(configuredProvider('rate_confirmation', env)).toBe('ANTHROPIC')
    // And the floor still answers when nothing names a type.
    expect(configuredProvider(null, env)).toBe('ANTHROPIC')
  })

  it('falls through to the floor for a type nobody named', () => {
    // AN ENVIRONMENT THAT NAMES NONE BEHAVES AS IT DID BEFORE THE RULING,
    // which is what makes this safe to ship without touching every worker.
    const env = { LLM_PROVIDER: 'DEEPSEEK' }
    for (const kind of [
      'cdl',
      'medical',
      'coi',
      'rate_confirmation',
      'classify',
    ] as const) {
      expect(configuredProvider(kind, env), kind).toBe('DEEPSEEK')
    }
  })

  it('refuses a misspelled per-type value, naming THAT variable', () => {
    // The message must name `LLM_PROVIDER_MEDICAL`, not `LLM_PROVIDER` — a
    // refusal pointing at the wrong variable is a refusal somebody debugs by
    // editing a setting that was already correct.
    expect(() =>
      configuredProvider('medical', {
        LLM_PROVIDER: 'ANTHROPIC',
        LLM_PROVIDER_MEDICAL: 'DEEPSEKE',
      }),
    ).toThrowError(/LLM_PROVIDER_MEDICAL is "DEEPSEKE"/)
  })

  it('routes the model the same way, per type', () => {
    const env = { LLM_PROVIDER: 'ANTHROPIC', LLM_PROVIDER_MEDICAL: 'DEEPSEEK' }
    expect(defaultModelFor('image/jpeg', 'medical', env)).toBe(
      'deepseek-v4-flash-vision-exp',
    )
    expect(defaultModelFor('image/jpeg', 'cdl', env)).toBe('claude-sonnet-5')
  })

  it('sends a PDF to the vision model and a paste to the text one', () => {
    const env = { LLM_PROVIDER: 'DEEPSEEK' }
    // A PDF IS A PAGE, NOT TEXT. On DeepSeek the text model cannot see one.
    expect(defaultModelFor('application/pdf', null, env)).toBe(
      'deepseek-v4-flash-vision-exp',
    )
    expect(defaultModelFor('image/jpeg', null, env)).toBe(
      'deepseek-v4-flash-vision-exp',
    )
    expect(defaultModelFor('text/plain', null, env)).toBe('deepseek-v4-pro')
  })
})

describe('what DeepSeek costs, at the rates the owner supplied', () => {
  // Peak rates, 2026-09-12. OFF-PEAK IS HALF OF EVERY ONE OF THEM, so each
  // figure here is an upper bound and is recorded as one.
  it('prices the vision model at its own rate, not the dearest on file', () => {
    //   2019 input x  44 =  88,836
    //     97 output x 132 =  12,804
    //                       -------
    //                       101,640 millionths -> 0.102¢
    expect(
      costMilliCents(
        { inputTokens: 2_019, outputTokens: 97 },
        'deepseek-v4-flash-vision-exp',
      ),
    ).toBe(102)
  })

  it('does not derive a DeepSeek cache rate from Anthropic’s multiple', () => {
    const flash = pricesFor('deepseek-v4-flash-vision-exp')
    // A cache HIT is 3.2% of input, not 10% — deriving it would overstate by 3x.
    expect(flash.cacheRead).toBe(1.4)
    expect(flash.cacheRead).not.toBe(flash.input * 0.1)
    // And an automatic cache has NO write premium.
    expect(flash.cacheWrite).toBe(44)
    expect(flash.cacheWrite).not.toBe(flash.input * 1.25)
  })

  it('leaves the derived rates alone for every row that does not say', () => {
    const sonnet = pricesFor('claude-sonnet-5')
    expect(sonnet.cacheWrite).toBe(375)
    expect(sonnet.cacheRead).toBe(30)
  })
})
