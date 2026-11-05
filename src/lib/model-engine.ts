import {
  ClaudeError,
  EXTRACTION_MODEL,
  askAboutDocument,
  configuredProvider,
  defaultModelFor,
  explicitProviderFor,
  modelOf,
  providerNamed,
  type AskInput,
  type AskResult,
  type LlmProvider,
  type ReadKind,
} from './claude'
import { askGemini, isGeminiModel } from './gemini'

// ---------------------------------------------------------------------------
// ONE SEAM, ONE RULE — AND ONE FALLBACK.
//
// The extraction service asks a model to read a document and does not know
// whose model it is. The strict parse, the money handling, the OCR columns and
// the correction memory downstream stay engine-agnostic as long as the branch
// lives here and nowhere else.
//
// ROUTED ON THE RESOLVED MODEL — the requested one OR THE DEFAULT. The first
// version routed on the requested model alone, so a call with no model asked
// for went to Anthropic carrying `EXTRACTION_MODEL`, which by then named a
// Gemini model. Every default extraction 404'd.
// ---------------------------------------------------------------------------

/**
 * What a worker that names NO fallback provider falls to: the floor's vision
 * model.
 *
 * KEPT AS A CONSTANT AND NO LONGER USED DIRECTLY. `fallbackModelFor` resolves
 * the fallback through `LLM_FALLBACK_PROVIDER`, and both deployed workers set
 * it to DEEPSEEK (owner's ruling, 2026-11-05) — see `fallbackProviderFor`.
 * This is what the tests that name no provider at all still see, and it is
 * what a worker whose `vars` lost the line would fall to, which is why
 * `tests/llm-provider.test.ts` reads both workers' `vars` and refuses it.
 */
export const FALLBACK_MODEL = 'claude-sonnet-5'

/** The variable naming where a failed default lands. One, not per type. */
export const FALLBACK_PROVIDER_VAR = 'LLM_FALLBACK_PROVIDER'

/**
 * Where a failed default lands. Named because it is a policy, not a detail.
 *
 * ── ITS OWN VARIABLE, BECAUSE `LLM_PROVIDER` MOVES THE PRIMARY ────────────
 *
 * Owner's ruling, 2026-11-05. The Anthropic console key was disabled on
 * 2026-11-02. The fallback on both workers was "the configured provider's
 * model"; neither worker configured one; the unset floor is ANTHROPIC — so
 * every Gemini outage would have reached for a dead key and answered 401.
 *
 * The first wording of the fix was `LLM_PROVIDER=DEEPSEEK` on production.
 * That variable decides the PRIMARY read as well: `askModel` resolves the
 * default through `explicitProviderFor` — the 2026-09-13 fix for the inert
 * variable — so that one line would have moved every production read onto
 * DeepSeek and refused every PDF. Readers stay on Gemini; the fallback is
 * named separately, here.
 *
 * ABSENT MEANS THE CONFIGURED PROVIDER, exactly as before this variable
 * existed, so a worker that names nothing behaves as it always did. What
 * forbids that on the two real workers is `tests/llm-provider.test.ts`, which
 * reads each worker's own `vars` and fails by name if any read kind's
 * fallback resolves to ANTHROPIC. A misspelling refuses through
 * `providerNamed`, naming THIS variable.
 */
export function fallbackProviderFor(
  kind: ReadKind | null = null,
  env: Record<string, string | undefined> = process.env,
): LlmProvider {
  const value = env[FALLBACK_PROVIDER_VAR]
  if (value === undefined || value.trim() === '')
    return configuredProvider(kind, env)
  return providerNamed({ name: FALLBACK_PROVIDER_VAR, value })
}

/** The fallback provider's model for this document. */
export function fallbackModelFor(
  mimeType: string,
  kind: ReadKind | null = null,
  env: Record<string, string | undefined> = process.env,
): string {
  return modelOf(fallbackProviderFor(kind, env), mimeType)
}

/**
 * The model a read with NO model named goes to FIRST.
 *
 * `EXTRACTION_MODEL` unless a deployment has EXPLICITLY named a provider for
 * this kind or for the floor — then that provider's model, which is what made
 * `LLM_PROVIDER_CDL=DEEPSEEK` mean something on 2026-09-13. Exported so the
 * test that pins "readers stay on Gemini" asks THIS function with each
 * worker's `vars`, not a re-derivation of it.
 */
export function defaultModelOf(
  mimeType: string,
  kind: ReadKind | null = null,
  env: Record<string, string | undefined> = process.env,
): string {
  const configured = explicitProviderFor(kind, env)
  return configured === null
    ? EXTRACTION_MODEL
    : defaultModelFor(mimeType, kind, env)
}

