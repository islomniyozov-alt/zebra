import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

// THE BATCH PREVIEW'S ORDER IS TOTAL (2026-11-17). Load numbers are per
// authority, so two authorities' 1001 tie, and both reads ordered by
// loadNumber alone — Postgres broke the tie either way, and deploy production
// run 44095305838 failed tests/integration/batch-page-head.test.ts when the
// two spellings broke it differently. That test sees the defect only when the
// coin lands wrong; this one sees it every time.

const source = readFileSync('src/lib/batch-preview.ts', 'utf8')

describe('the batch preview orders by load number, then id, in both spellings', () => {
  it('the Prisma read', () => {
    expect(source).toContain("orderBy: [{ loadNumber: 'asc' }, { id: 'asc' }],")
    expect(source).not.toMatch(/orderBy: \{ loadNumber: 'asc' \},/)
  })

  it('and the SQL read, the same way', () => {
    expect(source).toMatch(/ORDER BY l\."loadNumber", l\.id\s+LIMIT 2000/)
  })
})
