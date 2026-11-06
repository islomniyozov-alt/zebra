import { readFileSync } from 'node:fs'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { parseWranglerConfig } from '../scripts/hyperdrive-config.mjs'
import {
  EXTRACTION_MODEL,
  explicitProviderFor,
  providerOf,
  type ReadKind,
} from '@/lib/claude'
import { isGeminiModel } from '@/lib/gemini'
import {
  FALLBACK_PROVIDER_VAR,
  askModel,
  defaultModelOf,
  fallbackModelFor,
  fallbackProviderFor,
} from '@/lib/model-engine'

// ---------------------------------------------------------------------------
// WHO READS, AND WHO IS THE FALLBACK — ON THE TWO REAL WORKERS.
//
// Owner's ruling, 2026-11-05 (EXTRACTION-CONTRACT.md, "Which provider
// answers"; GAPS 40). The Anthropic console key was disabled on 2026-11-02.
// Readers stay on Gemini; the fallback is DeepSeek; nothing resolves to
// Anthropic on either worker.
//
// THE INSTRUMENT IS BUILT FROM THE ARTEFACT: each worker's `vars` as
// `wrangler.jsonc` declares them, production's from its OWN block because
// `vars` do not inherit into a named environment, resolved through the SAME
// functions `askModel` resolves with. The code's floor for an unset variable
// is still ANTHROPIC (owner's ruling 2026-09-12) — this is what says the two
// deployed workers may not sit on the floor.
// ---------------------------------------------------------------------------

type Vars = Record<string, string | undefined>

const config = parseWranglerConfig(readFileSync('wrangler.jsonc', 'utf8'))

/** Each worker's own `vars`. Production never falls back to the top level. */
const WORKERS: [name: string, vars: Vars][] = [
  ['dev', config.vars ?? {}],
  ['production', config.env?.production?.vars ?? {}],
]

const KINDS: (ReadKind | null)[] = [
  null,
  'cdl',
  'medical',
  'coi',
  'rate_confirmation',
  'classify',
]
const MEDIA = ['image/jpeg', 'application/pdf', 'text/plain']

describe.each(WORKERS)('the %s worker', (name, vars) => {
  it.each(KINDS)(
    'reads kind %s on Gemini first, for every media type',
    (kind) => {
      // The primary is `EXTRACTION_MODEL` only while no provider is EXPLICITLY
      // named for the kind or the floor — `LLM_PROVIDER=DEEPSEEK` here would
      // have moved every read, which is why the fallback has its own variable.
      expect(
        explicitProviderFor(kind, vars),
        `${name}: ${kind ?? 'floor'}`,
      ).toBeNull()
      for (const mime of MEDIA) {
        const model = defaultModelOf(mime, kind, vars)
        expect(model, `${name}: ${kind ?? 'floor'} ${mime}`).toBe(
          EXTRACTION_MODEL,
        )
        expect(isGeminiModel(model)).toBe(true)
      }
    },
  )

  it.each(KINDS)('never falls back to Anthropic for kind %s', (kind) => {
    expect(
      fallbackProviderFor(kind, vars),
      `${name}: fallback provider for ${kind ?? 'the floor'}`,
    ).not.toBe('ANTHROPIC')
    for (const mime of MEDIA) {
      expect(
        providerOf(fallbackModelFor(mime, kind, vars)),
        `${name}: fallback model for ${kind ?? 'the floor'} ${mime}`,
      ).not.toBe('ANTHROPIC')
    }
  })

  it('names the fallback in its own vars block', () => {
    // Not inherited, not implied: the line is in this worker's block.
    expect(vars[FALLBACK_PROVIDER_VAR], `${name}`).toBe('DEEPSEEK')
  })
})

describe('the variable itself', () => {
  it('absent means the configured provider, exactly as before it existed', () => {
    expect(fallbackProviderFor(null, {})).toBe('ANTHROPIC')
    expect(fallbackProviderFor('cdl', { LLM_PROVIDER_CDL: 'DEEPSEEK' })).toBe(
      'DEEPSEEK',
    )
    expect(fallbackProviderFor('coi', { LLM_PROVIDER_CDL: 'DEEPSEEK' })).toBe(
      'ANTHROPIC',
    )
  })

  it('names the fallback without touching the primary', () => {
    const vars = { LLM_FALLBACK_PROVIDER: 'DEEPSEEK' }
    expect(fallbackProviderFor('rate_confirmation', vars)).toBe('DEEPSEEK')
    expect(explicitProviderFor('rate_confirmation', vars)).toBeNull()
    expect(defaultModelOf('application/pdf', 'rate_confirmation', vars)).toBe(
      EXTRACTION_MODEL,
    )
  })

  it('sends a paste to the text model and a page to the vision model', () => {
    const vars = { LLM_FALLBACK_PROVIDER: 'deepseek' }
    expect(fallbackModelFor('text/plain', null, vars)).toBe('deepseek-v4-pro')
    expect(fallbackModelFor('image/jpeg', null, vars)).toBe(
      'deepseek-v4-flash-vision-exp',
    )
  })

  it('refuses a misspelling, naming THIS variable', () => {
    expect(() =>
      fallbackProviderFor(null, { LLM_FALLBACK_PROVIDER: 'DEEPSEAK' }),
    ).toThrow(/LLM_FALLBACK_PROVIDER is "DEEPSEAK", which is not a provider/)
  })
})

// ---------------------------------------------------------------------------
// THE FALLBACK FIRES, WITH THE OUTAGE FORCED IN THE HARNESS — never by taking
// Gemini down on a worker. Every call below is a fake fetch.
// ---------------------------------------------------------------------------

