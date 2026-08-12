// ---------------------------------------------------------------------------
// THE CLAUDE API, FROM THE WORKER (Phase 5 §1.2).
//
// One module, `fetch` only — no SDK. The Anthropic SDK pulls in Node streams
// and its own retry machinery, and this runs on workerd where the first is
// absent and the second is a second story about what a timeout means. The
// Messages API over `fetch` is a POST with a JSON body; that is the whole
// surface this phase needs.
//
// THE MODEL IS A NAMED CONSTANT, per §1.2: "model string a named constant, not
// scattered". One place to change it, one place to read it in a cost report.
//
// THE TOKEN CAP IS ENFORCED BEFORE THE CALL, not after. A cap that only limits
// the RESPONSE still lets a 90-page scanned PDF cost real money on its way in,
// and the acceptance box asks for "the token cap proven by a document that
// exceeds it failing cleanly" — which means refusing to send it, not truncating
// it into a wrong answer.
// ---------------------------------------------------------------------------

/**
 * §1.2. Changed here or nowhere.
 *
 * GEMINI 3.6 FLASH SINCE THE ENGINE TABLE (owner's ruling, 2026-08-11): 94.5%
 * on the invoice-making fields against Sonnet's 96.6%, no refusals across the
 * corpus, and roughly a quarter of the cost. Sonnet stays allowlisted as the
 * fallback — one word in this constant moves the whole pipeline back, and the
 * adapter seam means nothing else changes when it does.
 */
export const EXTRACTION_MODEL = 'gemini-3.6-flash'

/** What the response may cost. Generous for a rate confirmation; finite. */
// 8k, RAISED FROM 4k after the golden-set runs.
//
// A three-stop confirmation with a long instructions block and a 128-character
// commodity string does not fit in 4,096 output tokens. When it did not, the
// answer came back TRUNCATED — valid JSON up to the cut, garbage after it — and
// the strict parser reported `not_json`, which sent a session hunting for
// prose the model had never written. Two of thirteen documents refused on one
// run and a different one on the next, intermittently, because output length
// varies with the page.
//
// Costs nothing unless used: output tokens are billed as generated.
export const MAX_OUTPUT_TOKENS = 8_192

/**
 * The biggest document worth sending, in bytes of base64.
 *
 * A rate confirmation is one or two pages. Ten megabytes of base64 is roughly
 * 7.5MB of PDF — a scan at 600dpi, or somebody's whole load file. Neither is a
 * rate confirmation, and sending one buys a slow, expensive, wrong answer.
 *
 * Deliberately below `MAX_UPLOAD_BYTES` (25MB) in documents.ts: the pipeline
 * will store a bigger file happily, and extraction is the thing that declines.
 */
export const MAX_DOCUMENT_BASE64_BYTES = 10 * 1024 * 1024

/**
 * Published prices for the extraction model, in cents per million tokens.
 *
 * Kept here so the walkthrough can print a real number rather than "a few
 * cents" (§5). It is a CONSTANT COPIED FROM A PRICE LIST — if Anthropic moves
 * its prices this figure is stale, and stale is why it says so out loud in the
 * report rather than being buried in a total.
 */
export const PRICE_CENTS_PER_MTOK = { input: 300, output: 1_500 } as const

/**
 * Cents per million tokens, per model, recorded on 2026-08-11.
 *
 * A COPIED CONSTANT AND IT WILL GO STALE — `PHASE-5-BRIEF.md` §7 flag 3 says
 * so, and adding models multiplies the ways it can. Nothing checks it against
 * a published price list and nothing can without a network call on every run,
 * so every figure computed from it is printed as what it is: arithmetic from a
 * constant recorded on a date, never a reading of a bill.
 *
 * Cache pricing is Anthropic's published multiple of the input rate — a write
 * costs 1.25x and a read 0.1x — computed here rather than typed, so the two
 * cannot drift apart.
 */
export const MODEL_PRICES = {
  'claude-sonnet-5': { input: 300, output: 1_500 },
  'claude-haiku-4-5-20251001': { input: 100, output: 500 },
  // Google, same units. LIST RATES, supplied by the owner on 2026-08-11 and
  // replacing the assumed ones the engine table was first computed with.
  //
  // The assumption was wrong by 5x on input and 3x on output, so the table's
  // Gemini cost column understated by roughly 3.7x — Flash at 0.407¢ per
  // document was really 1.496¢. It changed the ratio and not the ruling, and
  // it is the reason the run prints MEASURED TOKENS beside every cost line:
  // a cost is arithmetic over a constant somebody typed, and the tokens are
  // the only part of it that was observed.
  'gemini-3.6-flash': { input: 150, output: 750 },
  'gemini-3.5-flash-lite': { input: 30, output: 250 },
} as const

export type PricedModel = keyof typeof MODEL_PRICES

/** The models this system will send a document to. Nothing else is accepted. */
export const ALLOWED_MODELS = Object.keys(MODEL_PRICES) as PricedModel[]

