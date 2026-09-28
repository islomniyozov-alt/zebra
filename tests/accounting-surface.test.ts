import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

// ---------------------------------------------------------------------------
// THE ACCOUNTING SECTION IS FIVE PAGES AND EVERY LIST HAS THE SAME CONTROLS.
//
// ── WHY THIS IS A SOURCE CHECK ────────────────────────────────────────────
//
// The ruling is about what each screen OFFERS: search, sort, a date range, a
// company filter, a sticky header and a totals row. A behavioural test would
// need a browser, a session and seeded money on every one of them, which is the
// reason nothing checked the old Money section's shape either.
//
// So this reads the pages. It is the "count the thing you are claiming"
// instrument: the claim is about these five files, so these five files are what
// is counted — and the exceptions are named rather than quietly permitted.
// ---------------------------------------------------------------------------

const DIR = join(process.cwd(), 'src', 'app', '(app)', 'accounting')

const PAGES = ['invoices', 'payments', 'payroll', 'charges', 'reports'] as const

const pageSource = (name: string) =>
  readFileSync(join(DIR, name, 'page.tsx'), 'utf8')

describe('the five pages exist', () => {
  it('is exactly five, with nothing extra alongside them', () => {
    const directories = readdirSync(DIR, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort()
    // §6.2's table is five destinations, each answering something the other four
    // do not. A sixth PAGE has to change that table first.
    //
    // `export` IS NOT A PAGE and is named here rather than tolerated: it is the
    // shared CSV route handler (§7.1.5), which has to live under this segment so
    // that it inherits the same auth context the pages do.
    expect(directories).toEqual([...PAGES, 'export'].sort())
    for (const name of PAGES) {
      expect(existsSync(join(DIR, name, 'page.tsx')), name).toBe(true)
    }
  })
})

// ── EVERY LIST READS THE SHARED CONTROLS ────────────────────────────────────
//
// Five screens parsing `?from=` for themselves is five chances to disagree about
// whether the bound is inclusive — and MONEY-DESIGN §0 is the standing lesson
// about a day's slip on a week boundary looking like nothing.
describe('every page uses the shared list core', () => {
  it.each([...PAGES])('%s reads its params through list-view', (name) => {
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
      /import \{[^}]*\bgridView\b[^}]*\} from '\.\.\/grid-page'|import \{[^}]*\breadListParams\b[^}]*\} from '@\/lib\/list-view'/s,
    )
  })

  it.each([...PAGES])('%s does not parse a date bound by hand', (name) => {
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
  const LISTS = ['invoices', 'payments', 'payroll', 'charges'] as const

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
  it.each(['invoices', 'payments', 'charges'] as const)(
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

  // ── PAYROLL HAS BOTH, AND WHICH ONE DEPENDS ON THE TAB ──────────────────
  //
  // This read "a week picker INSTEAD OF a range" while Payroll was one grid about
  // one week. With five tabs (§7.1.6) that is no longer true and the test was
  // right to fail: Batches and Driver statements span every week, so a range over
  // the check date and the period is exactly what they need, and a week picker
  // above them would be a control that changes nothing.
  //
  // The rule that survives is the ORIGINAL REASON: a week-scoped grid has no
  // second date to bound, so it gets the picker and not a range.
  it('payroll has a week picker, for the tabs the week means something to', () => {
    const source = pageSource('payroll')
    expect(source).toContain('<WeekPicker')
    // The picker is rendered only for those tabs, and the flag that decides it is
    // named — a `weekStrip` shown unconditionally would put a week control above
    // a grid spanning every week.
    expect(source).toContain('const weekScoped =')
    expect(source).toMatch(/\{weekStrip\}/)
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

  it('payroll has no company filter, because settlement is org-wide', () => {
    expect(pageSource('payroll')).not.toContain('<CompanyChips')
  })

  // REPORTS IS NOT A LIST IN TWO OF ITS THREE CUTS. The company and week cuts
  // are periods down and authorities across, which `Table` is not for; the
  // driver cut is an ordinary list and gets the full set.
  it('reports gives its driver cut the list controls', () => {
    const source = pageSource('reports')
    expect(source).toContain('totalsLabel(')
    expect(source).toMatch(/\n\s+sort=\{\{/)
    expect(source).toMatch(/\n\s+range=\{\{/)
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
describe('client components in Accounting take no callbacks', () => {
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
    walk(DIR)
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

  it('shoots all five pages', () => {
    for (const name of PAGES) {
      expect(source, name).toContain(`/accounting/${name}`)
    }
  })
})
