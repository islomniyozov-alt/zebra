import {
  ClaudeError,
  DOCUMENT_TYPES,
  IMAGE_TYPES,
  MAX_DOCUMENT_BASE64_BYTES,
  MAX_OUTPUT_TOKENS,
  type AskInput,
  type AskResult,
} from './claude'

// ---------------------------------------------------------------------------
// THE GEMINI API, FROM THE WORKER — BEHIND THE SAME CONTRACT.
//
// `fetch` only, for the reason claude.ts gives and one more: `@google/genai`
// was installed into this repository while this adapter was being written, and
// it was removed again. An SDK on workerd is a bet on somebody else's opinion
// of Node, and the whole surface needed here is a POST with a JSON body.
//
// SAME CONTRACT, deliberately: same `AskInput`, same `AskResult`, same
// `ClaudeError` reasons, same all-or-nothing parse downstream. The error class
// keeps its Anthropic name rather than being renamed across a dozen files for
// a word — what matters is that a caller cannot tell which engine refused, and
// therefore cannot grow a branch that treats one of them specially.
//
// WHAT IS NOT SHARED is the shape of the request and of the usage block, which
// is the entire job of this file:
//
//   * the model is in the URL, not the body;
//   * the key is a header, never a query parameter — a key in a URL lands in
//     access logs, proxies and browser history;
//   * the system prompt is `systemInstruction`, the document is `inlineData`;
//   * `responseMimeType: application/json` asks for JSON without a schema,
//     because the strict parser downstream is the contract and a second
//     schema here would be a second thing to keep in step;
//   * truncation is `finishReason: MAX_TOKENS`, not `stop_reason`.
// ---------------------------------------------------------------------------

const ENDPOINT = 'https://generativelanguage.googleapis.com/v1beta/models'

/** Which engine a model name belongs to. The only routing rule there is. */
export function isGeminiModel(model: string): boolean {
  return model.startsWith('gemini-')
}

export async function askGemini(input: AskInput): Promise<AskResult> {
  const apiKey = input.apiKey ?? process.env.GEMINI_API_KEY
  if (!apiKey) {
    // The same named failure Anthropic's missing key produces, so a worker
    // without the secret says so once in a log rather than returning empty
    // extractions that look like unreadable documents.
    throw new ClaudeError(
      'no_api_key',
      'GEMINI_API_KEY is not set on this worker.',
    )
  }

  // THE SAME GUARDS, BEFORE THE CALL. A cap that only limits the response
  // still lets a 90-page scan cost money on its way in, and the acceptance
  // box asks for a document over the cap failing cleanly — which means the
  // fetch never happens.
  if (input.base64.length > MAX_DOCUMENT_BASE64_BYTES) {
    throw new ClaudeError(
      'document_too_large',
      `Document is ${Math.round(input.base64.length / 1024 / 1024)}MB of base64; the cap is ${MAX_DOCUMENT_BASE64_BYTES / 1024 / 1024}MB.`,
    )
  }

  if (!DOCUMENT_TYPES.has(input.mimeType) && !IMAGE_TYPES.has(input.mimeType)) {
    throw new ClaudeError(
      'unsupported_media_type',
      `${input.mimeType} cannot be read as a document.`,
    )
  }

  const model = input.model ?? 'gemini-2.5-flash'
  const call = input.fetchImpl ?? fetch

  const response = await call(`${ENDPOINT}/${model}:generateContent`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-goog-api-key': apiKey,
    },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: input.system }] },
      contents: [
        {
          role: 'user',
          parts: [
            {
              inlineData: { mimeType: input.mimeType, data: input.base64 },
            },
            { text: input.prompt },
          ],
        },
      ],
      generationConfig: {
        maxOutputTokens: MAX_OUTPUT_TOKENS,
        responseMimeType: 'application/json',
        // Deterministic as the API allows. The corpus table is a measurement
        // and run-to-run drift is already its largest caveat.
        temperature: 0,
      },
    }),
  })

  if (!response.ok) {
    const body = await response.text().catch(() => '')
    throw new ClaudeError(
      'http_error',
      `Gemini returned ${response.status}: ${body.slice(0, 300)}`,
      response.status,
    )
  }

  const payload = (await response.json()) as {
    candidates?: {
      content?: { parts?: { text?: string }[] }
      finishReason?: string
    }[]
    usageMetadata?: {
      promptTokenCount?: number
      candidatesTokenCount?: number
      cachedContentTokenCount?: number
    }
    promptFeedback?: { blockReason?: string }
  }

  const candidate = payload.candidates?.[0]

  // A blocked prompt is a refusal, and it is not a network problem. Named so
  // a screen can say "this file cannot be read" rather than "try again".
  if (payload.promptFeedback?.blockReason) {
    throw new ClaudeError(
      'refused',
      `Gemini blocked the request: ${payload.promptFeedback.blockReason}.`,
    )
  }

  const text = (candidate?.content?.parts ?? [])
    .map((part) => part.text ?? '')
    .join('')
    .trim()

  // TRUNCATION FIRST, and by name. Checked before the empty test because an
  // answer cut off at zero tokens is both, and "it stopped early" is the
  // useful half — `not_json` three layers later is what cost a session on the
  // Anthropic side.
  if (candidate?.finishReason === 'MAX_TOKENS') {
    throw new ClaudeError(
      'truncated',
      `The answer hit the ${MAX_OUTPUT_TOKENS}-token cap and stops mid-value.`,
    )
  }

  if (text === '') {
    throw new ClaudeError(
      'no_text',
      `Gemini returned no text (finishReason ${candidate?.finishReason ?? 'absent'}).`,
    )
  }

  return {
    text,
    usage: {
      inputTokens: payload.usageMetadata?.promptTokenCount ?? 0,
      outputTokens: payload.usageMetadata?.candidatesTokenCount ?? 0,
      // Gemini 2.5 caches implicitly; there is no write to pay for and the
      // read is reported here. Mapped onto the same two counters so one cost
      // function prices both engines.
      cacheWriteTokens: 0,
      cacheReadTokens: payload.usageMetadata?.cachedContentTokenCount ?? 0,
    },
    model,
  }
}
