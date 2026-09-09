import { readCostOf, type AskResult, type ReadCost } from './claude'
import { askModel } from './model-engine'
import { parseResponseText } from './extraction/parse'
import {
  classifyPromptFor,
  classifySchemaFor,
  type ClassifiedDocument,
  type ClassifyConfidence,
} from './extraction/classify-shape'
import type { DocumentType } from '@/generated/prisma/client'

// ---------------------------------------------------------------------------
// PROPOSING WHAT A DROPPED DOCUMENT IS.
//
// The flow the owner ruled on, 2026-09-09:
//
//   classify -> extract with the proposed type's contract -> the confirm step
//   NAMES the type it decided and lets the person change it, which re-reads
//   with the correct contract.
//
// A wrong guess costs one re-read and can never cause a wrong filing.
//
// ── A LOW-CONFIDENCE CLASSIFICATION ASKS BEFORE EXTRACTING ────────────────
//
// Also ruled, and it is the clause that keeps the re-read rare. The whole
// flow's safety rests on a wrong guess being cheap; a classifier permitted to
// shrug and proceed makes the guess frequent, and a re-read that happens half
// the time is not a fallback, it is the design.
//
// So `low` — and `null`, which is the classifier saying this is none of the
// types it knows — both stop and ask. Only `high` and `medium` spend a read.
// ---------------------------------------------------------------------------

/** The bar a proposal must clear before this system spends a read on it. */
const ACTS_ON: readonly ClassifyConfidence[] = ['high', 'medium']

export type ClassifyOutcome =
  | {
      ok: true
      proposal: ClassifiedDocument
      actionable: boolean
      cost: ReadCost
    }
  | {
      ok: false
      reason: 'unsupported_type' | 'call_failed' | 'unparsable'
      cost: ReadCost | null
    }

/**
 * Which of the readable types this document is, if any.
 *
 * `candidates` comes from the caller rather than from a constant here, so the
 * classifier can never propose a type with no reader behind it — see
 * `classify-shape.ts` for why that list has exactly one home.
 */
export async function classifyDocument(input: {
  base64: string
  mimeType: string
  candidates: readonly { type: DocumentType; whatItLooksLike: string }[]
  model?: string
  apiKey?: string
}): Promise<ClassifyOutcome> {
  const types = input.candidates.map((row) => row.type)

  let answer: AskResult
  try {
    answer = await askModel({
      base64: input.base64,
      mimeType: input.mimeType,
      system: `${classifyPromptFor(input.candidates)}

JSON Schema:
${JSON.stringify(classifySchemaFor(types), null, 2)}`,
      prompt: 'Which of these documents is this? Return the JSON described.',
      ...(input.model ? { model: input.model } : {}),
      ...(input.apiKey ? { apiKey: input.apiKey } : {}),
    })
  } catch (error) {
    const reason =
      error instanceof Error &&
      'reason' in error &&
      (error.reason === 'document_too_large' ||
        error.reason === 'unsupported_media_type' ||
        error.reason === 'truncated')
        ? ('unsupported_type' as const)
        : ('call_failed' as const)
    return { ok: false, reason, cost: null }
  }

  const cost = readCostOf(answer)

  let proposal: ClassifiedDocument
  try {
    proposal = readClassification(answer.text, types)
  } catch {
    return { ok: false, reason: 'unparsable', cost }
  }

  return {
    ok: true,
    proposal,
    // BOTH HALVES OF THE GATE. A type this system cannot read is not
    // actionable however sure the model is, and a type it can read is not
    // actionable on a guess.
    actionable: proposal.type !== null && ACTS_ON.includes(proposal.confidence),
    cost,
  }
}

/**
 * Read the classifier's answer, refusing anything outside the offered set.
 *
 * THE ENUM IS ENFORCED HERE AS WELL AS ASKED FOR. A schema is an instruction
 * to something that may not follow it — the same reason every contract in
 * `extraction/` asserts its own shape — and a type this system cannot read,
 * arriving as a string, must not become a route it then tries to call.
 */
export function readClassification(
  text: string,
  allowed: readonly DocumentType[],
): ClassifiedDocument {
  const root = parseResponseText(text) as Record<string, unknown>
  if (typeof root !== 'object' || root === null || Array.isArray(root)) {
    throw new Error('classification was not an object')
  }

  const raw = root['type']
  const type =
    typeof raw === 'string' && (allowed as readonly string[]).includes(raw)
      ? (raw as DocumentType)
      : null

  const confidenceRaw = root['confidence']
  const confidence: ClassifyConfidence =
    confidenceRaw === 'high' || confidenceRaw === 'medium'
      ? confidenceRaw
      : // ANYTHING UNRECOGNISED IS `low`, WHICH MEANS ASK. A malformed or
        // missing confidence is not a reason to proceed — it is the same
        // situation as an uncertain one, and the safe reading is the cautious
        // one rather than the permissive one.
        'low'

  const because = root['because']
  return {
    type,
    confidence,
    because:
      typeof because === 'string' && because.trim() !== '' ? because : null,
  }
}
