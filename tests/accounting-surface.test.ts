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

  // ── THE WINDOW CONTROL: A RANGE, OR THE ROLLING PICKER ─────────────────
  //
  // THIS USED TO REQUIRE A RANGE ON INVOICES AND PAYMENTS AND IT FAILED ON
  // PURPOSE. §6.2.8 (v10.21) gives both screens the rolling picker and removes
  // the from/to range with it, for the reason v10.16 gave: a picker beside a
  // range is one screen answering for two periods.
  //
  // The guard is not deleted, because "this list says WHICH dates it is showing"
  // is still the thing worth pinning. It is split by which control provides it.
  //
  // PAYROLL HAS NEITHER, and the reason is unchanged: the week IS the range, and
  // a second date control beside the week picker would be two answers to one
  // question.
  it.each(['charges'] as const)('%s has a labelled date range', (name) => {
    const source = pageSource(name)
    expect(source).toMatch(/\n\s+range=\{\{/)
    // LABELLED WITH THE FIELD, never a bare "Date". The label is the first
    // thing in the descriptor and must not be a generic key.
    expect(source).not.toMatch(
      /range=\{\{\s*\n?\s*label: t\('accounting\.date'\)/,
    )
  })

  it.each(['invoices', 'payments', 'batches', 'statements'] as const)(
    '%s takes its window from the rolling picker instead',
    (name) => {
      const source = pageSource(name)
      expect(source).toContain('<PeriodPicker')
      // AND NOT BOTH. The two-window arrangement is what §6.2.8 forbids, so the
      // absence is asserted rather than assumed from the presence above.
      expect(source).not.toMatch(/\n\s+range=\{\{/)
    },
  )

  // ── AND THE SUMMARY STRIP, WHICH IS WHY THE PICKER IS THERE (§6.2.8) ────
  it.each(['invoices', 'payments'] as const)(
    '%s carries a summary strip whose figures are links',
    (name) => {
      const source = pageSource(name)
      expect(source).toContain('<SummaryStrip')
      // EVERY FIGURE IS A LINK: the href is what makes it a control rather than
      // a notification, and a strip of plain numbers would still render.
      expect(source).toMatch(/href: (listHref|stripHref)\(/)
    },
  )

  // ── A BALANCE LINKS WITH NO DATE FILTER (§6.2.8, ruling 2026-10-04) ─────
  //
  // The figure has no window, so the list it opens must not have one either, or
  // the number above the rows is not the sum of the rows. `?period=all` is that
  // state, and it is asserted at the source because the alternative — a figure
  // quietly linking to a thirteen-week list — looks right in every screenshot.
  it.each(['invoices', 'payments'] as const)(
    '%s sends a balance figure to an unfiltered list',
    (name) => {
      const source = pageSource(name)
      // THE WHOLE CONDITIONAL, not just the call. `toContain` on
      // `next.set('period', ALL_DATES)` is satisfied by a line that can never
      // run — `if (kind === 'balance' && false) next.set(...)` — which is what
      // the break harness demonstrated. The reachability is the claim.
      expect(source).toContain(
        "if (kind === 'balance') next.set('period', ALL_DATES)",
      )
      // AND THE TWO KINDS ARE DISTINGUISHED rather than one rule applied to
      // both: a flow keeps the picker.
      expect(source).toMatch(/kind: 'balance' \| 'flow'/)
    },
  )

  // ── AND EVERY FIGURE DECLARES WHICH KIND IT IS ─────────────────────────
  //
  // `SummaryFigure.scope` is required by the type, so a missing one is a build
  // error — what this adds is that both VALUES are actually used on each screen.
  // A strip of four balances would compile, satisfy every other guard here, and
  // leave the picker decorative again.
  it.each(['invoices', 'payments'] as const)(
    '%s carries both a balance and a flow',
    (name) => {
      const source = pageSource(name)
      expect(source).toContain("scope: 'balance'")
      expect(source).toContain("scope: allDates ? 'all' : 'window'")
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
  })

  // ── THE WINDOW ON REPORTS IS THE ROLLING PICKER, NOT A RANGE ───────────
  //
  // THIS ASSERTION USED TO BE `range={{` AND IT FAILED ON PURPOSE. §6.2.7
  // (v10.19) puts the dashboard's picker on this screen and removes the
  // from/to range with it: v10.16 revoked the two-window arrangement, so a
  // picker beside a range would be one screen answering for two periods.
  //
  // The guard is not deleted, because "this screen has a window control" is
  // still the thing worth pinning — it is repointed at the control that now
  // provides it, and the weekly/monthly toggle is asserted GONE so the two
  // cannot quietly come back together. Flag 45 records what that costs.
  it('reports takes its window from the rolling picker, not a date range', () => {
    const source = pageSource('reports')
    expect(source).toContain('<PeriodPicker')
    expect(source).toContain('<CompanyChips')
    expect(source).not.toMatch(/\n\s+range=\{\{/)
    // THE TOGGLE IS GONE TOO: a month is not a whole number of settlement
    // weeks, so it cannot be drawn on an axis aligned to them (v10.17).
    expect(source).not.toContain("t('reports.monthly')")
  })

  // AND THE FOUR CHARTED SECTIONS §6.2.7 NAMES ARE ON IT. Asserted by the
  // component rather than by a heading, because a heading with no chart under
  // it is exactly the failure this would otherwise miss.
  it('reports carries the four charted sections', () => {
    const source = pageSource('reports')
    // By company: the money series, with its hatch for unrecorded pay.
    expect(source).toContain('<BarChart')
    // Receivables: the shared aging bar, plus invoiced/factored/collected.
    expect(source).toContain('<AgingBar')
    expect(source).toContain('<SeriesBars')
    // Settlements: deductions by category.
    expect(source).toContain('<Donut')
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

// ── THE TABS EACH DESTINATION HAS, AGAINST §6.2's OWN TABLE ────────────────
//
// THIS EXISTS BECAUSE THE DOCUMENT GOT AHEAD OF THE CODE TWICE IN ONE DAY.
// §6.2 listed `Charges: Scheduled · One-time · This week` and the page had two
// tabs, so `?tab=thisWeek` fell back to Scheduled and rendered a screen that
// looked correct — the failure is invisible unless somebody asks for the tab by
// name, which is what the screenshot run did.
//
// §6.2.1 had already described the checkbox column and the funnels as built
// while they were not, for a few hours, for the same reason: an amendment
// landing before its code is right, and nothing was watching the gap close.
//
// SO THE COUNT IS ASSERTED AGAINST THE DOCUMENT, not against the code. The
// numbers come from §6.2's table and a page that grows or loses a tab has to
// change the table first — which is the order §15 requires anyway.
describe('each destination has the tabs §6.2 says it has', () => {
  const EXPECTED: Record<string, readonly string[]> = {
    invoices: ['invoices', 'ready', 'factored', 'direct'],
    payments: ['payments', 'unapplied'],
    reports: ['company', 'week', 'driver'],
    batches: ['batches', 'balances'],
    statements: ['statements'],
    // FOUR SINCE MIGRATION 61 (§6.2.4). `standing` sits second, and the order
    // here is the order on screen — a page that reordered its tabs without
    // reordering §6.2's table would fail this, which is the point.
    charges: ['scheduled', 'standing', 'oneTime', 'thisWeek'],
  }

  it.each(Object.keys(EXPECTED))('%s declares its tab list', (name) => {
    const source = pageSource(name)
    // The literal the page narrows `?tab=` against. Reports names its cuts
    // `CUTS` because a cut is what that page calls a tab.
    const match = /const (?:TABS|CUTS)(?::[^=]+)? = \[([^\]]*)\]/.exec(source)
    expect(match, `${name} has no TABS/CUTS literal`).not.toBeNull()
    const declared = [...(match?.[1] ?? '').matchAll(/'([^']+)'/g)].map(
      (hit) => hit[1],
    )
    expect(declared, name).toEqual([...EXPECTED[name]!])
  })

  it('and the design system still says the same thing', () => {
    // If §6.2's table is edited, this is the line that notices the code was not.
    const doc = readFileSync('TMS-DESIGN-SYSTEM.md', 'utf8')
    expect(doc).toContain('Scheduled · Standing · One-time · This week')
    expect(doc).toContain('Batches · Balances')
    expect(doc).toContain(
      'Invoices · Ready to invoice · Factored · Direct-settled',
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

  // ── THE TWO HALVES OF THE SELECTOR MUST AGREE ───────────────────────────
  //
  // Every bulk bar depends on a string matching across two files. The page
  // passes `selection={{ name: 'batch' }}` to `Table`, which renders
  // `<input name="batch">`; the wrapper then HARDCODES
  // `input[name="batch"]:checked` in a `querySelectorAll` to count what is
  // ticked.
  //
  // RENAME EITHER SIDE AND THE BAR SIMPLY NEVER APPEARS. The count stays 0, the
  // `count > 0 ?` branch never renders, nothing throws, and the screen looks
  // exactly like one where nothing is selected. There is no error to find,
  // which puts it in the same family as the `sed` that matched nothing and the
  // `tail` that returned 0: the failure wears success's clothes.
  //
  // THE TESTS ABOVE DO NOT CATCH IT. They assert `<BulkStatus` is present and
  // `selection={{ name: 'batch'` is present — two literals that both stay true
  // after the wrapper's selector is changed to something else.
  //
  // SO THIS EXTRACTS RATHER THAN ASSERTS A LITERAL. The name is read out of the
  // page and looked for in the wrapper, so a deliberate rename of BOTH sides
  // passes — as it should, it is still correct — and a rename of one fails.
  // Asserting `'batch'` on both sides would turn every legitimate rename into
  // a test edit, which is how a guard becomes something people switch off.
  describe('a bulk bar counts the checkbox its own grid renders', () => {
    const PAIRS = [
      ['batches', join(PAYROLL, 'batches', 'BulkStatus.tsx')],
      ['statements', join(PAYROLL, 'statements', 'BulkPostPaid.tsx')],
      ['invoices', join(ACCOUNTING, 'invoices', 'BulkMarkSent.tsx')],
    ] as const

    it.each(PAIRS)('%s', (page, wrapper) => {
      const source = pageSource(page)
      // BOTH SPELLINGS. `batches` passes the prop directly; `statements` and
      // `invoices` pass it through a conditional spread because the column only
      // exists for a role that may act. A regex matching only `selection={{`
      // finds one of the three and reports the other two as having no
      // selection at all — which is the mistake this very check was written
      // after making by hand.
      const match = /selection[=:]\s*\{\{?\s*name:\s*'([^']+)'/.exec(source)
      expect(match, `${page} passes no selection name to Table`).not.toBeNull()
      const name = match![1]!

      // EVERY OCCURRENCE, NOT "CONTAINS IT SOMEWHERE". The first version of
      // this asserted `toContain('input[name="batch"]')` and `watch-guard`
      // refused to accept it: breaking the COUNTING selector in `BulkStatus`
      // left the CLEAR-ALL selector untouched three lines below, the string was
      // still present in the file, and the guard passed.
      //
      // A broken counter with an intact clear-all is the exact failure — no
      // bar, no error — so "the name appears in this file" was never the claim
      // worth making. The claim is that every selector in the wrapper names the
      // checkbox the grid renders, and that is what is asserted.
      const client = readFileSync(wrapper, 'utf8')
      const selectors = [...client.matchAll(/input\[name="([^"]+)"\]/g)].map(
        (hit) => hit[1],
      )
      expect(
        selectors.length,
        `${wrapper} queries no input[name=…] at all, so its bar can never count anything`,
      ).toBeGreaterThan(0)
      expect(
        [...new Set(selectors)],
        `${page}'s grid renders input[name="${name}"]; its bulk bar queries a different selector`,
      ).toEqual([name])
    })
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

// ── THE OPEN-BATCH PREVIEW (owner's ruling, 2026-09-29) ────────────────────
describe('the open-batch flow', () => {
  const preview = readFileSync('src/lib/batch-preview.ts', 'utf8')
  const page = readFileSync(join(PAYROLL, 'batches', 'new', 'page.tsx'), 'utf8')

  // ── EVERY BUCKET IS RENDERED, AND NAMED FROM ONE LIST ───────────────────
  //
  // Five reasons in the lib and four rendered would hide a whole class of
  // excluded freight, silently, on the screen whose entire job is to say what
  // is being left out. The page maps `UNAVAILABLE_REASONS` rather than listing
  // headings by hand, so a sixth reason appears without an edit here.
  it('renders every reason the classifier can return', () => {
    expect(page).toContain('UNAVAILABLE_REASONS.map')
    for (const reason of [
      'inTransit',
      'outsideRange',
      'alreadyInBatch',
      'noDriver',
      'noRule',
    ]) {
      expect(preview, reason).toContain(`${reason}:`)
      expect(page, reason).toContain(reason)
    }
  })

  it('gives every reason a label and a sentence about what to do', () => {
    // §10: an empty state is an invitation. "No pay rule" is not a fact about
    // a load, it is a task on a driver page, and the hint says so.
    const labels = [...page.matchAll(/'(preview\.reason\.\w+)'/g)].map(
      (hit) => hit[1],
    )
    const hints = [...page.matchAll(/'(preview\.hint\.\w+)'/g)].map(
      (hit) => hit[1],
    )
    expect(new Set(labels).size).toBe(5)
    expect(new Set(hints).size).toBe(5)
  })

  // ── A LOAD LANDS IN EXACTLY ONE BUCKET ──────────────────────────────────
  //
  // The classifier is one chained conditional rather than five filters, so a
  // load with no POD and no driver is reported once. Five independent passes
  // would let a load appear twice, or — worse — fall between them as the
  // predicates drifted.
  it('classifies with one decision per load, not five filters', () => {
    expect(preview).toContain('const reason: UnavailableReason | null =')
    expect(preview).not.toMatch(/loads\.filter\([^)]*\)\s*\.filter/)
  })

  it('bounds the window on the POD, not the delivery stop', () => {
    // MONEY-DESIGN §0: a week is decided by when the POD landed. A load
    // delivered Saturday whose POD arrives Monday belongs to the next week,
    // which is what `outsideRange` exists to show.
    expect(preview).toContain('podAt < input.from || podAt > input.to')
  })

  it('says WHICH authority the batch will settle, before the button is pressed', () => {
    // §6.2.10, 2026-10-05: the chip now scopes the BATCH and not only the grid,
    // so the sentence has to name what Create will settle. It used to say
    // "org-wide" unconditionally — true under the old ruling and a lie under
    // this one, which is why this assertion changed rather than being deleted.
    //
    // BOTH BRANCHES, because a screen that only ever said one of them would pass
    // a check for either string on its own.
    expect(page).toContain("t('preview.forOrg')")
    expect(page).toContain("t('preview.forCompany')")
    expect(page).toContain("t('preview.willOpen')")
  })
})

describe('Invoices finishes a week (§6.2, v10.8)', () => {
  const page = readFileSync(join(ACCOUNTING, 'invoices', 'page.tsx'), 'utf8')
  const bulk = readFileSync(
    join(ACCOUNTING, 'invoices', 'bulk-actions.ts'),
    'utf8',
  )
  const grids = readFileSync(
    join(process.cwd(), 'src', 'lib', 'accounting-grids.ts'),
    'utf8',
  )

  it('filters by status through a funnel the bar can also render', () => {
    // §6.2.1: a funnel writes the same query parameter the filter bar shows
    // as a chip, so a filtered grid stays a link somebody can send.
    expect(grids).toMatch(/columnFilters: \{\s*status: \(row\) => row\.status,/)
    expect(page).toMatch(/filterable: true,/)
    expect(page).toMatch(/funnelFor=\{funnelFor\}/)
  })

  it('keeps factored invoices out of the default population', () => {
    // A factored invoice is SOLD. Leaving it in Invoices would put money the
    // factor already paid us for into the aging chips and the balance total.
    expect(page).toMatch(/tab === 'factored'/)
    expect(page).toMatch(/filter\(\(row\) => !row\.isFactored\)/)
  })

  it('records a send per invoice, through the real function', () => {
    // Not `updateMany`: `markInvoiceSent` refuses an already-sent invoice and
    // an empty channel, and a bulk path that skipped it would record sends
    // that never happened.
    expect(bulk).toMatch(/await markInvoiceSent\(tx, id, \{ channel \}\)/)
    expect(bulk).not.toMatch(/updateMany/)
    expect(bulk).not.toMatch(/sentAt: new Date\(\)/)
  })

  it('asks for the channel rather than defaulting it', () => {
    // "Did we send it" and "where did it go" are different questions in a
    // payment chase. A default would put an answer in the record that nobody
    // gave.
    expect(bulk).toMatch(/formData\.get\('channel'\)/)
    expect(bulk).not.toMatch(/channel \|\| 'email'/)
    expect(bulk).not.toMatch(/channel \?\? 'email'/)
  })

  it('names every refusal instead of counting them', () => {
    expect(bulk).toMatch(/invoice: name,/)
    expect(bulk).toMatch(/refusals\.push/)
  })
})

describe('applying a payment (§6.2.5)', () => {
  const lib = readFileSync(
    join(process.cwd(), 'src', 'lib', 'payments.ts'),
    'utf8',
  )
  const action = readFileSync(join(APP, 'payments', 'actions.ts'), 'utf8')
  const form = readFileSync(
    join(APP, 'payments', '[id]', 'OpenItems.tsx'),
    'utf8',
  )
  const detail = readFileSync(join(APP, 'payments', '[id]', 'page.tsx'), 'utf8')

  it('lists both kinds of open item in one list', () => {
    // The question is "what does this payer owe us", and two tables would
    // make somebody add up two subtotals to see whether the wire is covered.
    expect(detail).toMatch(/const openItems: OpenItem\[\] = \[/)
    expect(detail).toMatch(/kind: 'invoice',/)
    expect(detail).toMatch(/kind: 'load',/)
    // And the panels it replaced are gone, not merely unused.
    expect(detail).not.toMatch(/<ApplyToInvoice\b/)
    expect(detail).not.toMatch(/<ApplyStatement\b/)
  })

  it('prefills every amount to that item balance', () => {
    expect(form).toMatch(/\(item\.balanceCents \/ 100\)\.toFixed\(2\)/)
  })

  it('goes through the existing rule for each kind', () => {
    // The carrier check, the factoring check and both ceilings live in
    // `applyToInvoice` and `applyToLoads`. This orchestrates; it must not
    // reimplement, and it must have no fast path.
    expect(lib).toMatch(/await applyToInvoice\(\s*tx,\s*paymentId,/)
    expect(lib).toMatch(/await applyToLoads\(tx, paymentId, shares\)/)
    expect(lib).not.toMatch(/paymentApplication\.createMany/)
  })

  it('is all or nothing, with the rollback where the transaction is', () => {
    // One person dividing one payment: applying three of five allocations
    // leaves a split nobody chose. The lib reports; the action throws.
    expect(lib).toMatch(
      /if \(refusals\.length > 0\) return \{ ok: false, refusals \}/,
    )
    expect(action).toMatch(/throw new Refused\(result\.refusals\)/)
    expect(action).toMatch(/error instanceof Refused/)
  })

  it('names every refusal rather than counting them', () => {
    expect(lib).toMatch(/label: label\(allocation\.id\)/)
    expect(action).toMatch(/refusals: error\.refusals\.map/)
  })

  it('leaves the remainder unapplied instead of forcing it', () => {
    // Unapplied money is a real state. A screen that always zeroed it would
    // be inventing an allocation nobody made.
    expect(lib).toMatch(/unappliedCents: payment\?\.unappliedCents \?\? 0/)
    expect(action).not.toMatch(/unappliedCents: 0,/)
  })
})

describe('the statements grid finishes a week (§6.2.6)', () => {
  const grids = readFileSync(
    join(process.cwd(), 'src', 'lib', 'accounting-grids.ts'),
    'utf8',
  )
  const page = readFileSync(join(PAYROLL, 'statements', 'page.tsx'), 'utf8')
  const bulk = readFileSync(
    join(PAYROLL, 'statements', 'bulk-actions.ts'),
    'utf8',
  )

  it('computes Deductions from the lines, not from the two-signed field', () => {
    // `Settlement.deductionsCents` is written NEGATIVE by the batch engine
    // and POSITIVE by refreshTotals. Dev holds both. A column rendering it
    // shows -$450.00 beside $450.00 and sums them against each other.
    expect(grids).toMatch(/tx\.settlementLine\.groupBy\(\{/)
    expect(grids).toMatch(/tx\.settlementDeductionLine\.groupBy\(\{/)
    expect(grids).toMatch(/deductionsCents: reducing\.get\(row\.id\) \?\? 0,/)
    expect(grids).not.toMatch(/deductionsCents: row\.deductionsCents,/)
  })

  it('counts only what reduces net, from both tables', () => {
    expect(grids).toMatch(/amountCents: \{ lt: 0 \}/)
    expect(grids).toMatch(/totalCents: \{ lt: 0 \}/)
  })

  it('filters on status and on the batch NUMBER', () => {
    // An id in a filter chip is something nobody can type or recognise.
    // INSIDE `columnFilters`, NOT ANYWHERE IN THE FILE. The same line
    // appears in `sorts` too, so a loose match passed while a break moved
    // the filter to `batchId` — the guard was reading the wrong one of two
    // identical lines.
    const filters = grids.slice(
      grids.indexOf('export const statementShape'),
      grids.indexOf(
        'defaultSort',
        grids.indexOf('export const statementShape'),
      ),
    )
    const columnFilters = filters.slice(filters.indexOf('columnFilters: {'))
    expect(columnFilters).toMatch(/batch: \(row\) => row\.batchNumber,/)
    expect(columnFilters).not.toMatch(/batch: \(row\) => row\.batchId,/)
    expect(page).toMatch(/key: 'batch',/)
    expect(page).toMatch(/funnelFor=\{funnelFor\}/)
  })

  it('posts and pays per statement, through the real functions', () => {
    // A bulk route writing `status = 'PAID'` would be a way to pay a
    // negative statement from a checkbox.
    expect(bulk).toMatch(/await approveSettlement\(tx, id, session\.userId\)/)
    expect(bulk).toMatch(
      /await markSettlementPaid\(tx, id, \{ method, reference \}\)/,
    )
    expect(bulk).not.toMatch(/updateMany/)
  })

  it('names refusals, and names a draft by its driver', () => {
    // A draft has no issued number yet, so the id would be the only handle —
    // and an id in an error message is the thing the reader has to look up.
    expect(bulk).toMatch(/isPlaceholderNumber\(settlement\.settlementNumber\)/)
    expect(bulk).toMatch(/driver\.firstName/)
    expect(bulk).toMatch(/refusals\.push/)
  })
})
