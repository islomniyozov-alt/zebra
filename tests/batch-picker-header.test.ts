import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { UNAVAILABLE_REASONS } from '@/lib/batch-preview'

// ---------------------------------------------------------------------------
// §6.2.10 PART 1 — "0 AVAILABLE" NEVER STANDS ALONE (queue item 20 (7)).
// The picker's header names the buckets that took the rest, with their counts,
// in the picker's order, through the ONE reason-label map the groups below use.
// ---------------------------------------------------------------------------

const page = readFileSync(
  join('src', 'app', '(app)', 'payroll', 'batches', 'new', 'page.tsx'),
  'utf8',
)
const doc = readFileSync('TMS-DESIGN-SYSTEM.md', 'utf8')

describe('the header line', () => {
  it('says how many are available, beside how many were considered', () => {
    expect(page).toContain(
      "{t('preview.considered')} {data.preview.considered}",
    )
    expect(page).toContain('{data.preview.available.length}')
    expect(page).toContain("{t('preview.available').toLowerCase()}")
  })

  it("names every non-empty bucket in the picker's order, by the one label map", () => {
    // The same `UNAVAILABLE_REASONS` and the same `REASON_LABEL` the groups
    // below render through, so the line and the groups cannot disagree about
    // what a bucket is called or which come first.
    expect(page).toMatch(
      /UNAVAILABLE_REASONS\.filter\(\s*\(reason\) => data\.preview\.unavailable\[reason\]\.length > 0,?\s*\)\.map\(/,
    )
    expect(page).toContain('{data.preview.unavailable[reason].length}')
    expect(page).toContain('{t(REASON_LABEL[reason]).toLowerCase()}')
    // Five buckets in the lib, five labels in the page's map — the guard the
    // accounting-surface suite already keeps; restated here by count.
    const labelled = UNAVAILABLE_REASONS.filter((reason) =>
      page.includes(`${reason}: 'preview.reason.${reason}'`),
    )
    expect(labelled.length).toBe(UNAVAILABLE_REASONS.length)
  })

  it('is specified before the code', () => {
    expect(doc).toContain('**"0 available" never stands alone.**')
  })
})
