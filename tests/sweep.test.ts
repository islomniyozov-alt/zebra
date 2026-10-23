import { readdirSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
// A plain .mjs script, imported for its pure functions rather than copied into
// TypeScript — a copy is what makes a guard test something other than the thing
// that ships. It resolves without a directive, so there is none: an unnecessary
// `@ts-expect-error` is itself a type error here, which is the compiler making
// the same point this file makes about guards that assert nothing.
import {
  classify,
  credentialsFor,
  duplicateMatches,
  knownGap,
  MATRIX_ROLES,
  markFor,
  matrixFindings,
  outcomeOf,
  readRouteMatrix,
  routesUnder,
  SIGN_IN_ATTEMPTS,
  tally,
  WARM_UP_WINDOW_MS,
  warmUp,
} from '../scripts/sweep.mjs'

// §6.8, owner's ruling 2026-10-12 (closing GAPS 24): the sweep measures the
// application, not Neon waking up. One direct SELECT 1 and one GET /login
// answered 200, BEFORE the id-resolving connection that would otherwise be
// the wake-up nobody measured; both wall times go in the verdict file.
describe('the warm-up', () => {
  it('runs before the ids are resolved, and its record reaches the verdict file', () => {
    const script = readFileSync('scripts/sweep.mjs', 'utf8')
    expect(script).toMatch(
      /const coldStart = await warmUp\(pool, BASE\)[\s\S]*?await resolveIds\(pool\)/,
    )
    expect(script).toMatch(/coldStart,\s*signIns,\s*serverErrors,/)
    expect(WARM_UP_WINDOW_MS).toBe(120_000)
  })

  it('records both wall times and the status it stopped on', async () => {
    const pool = { query: async () => ({ rows: [{ '?column?': 1 }] }) }
    const fetchImpl = async () =>
      new Response('ok', { status: 200 }) as unknown as Response
    const cold = await warmUp(pool, 'https://zebra-dev.example.workers.dev', {
      fetchImpl,
    })
    expect(cold.loginStatus).toBe(200)
    expect(cold.directMs).toBeGreaterThanOrEqual(0)
    expect(cold.loginMs).toBeGreaterThanOrEqual(0)
    expect(typeof cold.at).toBe('string')
  })
})

// GAPS 26's first three sweeps recorded no GET at all and a browser POST
// duration on 2 of 21: the context closed the moment the URL changed, before
// the redirect target finished, and a 303 has no `responseEnd`. Both fixes
// are pinned here, because a sweep that silently measures nothing is the
// failure this whole instrument exists to prevent.
describe('the two-request capture', () => {
  const script = readFileSync('scripts/sweep.mjs', 'utf8')

  it('waits for the redirect target to load before the context closes', () => {
    expect(script).toMatch(
      /row\.outcome = 'ok'[\s\S]*?waitForLoadState\('load', \{ timeout: 60_000 \}\)[\s\S]*?signIns\.push\(row\)/,
    )
  })

  it('measures the render on its own GET, by that GET’s ray, with no window', () => {
    // §6.10, owner's ruling 2026-10-23: nothing written during the render
    // inside the sign-in POST reaches the tail, so after each sign-in the
    // sweep GETs /dashboard with the new session and reads that invocation.
    expect(script).toMatch(
      /if \(found\) row\.renderGet = await timedGet\('\/dashboard', found\)/,
    )
    expect(script).toMatch(
      /const render = row\.renderGet\?\.ray \? tail\.lookup\(row\.renderGet\.ray\) : null/,
    )
    expect(script).not.toMatch(/renderFrom|renderTo|isRedirectRender/)
  })

  it('two sign-ins matched to one invocation is a problem, by name', () => {
    const rows = [
      { role: 'owner', attempt: 1, matchedRays: ['a1'] },
      { role: 'admin', attempt: 1, matchedRays: ['b2'] },
      { role: 'manager', attempt: 1, matchedRays: ['a1'] },
    ]
    const shared = duplicateMatches(rows)
    expect([...shared.keys()]).toEqual(['a1'])
    expect(shared.get('a1')!.map((row: { role: string }) => row.role)).toEqual([
      'owner',
      'manager',
    ])
    expect(duplicateMatches(rows.slice(0, 2)).size).toBe(0)
    expect(script).toMatch(
      /const shared = duplicateMatches\(signIns\)[\s\S]*?sums\.problems \+= shared\.size/,
    )
  })

  it('falls back to responseStart for a redirect, and says which it read', () => {
    expect(script).toMatch(
      /timing\.responseEnd >= 0\s*\?\s*Math\.round\(timing\.responseEnd\)\s*:\s*timing\.responseStart >= 0\s*\?\s*Math\.round\(timing\.responseStart\)/,
    )
    expect(script).toContain('row.postMsKind = msKind')
    expect(script).toContain('getMsKind: msKind')
  })
})

// Owner's brief, 2026-10-11: a stalled sign-in names its role and is retried
// once — once, because a sweep that retried until it got in would sweep a dev
// that cannot sign anybody in.
describe('a stalled sign-in', () => {
  it('is retried once and no more', () => {
    expect(SIGN_IN_ATTEMPTS).toBe(2)
  })

  it('names the role in both messages, and the last one is NOT OK', () => {
    const script = readFileSync('scripts/sweep.mjs', 'utf8')
    expect(script).toContain(
      '`${label} SIGN-IN STALLED, ${attempt} of ${SIGN_IN_ATTEMPTS} attempts: ${reason}. NOT OK.`',
    )
    expect(script).toContain(
      '`${label} sign-in stalled (attempt ${attempt} of ${SIGN_IN_ATTEMPTS}): ${reason} — retrying once.`',
    )
  })
})

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

  it('and its row is not labelled FAIL', () => {
    // The 2026-10-10 sweep printed two FAIL rows above "0 PROBLEMS".
    expect(markFor(classify(307, ''))).toBe('redir')
    expect(markFor(classify(200, ''))).toBe('ok   ')
    expect(markFor(classify(500, ''))).toBe('FAIL ')
    expect(markFor(classify(404, ''))).toBe('FAIL ')
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

// ---------------------------------------------------------------------------
// THE ROUTE MATRIX (TMS-DESIGN-SYSTEM.md §6.8, 2026-10-10).
//
// The sweep reads the table out of the design system, so these read it the same
// way and hold it to the filesystem: every protected page has exactly one row,
// and every row is a page. A new page with no decision about who may open it
// fails here by name, before any sweep runs.
// ---------------------------------------------------------------------------

const PUBLIC = new Set(['/login', '/reset-password', '/reset-password/[token]'])
const MATRIX = readRouteMatrix(readFileSync('TMS-DESIGN-SYSTEM.md', 'utf8'))

describe('the route matrix covers every protected page, and only those', () => {
  const protectedRoutes = ROUTES.filter((route) => !PUBLIC.has(route))

  it('reads the rows out of the design system', () => {
    expect(MATRIX.size).toBe(protectedRoutes.length)
    // 54 at §6.8's writing; 55 since §6.9's testing summary (2026-10-11). A
    // pinned number so a page cannot appear or vanish without this line moving.
    expect(protectedRoutes.length).toBe(55)
  })

  it.each(ROUTES.filter((route) => !PUBLIC.has(route)))(
    '%s has a row',
    (route) => {
      expect(MATRIX.has(route)).toBe(true)
    },
  )

  it('and names no page that does not exist', () => {
    expect(
      [...MATRIX.keys()].filter((route) => !ROUTES.includes(route)),
    ).toEqual([])
  })

  it('speaks only the three words, in every role column', () => {
    expect(MATRIX_ROLES).toEqual([
      'owner',
      'admin',
      'manager',
      'dispatcher',
      'accounting',
      'driver',
    ])
    for (const [route, row] of MATRIX) {
      for (const role of MATRIX_ROLES) {
        expect(['reach', 'refuse', 'redirect'], `${route} ${role}`).toContain(
          (row as Record<string, string>)[role],
        )
      }
    }
  })

  it('reads columns by header, so a reordered table cannot swap two roles', () => {
    // THE FAILURE THIS GUARDS: the table grew from two columns to six, and a
    // positional parser read the admin column as the dispatcher's.
    const table = [
      '<!-- route-matrix:start -->',
      '| Route | Driver | Owner | Note | Admin | Manager | Dispatcher | Accounting |',
      '| --- | --- | --- | --- | --- | --- | --- | --- |',
      '| `/x` | refuse | reach | n | reach | reach | refuse | reach |',
      '<!-- route-matrix:end -->',
    ].join('\n')
    const row = readRouteMatrix(table).get('/x') as Record<string, string>
    expect(row.driver).toBe('refuse')
    expect(row.owner).toBe('reach')
    expect(row.dispatcher).toBe('refuse')
    expect(row.note).toBe('n')
    expect(() =>
      readRouteMatrix(table.replace('| Dispatcher ', '| Nobody ')),
    ).toThrow(/dispatcher/)
  })

  it('a driver reaches nothing org-wide: only their own account', () => {
    // The owner's words, 2026-10-10. Every one of these pages is org-wide.
    const reached = [...MATRIX]
      .filter(([, row]) => (row as Record<string, string>).driver === 'reach')
      .map(([route]) => route)
    expect(reached).toEqual(['/account'])
  })

  it('credentials come from SEED_<ROLE>_EMAIL / _PASSWORD', () => {
    expect(
      credentialsFor('accounting', {
        SEED_ACCOUNTING_EMAIL: 'a@x.test',
        SEED_ACCOUNTING_PASSWORD: 'p',
      }),
    ).toEqual({ email: 'a@x.test', password: 'p' })
  })

  it('refuses without markers rather than checking an empty matrix', () => {
    expect(() => readRouteMatrix('# no table here')).toThrow(/markers/)
  })
})

describe('a disagreement with the matrix', () => {
  const matrix = new Map([
    [
      '/payroll/batches',
      { owner: 'reach', dispatcher: 'refuse', note: 'Payroll' },
    ],
    [
      '/safety/random',
      { owner: 'reach', dispatcher: 'refuse', note: 'GAPS 12' },
    ],
  ])

  it('maps a verdict to the matrix words', () => {
    expect(outcomeOf('ok')).toBe('reach')
    expect(outcomeOf('CLIENT ERROR 404')).toBe('refuse')
    expect(outcomeOf('redirect')).toBe('redirect')
    expect(outcomeOf('SERVER ERROR')).toBe('error')
    expect(knownGap('flagged — GAPS 12')).toBe('GAPS 12')
    expect(knownGap('Payroll')).toBeNull()
  })

  it('is NEW and fails the sweep unless the row names a GAPS row', () => {
    const findings = matrixFindings(
      [
        // A dispatcher who can open payroll: the failure this exists for.
        {
          route: '/payroll/batches',
          role: 'dispatcher',
          status: 200,
          verdict: 'ok',
        },
        // Known: the row says which GAPS row carries it.
        {
          route: '/safety/random',
          role: 'dispatcher',
          status: 200,
          verdict: 'ok',
        },
        // Agreeing rows are not findings.
        {
          route: '/payroll/batches',
          role: 'owner',
          status: 200,
          verdict: 'ok',
        },
      ],
      matrix,
    )
    expect(findings).toHaveLength(2)
    const sums = tally({ authed: [], anon: [], unresolved: [], findings })
    expect(sums.fresh.map((row) => row.route)).toEqual(['/payroll/batches'])
    expect(sums.known.map((row) => row.route)).toEqual(['/safety/random'])
    expect(sums.problems).toBe(1)
  })

  it('but a server error is never known, whatever the row says', () => {
    const findings = matrixFindings(
      [
        {
          route: '/safety/random',
          role: 'dispatcher',
          status: 500,
          verdict: 'SERVER ERROR',
        },
      ],
      matrix,
    )
    const sums = tally({ authed: [], anon: [], unresolved: [], findings })
    expect(sums.known).toEqual([])
    expect(sums.problems).toBe(1)
  })

  it('and a page with no row is a finding too', () => {
    const findings = matrixFindings(
      [{ route: '/new-page', role: 'dispatcher', status: 200, verdict: 'ok' }],
      matrix,
    )
    expect(findings[0]?.expected).toBe('(no row)')
    expect(
      tally({ authed: [], anon: [], unresolved: [], findings }).problems,
    ).toBe(1)
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
