import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

// ---------------------------------------------------------------------------
// TWO GROUPS, SIX DESTINATIONS, AND EVERY GRID CARRIES THE SAME CONTROLS.
//
// ── WHY THIS IS A SOURCE CHECK ────────────────────────────────────────────
//
// The ruling is about what each screen OFFERS: search, sort, a date range, a
// company filter, a sticky header, a totals row, a columns chooser, export and
// pagination. A behavioural test would need a browser, a session and seeded
// money on every one of them, which is the reason nothing checked the old Money
// section's shape either.
//
// So this reads the pages. It is the "count the thing you are claiming"
// instrument: the claim is about these six files, so these six files are what is
// counted — and every exception is named rather than quietly permitted.
//
// ── REWRITTEN 2026-09-28 FOR THE SPLIT ────────────────────────────────────
//
// It described one Accounting directory of five pages, and §6.2 now has
// Accounting (Invoices, Payments, Reports) and Payroll (Batches, Statements,
// Charges). Thirty-three of its cases failed on the move, which is the shape a
// guard SHOULD fail in: loudly, naming each page, rather than passing because it
// found nothing.
// ---------------------------------------------------------------------------

const APP = join(process.cwd(), 'src', 'app', '(app)')
const ACCOUNTING = join(APP, 'accounting')
const PAYROLL = join(APP, 'payroll')

/** Every destination, as `[group directory, segment]`. */
const PAGES = [
  [ACCOUNTING, 'invoices'],
  [ACCOUNTING, 'payments'],
  [ACCOUNTING, 'reports'],
  [PAYROLL, 'batches'],
  [PAYROLL, 'statements'],
  [PAYROLL, 'charges'],
] as const

const NAMES = PAGES.map(([, name]) => name)

const dirOf = (name: string) => {
  const found = PAGES.find(([, segment]) => segment === name)
  if (!found) throw new Error(`no such destination: ${name}`)
  return found[0]
}

const pageSource = (name: string) =>
  readFileSync(join(dirOf(name), name, 'page.tsx'), 'utf8')

