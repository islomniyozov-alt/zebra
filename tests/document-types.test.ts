import { describe, expect, it } from 'vitest'
import { DocumentType } from '@/generated/prisma/enums'
import {
  DOCUMENT_TYPE_LABEL_KEYS,
  DOCUMENT_TYPES,
  documentTypeLabels,
} from '@/lib/document-types'
import { isMessageKey, translator, type Locale } from '@/lib/i18n'

// ---------------------------------------------------------------------------
// THE LABEL MAP IS EXHAUSTIVE, ASSERTED TWICE OVER.
//
// `satisfies Record<DocumentType, MessageKey>` already makes a missing member a
// COMPILE error, which is the real guard and the better one. This file exists
// beside it for two reasons.
//
// FIRST, SO THE BREAK CAN BE WATCHED. `scripts/watch-guard.mjs` adjudicates by
// parsing failing TEST names out of vitest's output; handed `tsc --noEmit` it
// sees a non-zero exit and no failures and reports THE BREAK DID NOT FIRE —
// correctly, on its own terms, because it cannot read a type error. A guard
// that cannot be watched failing is not known to work (AGENTS.md), so the same
// claim is made here where the wrapper can see it fire.
//
// SECOND, BECAUSE THE TYPE CHECK CANNOT SEE THE TRANSLATIONS. A key that is in
// the map and missing from a locale is well-typed and still prints nothing, and
// that is exactly how the three DQF types shipped unlabelled: the lookup was
// `t(\`docType.${row.type}\` as MessageKey)`, and the cast told the compiler to
// stop asking.
//
// THE ENUM COMES FROM THE GENERATED CLIENT, not from a list written here. A
// second hand-written list of DocumentType members would be the thing that goes
// stale — "count the thing you are claiming, not a superset of it", and the
// thing being claimed is about the schema's own enum.
// ---------------------------------------------------------------------------

const MEMBERS = Object.values(DocumentType)

describe('every DocumentType has a label', () => {
  it('covers the generated enum exactly, with nothing extra', () => {
    expect([...MEMBERS].sort()).toEqual([...DOCUMENT_TYPES].sort())
  })

  // ONE ASSERTION PER MEMBER, so a failure names the type rather than printing
  // two sorted arrays and leaving somebody to diff them by eye.
  it.each(MEMBERS)('%s has a message key', (member) => {
    expect(
      DOCUMENT_TYPE_LABEL_KEYS[member],
      `${member} has no entry in DOCUMENT_TYPE_LABEL_KEYS`,
    ).toBeTruthy()
  })

  it.each(MEMBERS)('%s is a real message key', (member) => {
    // A KEY THAT IS WELL-TYPED AND ABSENT FROM `messages` is the failure the
    // compiler cannot see. `isMessageKey` asks the catalogue.
    expect(
      isMessageKey(DOCUMENT_TYPE_LABEL_KEYS[member]),
      `${DOCUMENT_TYPE_LABEL_KEYS[member]} is not in the message catalogue`,
    ).toBe(true)
  })

  // ALL THREE LOCALES ARE THE COMPILER'S JOB AND IT ALREADY DOES IT:
  // `Dictionary = Record<MessageKey, string>`, so `ru` and `fa` cannot omit a
  // key of `en`. A test looping the catalogues would re-assert what the type
  // guarantees, and would need them exported to do it. What is asserted here
  // instead is that each locale returns a NON-EMPTY name, which the type does
  // not say — `''` satisfies `string`.
  it.each(['en', 'ru', 'fa'] as Locale[])('reads as a name in %s', (locale) => {
    const labels = documentTypeLabels(translator(locale))
    const blank = MEMBERS.filter((member) => labels[member].trim() === '')
    expect(blank).toEqual([])
  })

  // AND THE RENDERED MAP NEVER RETURNS A KEY AS A LABEL. The symptom the three
  // DQF types produced on the documents list was the key itself in the column.
  it('renders a name, never the key it looked up', () => {
    const labels = documentTypeLabels(translator('en'))
    for (const member of MEMBERS) {
      expect(labels[member]).toBeTruthy()
      expect(labels[member].startsWith('docType.')).toBe(false)
    }
  })
})
