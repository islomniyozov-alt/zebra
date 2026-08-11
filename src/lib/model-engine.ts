import { askAboutDocument, type AskInput, type AskResult } from './claude'
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
// ROUTED ON THE MODEL NAME, because the model is already an allowlisted value
// checked against the price table — so there is no second thing to configure,
// no engine field to keep in step with it, and no way to ask for a Gemini
// model and be answered by Anthropic.
// ---------------------------------------------------------------------------

export async function askModel(input: AskInput): Promise<AskResult> {
  return isGeminiModel(input.model ?? '')
    ? askGemini(input)
    : askAboutDocument(input)
}
