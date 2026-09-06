// ---------------------------------------------------------------------------
// HOW ANY DOCUMENT'S FIELD ARRIVES: A VALUE WITH HOW SURE THE MODEL IS.
//
// SHARED, AND THAT IS WHY IT IS ITS OWN FILE. It lived in `extraction-shape.ts`
// beside the rate confirmation's fields, which was correct while a rate
// confirmation was the only document this system read. The CDL shape imports
// it too now, and moving the pair under a rate-con name would have dragged the
// common part beneath one document's title — a shared idea filed under a
// specific one, which is the shape somebody grep-searching for "the envelope"
// never finds.
//
// EVERY FIELD IS A `Field<T>`, NOT A BARE VALUE, and the reason is the same for
// every document type. A document from a source nobody has seen before will
// have fields the model is sure about — a licence number in 14pt — and fields
// it is guessing at, a delivery window written as "Tue AM" or a digit under
// glare. Collapsing those into one shape is how a guess gets typed into a
// record and nobody knows which one it was. Confidence travels with the value
// so the form can mark the doubtful ones and the refusal rules can weigh them.
// ---------------------------------------------------------------------------

/** How sure the model is. Three buckets, because a percentage invites false precision. */
export type Confidence = 'high' | 'medium' | 'low'

export const CONFIDENCES: readonly Confidence[] = ['high', 'medium', 'low']

export interface Field<T> {
  value: T
  confidence: Confidence
  /** Where on the document it was read, when the model can say. For a human. */
  note?: string
}

/** A field the document did not carry. Absent, never a guessed default. */
export type Maybe<T> = Field<T> | null