export function isPricedModel(value: string): value is PricedModel {
  return Object.hasOwn(MODEL_PRICES, value)
}

export interface Usage {
  inputTokens: number
  outputTokens: number
  /** Tokens written INTO the cache, billed at 1.25x input. */
  cacheWriteTokens?: number
  /** Tokens read FROM the cache, billed at 0.1x input. */
  cacheReadTokens?: number
}

/**
 * Cents per million tokens for one model, cache rates included.
 *
 * Falls back to the Sonnet price for a model nobody has priced: a cost that is
 * WRONG is worse than a cost that is missing, so the fallback is the most
 * expensive one on file rather than zero. A zero would quietly report that an
 * unpriced model is free.
 */
export function pricesFor(model: string): {
  input: number
  output: number
  cacheWrite: number
  cacheRead: number
} {
  // THE DEAREST ON FILE, computed rather than named. When there were two rows
  // this pointed at Sonnet by hand; with five it has to be derived, or adding
  // a cheap model would quietly make the fallback cheap and an unpriced model
  // would be reported as costing less than it does.
  const dearest = Object.values(MODEL_PRICES).reduce((worst, price) =>
    price.input + price.output > worst.input + worst.output ? price : worst,
  )
  const base = isPricedModel(model) ? MODEL_PRICES[model] : dearest
  return {
    input: base.input,
    output: base.output,
    cacheWrite: base.input * 1.25,
    cacheRead: base.input * 0.1,
  }
}

/** What one call cost, in integer cents, rounded half up (rule 9-money). */
export function costCents(usage: Usage, model = EXTRACTION_MODEL): number {
  return Math.round(costMilliCents(usage, model) / 1_000)
}

/**
 * The same cost in THOUSANDTHS of a cent.
 *
 * Because whole cents cannot tell 0.6¢ from 1.4¢, and those are different
 * claims about a thousand loads a month — which is exactly the number §5 asks
 * to be a measured fact rather than a hope. A rate confirmation lands around
 * 2,500 of these, i.e. two and a half cents.
 */
export function costMilliCents(usage: Usage, model = EXTRACTION_MODEL): number {
  const price = pricesFor(model)
  return Math.round(
    (usage.inputTokens * price.input +
      usage.outputTokens * price.output +
      (usage.cacheWriteTokens ?? 0) * price.cacheWrite +
      (usage.cacheReadTokens ?? 0) * price.cacheRead) /
      1_000,
  )
}

/** "2.583¢" — the figure a walkthrough prints. */
export function formatCostMilliCents(milliCents: number): string {
  return `${(milliCents / 1_000).toFixed(3)}¢`
}

export type ClaudeFailure =
  | 'no_api_key'
  | 'document_too_large'
  | 'unsupported_media_type'
  | 'refused'
  | 'http_error'
  | 'no_text'
  /** The answer hit `max_tokens` and stops mid-value. Named, not guessed at. */
  | 'truncated'

export class ClaudeError extends Error {
  constructor(
    readonly reason: ClaudeFailure,
    message: string,
    readonly status?: number,
  ) {
    super(message)
    this.name = 'ClaudeError'
  }
}

/** What the API accepts as a document block, and what it accepts as an image. */
export const DOCUMENT_TYPES = new Set(['application/pdf'])
export const IMAGE_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp',
])

export interface AskInput {
  /** The file, base64 — the pipeline already has the bytes in R2. */
  base64: string
  mimeType: string
  system: string
  prompt: string
  /** Injected in tests. The real one is `globalThis.fetch`. */
  fetchImpl?: typeof fetch
  apiKey?: string
  /** Defaults to EXTRACTION_MODEL. Only a priced model is ever sent. */
  model?: string
  /**
   * Ask Anthropic to cache the system block and the schema.
   *
   * The DOCUMENT is never cacheable — it is different every time and it is
   * most of the input. What repeats is the instructions and the JSON schema,
   * which together are the same bytes on every call.
   */
  cache?: boolean
}

export interface AskResult {
  text: string
  usage: Usage
  model: string
  /**
   * Set when the engine that was ASKED failed and this answer came from the
   * fallback instead.
   *
   * A silent swap must stay visible in the data (owner's ruling). `model`
   * alone says who answered; this says who was supposed to, and why they did
   * not — so a month of quiet Sonnet bills is a question somebody can answer
   * from a row rather than a hunch.
   */
  fellBackFrom?: { model: string; reason: ClaudeFailure; status?: number }
}

/**
 * One document, one question, one answer.
 *
 * Returns the raw text. Parsing is `extraction.ts`'s job and refusing a
 * malformed answer is its rule — this module's contract ends at "the model
 * said something".
 */