const QUOTA = () =>
  new Response(
    JSON.stringify({ error: { code: 429, message: 'quota exceeded' } }),
    { status: 429, headers: { 'content-type': 'application/json' } },
  )

/** Gemini answers 429; whatever is asked next answers in DeepSeek's shape. */
function geminiDown(model = 'deepseek-v4-flash-vision-exp') {
  const calls: { url: string; init: RequestInit }[] = []
  const impl = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} })
    if (String(url).includes('generativelanguage.googleapis.com'))
      return QUOTA()
    return new Response(
      JSON.stringify({
        content: [{ type: 'text', text: '{"ok":"from deepseek"}' }],
        usage: { input_tokens: 100, output_tokens: 50 },
        model,
        stop_reason: 'end_turn',
      }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    )
  }) as unknown as typeof fetch
  return { calls, impl }
}

const read = (over: Record<string, unknown> = {}) => ({
  base64: '/9j/4AAQSkZJRg==',
  mimeType: 'image/jpeg',
  system: 'system',
  prompt: 'prompt',
  ...over,
})

/** The two deployed workers' situation: fallback named, keys present. */
function deployed(over: Record<string, string> = {}) {
  vi.stubEnv('LLM_FALLBACK_PROVIDER', 'DEEPSEEK')
  vi.stubEnv('GEMINI_API_KEY', 'g-key')
  vi.stubEnv('DEEPSEEK_API_KEY', 'ds-key')
  // Gone from both workers once GAPS 40 closes. Empty here so a path that
  // still wanted it fails by name rather than finding the developer's.
  vi.stubEnv('ANTHROPIC_API_KEY', '')
  for (const [name, value] of Object.entries(over)) vi.stubEnv(name, value)
}

afterEach(() => vi.unstubAllEnvs())

describe('a Gemini outage, on a worker configured like the real two', () => {
  it('lands a licence on DeepSeek, with DeepSeek’s key, and records the swap', async () => {
    deployed()
    const { calls, impl } = geminiDown()
    const answer = await askModel({ ...read(), kind: 'cdl', fetchImpl: impl })

    expect(calls).toHaveLength(2)
    expect(calls[0]!.url).toContain('generativelanguage.googleapis.com')
    expect(calls[1]!.url).toContain('api.deepseek.com')
    const headers = calls[1]!.init.headers as Record<string, string>
    expect(headers['x-api-key']).toBe('ds-key')
    expect(JSON.parse(String(calls[1]!.init.body)).model).toBe(
      'deepseek-v4-flash-vision-exp',
    )
    expect(answer.model).toBe('deepseek-v4-flash-vision-exp')
    expect(answer.text).toBe('{"ok":"from deepseek"}')
    expect(answer.fellBackFrom).toEqual({
      model: EXTRACTION_MODEL,
      reason: 'http_error',
      status: 429,
    })
  })

  it('lands a pasted booking on DeepSeek’s text model', async () => {
    deployed()
    const { calls, impl } = geminiDown('deepseek-v4-pro')
    const answer = await askModel({
      ...read({ mimeType: 'text/plain', base64: btoa('Pickup Monday') }),
      kind: 'rate_confirmation',
      fetchImpl: impl,
    })
    expect(calls[1]!.url).toContain('api.deepseek.com')
    expect(answer.model).toBe('deepseek-v4-pro')
  })

  it('reports a PDF as THE OUTAGE, sends nothing to DeepSeek, and says why', async () => {
    // `readsPdf` is false on DeepSeek and stays: 13 rate confirmations at 0.0%
    // by answering. The dispatcher must hear "try again", not "this file".
    deployed()
    const { calls, impl } = geminiDown()
    const attempt = askModel({
      ...read({ mimeType: 'application/pdf', base64: 'JVBERi0xLjQK' }),
      kind: 'rate_confirmation',
      fetchImpl: impl,
    })
    await expect(attempt).rejects.toMatchObject({
      reason: 'http_error',
      status: 429,
    })
    await expect(attempt).rejects.toThrow(
      /gemini-3\.6-flash could not answer .*429.*, and the fallback deepseek-v4-flash-vision-exp does not read PDFs, so nothing was sent to it/,
    )
    expect(calls).toHaveLength(1)
    expect(calls[0]!.url).toContain('generativelanguage.googleapis.com')
  })

  it('names DEEPSEEK_API_KEY, not Anthropic’s, when the fallback key is missing', async () => {
    // Production between the deploy and Islom's `wrangler secret put`.
    deployed()
    vi.stubEnv('DEEPSEEK_API_KEY', '')
    const { calls, impl } = geminiDown()
    await expect(
      askModel({ ...read(), kind: 'cdl', fetchImpl: impl }),
    ).rejects.toMatchObject({ reason: 'no_api_key' })
    await expect(
      askModel({ ...read(), kind: 'cdl', fetchImpl: impl }),
    ).rejects.toThrow(/DEEPSEEK_API_KEY is not set on this worker/)
    // Gemini was asked each time; nothing else was.
    expect(calls.every((c) => c.url.includes('googleapis.com'))).toBe(true)
  })

  it('never reaches Anthropic, even with the floor unset', async () => {
    deployed()
    const { calls, impl } = geminiDown()
    for (const kind of KINDS) {
      await askModel({ ...read(), ...(kind ? { kind } : {}), fetchImpl: impl })
    }
    expect(calls.some((c) => c.url.includes('api.anthropic.com'))).toBe(false)
    expect(
      calls.filter((c) => c.url.includes('api.deepseek.com')),
    ).toHaveLength(KINDS.length)
  })
})
