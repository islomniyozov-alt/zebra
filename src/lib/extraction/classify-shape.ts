import type { DocumentType } from '@/generated/prisma/client'

// ---------------------------------------------------------------------------
// WHICH DOCUMENT IS THIS? — THE ONE PLACE THIS SYSTEM INFERS A TYPE.
//
// ── THE RULE IT BENDS, AND THE RULING THAT MAKES THE BEND SAFE ────────────
//
// `compliance-documents.ts` says the type is STATED, never classified from the
// image, and gives the reason: a misclassified document is the CLASS AM bug
// with a whole contract behind it. A registration read by the medical reader
// would be refused for having no expiry it recognises — or worse, would not
// be, and would file a registration date as a driver's medical expiry.
//
// The owner's ruling of 2026-09-09 bends that rule in exactly one direction
// and fences the bend:
//
//   CLASSIFICATION PROPOSES, NEVER CHOOSES.
//   classify -> extract with the proposed type's contract -> the confirm step
//   NAMES the type it decided and lets the person change it, which re-reads
//   with the correct contract.
//
// So a wrong guess costs one re-read and can never cause a wrong filing: the
// verdict is on the screen beside the values, and nothing is stored until
// somebody agrees with both.
//
// A LOW-CONFIDENCE CLASSIFICATION ASKS BEFORE EXTRACTING. Spending a read on a
// guess is the one cost the flow above does not already bound — the re-read is
// cheap because it is rare, and it stops being rare if the classifier is
// allowed to shrug and proceed anyway.
//
// ── WHY IT IS A SEPARATE CALL AND NOT A FIELD ON EACH CONTRACT ────────────
//
// The alternative is to ask each reader "and is this really a medical card?"
// and trust the one whose prompt is already telling it what to find. A reader
// primed to look for an expiry date finds one on almost any document; asking
// the question first, with nothing else in the prompt, is the only way the
// answer is about the document rather than about the question.
// ---------------------------------------------------------------------------

/** How sure the classifier is. Same vocabulary the field envelopes use. */
export type ClassifyConfidence = 'high' | 'medium' | 'low'

export interface ClassifiedDocument {
  /** The proposed type, or null when the image is none of them. */
  type: DocumentType | null
  confidence: ClassifyConfidence
  /** What it saw that decided it, in a few words, for the confirm step. */
  because: string | null
}

/**
 * The types this classifier may propose.
 *
 * DERIVED FROM THE READERS, NOT LISTED TWICE. A type nobody can read is a type
 * the classifier must not propose — proposing it would put a document in front
 * of a contract that does not exist. `READABLE_COMPLIANCE_DOCUMENTS` is the
 * one list; this reads from it at the call site rather than restating it here,
 * and the schema below is built from what it is given.
 */
export function classifySchemaFor(types: readonly DocumentType[]) {
  return {
    type: 'object',
    properties: {
      type: { type: ['string', 'null'], enum: [...types, null] },
      confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
      because: { type: ['string', 'null'] },
    },
    required: ['type', 'confidence', 'because'],
    additionalProperties: false,
  } as const
}

/**
 * The classifier's prompt.
 *
 * ── AN ENUM IS CORRECT HERE, WHICH IS WHY THE BEND IS NARROW ──────────────
 *
 * Everywhere else in this directory an enum is refused: telling a model the
 * permitted answers is what turned a Georgia `CLASS AM` into `A`. That
 * argument applies to TRANSCRIPTION — the card said something and the enum
 * overrode it.
 *
 * This is not transcription. There is no printed value being read; the
 * question genuinely has a closed set of answers, and `null` is one of them.
 * The failure mode the enum causes elsewhere — a real value forced into a
 * listed one — is here the whole point: a document that is none of these must
 * come back as none of these rather than as the nearest.
 */
export function classifyPromptFor(
  descriptions: readonly { type: DocumentType; whatItLooksLike: string }[],
): string {
  const lines = descriptions
    .map((row) => `- ${row.type}: ${row.whatItLooksLike}`)
    .join('\n')

  return `You are sorting a scanned document for a trucking company's compliance file.

Say WHICH of these it is. Do not read any values off it; another step does that.

${lines}

Return ONLY the JSON described by the schema.

- type: the matching value above, or null if it is none of them.
- confidence: "high" if the document's own headings make it obvious, "medium" if the layout suggests it but the headings are unclear or cut off, "low" if you are inferring from a few words.
- because: the heading or feature that decided it, in a few words. If the type is null, say what the document appears to be instead.

null IS A REAL ANSWER AND OFTEN THE RIGHT ONE. A rate confirmation, an invoice, a bill of lading, a lease agreement and a photograph of a truck are all documents this file receives and none of them is in the list above. Returning the nearest match for one of those is worse than returning null, because the next step would read it with a contract it does not fit.

Do not transcribe anything. Do not return dates, names, numbers or limits.`
}
