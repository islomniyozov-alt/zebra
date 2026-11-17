import type { ComplianceType, DocumentType } from '@/generated/prisma/client'

// ---------------------------------------------------------------------------
// THE DRIVER'S DOCUMENTS TAB (§6.4 part 2 v11.30).
//
// The tab said "No documents on this driver" and offered nothing. Two rules it
// needs live here rather than in the page, where no test can reach them:
// which kinds a person may file on a driver, and which expiry each listed
// document prints.
// ---------------------------------------------------------------------------

/**
 * The kinds a document filed ON A DRIVER may be. The DQF's document kinds,
 * the medical card, the photo and "other" — nothing that belongs to a load or
 * a truck. The picker offers these in this order.
 */
export const DRIVER_DOCUMENT_KINDS = [
  'CDL_COPY',
  'MEDICAL_CARD',
  'EMPLOYMENT_APPLICATION',
  'EMPLOYMENT_VERIFICATION',
  'ROAD_TEST_CERTIFICATE',
  'PHOTO',
  'OTHER',
] as const satisfies readonly DocumentType[]

export type DriverDocumentKind = (typeof DRIVER_DOCUMENT_KINDS)[number]

export function isDriverDocumentKind(
  value: unknown,
): value is DriverDocumentKind {
  return (
    typeof value === 'string' &&
    (DRIVER_DOCUMENT_KINDS as readonly string[]).includes(value)
  )
}

/**
 * A document filed on the driver whose expiry is a compliance record's: the
 * copy of the licence prints the licence's expiry, the medical card the
 * certificate's. Every other kind evidences nothing dated.
 */
export const EXPIRY_FROM_RECORD: Partial<Record<DocumentType, ComplianceType>> =
  {
    CDL_COPY: 'CDL',
    MEDICAL_CARD: 'MEDICAL_CARD',
  }

export interface DriverDocumentSource {
  id: string
  filename: string
  type: string
  uploadedAt: Date
  needsRotation: boolean
  superseded: boolean
}

export interface DriverRecordSource {
  id: string
  type: string
  expiresAt: Date
  isSuperseded: boolean
  documents: readonly {
    id: string
    filename: string
    uploadedAt?: Date | null
  }[]
}

export interface DriverDocumentListRow {
  id: string
  filename: string
  /** The document's kind: its own type, or the type its record files under. */
  type: string
  uploadedAt: Date | null
  /** The expiry of the record it evidences; null when it evidences nothing dated. */
  expiresAt: Date | null
  needsRotation: boolean
  superseded: boolean
  /** Set when the document is attached to a compliance record. */
  recordId: string | null
}

/**
 * EVERY LIVE DOCUMENT ON THE DRIVER AND EVERY ONE ATTACHED TO THE DRIVER'S
 * RECORDS, newest first, each with the expiry of what it evidences: the record
 * it is attached to, or for a licence copy or medical card filed on the
 * driver, the newest live record of that kind. A document listed by both
 * routes appears once.
 *
 * `documentTypeFor` maps a record's type to the kind its files are filed as;
 * passed in so this file stays free of the compliance module.
 */
export function driverDocumentList(input: {
  documents: readonly DriverDocumentSource[]
  records: readonly DriverRecordSource[]
  documentTypeFor: (type: ComplianceType) => DocumentType
}): DriverDocumentListRow[] {
  const newestLive = (type: ComplianceType) =>
    input.records
      .filter((record) => record.type === type && !record.isSuperseded)
      .sort((a, b) => b.expiresAt.getTime() - a.expiresAt.getTime())[0] ?? null

  const out = new Map<string, DriverDocumentListRow>()
  for (const document of input.documents) {
    const from = EXPIRY_FROM_RECORD[document.type as DocumentType]
    out.set(document.id, {
      id: document.id,
      filename: document.filename,
      type: document.type,
      uploadedAt: document.uploadedAt,
      expiresAt: from ? (newestLive(from)?.expiresAt ?? null) : null,
      needsRotation: document.needsRotation,
      superseded: document.superseded,
      recordId: null,
    })
  }
  for (const record of input.records) {
    for (const document of record.documents) {
      if (out.has(document.id)) continue
      out.set(document.id, {
        id: document.id,
        filename: document.filename,
        type: input.documentTypeFor(record.type as ComplianceType),
        uploadedAt: document.uploadedAt ?? null,
        expiresAt: record.expiresAt,
        needsRotation: false,
        superseded: false,
        recordId: record.id,
      })
    }
  }
  return [...out.values()].sort(
    (a, b) =>
      (b.uploadedAt?.getTime() ?? 0) - (a.uploadedAt?.getTime() ?? 0) ||
      a.id.localeCompare(b.id),
  )
}
