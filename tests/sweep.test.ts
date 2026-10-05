import { readdirSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
// A plain .mjs script, imported for its pure functions rather than copied into
// TypeScript — a copy is what makes a guard test something other than the thing
// that ships. It resolves without a directive, so there is none: an unnecessary
// `@ts-expect-error` is itself a type error here, which is the compiler making
// the same point this file makes about guards that assert nothing.
import { classify, routesUnder, tally } from '../scripts/sweep.mjs'

// ---------------------------------------------------------------------------
// THE SWEEP'S ARITHMETIC, WITHOUT A WORKER.
//
// `npm run sweep` needs a deployed worker and a session, so it cannot run in
// `npm run check`. What CAN run here is the part that decides OK from NOT OK —
// and that is the part whose failure would be invisible, because a sweep that
// quietly classified a 500 as fine would print a clean verdict forever.
//
// THE LIST OF ROUTES IS THE OTHER HALF. It is derived from the filesystem
// precisely so that a new page cannot escape it; a test that hard-coded the
// expected routes would have to be edited every time a page is added, which is
// the same hand-maintained list this script exists to replace. So these assert
// the DERIVATION RULES instead: groups contribute nothing, every `page.tsx` is
// present, and nothing else is.
// ---------------------------------------------------------------------------

const ROUTES: string[] = routesUnder('src/app')

describe('the routes come from the filesystem', () => {
  it('finds one route per page.tsx, and no more', () => {
    // Counted from the artefact with a different method than the script uses:
    // a recursive glob over the same tree. Two readings of the same directory.
    const pages = globPages('src/app')
    expect(ROUTES.length).toBe(pages.length)
  })

  it('strips route groups, which is the rule a hand-written list gets wrong', () => {
    // `src/app/(app)/loads/page.tsx` serves `/loads`, not `/(app)/loads`.
    expect(ROUTES.some((route) => route.includes('('))).toBe(false)
    expect(ROUTES).toContain('/loads')
    expect(ROUTES).toContain('/login')
  })

  it('keeps dynamic segments as segments, so they can be resolved', () => {
    expect(ROUTES).toContain('/loads/[id]')
    expect(ROUTES).toContain('/reset-password/[token]')
  })

  it('and includes the three screens that were returning 500', () => {
    // THE WHOLE REASON THIS SCRIPT EXISTS. Not a tautology: `/payroll/batches`
    // is the one no instrument covered, and the live check's six-route list
    // still does not name it.
    expect(ROUTES).toContain('/trucks')
    expect(ROUTES).toContain('/loads')
    expect(ROUTES).toContain('/payroll/batches')
  })
})

describe('what a response means', () => {
  it('a 5xx is a server error', () => {
    expect(classify(500, '')).toBe('SERVER ERROR')
    expect(classify(503, '')).toBe('SERVER ERROR')
  })

  it('and so is a 200 that rendered the error boundary', () => {
    // THE CASE A STATUS LINE CANNOT SEE. Next can answer 200 with
    // `src/app/error.tsx` in the body.
    expect(classify(200, '<h1>Something went wrong on our side</h1>')).toBe(
      'ERROR BOUNDARY',
    )
  })

  it('the words it looks for are the words that page actually renders', () => {
    // A REWORDED ERROR PAGE WOULD TURN THE CHECK ABOVE OFF SILENTLY, and the
    // sweep would then report every broken screen as healthy — the one failure
    // mode that is worse than no sweep.
    const page = readFileSync('src/app/error.tsx', 'utf8')
    expect(page).toContain('Something went wrong on our side')
    expect(readFileSync('scripts/sweep.mjs', 'utf8')).toContain(
      'Something went wrong on our side',
    )
  })

  it('a redirect is neither a fault nor a render', () => {
    expect(classify(307, '')).toBe('redirect')
  })

  it('and a 4xx says which', () => {
    expect(classify(404, '')).toBe('CLIENT ERROR 404')
  })
})

describe('the verdict', () => {
  const ok = { route: '/a', verdict: 'ok' }

  it('is clean when every page rendered and every stranger was refused', () => {
    const sums = tally({
      authed: [ok, { route: '/b', verdict: 'ok' }],
      anon: [
        { route: '/a', refused: true },
        { route: '/b', refused: true },
      ],
      unresolved: [],
    })
    expect(sums.problems).toBe(0)
    expect(sums.rendered).toBe(2)
  })

  it('counts a server error', () => {
    const sums = tally({
      authed: [ok, { route: '/b', verdict: 'SERVER ERROR' }],
      anon: [],
      unresolved: [],
    })
    expect(sums.problems).toBe(1)
    // AND IT IS NOT COUNTED AS RENDERED, which is the arithmetic that made the
    // first draft print "55 answered" beside "0 problems".
    expect(sums.rendered).toBe(1)
  })

  it('counts a page a stranger could read', () => {
    const sums = tally({
      authed: [ok],
      anon: [{ route: '/secret', refused: false }],
      unresolved: [],
    })
    expect(sums.problems).toBe(1)
  })

  it('counts a page that was never fetched at all', () => {
    // "WE DID NOT LOOK" IS NOT "WE LOOKED AND IT WAS FINE". A dynamic route with
    // no row behind it is the common case, and the temptation is to treat it as
    // a pass because nothing failed.
    const sums = tally({
      authed: [ok],
      anon: [{ route: '/a', refused: true }],
      unresolved: ['/claims/[id] (no Claim row in this organization)'],
    })
    expect(sums.problems).toBe(1)
  })

  it('and does not count a redirect', () => {
    const sums = tally({
      authed: [ok, { route: '/login', verdict: 'redirect' }],
      anon: [],
      unresolved: [],
    })
    expect(sums.problems).toBe(0)
    expect(sums.redirects.length).toBe(1)
  })
})

/** A second reading of the same tree, so the count above is not self-confirming. */
function globPages(root: string): string[] {
  const out: string[] = []
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.isDirectory()) walk(`${dir}/${entry.name}`)
      else if (entry.name === 'page.tsx') out.push(`${dir}/${entry.name}`)
    }
  }
  walk(root)
  return out
}