/**
 * Whether a failure is an OUTAGE — the engine could not answer — rather than
 * an answer we did not like.
 *
 * THE DISTINCTION IS THE WHOLE RULE (owner's ruling). A quota or a dropped
 * connection means nobody read the document, and retrying elsewhere is
 * strictly better than telling a dispatcher to try again. A BAD ANSWER is not
 * an outage: a refusal, a truncation, or JSON the parser rejects are all the
 * engine having read the document and produced something wrong, and paying a
 * second engine to disagree is not a fallback, it is a second opinion nobody
 * asked for.
 *
 * A parse failure cannot reach here at all — it happens downstream, in
 * `extraction.ts`, after this function has returned text. That is structural
 * and is asserted anyway, because "it cannot happen" is a claim with a history.
 */
export function isOutage(error: unknown): boolean {
  // A fetch that rejects never reached the other end: DNS, TLS, a dropped
  // socket. Nothing was read and nothing was billed.
  if (!(error instanceof ClaudeError)) return true

  if (error.reason !== 'http_error') return false

  // 429 is the quota. 5xx is theirs, not ours. Every other 4xx is a
  // CONFIGURATION error — a wrong model name, a revoked key — and falling back
  // would hide it behind a working system and a larger bill.
  return error.status === 429 || (error.status ?? 0) >= 500
}

export async function askModel(input: AskInput): Promise<AskResult> {
  // ── THE CONFIGURED PROVIDER DECIDES, WHEN THERE IS ONE ────────────────
  //
  // `EXTRACTION_MODEL` is the default of last resort, not the first answer.
  // It named a Gemini model, and this line used to read
  // `input.model ?? EXTRACTION_MODEL` — so `LLM_PROVIDER_CDL=DEEPSEEK` was
  // INERT: every default read went to Gemini and never reached the transport
  // where the provider is resolved.
  //
  // That shipped to dev on 2026-09-13 and was caught by a real upload read
  // back out of the ledger, not by a test. Every unit guard passed: they
  // exercised `configuredProvider` and `askAboutDocument` directly, and
  // nothing exercised THIS line with no model named.
  //
  // EXPLICIT ONLY. A deployment that has named no provider keeps
  // `EXTRACTION_MODEL` — collapsing "unset" into "Anthropic" here would have
  // moved every unconfigured read in the system onto Sonnet. `defaultModelOf`
  // is that resolution, exported so the deployment test asks it directly.
  const model =
    input.model ?? defaultModelOf(input.mimeType, input.kind ?? null)
  const resolved = { ...input, model }

  if (!isGeminiModel(model)) return askAboutDocument(resolved)

  try {
    return await askGemini(resolved)
  } catch (error) {
    // ONLY THE DEFAULT PATH FALLS BACK.
    //
    // A caller that NAMED a model gets the failure it asked for. The engine
    // table names one per column, and a silent swap there would make a column
    // secretly Sonnet — a measurement quietly reporting the wrong engine is
    // worse than a measurement that stops.
    if (input.model || !isOutage(error)) throw error

    // THE FALLBACK FOLLOWS THE SAME PER-TYPE CONFIG as the default would
    // have. A Gemini outage on a medical read must not reach for whatever
    // the rate-confirmation column happens to be set to.
    const fallbackModel = fallbackModelFor(input.mimeType, input.kind ?? null)
    const reason = error instanceof ClaudeError ? error.reason : 'http_error'
    const status = error instanceof ClaudeError ? error.status : undefined

    let answer: AskResult
    try {
      answer = await askAboutDocument({ ...input, model: fallbackModel })
    } catch (second) {
      // ── A PDF THE FALLBACK CANNOT READ IS STILL THE OUTAGE ─────────────
      //
      // `askAboutDocument` refuses a PDF bound for DeepSeek before anything
      // is sent (`pdf_not_supported`; `readsPdf` is measured, not assumed,
      // and it stays). Thrown as-is, the reader would see the fallback's
      // refusal and not Gemini's outage — and a refusal about the document
      // reads as "this file", when the truth is "nobody could read it just
      // now". So the ORIGINAL failure goes out, its message saying that the
      // fallback was refused and that nothing was sent to it. Every reader
      // classifies it `call_failed`: try again, do not photograph it again.
      if (
        second instanceof ClaudeError &&
        second.reason === 'pdf_not_supported'
      ) {
        const said =
          error instanceof ClaudeError ? error.message : String(error)
        throw new ClaudeError(
          reason,
          `${model} could not answer (${said}), and the fallback ${fallbackModel} does not read PDFs, so nothing was sent to it. Try again when ${model} answers.`,
          status,
        )
      }
      throw second
    }

    return {
      ...answer,
      fellBackFrom: {
        model,
        reason,
        ...(status !== undefined ? { status } : {}),
      },
    }
  }
}