export async function askAboutDocument(input: AskInput): Promise<AskResult> {
  const apiKey = input.apiKey ?? process.env.ANTHROPIC_API_KEY
  if (!apiKey) {
    // Named, not silent. A worker without the secret should say so once, in a
    // way that reaches a log, rather than returning empty extractions that
    // look like documents nothing could be read from.
    throw new ClaudeError(
      'no_api_key',
      'ANTHROPIC_API_KEY is not set on this worker.',
    )
  }

  if (input.base64.length > MAX_DOCUMENT_BASE64_BYTES) {
    throw new ClaudeError(
      'document_too_large',
      `Document is ${Math.round(input.base64.length / 1024 / 1024)}MB of base64; the cap is ${MAX_DOCUMENT_BASE64_BYTES / 1024 / 1024}MB.`,
    )
  }

  // TEXT IS SENT AS TEXT. A pasted booking email arrives here as a
  // `text/plain` document because the whole pipeline is built on documents —
  // but base64ing words into a document block asks the model to read a file
  // that is already language. Decoded and sent as a text part instead, on
  // both engines, so one contract covers a PDF and a paste.
  const isText = input.mimeType === 'text/plain'
  const isPdf = DOCUMENT_TYPES.has(input.mimeType)
  const isImage = IMAGE_TYPES.has(input.mimeType)
  if (!isPdf && !isImage && !isText) {
    throw new ClaudeError(
      'unsupported_media_type',
      `${input.mimeType} cannot be read as a document.`,
    )
  }

  const call = input.fetchImpl ?? fetch
  const response = await call('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: input.model ?? EXTRACTION_MODEL,
      max_tokens: MAX_OUTPUT_TOKENS,
      // CACHE THE INSTRUCTIONS, NEVER THE DOCUMENT — and the breakpoint goes
      // on the SYSTEM block only.
      //
      // A `cache_control` marker caches everything UP TO AND INCLUDING the
      // block it sits on. The first version of this also marked the user's
      // text block, which comes after the document — so every unique PDF was
      // written into the cache and never read again. The run said so plainly:
      // 115,582 tokens written against 21,660 read, on a corpus whose entire
      // repeated prefix is about 22,000. Writes cost 1.25x.
      //
      // So: one breakpoint, on the system block, which is the only part that
      // is the same bytes every time.
      system: input.cache
        ? [
            {
              type: 'text',
              text: input.system,
              cache_control: { type: 'ephemeral' },
            },
          ]
        : input.system,
      messages: [
        {
          role: 'user',
          content: [
            ...(isText
              ? [{ type: 'text', text: decodeBase64Text(input.base64) }]
              : [
                  {
                    type: isPdf ? 'document' : 'image',
                    source: {
                      type: 'base64',
                      media_type: input.mimeType,
                      data: input.base64,
                    },
                  },
                ]),
            // NEVER a breakpoint here: this block follows the document, and
            // caching up to it would cache the document.
            { type: 'text', text: input.prompt },
          ],
        },
      ],
    }),
  })

  if (!response.ok) {
    const body = await response.text().catch(() => '')
    throw new ClaudeError(
      'http_error',
      `Claude returned ${response.status}: ${body.slice(0, 300)}`,
      response.status,
    )
  }

  const payload = (await response.json()) as {
    content?: { type: string; text?: string }[]
    usage?: {
      input_tokens?: number
      output_tokens?: number
      cache_creation_input_tokens?: number
      cache_read_input_tokens?: number
    }
    model?: string
    stop_reason?: string
  }

  const text = (payload.content ?? [])
    .filter((block) => block.type === 'text')
    .map((block) => block.text ?? '')
    .join('')
    .trim()

  if (text === '') {
    throw new ClaudeError('no_text', 'Claude returned no text block.')
  }

  // TRUNCATION IS ITS OWN FAILURE, said in its own words.
  //
  // `stop_reason` was read into this type and never checked, so an answer cut
  // off at the token cap reached the parser as a broken string and was
  // reported as `not_json`. That is a true statement about the text and a
  // misleading one about the cause: nothing was malformed, the answer simply
  // did not finish. Raising the cap is the fix; saying so is what makes the
  // next one diagnosable in a log rather than in a re-run.
  if (payload.stop_reason === 'max_tokens') {
    throw new ClaudeError(
      'truncated',
      `The answer hit the ${MAX_OUTPUT_TOKENS}-token cap and stops mid-value.`,
    )
  }

  return {
    text,
    usage: {
      inputTokens: payload.usage?.input_tokens ?? 0,
      outputTokens: payload.usage?.output_tokens ?? 0,
      cacheWriteTokens: payload.usage?.cache_creation_input_tokens ?? 0,
      cacheReadTokens: payload.usage?.cache_read_input_tokens ?? 0,
    },
    model: payload.model ?? EXTRACTION_MODEL,
  }
}

/** base64 back to the words somebody pasted. `atob` exists on workerd. */
export function decodeBase64Text(base64: string): string {
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index++) {
    bytes[index] = binary.charCodeAt(index)
  }
  return new TextDecoder().decode(bytes)
}
