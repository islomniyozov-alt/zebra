import { describe, expect, it } from 'vitest'
import {
  DRIVER_DOCUMENT_KINDS,
  driverDocumentList,
  isDriverDocumentKind,
} from '@/lib/driver-documents'
import { documentTypeFor } from '@/lib/compliance'
import { DQF_DOCUMENT_TYPES } from '@/lib/dqf'

// ---------------------------------------------------------------------------
// THE DRIVER'S DOCUMENTS TAB, ITS TWO RULES (§6.4 part 2 v11.30).
// ---------------------------------------------------------------------------

const at = (iso: string) => new Date(`${iso}T00:00:00.000Z`)

describe('the driver document kinds', () => {
  it('include every document kind the DQF reads, so every DQF upload can be made here', () => {
    for (const type of DQF_DOCUMENT_TYPES)
      expect(DRIVER_DOCUMENT_KINDS as readonly string[]).toContain(type)
  })

  it('refuse a kind that belongs to a load', () => {
    expect(isDriverDocumentKind('RATE_CONFIRMATION')).toBe(false)
    expect(isDriverDocumentKind('CDL_COPY')).toBe(true)
  })
})

describe('the list', () => {
  const list = driverDocumentList({
    documentTypeFor,
    documents: [
      {
        id: 'cdl',
        filename: 'cdl.jpg',
        type: 'CDL_COPY',
        uploadedAt: at('2026-11-10'),
        needsRotation: false,
        superseded: false,
      },
      {
        id: 'app',
        filename: 'application.pdf',
        type: 'EMPLOYMENT_APPLICATION',
        uploadedAt: at('2026-11-12'),
        needsRotation: false,
        superseded: false,
      },
      {
        id: 'med',
        filename: 'med.jpg',
        type: 'MEDICAL_CARD',
        uploadedAt: at('2026-11-01'),
        needsRotation: true,
        superseded: false,
      },
    ],
    records: [
      {
        id: 'r-cdl-old',
        type: 'CDL',
        // LATER than the live one: only the supersession filter keeps it out.
        expiresAt: at('2030-01-01'),
        isSuperseded: true,
        documents: [],
      },
      {
        id: 'r-cdl',
        type: 'CDL',
        expiresAt: at('2029-05-05'),
        isSuperseded: false,
        documents: [],
      },
      {
        id: 'r-mvr',
        type: 'MVR',
        expiresAt: at('2027-02-02'),
        isSuperseded: false,
        documents: [
          { id: 'mvr-file', filename: 'mvr.pdf', uploadedAt: at('2026-11-14') },
          // Also listed on the driver? Not here — but a duplicate id is kept once.
          {
            id: 'app',
            filename: 'application.pdf',
            uploadedAt: at('2026-11-12'),
          },
        ],
      },
    ],
  })

  it('lists the driver’s documents and the records’ files, newest first, each once', () => {
    expect(list.map((row) => row.id)).toEqual(['mvr-file', 'app', 'cdl', 'med'])
  })

  it('a licence copy prints the newest LIVE licence record’s expiry, never a superseded one', () => {
    expect(list.find((row) => row.id === 'cdl')?.expiresAt).toEqual(
      at('2029-05-05'),
    )
  })

  it('a record’s file prints that record’s expiry and its filing kind', () => {
    const mvr = list.find((row) => row.id === 'mvr-file')!
    expect(mvr.expiresAt).toEqual(at('2027-02-02'))
    expect(mvr.recordId).toBe('r-mvr')
    expect(mvr.type).toBe(documentTypeFor('MVR'))
  })

  it('a document that evidences nothing dated prints no expiry; a medical card with no record prints none', () => {
    expect(list.find((row) => row.id === 'app')?.expiresAt).toBeNull()
    expect(list.find((row) => row.id === 'med')?.expiresAt).toBeNull()
    // The parked state is carried through.
    expect(list.find((row) => row.id === 'med')?.needsRotation).toBe(true)
  })
})
