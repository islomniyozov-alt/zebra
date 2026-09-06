import { costMilliCents, type Usage } from './claude'
import { askModel } from './model-engine'
import type { AskResult } from './claude'
import { EXTRACTION_SCHEMA } from './extraction-shape'
import {
  ExtractionParseError,
  moneyToCents,
  parseExtraction,
  type ExtractedMoneyCents,
} from './extraction/parse'
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
// ---------------------------------------------------------------------------
// THE READER'S INSTRUCTIONS.
//
// Every rule below the first block came out of the owner verifying the golden
// set document by document — `EXTRACTION-CONTRACT.md` carries each one with the
// sheet it was ruled on and the failure it is aimed at. The first run against
// verified truth scored 86.0%, and THREE QUARTERS OF EVERY FAILURE WAS A VALUE
// INVENTED WHERE THE TRUTH WAS ABSENCE — not misreading. So the weight of this
// prompt is on refusing to fill slots.
//
// Do not add a rule here without a document that produced it.
// ---------------------------------------------------------------------------

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
  '',
  'ABSENCE OVER INVENTION. An empty field is a correct answer and the most',
  'common one. A wrong value costs more than a missing one: a missing value is',
  'visible on the form and a wrong one is not.',
  '',
  '- NEVER COMPUTE A VALUE. Only what the page prints. No averages, no',
  '  midpoints, no unit conversions, no sums the document did not do itself.',
  '  "Temp: 33.0 to 38.0" is NOT tempF 35.5 - a single-temperature field',
  '  cannot hold a range, so tempF is null.',
  '- A PRINTED negative is a value; an EMPTY SLOT is not. "Hazmat? No" means',
  '  isHazmat false. A blank "Driver 2" line does NOT mean isTeam false - it',
  '  means isTeam null. "Team Drivers" under special requirements means true.',
  '- A MALFORMED value is reported, not repaired. If a printed range reads',
  '  "0800-600", the start is 08:00 and the end is null. Never straighten a',
  '  value into something plausible.',
  '',
  'PLACEHOLDERS ARE ABSENT VALUES. Templates print filler where they require a',
  'value and the shipper gave none.',
  '',
  '- All-zero and filler strings are null: "0000000" as a bill of lading,',
  '  "N/A", "TBD", "XXX", "-".',
  '- A NONSENSE QUANTITY is a placeholder: "Weight (lbs): 01" on a full',
  '  truckload, a pallet count of 0, a piece count of 0, "Total Wgt: 0 lb".',
  '  Judge by IMPOSSIBILITY, not by "unusually low" - 3,000 lb of empty',
  '  pallets is a real weight and must be kept.',
  '- MILES IS READ, NEVER COMPUTED. Set miles only when the document STATES',
  '  a trip distance - Amazon Relay prints "320.1mi" on the face of a',
  '  booking. Do not derive it from the cities, do not estimate it, and do',
  '  not add up leg distances that were not printed. Almost every other',
  '  document leaves it null, which is correct.',
  '',
  'LABEL DISCIPLINE. Read the value, not only the label above it.',
  '',
  '- A value that NAMES ITSELF something else IS that something else.',
  '  "BOL: LOAD ID 538581-104" is a load id, not a bill of lading, so',
  '  bolNumber is null. An address in a "Name:" slot is an address, so the',
  '  stop name is null.',
  '- A CUSTOMER REFERENCE is not a PO. Take poNumber only from a field that',
  '  says PO.',
  '- brokerReference is THE NUMBER THE BROKER REQUIRES ON THE INVOICE: the',
  '  PRO #, Order #, Route # or Load Confirmation number in the header. Where',
  '  several numbers are printed, prefer the one the page says must appear on',
  '  invoices. A shipper LOAD ID printed in a Reference field is not it.',
  '- OUR OWN identifiers are never cargo data. A seal number or stop field',
  '  holding the carrier phone, MC or DOT number is a template artifact: null.',
  '- EQUIPMENT IS NOT A COMMODITY. "Commodity: VAN" beside "Trailer: Power',
  '  Only" names no freight: commodity is null, and the equipment word belongs',
  '  to equipmentType.',
  '- A LABELLED fact attaches even from a header: "Customer Pickup #: 4301" is',
  '  the pickup stop referenceNumber when there is exactly one pickup. A number',
  '  matched out of an instruction SENTENCE by its shape attaches to nothing.',
  '',
  'WINDOWS NEED TWO DIFFERENT ENDS.',
  '',
  '- One printed time is scheduledAt, with windowStart and windowEnd null.',
  '  That includes a time printed TWICE IDENTICALLY (early equal to late is an',
  '  appointment) and a one-sided "Arrive Between: 01/22/2026 1200 / And:".',
  '- Two different times are scheduledAt null, windowStart and windowEnd set.',
  '- Facility operating hours printed against an FCFS stop ARE that window.',
  '',
  'MONEY.',
  '',
  '- A single UNNAMED rate is the linehaul: "CONFIRMED RATE - $950.00 ALL-IN"',
  '  is linehaul and total, fuel null.',
  '- A single rate that NAMES ITSELF an accessorial is not the linehaul.',
  '  "TRUCK ORDERED & NOT USED $150.00" alone means linehaul null.',
  '- A printed "$0.00" freight line IS a value: keep the zero. An absent',
  '  freight line is null. They are different facts.',
  '',
  'EQUIPMENT DIALECT. Some brokers never print "power only":',
  '',
  '- "53 ITS Asset", or any broker-owned trailer beside a "Hook" event, is',
  '  POWER_ONLY.',
  '- "Power Only (DAT)", "Power Only,Van 53", or a loading type of "Drop',
  '  Empty, Hook Loaded" is POWER_ONLY.',
  '- "53 Van" or "Van" with no hook language is DRY_VAN.',
].join('\n')

