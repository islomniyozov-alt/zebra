import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  LOAD_VIEWS,
  isLoadViewName,
  viewWhere,
  type LoadViewName,
} from '@/lib/load-views'

// ---------------------------------------------------------------------------
// THE NAMED VIEWS, AND THE THREE THINGS THE AGREEMENT TEST CANNOT SEE.
//
// `tests/integration/dashboard.test.ts` proves each Needs-you count equals what
// its destination lists. That is the owner's ruling and it holds — but
// `watch-guard` refused three breaks against it, and each refusal was correct
// and worth writing down.
//
//   "podMissing's view forgets closed history" DID NOT FIRE, because the count
//   and the destination BOTH call `podMissingWhere`. Break the shared function
//   and both sides move together, so they still agree. AGREEMENT AND
//   CORRECTNESS ARE DIFFERENT CLAIMS: one function with two readers can only
//   ever prove the readers match. What the predicate SAYS is guarded in the
//   integration file's closed-history describe, which seeds an archived load
//   and requires the count not to move.
//
//   "the loads list stops resolving the named view" DID NOT FIRE, because the
//   integration test calls `viewWhere` itself rather than rendering the page.
//   So the page could stop applying the view entirely and nothing would notice
//   — which is the same mistake the ruling corrected one level up: testing a
//   function instead of the destination. Guarded below BY READING THE SOURCE,
//   and that is admitted to be a source check rather than behaviour.
//
//   "an unknown view name narrows to nothing" DID NOT FIRE, because no test
//   passes one. Guarded below.
// ---------------------------------------------------------------------------

const LOADS_PAGE = join(
  process.cwd(),
  'src',
  'app',
  '(app)',
  'loads',
  'page.tsx',
)

describe('an unknown view narrows nothing', () => {
  // A TYPO'D VIEW MUST NOT RETURN AN IMPOSSIBLE PREDICATE. An empty list reads
  // as "no loads are in this state" — a confident answer to a question nobody
  // asked. An unfiltered list is obviously not what was meant.
  it.each(['podmissing', 'POD_MISSING', 'nope', '', 'podMissing '])(
    '%s resolves to an empty where, not an impossible one',
    (name) => {
      expect(viewWhere(name)).toEqual({})
    },
  )

  it('and undefined does the same, which is the no-view case', () => {
    expect(viewWhere(undefined)).toEqual({})
  })

  // THE CASE-SENSITIVITY IS DELIBERATE and asserted so it cannot drift into a
  // fuzzy match: the names are URL tokens the dashboard writes, not something a
  // person types.
  it('recognises exactly the registry names', () => {
    for (const name of Object.keys(LOAD_VIEWS)) {
      expect(isLoadViewName(name)).toBe(true)
      expect(viewWhere(name)).not.toEqual({})
    }
    expect(isLoadViewName('podmissing')).toBe(false)
  })
})

describe('every view excludes the archive', () => {
  // CLOSED HISTORY IS IN NO QUEUE. 13,517 loads on dev ran, were billed and
  // were paid in another system; `billing-status.ts` records what counting them
  // cost once already — "14,346 delivered, waiting on a POD", which is not a
  // queue anybody can work.
  //
  // ASSERTED ON THE PREDICATE ITSELF, per view, because the agreement test
  // cannot: both of its sides call these functions.
  it.each(Object.keys(LOAD_VIEWS) as LoadViewName[])(
    '%s carries the billing-axis clause',
    (name) => {
      expect(viewWhere(name)).toMatchObject({
        billingStatus: { not: 'CLOSED_IN_DATATRUCK' },
      })
    },
  )

  it('and none of them is soft-deleted freight', () => {
    for (const name of Object.keys(LOAD_VIEWS)) {
      expect(viewWhere(name)).toMatchObject({ deletedAt: null })
    }
  })
})

describe('the loads list resolves the view it is given', () => {
  // ── A SOURCE CHECK, AND IT SAYS SO ──────────────────────────────────────
  //
  // The behavioural version needs the page rendered with a request, a session
  // and seeded money — which is the reason `accounting-surface.test.ts` reads
  // source for the same class of claim. What this catches is the page quietly
  // stopping: `watch-guard` replaced `viewWhere(viewParam)` with `{}` and the
  // integration suite stayed green, because it calls `viewWhere` directly.
  const source = readFileSync(LOADS_PAGE, 'utf8')

  it('reads ?view= and resolves it through viewWhere', () => {
    expect(source).toContain("typeof params['view'] === 'string'")
    expect(source).toContain('viewWhere(viewParam)')
  })

  // BOTH QUERIES, NOT ONE. The count feeds the footer and the findMany feeds
  // the rows; applying the view to only one produces "1–50 of 13,500" over a
  // list of 101 — the same disagreement the ruling closed, one level down.
  it('applies it to the row query AND the matching count', () => {
    const spreads = [...source.matchAll(/\.\.\.namedView/g)]
    expect(spreads.length).toBeGreaterThanOrEqual(2)
  })

  it('and the dashboard links by name, never by a raw filter', () => {
    const dashboard = readFileSync(
      join(process.cwd(), 'src', 'lib', 'dashboard.ts'),
      'utf8',
    )
    // THE RULING: no raw filter params in URLs. A row linking at
    // `?status=DELIVERED` is the shape that disagreed with its own count.
    const loadHrefs = [...dashboard.matchAll(/href: '\/loads\?([^']+)'/g)].map(
      (hit) => hit[1]!,
    )
    expect(loadHrefs.length).toBeGreaterThan(0)
    for (const query of loadHrefs) {
      expect(query, `/loads?${query} is not a named view`).toMatch(
        /^view=[A-Za-z]+$/,
      )
      expect(isLoadViewName(query.slice('view='.length))).toBe(true)
    }
  })
})
