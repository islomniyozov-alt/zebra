// ---------------------------------------------------------------------------
// TAGS, ONE RULE. Free text split on commas, trimmed, emptied and de-duplicated
// — the rule the Datatruck import has used since item 9 (`tagsFrom` in
// `datatruck/loads.ts` delegates here). A tag typed on the driver form and a
// tag imported from the export are the same tag, because they went through
// the same function. Queue item 17.
//
// COMMAS ONLY. Guessing a second separator would silently split a tag that
// legitimately contains one.
// ---------------------------------------------------------------------------

export function parseTags(value: unknown): string[] {
  if (typeof value !== 'string' || value.trim() === '') return []
  return [
    ...new Set(
      value
        .split(',')
        .map((tag) => tag.trim())
        .filter((tag) => tag !== ''),
    ),
  ]
}

/** The stored list back into the one text field, for the form's value. */
export function tagsToInput(tags: readonly string[]): string {
  return tags.join(', ')
}