/**
 * The schema rides in the SYSTEM block, not beside the document.
 *
 * It is the same bytes on every call and it is large — which makes it the
 * other half of what prompt caching is for. The user message keeps only the
 * instruction to answer, so the cacheable prefix is instructions + schema and
 * the uncacheable remainder is the document alone.
 */
export const EXTRACTION_SYSTEM_WITH_SCHEMA = [
  EXTRACTION_SYSTEM,
  '',
  'Answer with JSON matching this schema exactly:',
  '',
  JSON.stringify(EXTRACTION_SCHEMA),
].join('\n')

export function extractionPrompt(): string {
  return 'Extract this rate confirmation. Return the JSON object and nothing else.'
}

export type ExtractionFailure =
  | 'no_document'
  | 'not_readable'
  | 'call_failed'
  | 'unparsable'

export interface ExtractionSuccess {
  ok: true
  documentId: string
  /** Present when the default engine failed and Sonnet answered instead. */
  fellBackFrom?: { model: string; reason: string; status?: number }
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

/**
 * WHICH TABLE THE ANSWER LANDS ON.
 *
 * Upload-first extraction (§1.5) happens BEFORE the load exists, so there is
 * no Document yet — the answer lives on the `PendingUpload` and `confirmUpload`
 * carries it across. The columns are named identically on both tables, which
 * is why this is one parameter rather than two copies of the same function.
 */
export type ExtractionTarget = 'document' | 'pending'

/**
 * THE MODEL CALL DOES NOT HAPPEN INSIDE A TRANSACTION, AND THAT IS WHY THIS IS
 * THREE FUNCTIONS INSTEAD OF ONE.
 *
 * It used to. `extractRateConfirmation(tx, …)` held an interactive transaction
 * open across an HTTP call to Google, and the owner found what that costs:
 * pasting a Relay booking email into production returned a bare 500. Under
 * `wrangler tail` the worker said it in full —
 *
 *   Transaction API error: A query cannot be executed on an expired
 *   transaction. The timeout for this transaction was 60000 ms, however
 *   61858 ms passed since the start of the transaction.
 *
 * — because Gemini was returning 503 "high demand", the seam fell back to
 * Claude, Claude was overloaded too, and the retries outlived the lock. The
 * thrown Prisma error is not a `ClaudeError`, so nothing downstream recognised
 * it and the route rethrew it into an empty 500.
 *
 * Phase 5 flag 31's rule was "fewer statements inside the lock, not a longer
 * lock". This is the same rule one step further: a third party's latency has
 * no business inside a database transaction at all. Raising the 60s ceiling
 * would have bought a slower failure, not a fix — the model can be slow for
 * longer than any number worth holding a Postgres transaction open for.
 *
 * So: a short transaction to claim the row, NO transaction while the model
 * thinks, and a short transaction to write what came back.
 */
export async function beginExtraction(
  tx: TxClient,
  target: ExtractionTarget,
  documentId: string,
): Promise<{ ok: true } | ExtractionRefusal> {
  const found =
    target === 'document'
      ? await tx.document.findFirst({
          where: { id: documentId, deletedAt: null },
          select: { id: true },
        })
      : await tx.pendingUpload.findFirst({
          where: { id: documentId },
          select: { id: true },
        })

  if (!found) {
    return {
      ok: false,
      documentId,
      reason: 'no_document',
      detail:
        target === 'document'
          ? 'No such document in this tenant.'
          : 'No such pending upload in this tenant.',
    }
  }

  // The status moves NOT_QUEUED → PROCESSING → COMPLETED | FAILED, which is
  // what the enum has always described. Written in its own transaction now, so
  // a row that dies mid-call is left saying PROCESSING rather than saying
  // nothing — which is the honest record of what happened to it.
  await setStatus(tx, target, documentId, {
    ocrStatus: 'PROCESSING',
    ocrError: null,
  })
  return { ok: true }
}

/** What the model said, or why it did not say it. No database, no lock. */
export type AskedExtraction =
  | {
      ok: true
      answer: AskResult
      extracted: Extracted
      money: ReturnType<typeof moneyToCents>
    }
  | {
      ok: false
      reason: ExtractionFailure
      detail: string
      /** The model's own words, when there were some. Kept for `unparsable`. */
      rawText?: string
    }

export interface AskForExtractionInput {
  base64: string
  mimeType: string
  /** Injected in tests; the real one is `globalThis.fetch`. */
  fetchImpl?: typeof fetch
  apiKey?: string
  /** The cost experiment's two knobs. Both default to the shipped behaviour. */
  model?: string
  cache?: boolean
}

/**
 * Ask, and parse. Called with nothing held open.
 *
 * The failure taxonomy is unchanged and still matters to the screen:
 * `not_readable` is the DOCUMENT's fault — too big, wrong type, more than can
 * be said back — and `call_failed` is ours or the network's. One is "this file
 * cannot be read", the other is "try again".
 */
export async function askForExtraction(
  input: AskForExtractionInput,
): Promise<AskedExtraction> {
  let answer: AskResult
  try {
    answer = await askModel({
      base64: input.base64,
      mimeType: input.mimeType,
      system: EXTRACTION_SYSTEM_WITH_SCHEMA,
      prompt: extractionPrompt(),
      ...(input.model ? { model: input.model } : {}),
      ...(input.cache ? { cache: true } : {}),
      ...(input.fetchImpl ? { fetchImpl: input.fetchImpl } : {}),
      ...(input.apiKey ? { apiKey: input.apiKey } : {}),
    })
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error)
    const reason: ExtractionFailure =
      error instanceof Error &&
      'reason' in error &&
      (error.reason === 'document_too_large' ||
        error.reason === 'unsupported_media_type' ||
        // A truncated answer is the DOCUMENT being too much to say back, not
        // the network failing. "Try again" is the wrong advice for it.
        error.reason === 'truncated')
        ? 'not_readable'
        : 'call_failed'
    return { ok: false, reason, detail }
  }

