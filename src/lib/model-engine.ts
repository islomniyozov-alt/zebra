import {
  ClaudeError,
  EXTRACTION_MODEL,
  askAboutDocument,
  type AskInput,
  type AskResult,
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

/** Where a failed default lands. Named because it is a policy, not a detail. */
export const FALLBACK_MODEL = 'claude-sonnet-5'

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
  const model = input.model ?? EXTRACTION_MODEL
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

    const answer = await askAboutDocument({ ...input, model: FALLBACK_MODEL })
    return {
      ...answer,
      fellBackFrom: {
        model,
        reason: error instanceof ClaudeError ? error.reason : 'http_error',
        ...(error instanceof ClaudeError && error.status !== undefined
          ? { status: error.status }
          : {}),
      },
    }
  }
}
