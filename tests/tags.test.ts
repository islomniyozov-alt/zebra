import { describe, expect, it } from 'vitest'
import { parseTags, tagsToInput } from '@/lib/tags'
import { tagsFrom } from '@/lib/datatruck/loads'

// ---------------------------------------------------------------------------
// TAGS, ONE RULE (queue item 17). The form and the import split the same way,
// so a tag typed and a tag imported are the same tag.
// ---------------------------------------------------------------------------

describe('parseTags', () => {
  it('splits on commas, trims, drops empties and duplicates', () => {
    expect(parseTags(' hazmat, team ,,hazmat, ')).toEqual(['hazmat', 'team'])
  })

  it('keeps a tag that legitimately contains another separator', () => {
    // Guessing a second separator would split "no-touch freight" or
    // "Owner/Op" into tags nobody typed.
    expect(parseTags('no-touch freight; Owner/Op')).toEqual([
      'no-touch freight; Owner/Op',
    ])
  })

  it('reads nothing from nothing, whatever shape nothing arrives in', () => {
    expect(parseTags('')).toEqual([])
    expect(parseTags('  ')).toEqual([])
    expect(parseTags(null)).toEqual([])
    expect(parseTags(undefined)).toEqual([])
    expect(parseTags(42)).toEqual([])
  })

  it('is the rule the import uses', () => {
    const raw = 'Amazon, Relay ,amazon,, drop'
    expect(tagsFrom(raw)).toEqual(parseTags(raw))
  })

  it('round-trips through the one text field', () => {
    const tags = ['hazmat', 'team']
    expect(parseTags(tagsToInput(tags))).toEqual(tags)
    expect(tagsToInput([])).toBe('')
  })
})