  try {
    const extracted = parseExtraction(answer.text)
    return { ok: true, answer, extracted, money: moneyToCents(extracted) }
  } catch (error) {
    if (error instanceof ExtractionParseError) {
      // §1.2: a response that does not parse is a FAILED extraction, never a
      // half-filled form. The raw text travels back so it can be kept.
      return {
        ok: false,
        reason: 'unparsable',
        detail: `${error.reason} at ${error.path}`,
        rawText: answer.text,
      }
    }
    throw error
  }
}

/**
 * Write what came back. Short, and the only part that needs the lock.
 *
 * ALWAYS WRITES. A failed extraction is a fact about the document — `FAILED`
 * with the reason in `ocrError` — because the alternative is a row that looks
 * like it was never tried and a screen that offers the button again forever.
 */
export async function recordExtraction(
  tx: TxClient,
  target: ExtractionTarget,
  documentId: string,
  asked: AskedExtraction,
): Promise<ExtractionOutcome> {
  if (!asked.ok) {
    await setStatus(tx, target, documentId, {
      // The reason is kept where somebody will find it. A truncated message is
      // still a message; a null one is a mystery.
      ocrStatus: 'FAILED',
      ocrError: asked.detail.slice(0, 500),
      ...(asked.rawText ? { ocrText: asked.rawText.slice(0, 20_000) } : {}),
    })
    return {
      ok: false,
      documentId,
      reason: asked.reason,
      detail: asked.detail,
    }
  }

  const { answer, extracted, money } = asked

  await setStatus(tx, target, documentId, {
    ocrStatus: 'COMPLETED',
    ocrError: null,
    // The model's own words, kept: an accuracy argument six months from now is
    // settled by what it said, not by what we stored after reshaping it.
    ocrText: answer.text.slice(0, 20_000),
    extractedJson: {
      extracted,
      money,
      usage: answer.usage,
      model: answer.model,
      // WHICH ENGINE ACTUALLY ANSWERED, and who was asked. A swap that is only
      // inferable from the model name is a swap nobody notices for a month;
      // this makes it a field.
      ...(answer.fellBackFrom ? { fellBackFrom: answer.fellBackFrom } : {}),
      // Not `new Date()` — the audit layer stamps rows and this is a fact
      // about the CALL, so it travels with the usage it belongs to.
      costMilliCents: costMilliCents(answer.usage, answer.model),
    } as never,
  })

  return {
    ok: true,
    documentId,
    extracted,
    money,
    usage: answer.usage,
    costMilliCents: costMilliCents(answer.usage, answer.model),
    model: answer.model,
    ...(answer.fellBackFrom ? { fellBackFrom: answer.fellBackFrom } : {}),
  }
}

/** One delegate, two tables with identically-named columns. */
async function setStatus(
  tx: TxClient,
  target: ExtractionTarget,
  id: string,
  data: Record<string, unknown>,
): Promise<void> {
  if (target === 'document') {
    await tx.document.update({ where: { id }, data: data as never })
  } else {
    await tx.pendingUpload.update({ where: { id }, data: data as never })
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
