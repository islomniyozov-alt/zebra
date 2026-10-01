import type { DocumentType } from '@/generated/prisma/client'
import type { MessageKey } from './i18n'

// ---------------------------------------------------------------------------
// EVERY DocumentType'S LABEL, NAMED ONE BY ONE, IN ONE PLACE.
//
// Same shape and same argument as `WARNING_LABEL_KEYS` in
// `components/WarningCell.tsx`, which says it best: a template like
// `docType.${type}` is shorter and lets a new enum value ship untranslated —
// the cast accepts it, the lookup misses, and the screen prints the key where a
// name belongs.
//
// ── IT WAS NOT HYPOTHETICAL ──────────────────────────────────────────────
//
// `DocumentType` has 21 members. `docType.*` had EIGHTEEN keys, and the three
// missing ones are `EMPLOYMENT_APPLICATION`, `EMPLOYMENT_VERIFICATION` and
// `ROAD_TEST_CERTIFICATE` — the DQF documents added in item 13, which shipped
// without labels because `src/app/(app)/documents/page.tsx` looked them up as
// `t(\`docType.${row.type}\` as MessageKey)`. THE CAST IS WHAT HID IT: it tells
// the compiler to stop asking, and the compiler was the only thing that knew.
//
// So the map is `satisfies Record<DocumentType, MessageKey>`. A 22nd enum value
// fails to compile HERE, by name, until somebody writes three sentences for it.
//
// ── ONE VOCABULARY, NOT TWO ──────────────────────────────────────────────
//
// There were two: `docType.*` (18 keys, the documents list) and
// `documents.type.*` (3 keys, the load screen's required-document slots). The
// same enum member had two labels that could drift apart, and `POD` already
// read differently in Russian — "POD" in one and "Документ о доставке" in the
// other. `documents.type.*` is gone and its three keys are deleted; this is the
// vocabulary.
// ---------------------------------------------------------------------------

export const DOCUMENT_TYPE_LABEL_KEYS = {
  RATE_CONFIRMATION: 'docType.RATE_CONFIRMATION',
  BOL: 'docType.BOL',
  POD: 'docType.POD',
  LUMPER_RECEIPT: 'docType.LUMPER_RECEIPT',
  SCALE_TICKET: 'docType.SCALE_TICKET',
  FUEL_RECEIPT: 'docType.FUEL_RECEIPT',
  DETENTION_PROOF: 'docType.DETENTION_PROOF',
  INVOICE_PDF: 'docType.INVOICE_PDF',
  SETTLEMENT_PDF: 'docType.SETTLEMENT_PDF',
  MAINTENANCE_RECEIPT: 'docType.MAINTENANCE_RECEIPT',
  INSURANCE_CERT: 'docType.INSURANCE_CERT',
  REGISTRATION: 'docType.REGISTRATION',
  INSPECTION_REPORT: 'docType.INSPECTION_REPORT',
  CDL_COPY: 'docType.CDL_COPY',
  MEDICAL_CARD: 'docType.MEDICAL_CARD',
  ACCIDENT_REPORT: 'docType.ACCIDENT_REPORT',
  EMPLOYMENT_APPLICATION: 'docType.EMPLOYMENT_APPLICATION',
  EMPLOYMENT_VERIFICATION: 'docType.EMPLOYMENT_VERIFICATION',
  ROAD_TEST_CERTIFICATE: 'docType.ROAD_TEST_CERTIFICATE',
  PHOTO: 'docType.PHOTO',
  OTHER: 'docType.OTHER',
} satisfies Record<DocumentType, MessageKey>

/**
 * The same, translated for this request.
 *
 * EXHAUSTIVE BY TYPE, so a caller needs no `??` fallback and every screen
 * reading it shows a name rather than a key. `warningLabels` beside it does the
 * same thing for the same reason.
 */
export function documentTypeLabels(
  t: (key: MessageKey) => string,
): Record<DocumentType, string> {
  return Object.fromEntries(
    Object.entries(DOCUMENT_TYPE_LABEL_KEYS).map(([type, key]) => [
      type,
      t(key),
    ]),
  ) as Record<DocumentType, string>
}

/** The enum's members, in schema order. For a filter's option list. */
export const DOCUMENT_TYPES = Object.keys(
  DOCUMENT_TYPE_LABEL_KEYS,
) as DocumentType[]