describe('the six destinations exist', () => {
  it('is exactly six, in two groups, with nothing extra alongside them', () => {
    const accounting = readdirSync(ACCOUNTING, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort()
    const payroll = readdirSync(PAYROLL, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort()

    // §6.2's table is six destinations, each answering something the other five
    // do not. A seventh has to change that table first.
    expect(accounting).toEqual(['invoices', 'payments', 'reports'])
    expect(payroll).toEqual(['batches', 'charges', 'statements'])

    for (const name of NAMES) {
      expect(existsSync(join(dirOf(name), name, 'page.tsx')), name).toBe(true)
    }
  })

  it('keeps the shared grid machinery out of both groups', () => {
    // `_grid` is private to the router (leading underscore) and belongs to
    // neither group, because both use it. Living under `accounting/` — where it
    // started — would have made Payroll import across a sibling section for its
    // own header.
    const shared = readdirSync(join(APP, '_grid')).sort()
    expect(shared).toContain('PageHeader.tsx')
    expect(shared).toContain('GridToolbar.tsx')
    expect(shared).toContain('grid-page.ts')
    // And the CSV route is neither group's either.
    expect(existsSync(join(APP, 'exports', 'route.ts'))).toBe(true)
  })

  it('gives every destination a breadcrumb naming its group', () => {
    // §6.2.1 — two groups, six destinations and eleven tabs is where "where am
    // I" stops being obvious. The group name is the first crumb.
    for (const name of NAMES) {
      expect(pageSource(name), name).toContain('breadcrumb={[')
    }
  })
})

// ── EVERY LIST READS THE SHARED CONTROLS ────────────────────────────────────
//
// Five screens parsing `?from=` for themselves is five chances to disagree about
// whether the bound is inclusive — and MONEY-DESIGN §0 is the standing lesson
// about a day's slip on a week boundary looking like nothing.
describe('every page uses the shared list core', () => {
  it.each([...NAMES])('%s reads its params through list-view', (name) => {
    const source = pageSource(name)
    expect(source).toContain("from '@/lib/list-view'")
    // EITHER ENTRY POINT. `gridView` calls `readListParams` itself and adds the
    // filter/sort/paginate order that §7.1.3 depends on; a page calling
    // `readListParams` directly is the simpler form for a grid with no pages.
    // What is forbidden is neither.
    //
    // THE IMPORT, NOT THE CALL. Written as `toMatch(/gridView\(|readListParams\(/)`
    // this guard did not fire when the import was deleted — the call sites still
    // matched the text, so a page that could not compile still "used the shared
    // core" as far as the instrument could tell. An import is the dependency; a
    // string that looks like a call is a string.
    expect(source).toMatch(
      /import \{[^}]*\bgridView\b[^}]*\} from '[./]*_grid\/grid-page'|import \{[^}]*\breadListParams\b[^}]*\} from '@\/lib\/list-view'/s,
    )
  })

  it.each([...NAMES])('%s does not parse a date bound by hand', (name) => {
    // The shape `new Date(`${x}T00:00:00` )` in a page is the copy this module
    // exists to prevent. `payroll` and `reports` legitimately build instants, but
    // from a WEEK or a default window, never from `from`/`to`.
    const source = pageSource(name)
    expect(source).not.toMatch(/params\.(from|to)\s*\?\?\s*new Date\(`/)
  })
})

// ── SEARCH, SORT, TOTALS, RANGE, COMPANY — AND THE EXCEPTIONS, BY NAME ──────
//
// A blanket "every page has all six" would be false, and a test written to be
// true of whatever shipped would be no instrument at all. So each exception is
// listed with its reason and asserted to STILL be the exception.
describe('the controls each list carries', () => {
  const LISTS = [
    'invoices',
    'payments',
    'batches',
    'statements',
    'charges',
  ] as const

  // ── ANCHORED ON THE PROP, NOT ON A SUBSTRING ────────────────────────────
  //
  // These read `toContain('search={{')` and `toContain('totals={{')` first, and
  // the break harness caught what that meant: `xsearch={{` CONTAINS `search={{`,
  // so renaming the prop left the guard reporting nothing wrong with a page that
  // had lost its search box entirely. Two of seven breaks "did not fire", and the
  // fault was the instrument rather than the break — a leading boundary fixes it.
  it.each([...LISTS])('%s has a search box', (name) => {
    expect(pageSource(name)).toMatch(/\n\s+search=\{\{\s*\n\s+param: 'q'/)
  })

  it.each([...LISTS])('%s has a sticky header and a sortable table', (name) => {
    const source = pageSource(name)
    // The sticky header is `Table`'s, unconditionally (§7.1) — using the
    // component IS the claim, so what is checked is that the page hands it the
    // sort descriptor rather than rendering its own markup.
    expect(source).toMatch(/\n\s+sort=\{\{/)
    expect(source).toContain('sortable: true')
  })

  it.each([...LISTS])('%s has a totals row that states its count', (name) => {
    const source = pageSource(name)
    expect(source).toMatch(/\n\s+totals=\{\{/)
    // §7.1.2 — `Total (N rows)`, or §7.1.3's paginated `Total (1–50 of 340)`.
    // Both are composed by a helper with no branch that omits the numbers; what
    // is forbidden is a literal.
    expect(source).toMatch(/totalsLabel\(|pagedFooterLabel\(/)
  })

  // THE RANGE: three of the four have one. PAYROLL DOES NOT, and the reason is
  // that the week IS the range — a second date control beside the week picker
  // would be two answers to the same question, and §7.4.1 wants a range labelled
  // with WHICH date, of which payroll has no other.
  it.each(['invoices', 'payments', 'charges', 'statements'] as const)(
    '%s has a labelled date range',
    (name) => {
      const source = pageSource(name)
      expect(source).toMatch(/\n\s+range=\{\{/)
      // LABELLED WITH THE FIELD, never a bare "Date". The label is the first
      // thing in the descriptor and must not be a generic key.
      expect(source).not.toMatch(
        /range=\{\{\s*\n?\s*label: t\('accounting\.date'\)/,
      )
    },
  )

  // ── THE WEEK PICKER IS ON BATCHES, AND ONLY THERE ───────────────────────
  //
  // This read "payroll has a week picker instead of a range" when Payroll was one
  // page about one week, then "for the tabs the week means something to" when it
  // grew five tabs. With the split it is simpler again: Batches is where a run is
  // opened, refreshed and finalised, so the picker and the Tuesday strip live
  // there — and Balances, its other tab, is a YEAR, which is why the strip is
  // rendered per tab rather than per page.
  it('batches has the week picker and the Tuesday strip', () => {
    const source = pageSource('batches')
    expect(source).toContain('<WeekPicker')
    expect(source).toContain('{weekStrip}')
    expect(source).toContain('{blockers}')
    // Per tab, not per page: Balances is a year's totals.
    expect(source).toMatch(/tab === 'batches' \? \(/)
  })

  // THE COMPANY FILTER: on the three lists whose rows belong to an authority.
  // PAYROLL DOES NOT HAVE ONE — a settlement is org-wide by ruling (Islom,
  // 2026-09-11): one batch, one statement per driver, whoever's freight they
  // pulled. A company chip there would imply a per-authority payroll that does
  // not exist.
  it.each(['invoices', 'payments', 'charges'] as const)(
    '%s offers the company filter',
    (name) => {
      expect(pageSource(name)).toContain('<CompanyChips')
    },
  )

  it('batches and statements have no company filter, being org-wide', () => {
    // A settlement spans every authority a driver pulled for (Islom,
    // 2026-09-11), so there is no company on a run or on a statement to filter
    // by — and a chip there would imply a per-authority payroll that does not
    // exist. The BREAKDOWN rows carry the authorities instead.
    expect(pageSource('batches')).not.toContain('<CompanyChips')
    expect(pageSource('statements')).not.toContain('<CompanyChips')
  })

  // REPORTS IS NOT A LIST IN TWO OF ITS THREE CUTS. The company and week cuts
  // are periods down and authorities across, which `Table` is not for; the
  // driver cut is an ordinary list and gets the full set.
  it('reports gives its driver cut the list controls', () => {
    const source = pageSource('reports')
    // `pagedFooterLabel` since the driver cut gained pagination — the general
    // assertion above accepts either, and this one names the paginated form
    // because the driver cut is a list and the other two cuts are a matrix.
    expect(source).toContain('pagedFooterLabel(')
    expect(source).toMatch(/\n\s+sort=\{\{/)
    expect(source).toMatch(/\n\s+range=\{\{/)
  })
})

// ── THE GRID CONTRACT, ON EVERY PAGE (§7.1.3) ───────────────────────────────
//
// Seven controls, named together so a grid missing one has to say which and why.
// The exceptions below are asserted to STILL be exceptions, because a test
// written to be true of whatever shipped is not an instrument.
describe('the grid contract', () => {
  it.each([...NAMES])('%s has tabs over one grid', (name) => {
    expect(pageSource(name)).toContain('<Tabs')
  })

  it.each([...NAMES])('%s offers Export CSV and a columns chooser', (name) => {
    // Both live in `GridToolbar`, which carries the current filter into the
    // export link and the grid id into the preference.
    expect(pageSource(name)).toContain('<GridToolbar')
  })

  // WORD-BOUNDARY ANCHORED, for the third time in this file. `toContain` is
  // satisfied by a PREFIXED symbol — `xreadGridColumns(` contains
  // `readGridColumns(` — so the break harness found this guard reporting nothing
  // wrong with a page that had stopped reading the preference entirely. Same
  // shape as `xtotals={{` and `xsearch={{` before it.
  it.each([...NAMES])('%s reads a stored column preference', (name) => {
    expect(pageSource(name)).toMatch(/\breadGridColumns\(/)
    expect(pageSource(name)).toMatch(/\bkeepColumns\(/)
  })

  it.each([...NAMES])('%s paginates', (name) => {
    expect(pageSource(name)).toContain('<GridFooterNav')
  })

  // ── THE FOOT SUMS THE FILTERED SET, NOT THE PAGE ────────────────────────
  //
  // §7.1.2 as corrected from the artefact on 2026-09-28. `footRows` is what
  // carries the filtered set past the page slice; a paginated grid that forgets
  // it sums twenty rows under a label saying 251, which is the exact
  // disagreement the section exists to prevent — and it would look right.
  it.each([...NAMES])('%s hands its foot the filtered set', (name) => {
    const source = pageSource(name)
    const tables = source.split('<Table').length - 1
    const footRows = source.split('footRows={view.filtered}').length - 1
    expect(footRows, `${name}: ${tables} tables, ${footRows} footRows`).toBe(
      tables,
    )
  })
})

// ── RULING 6: THE CHECKBOX COLUMN AND THE COLUMN FUNNELS ───────────────────
describe('bulk status and the column funnels', () => {
  const batches = pageSource('batches')

  it('puts the batches grid inside the bulk form', () => {
    expect(batches).toContain('<BulkStatus')
    expect(batches).toContain("selection={{ name: 'batch'")
  })

  // ── THE SAFETY ARGUMENT, READ OUT OF THE SOURCE ─────────────────────────
  //
  // A bulk route that gathered ids and wrote `status = 'FINAL'` would be a way
  // to finalise a blocked week from a checkbox: a driver with no pay rule paid
  // nothing, silently, because the screen that names them was never consulted.
  // The action must go through the same two functions a single button does.
  it('changes status through finaliseBatch and markBatchPaid, per batch', () => {
    const action = readFileSync(
      join(PAYROLL, 'batches', 'bulk-actions.ts'),
      'utf8',
    )
    expect(action).toContain('finaliseBatch(tx, id, session.userId)')
    expect(action).toContain('markBatchPaid(tx, id, session.userId)')
    // NO DIRECT WRITE. This is the shape the ruling forbids.
    expect(action).not.toMatch(/settlementBatch\.update\([^)]*status/s)
    expect(action).not.toContain('updateMany')
  })

  it('reports refusals by name, with the drivers responsible', () => {
    const action = readFileSync(
      join(PAYROLL, 'batches', 'bulk-actions.ts'),
      'utf8',
    )
    // "3 of 5 changed" tells somebody two weeks of driver pay did not happen
    // and not which.
    expect(action).toContain('blockers.map((row) => row.driverName)')
    expect(action).toContain('batch: name')
  })

  it('gives the funnel-able columns something to match on', () => {
    // A column marked `filterable` whose key has no entry in the shape's
    // `columnFilters` renders a control that narrows nothing — which looks
    // exactly like a filter that found no rows.
    const grids = readFileSync('src/lib/accounting-grids.ts', 'utf8')
    const marked = [
      ...batches.matchAll(/key: '(\w+)',\s+filterable: true/g),
    ].map((match) => match[1])
    expect(marked.length).toBeGreaterThan(0)
    const block = grids.slice(grids.indexOf('columnFilters: {'))
    for (const key of marked) {
      expect(block, key).toContain(`${key}:`)
    }
  })

  it('namespaces the funnel parameter so it cannot collide with a chip', () => {
    const core = readFileSync('src/lib/list-view.ts', 'utf8')
    // `f.status` and a screen's own `status` chip both exist on this grid.
    expect(core).toContain(
      'export const columnFilterParam = (columnKey: string) => `f.${columnKey}`',
    )
  })
})

// ── NO FUNCTION CROSSES THE SERVER/CLIENT BOUNDARY ──────────────────────────
//
// THIS TEST EXISTS BECAUSE THE FIRST VERSION OF THE CHARGES PAGE DID IT.
//
// `errorFor: (key: string) => string` — a closure over `t`, handed from a server
// page to two client forms. React cannot serialise a function, so every request
// to /accounting/charges threw a 500. It passed typecheck (TypeScript does not
// check RSC serialisability), passed lint, and passed 2,418 tests, because
// nothing in the suite renders a page.
//
// It was found by PHOTOGRAPHING THE SCREEN, which is why the ruling asked for
// screenshots before a dispatch — and a hazard found by a human looking at a
// picture is a hazard that needs an instrument.
//
// Every client component in this section is a leaf whose props come from a
// server page, so a function type in its Props is this bug by construction.
// Server Actions are imported, not passed, so nothing legitimate is excluded.
describe('client components in these two groups take no callbacks', () => {
  const clientFiles = (() => {
    const found: { name: string; text: string }[] = []
    const walk = (dir: string) => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = join(dir, entry.name)
        if (entry.isDirectory()) {
          walk(full)
          continue
        }
        if (!entry.name.endsWith('.tsx')) continue
        const text = readFileSync(full, 'utf8')
        if (!text.startsWith("'use client'")) continue
        found.push({ name: entry.name, text })
      }
    }
    // BOTH GROUPS AND THE SHARED FOLDER. Written as one directory it would have
    // stopped covering Payroll the moment the split landed — and passed, because
    // it would still have found Accounting's files and its own
    // "cannot pass by finding nothing" case would still have been satisfied.
    walk(ACCOUNTING)
    walk(PAYROLL)
    walk(join(APP, '_grid'))
    return found
  })()

  it('reads real files, so the check cannot pass by finding nothing', () => {
    // The same guard `this-week-shape.test.ts` carries, for the same reason: a
    // renamed directory would otherwise turn this suite green by emptying it.
    expect(clientFiles.length).toBeGreaterThanOrEqual(5)
    expect(clientFiles.map((file) => file.name)).toContain('CompanyChips.tsx')
  })

  it.each(clientFiles.map((file) => file.name))(
    '%s declares no function-typed prop',
    (name) => {
      const file = clientFiles.find((candidate) => candidate.name === name)!
      // The Props block only — a function type in the component BODY is ordinary
      // React and is none of this test's business.
      const match = /interface Props \{([\s\S]*?)\n\}/.exec(file.text)
      if (!match) return
      const props = match[1] ?? ''
      // `(a: T) => U` or `=> void` in a member position.
      const offenders = props
        .split('\n')
        .filter((line) => /^\s{2}\w[\w?]*\s*:\s*\(.*\)\s*=>/.test(line))
      expect(
        offenders,
        `${name} passes a function from a server component`,
      ).toEqual([])
    },
  )
})

// ── AND THE SCREENSHOT PASS FAILS CLOSED ────────────────────────────────────
//
// The instrument that caught the 500 has to be one that cannot report a 500 as a
// success. `cmd | tail` gives you tail's exit code; a screenshot run that
// photographs an error page and exits 0 is the same trap with a camera.
describe('the screenshot script', () => {
  const source = readFileSync('scripts/screenshots-accounting.mjs', 'utf8')

  it('counts a 4xx/5xx or a bounce to login as a failed shot', () => {
    expect(source).toContain('if (status >= 400 || bounced) failures += 1')
    expect(source).toContain('process.exit(1)')
  })

  it('refuses to run at all without a session', () => {
    // Without one, every shot is the login page — and fifteen pictures of a login
    // form look like fifteen screenshots until somebody opens one.
    expect(source).toContain('NO SESSION.')
  })

  it('shoots all six destinations', () => {
    // BY FULL PATH, not by bare name — `batches` appears in this script's own
    // prose, and a guard satisfied by a comment is the substring trap this file
    // has now caught three times.
    const paths: Record<string, string> = {
      invoices: '/accounting/invoices',
      payments: '/accounting/payments',
      reports: '/accounting/reports',
      batches: '/payroll/batches',
      statements: '/payroll/statements',
      charges: '/payroll/charges',
    }
    for (const name of NAMES) {
      expect(source, name).toContain(`path: '${paths[name]}'`)
    }
  })
})
