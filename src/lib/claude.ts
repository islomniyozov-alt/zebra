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

// ---------------------------------------------------------------------------
// TWO HOSTS BEHIND ONE TRANSPORT (owner's ruling, 2026-09-12).
//
// DeepSeek publishes an ANTHROPIC-COMPATIBLE endpoint: the same POST, the same
// `x-api-key` and `anthropic-version` headers, the same content blocks, the
// same `usage` and `stop_reason` in the answer. So the switch is a base URL, a
// key and a model name — NOT a second client. Everything below this line runs
// identically on both, which is the property the acceptance is measuring: a
// difference in the numbers is then a difference between the ENGINES, not
// between two hand-written adapters that drifted.
//
// WHICH PROVIDER IS A CONFIG VALUE, `LLM_PROVIDER`, and it decides only what
// the DEFAULTS resolve to. A named model always goes to its own host — the
// accuracy run names one per column, and a run that could be silently answered
// by the other provider would be a measurement reporting the wrong engine.
// ---------------------------------------------------------------------------

export type LlmProvider = 'ANTHROPIC' | 'DEEPSEEK'

export interface ProviderConfig {
  /** The Messages endpoint, in full. */
  url: string
  /** The environment variable holding the key. Named, never inlined. */
  keyEnv: 'ANTHROPIC_API_KEY' | 'DEEPSEEK_API_KEY'
  /** What reads a photograph or a PDF. */
  visionModel: string
  /** What reads a pasted email — words that are already language. */
  textModel: string
}

export const PROVIDERS: Record<LlmProvider, ProviderConfig> = {
  ANTHROPIC: {
    url: 'https://api.anthropic.com/v1/messages',
    keyEnv: 'ANTHROPIC_API_KEY',
    // ONE MODEL FOR BOTH on Anthropic, because Sonnet reads either. The split
    // exists for DeepSeek and is expressed here rather than branched on.
    visionModel: 'claude-sonnet-5',
    textModel: 'claude-sonnet-5',
  },
  DEEPSEEK: {
    url: 'https://api.deepseek.com/anthropic/v1/messages',
    keyEnv: 'DEEPSEEK_API_KEY',
    visionModel: 'deepseek-v4-flash-vision-exp',
    textModel: 'deepseek-v4-pro',
  },
}

/**
 * Which model belongs to which host.
 *
 * BY PREFIX, and deliberately not by a lookup that a new model name could fall
 * out of. An unrecognised name goes to Anthropic, which is where every model
 * this transport spoke to before DeepSeek existed — the failure mode is a 404
 * from a real host, not a silent send to the wrong one.
 */
export function providerOf(model: string): LlmProvider {
  return model.startsWith('deepseek') ? 'DEEPSEEK' : 'ANTHROPIC'
}

/**
 * The configured provider, read at CALL TIME rather than at module load.
 *
 * A worker's environment is not there when a module is first evaluated on
 * workerd, so a constant computed at the top of this file would be whatever
 * the build machine had. It is also what makes the switch a redeploy of a
 * variable rather than of code.
 *
 * AN UNKNOWN VALUE IS ANTHROPIC AND SAYS SO. A typo in a Cloudflare variable
 * must not silently move every document read to a different company.
 */
export function configuredProvider(
  env: Record<string, string | undefined> = process.env,
): LlmProvider {
  const raw = (env.LLM_PROVIDER ?? '').trim().toUpperCase()
  if (raw === 'DEEPSEEK') return 'DEEPSEEK'
  if (raw !== '' && raw !== 'ANTHROPIC') {
    console.warn(
      `[zebra.llm] LLM_PROVIDER is ${JSON.stringify(raw)}, which is not a provider. Using ANTHROPIC.`,
    )
  }
  return 'ANTHROPIC'
}

/**
 * What the configured provider sends this document to.
 *
 * A PDF GOES TO THE VISION MODEL. It is not text — it is a page, and on
 * DeepSeek the text model cannot see one. Only a `text/plain` paste, which is
 * already language, takes the text model.
 */
export function defaultModelFor(
  mimeType: string,
  env: Record<string, string | undefined> = process.env,
): string {
  const provider = PROVIDERS[configuredProvider(env)]
  return mimeType === 'text/plain' ? provider.textModel : provider.visionModel
}

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
 * cannot drift apart. A row may OVERRIDE either where its provider does not
 * follow that shape; DeepSeek does not, and the override is why its cache rate
 * is not silently three times what it charges.
 */
