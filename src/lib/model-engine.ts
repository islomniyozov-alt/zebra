import {
  EXTRACTION_MODEL,
  askAboutDocument,
  type AskInput,
  type AskResult,
} from './claude'
import { askGemini, isGeminiModel } from './gemini'

// ---------------------------------------------------------------------------
// ONE SEAM, ONE RULE.
//
// The extraction service asks a model to read a document and does not know
// whose model it is. That is the whole point of the adapter: the strict parse,
// the money handling, the OCR columns and the correction memory downstream are
// engine-agnostic, and they stay that way as long as the branch lives here and
// nowhere else.
//
// ROUTED ON THE RESOLVED MODEL — the requested one OR THE DEFAULT — because
// the first version routed on the requested model alone. With no model asked
// for it saw an empty string, sent the call to Anthropic, and Anthropic was
// handed `EXTRACTION_MODEL`, which by then named a Gemini model. Every default
// extraction 404'd with "model: gemini-3.6-flash" from api.anthropic.com.
//
// The default is resolved HERE and passed down, so neither adapter carries its
// own idea of what to use when nobody says.
// ---------------------------------------------------------------------------

export async function askModel(input: AskInput): Promise<AskResult> {
  const model = input.model ?? EXTRACTION_MODEL
  const resolved = { ...input, model }
  return isGeminiModel(model) ? askGemini(resolved) : askAboutDocument(resolved)
}
