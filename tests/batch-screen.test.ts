import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

// ---------------------------------------------------------------------------
// §6.2.10 PART 2b — THE BATCH ROUTE IS THE BATCH SCREEN (queue item 20 (1)).
// Held to the doc in source: the grid lives once, the route reads its own
// batch, the Statement column links to the statement, Open a batch lands here.
// ---------------------------------------------------------------------------

const app = (...parts: string[]) =>
  readFileSync(join('src', 'app', '(app)', ...parts), 'utf8')

const batchPage = app('settlements', 'batches', '[id]', 'page.tsx')
const picker = app('payroll', 'batches', 'new', 'page.tsx')
const grid = app('payroll', 'batches', 'BatchTripsGrid.tsx')
const openAction = app('payroll', 'batches', 'actions.ts')
const batchActions = app('settlements', 'batches', 'actions.ts')
const doc = readFileSync('TMS-DESIGN-SYSTEM.md', 'utf8')

describe('the batch screen', () => {
  it('is specified before the code', () => {
    expect(doc).toContain('**2b — The batch route IS the batch screen.**')
  })

  it('renders the part 1 grid for its own batch, ticks from the exclusions', () => {
    expect(batchPage).toContain('<BatchTripsGrid')
    expect(batchPage).toMatch(
      /previewBatch\(tx, \{[\s\S]*?forBatchId: batch\.id/,
    )
    expect(batchPage).toContain('defaultCheckedFor: (row) => !row.excluded')
    expect(batchPage).toContain('<BatchTicks')
  })

  it('links the Statement column to the statement in every status', () => {
    expect(batchPage).toContain('href={`/settlements/${settlement.id}`}')
    // The PDF link and the "Refresh draft" placeholder are gone from this
    // column: the statement page owns its export.
    expect(batchPage).not.toContain('/api/settlements/statement/')
    expect(batchPage).not.toMatch(/batch\.status === 'DRAFT' \? \(\s*<span/)
  })

  it('has one grid for the picker and the screen', () => {
    expect(picker).toContain('<BatchTripsGrid')
    expect(picker).not.toMatch(/Column<PreviewTrip>/)
    expect(grid).toContain("key: 'loadNumber'")
    expect(grid).toContain("key: 'locations'")
    // Nine columns, §7.1's cap exactly (§6.2.10 part 1).
    expect(grid.match(/^\s{4}\{\n\s{6}key: '/gm)?.length).toBe(9)
    // A trip nobody can price is not offered, on both screens, by the one rule.
    expect(grid).toContain('offerFor: (row) => row.loadPayCents !== null')
  })

  it('writes the ticks as a delta through the two exclusion verbs', () => {
    expect(batchActions).toMatch(/setExclusions\(tx, \{/)
    const lib = readFileSync(join('src', 'lib', 'batch-exclusions.ts'), 'utf8')
    const body = lib.slice(lib.indexOf('export async function setExclusions'))
    expect(body).toContain('await excludeTrips(tx, {')
    expect(body).toContain('await includeTrips(tx, {')
    // Nothing writes the exclusion table from here directly.
    expect(body).not.toMatch(/settlementBatchExclusion\.(create|delete)/)
  })

  it('lands Open a batch on the batch, opened or already covering the week', () => {
    expect(openAction).toContain(
      'redirect(`/settlements/batches/${outcome.batchId}`)',
    )
    expect(openAction).toContain(
      'redirect(`/settlements/batches/${outcome.reason.batchId}`)',
    )
  })
})