export const MODEL_PRICES = {
  'claude-sonnet-5': { input: 300, output: 1_500 },
  'claude-haiku-4-5-20251001': { input: 100, output: 500 },
  // DeepSeek, same units. LIST RATES, supplied by the owner on 2026-09-12 and
  // recorded at the PEAK price.
  //
  // ── TWO PLACES THIS ROW DOES NOT FIT THE TABLE, BOTH DELIBERATE ─────────
  //
  // 1. OFF-PEAK IS HALF OF EVERY FIGURE HERE. DeepSeek discounts by time of
  //    day, which nothing else in this table does and which the ledger cannot
  //    reconstruct from a stored row. Recording the peak rate makes every
  //    DeepSeek cost an UPPER BOUND — the same posture as the unpriced
  //    fallback, chosen on purpose: a bill that comes in under the estimate is
  //    a good surprise, and the alternative is a comparison that flatters the
  //    engine we are thinking of switching to.
  //
  // 2. THE CACHE RATES ARE TYPED, NOT DERIVED. A DeepSeek cache hit is about
  //    3.2% of the input rate rather than Anthropic's 10%, and there is no
  //    write premium at all — the cache is automatic, so a miss simply costs
  //    the input rate. Deriving them would overstate a cache read by 3x.
  'deepseek-v4-flash-vision-exp': {
    input: 44,
    output: 132,
    cacheWrite: 44,
    cacheRead: 1.4,
  },
  'deepseek-v4-pro': {
    input: 132,
    output: 396,
    cacheWrite: 132,
    cacheRead: 4.4,
  },
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

/**
 * Models this system may send to whose RATE NOBODY HAS SUPPLIED.
 *
 * EMPTY, AND THE MECHANISM STAYS. The DeepSeek pair lived here for the hour
 * between the seam being built and the owner supplying the rates, which is the
 * situation this list exists for: a model can be reachable before it is
 * priceable, and the alternative to saying so is a guessed rate. The Gemini
 * rows in `MODEL_PRICES` were once computed from assumed rates and understated
 * by 3.7x — recorded in `EXTRACTION-CONTRACT.md`, and the reason every cost
 * line in this codebase prints the measured tokens beside it.
 *
 * Anything listed here is charged at the dearest rate on file by `pricesFor`,
 * which makes its cost an UPPER BOUND rather than a reading, and
 * `isPricedModel` stays false so a report can say which column is which.
 */
export const UNPRICED_MODELS: readonly string[] = []

/** The models this system will send a document to. Nothing else is accepted. */
export const ALLOWED_MODELS: string[] = [
  ...Object.keys(MODEL_PRICES),
  ...UNPRICED_MODELS,
]

export function isPricedModel(value: string): value is PricedModel {
  return Object.hasOwn(MODEL_PRICES, value)
}

/** Whether this system will send to it at all — priced or bounded. */
export function isAllowedModel(value: string): boolean {
  return ALLOWED_MODELS.includes(value)
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
 * WHAT ONE READ COST, TRAVELLING WITH THE READ.
 *
 * ── WHY EVERY READER RETURNS THIS AND NOT JUST THE RATE-CON ONE ───────────
 *
 * `askModel` has always returned `usage` on every call. `readCdl` and
 * `readMedicalCert` threw it away one line later, so the CDL and the medical
 * certificate had no measured cost anywhere — not in the database, not in the
 * accuracy dumps, not in a log. The rate confirmation's figure survived only
 * because a walkthrough printed a total and somebody copied it into a markdown
 * file. That is a note, not a ledger.
 *
 * A REFUSAL COSTS THE SAME AS A READING, which is why this is carried on the
 * failure branch too. The model answered, the tokens were billed, and the
 * rules then rejected what it said — a cost ledger that counted only successes
 * would understate by exactly the refusal rate, and the refusal rate is the
 * number anybody tuning a prompt is trying to move.
 *
 * NULL WHERE THERE GENUINELY WAS NO CALL. A document rejected for its size or
 * type never reached an engine and cost nothing; `null` says that, where a
 * zero would claim a free call was made.
 */
export interface ReadCost {
  usage: Usage
  /** Who ANSWERED. Not who was asked — see `fellBackFrom`. */
  model: string
  /** Thousandths of a cent, priced by `costMilliCents` at the answering model. */
  milliCents: number
  /** Set when the engine that was asked failed and the fallback answered. */
  fellBackFrom?: { model: string; reason: ClaudeFailure; status?: number }
}

/** The cost of an answer, in the shape every reader hands back. */
export function readCostOf(answer: AskResult): ReadCost {
  return {
    usage: answer.usage,
    model: answer.model,
    milliCents: costMilliCents(answer.usage, answer.model),
    ...(answer.fellBackFrom ? { fellBackFrom: answer.fellBackFrom } : {}),
  }
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
  const base: {
    input: number
    output: number
    cacheWrite?: number
    cacheRead?: number
  } = isPricedModel(model) ? MODEL_PRICES[model] : dearest
  return {
    input: base.input,
    output: base.output,
    // DERIVED FROM THE INPUT RATE UNLESS THE ROW SAYS OTHERWISE. Anthropic's
    // 1.25x/0.1x is the shape most of this table follows; DeepSeek's is not,
    // and a provider whose cache is automatic has no write premium at all.
    // `?? ` rather than a branch, so a row that says nothing keeps the
    // behaviour every existing figure was computed with.
    cacheWrite: base.cacheWrite ?? base.input * 1.25,
    cacheRead: base.cacheRead ?? base.input * 0.1,
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
  // THE MODEL DECIDES THE HOST, and the configured provider decides the model
  // when nobody named one. Resolved together, once, so the key, the URL and
  // the model in the body can never disagree about who is being called.
  const model = input.model ?? defaultModelFor(input.mimeType)
  const provider = PROVIDERS[providerOf(model)]

  const apiKey = input.apiKey ?? process.env[provider.keyEnv]
  if (!apiKey) {
    // Named, not silent. A worker without the secret should say so once, in a
    // way that reaches a log, rather than returning empty extractions that
    // look like documents nothing could be read from.
    //
    // NAMES THE VARIABLE THE PROVIDER NEEDS, which is the whole value of this
    // message: "ANTHROPIC_API_KEY is not set" on a worker configured for
    // DeepSeek would send somebody to check the wrong secret.
    throw new ClaudeError(
      'no_api_key',
      `${provider.keyEnv} is not set on this worker.`,
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
  const response = await call(provider.url, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model,
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
      // THE HOST IS IN THE MESSAGE. A 404 reads identically from both, and
      // "which provider refused" is the first question anybody asks of one.
      `${provider.url} returned ${response.status} for ${model}: ${body.slice(0, 300)}`,
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
    throw new ClaudeError('no_text', `${model} returned no text block.`)
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
    // WHO ANSWERED, as the answer itself reported it — falling back to the
    // resolved model rather than to `EXTRACTION_MODEL`, which names a Gemini
    // model this transport never calls.
    model: payload.model ?? model,
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
