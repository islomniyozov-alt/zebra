import { askAboutDocument, costMilliCents, type Usage } from './claude'
import { EXTRACTION_SCHEMA } from './extraction-shape'
import {
  ExtractionParseError,
  moneyToCents,
  parseExtraction,
  type ExtractedMoneyCents,
} from './extraction'
import type { Extracted } from './extraction-shape'
import type { TxClient } from './tenancy'

// ---------------------------------------------------------------------------
// A RATE CONFIRMATION, READ (Phase 5 §3 step 1).
//
// The document goes to the model with the schema it must answer in; the answer
// is parsed strictly or refused; the money in it becomes cents through
// money.ts; and the whole thing lands on the Document's OCR columns —
// `ocrStatus`, `ocrText`, `extractedJson`, `ocrError` — which have been in the
// schema since the init migration with the comment "Present from day one so
// that enabling AI extraction is a background job, not a migration across tens
// of thousands of rows." This is that day.
//
// NOTHING HERE TOUCHES A LOAD. §1.1: extraction prefills the existing Create
// Load form and nothing auto-saves. Step 2 reads what this wrote; this writes
// only to the Document.
// ---------------------------------------------------------------------------

/**
 * What the model is told it is.
 *
 * Short on purpose. A prompt that explains freight brokerage to the model is a
 * prompt that also tells it what to expect, and a document that disagrees with
 * the explanation is where a confident wrong answer comes from. What it needs
 * is the shape of the answer and permission to say "not present".
 */
export const EXTRACTION_SYSTEM = [
  'You read freight rate confirmations and return structured JSON.',
  '',
  'Rules:',
  '- Return ONLY JSON matching the given schema. No prose, no explanation.',
  '- A field the document does not carry is null. Never guess, never default.',
  '- confidence is "high" when the value is printed plainly and unambiguously,',
  '  "medium" when it is inferred from context or partly illegible, "low" when',
  '  you are reading between the lines.',
  '- Money fields are STRINGS, copied exactly as printed, including the symbol',
  '  and separators. Do not convert, round, or total them.',
  '- Dates and times are the local values printed on the document, as',
  '  YYYY-MM-DDTHH:mm. Do not convert to UTC and do not add a zone.',
  '- Stops are in the order the document lists them; pickups before deliveries',
  '  only if that is how it reads.',
].join('\n')

export function extractionPrompt(): string {
  return [
    'Extract this rate confirmation into JSON matching this schema exactly:',
    '',
    JSON.stringify(EXTRACTION_SCHEMA),
    '',
    'Return the JSON object and nothing else.',
  ].join('\n')
}

export type ExtractionFailure =
  | 'no_document'
  | 'not_readable'
  | 'call_failed'
  | 'unparsable'

export interface ExtractionSuccess {
  ok: true
  documentId: string
  extracted: Extracted
  money: ExtractedMoneyCents
  usage: Usage
  /** Thousandths of a cent. A rate confirmation is around 2,500 of these. */
  costMilliCents: number
  model: string
}

export interface ExtractionRefusal {
  ok: false
  documentId: string
  reason: ExtractionFailure
  detail: string
}

export type ExtractionOutcome = ExtractionSuccess | ExtractionRefusal

export interface ExtractInput {
  documentId: string
  base64: string
  mimeType: string
  /** Injected in tests; the real one is `globalThis.fetch`. */
  fetchImpl?: typeof fetch
  apiKey?: string
}

/**
 * Read one document and record what came back on it.
 *
 * ALWAYS WRITES. A failed extraction is a fact about the document — `FAILED`
 * with the reason in `ocrError` — because the alternative is a row that looks
 * like it was never tried and a screen that offers the button again forever.
 *
 * The status moves NOT_QUEUED → PROCESSING → COMPLETED | FAILED, which is what
 * the enum has always described and nothing has ever written.
 */
export async function extractRateConfirmation(
  tx: TxClient,
  input: ExtractInput,
): Promise<ExtractionOutcome> {
  const document = await tx.document.findFirst({
    where: { id: input.documentId, deletedAt: null },
    select: { id: true },
  })
  if (!document) {
    return {
      ok: false,
      documentId: input.documentId,
      reason: 'no_document',
      detail: 'No such document in this tenant.',
    }
  }

  await tx.document.update({
    where: { id: document.id },
    data: { ocrStatus: 'PROCESSING', ocrError: null },
  })

  const fail = async (
    reason: ExtractionFailure,
    detail: string,
  ): Promise<ExtractionRefusal> => {
    await tx.document.update({
      where: { id: document.id },
      // The reason is kept where somebody will find it. A truncated message is
      // still a message; a null one is a mystery.
      data: { ocrStatus: 'FAILED', ocrError: detail.slice(0, 500) },
    })
    return { ok: false, documentId: document.id, reason, detail }
  }

  let answer
  try {
    answer = await askAboutDocument({
      base64: input.base64,
      mimeType: input.mimeType,
      system: EXTRACTION_SYSTEM,
      prompt: extractionPrompt(),
      ...(input.fetchImpl ? { fetchImpl: input.fetchImpl } : {}),
      ...(input.apiKey ? { apiKey: input.apiKey } : {}),
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    // `not_readable` is the document's fault — too big, wrong type — and
    // `call_failed` is ours or the network's. A screen says different things
    // about them: one is "this file cannot be read", the other is "try again".
    const reason: ExtractionFailure =
      error instanceof Error &&
      'reason' in error &&
      (error.reason === 'document_too_large' ||
        error.reason === 'unsupported_media_type')
        ? 'not_readable'
        : 'call_failed'
    return fail(reason, message)
  }

  let extracted: Extracted
  try {
    extracted = parseExtraction(answer.text)
  } catch (error) {
    if (error instanceof ExtractionParseError) {
      // §1.2: a response that does not parse is a FAILED extraction, never a
      // half-filled form. The raw text is kept so the failure can be read.
      await tx.document.update({
        where: { id: document.id },
        data: { ocrText: answer.text.slice(0, 20_000) },
      })
      return fail('unparsable', `${error.reason} at ${error.path}`)
    }
    throw error
  }

  const money = moneyToCents(extracted)

  await tx.document.update({
    where: { id: document.id },
    data: {
      ocrStatus: 'COMPLETED',
      ocrError: null,
      // The model's own words, kept: an accuracy argument six months from now
      // is settled by what it said, not by what we stored after reshaping it.
      ocrText: answer.text.slice(0, 20_000),
      extractedJson: {
        extracted,
        money,
        usage: answer.usage,
        model: answer.model,
        // Not `new Date()` — the audit layer stamps rows and this is a fact
        // about the CALL, so it travels with the usage it belongs to.
        costMilliCents: costMilliCents(answer.usage),
      } as never,
    },
  })

  return {
    ok: true,
    documentId: document.id,
    extracted,
    money,
    usage: answer.usage,
    costMilliCents: costMilliCents(answer.usage),
    model: answer.model,
  }
}

/**
 * The same reading, against a mint rather than a Document (§1.5).
 *
 * Upload-first extraction happens BEFORE the load exists, so there is no
 * Document to write to yet — the answer lives on the `PendingUpload` and
 * `confirmUpload` carries it across. The columns are named identically on both
 * tables so this function is the same code with one delegate swapped, and a
 * reader comparing the two has nothing to translate.
 */
export async function extractPendingUpload(
  tx: TxClient,
  input: ExtractInput,
): Promise<ExtractionOutcome> {
  const pending = await tx.pendingUpload.findFirst({
    where: { id: input.documentId },
    select: { id: true },
  })
  if (!pending) {
    return {
      ok: false,
      documentId: input.documentId,
      reason: 'no_document',
      detail: 'No such pending upload in this tenant.',
    }
  }

  await tx.pendingUpload.update({
    where: { id: pending.id },
    data: { ocrStatus: 'PROCESSING', ocrError: null },
  })

  const fail = async (
    reason: ExtractionFailure,
    detail: string,
  ): Promise<ExtractionRefusal> => {
    await tx.pendingUpload.update({
      where: { id: pending.id },
      data: { ocrStatus: 'FAILED', ocrError: detail.slice(0, 500) },
    })
    return { ok: false, documentId: pending.id, reason, detail }
  }

  let answer
  try {
    answer = await askAboutDocument({
      base64: input.base64,
      mimeType: input.mimeType,
      system: EXTRACTION_SYSTEM,
      prompt: extractionPrompt(),
      ...(input.fetchImpl ? { fetchImpl: input.fetchImpl } : {}),
      ...(input.apiKey ? { apiKey: input.apiKey } : {}),
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    const reason: ExtractionFailure =
      error instanceof Error &&
      'reason' in error &&
      (error.reason === 'document_too_large' ||
        error.reason === 'unsupported_media_type')
        ? 'not_readable'
        : 'call_failed'
    return fail(reason, message)
  }

  let extracted: Extracted
  try {
    extracted = parseExtraction(answer.text)
  } catch (error) {
    if (error instanceof ExtractionParseError) {
      await tx.pendingUpload.update({
        where: { id: pending.id },
        data: { ocrText: answer.text.slice(0, 20_000) },
      })
      return fail('unparsable', `${error.reason} at ${error.path}`)
    }
    throw error
  }

  const money = moneyToCents(extracted)

  await tx.pendingUpload.update({
    where: { id: pending.id },
    data: {
      ocrStatus: 'COMPLETED',
      ocrError: null,
      ocrText: answer.text.slice(0, 20_000),
      extractedJson: {
        extracted,
        money,
        usage: answer.usage,
        model: answer.model,
        costMilliCents: costMilliCents(answer.usage),
      } as never,
    },
  })

  return {
    ok: true,
    documentId: pending.id,
    extracted,
    money,
    usage: answer.usage,
    costMilliCents: costMilliCents(answer.usage),
    model: answer.model,
  }
}

/** What was stored, for Step 2's form to read without calling anything. */
export async function storedExtraction(
  tx: TxClient,
  documentId: string,
): Promise<{
  status: string
  extracted: Extracted | null
  money: ExtractedMoneyCents | null
  error: string | null
} | null> {
  const document = await tx.document.findFirst({
    where: { id: documentId, deletedAt: null },
    select: { ocrStatus: true, ocrError: true, extractedJson: true },
  })
  if (!document) return null

  const stored = document.extractedJson as {
    extracted?: Extracted
    money?: ExtractedMoneyCents
  } | null

  return {
    status: document.ocrStatus,
    extracted: stored?.extracted ?? null,
    money: stored?.money ?? null,
    error: document.ocrError,
  }
}
