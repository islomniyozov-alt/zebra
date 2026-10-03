/**
 * @vitest-environment jsdom
 */
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import {
  CashPanel,
  CompliancePanel,
  FleetPanel,
} from '@/app/(app)/dashboard/Panels'

// ---------------------------------------------------------------------------
// THE THREE PANELS. §6.1.1's part-3 contract, asserted against a DOM.
//
// Same discipline as `dashboard-charts.test.tsx`: PRESENCE, COUNT and TEXT, no
// geometry. A restyle should not fail these; a missing figure should.
//
// ── WHAT IS WORTH ASSERTING HERE AND WHAT IS NOT ─────────────────────────
//
// Three of these panels draw bars whose widths are shares, and a share is
// arithmetic that can produce `NaN%` from an empty window — which renders as a
// bar of indeterminate width rather than an error. So the ZERO cases are tested
// as hard as the populated ones, and the figures are read back as TEXT, because
// a label that silently became "$NaN" is the failure a snapshot would have
// happily recorded.
//
// THE REMAINDER ROW IS TESTED BOTH WAYS. A list of ten drivers out of
// thirty-one that does not say so reads as the whole fleet; a list of three
// that says "and 0 others" reads as a bug. One assertion each.
// ---------------------------------------------------------------------------

afterEach(cleanup)

const fleetLabels = {
  heading: 'The fleet',
  trucksPaired: 'Trucks with a driver',
  trucksIdle: 'Trucks idle',
  driversPaired: 'Drivers with a truck',
  driversIdle: 'Drivers idle',
  movingNow: 'Moving now',
  topDrivers: 'Top drivers by gross',
  driver: 'Driver',
  gross: 'Gross',
  loads: 'Loads',
  other: (count: number) => `Other (${String(count)})`,
  empty: 'No settled freight in this period.',
  teamNote: 'A team load credits its full gross to both drivers.',
}

const driver = (
  over: Partial<{
    id: string
    name: string
    cents: number
    loads: number
  }> = {},
) => {
  const spec = {
    id: 'd1',
    name: 'ALIZODA, ABDUNAZARJONI',
    cents: 1_240_000,
    loads: 9,
    ...over,
  }
  return {
    driverId: spec.id,
    driverName: spec.name,
    grossCents: spec.cents,
    loads: spec.loads,
  }
}

const fleet = {
  trucksPaired: 28,
  trucksIdle: 87,
  driversPaired: 32,
  driversIdle: 25,
  movingNow: 42,
}

describe('FleetPanel', () => {
  it('shows all five assignment tiles with their counts', () => {
    render(
      <FleetPanel
        fleet={fleet}
        drivers={{ top: [], restCount: 0, restCents: 0 }}
        locale="en-US"
        labels={fleetLabels}
      />,
    )
    for (const [label, value] of [
      ['Trucks with a driver', '28'],
      ['Trucks idle', '87'],
      ['Drivers with a truck', '32'],
      ['Drivers idle', '25'],
      ['Moving now', '42'],
    ]) {
      const term = screen.getByText(label!)
      expect(term.parentElement?.textContent).toContain(value!)
    }
  })

  it('gives each driver a name, a figure and a load count', () => {
    const { container } = render(
      <FleetPanel
        fleet={fleet}
        drivers={{
          top: [
            driver(),
            driver({
              id: 'd2',
              name: 'KARIMOV, BOBUR',
              cents: 980_000,
              loads: 7,
            }),
          ],
          restCount: 0,
          restCents: 0,
        }}
        locale="en-US"
        labels={fleetLabels}
      />,
    )
    // SCOPED TO THE BAR LIST. Every one of these labels appears twice on
    // purpose — once in the bars and once in the `sr-only` table — and the
    // legend contributes list items of its own, so an unscoped
    // `getAllByRole('listitem')` counts three for two drivers. The duplication
    // is the feature; the query has to be specific about which copy it means.
    const rows = [...container.querySelectorAll('ol > li')]
    expect(rows).toHaveLength(2)
    expect(rows[0]!.textContent).toContain('ALIZODA, ABDUNAZARJONI')
    expect(rows[0]!.textContent).toContain('$12.4k')
    expect(rows[0]!.textContent).toContain('9')
    expect(rows[1]!.textContent).toContain('KARIMOV, BOBUR')
  })

  it('links each driver to their own record', () => {
    render(
      <FleetPanel
        fleet={fleet}
        drivers={{ top: [driver()], restCount: 0, restCents: 0 }}
        locale="en-US"
        labels={fleetLabels}
      />,
    )
    // `getAttribute`, not `toHaveAttribute` — this project has no jest-dom,
    // and chai answered the missing matcher with "Invalid Chai property"
    // rather than by failing the assertion it looked like.
    expect(
      screen
        .getByRole('link', { name: 'ALIZODA, ABDUNAZARJONI' })
        .getAttribute('href'),
    ).toBe('/drivers/d1')
  })

  it('names and sums the drivers it did not draw', () => {
    const { container } = render(
      <FleetPanel
        fleet={fleet}
        drivers={{ top: [driver()], restCount: 21, restCents: 9_339_100 }}
        locale="en-US"
        labels={fleetLabels}
      />,
    )
    // THE VISIBLE ROW CARRIES THE COMPACT FIGURE and the hidden table carries
    // the exact one, so both copies are checked rather than whichever the
    // query happened to reach first.
    const rest = container.querySelector('ol > li:last-child')
    expect(rest?.textContent).toContain('Other (21)')
    expect(rest?.textContent).toContain('$93.4k')
    expect(screen.getByRole('cell', { name: '$93,391.00' })).toBeTruthy()
  })

  it('draws no remainder row when the list is the whole fleet', () => {
    render(
      <FleetPanel
        fleet={fleet}
        drivers={{ top: [driver()], restCount: 0, restCents: 0 }}
        locale="en-US"
        labels={fleetLabels}
      />,
    )
    expect(screen.queryByText(/^Other \(/)).toBeNull()
  })

  it('warns that per-driver loads sum higher than the window, because teams', () => {
    // THE PREDICTABLE MISREADING. `topDriversByGross` credits BOTH crew seats,
    // so these counts exceed the load count on the chart above. Saying so on
    // screen is cheaper than the question.
    render(
      <FleetPanel
        fleet={fleet}
        drivers={{ top: [driver()], restCount: 0, restCents: 0 }}
        locale="en-US"
        labels={fleetLabels}
      />,
    )
    expect(
      screen.getByText('A team load credits its full gross to both drivers.'),
    ).toBeTruthy()
  })

  it('carries the exact cents in the hidden table, not the compact form', () => {
    // THE BARS ARE COMPACT BECAUSE TEN OF THEM SIT IN A COLUMN. A screen reader
    // gets no benefit from "$12.4k" and every benefit from the real figure.
    render(
      <FleetPanel
        fleet={fleet}
        drivers={{ top: [driver()], restCount: 0, restCents: 0 }}
        locale="en-US"
        labels={fleetLabels}
      />,
    )
    expect(screen.getByRole('cell', { name: '$12,400.00' })).toBeTruthy()
  })

  it('keeps the tiles when no driver settled in the window', () => {
    // §14: never a blank panel. The fleet is still a fact when the window is
    // empty, so the tiles stay and only the list says so.
    render(
      <FleetPanel
        fleet={fleet}
        drivers={{ top: [], restCount: 0, restCents: 0 }}
        locale="en-US"
        labels={fleetLabels}
      />,
    )
    expect(screen.getByText('No settled freight in this period.')).toBeTruthy()
    expect(screen.getByText('Trucks with a driver')).toBeTruthy()
  })

  it('gives a role without the figures the tiles and no money half', () => {
    // A DISPATCHER HOLDS `FLEET_READ` AND NOT `load.financials`. §6.1.1 makes
    // Cash money-roles-only and says nothing of the sort about Fleet, so the
    // five tiles are theirs and the gross bars are not — absent, not zeroed,
    // and never computed. §0: left out of the payload rather than hidden.
    const { container } = render(
      <FleetPanel
        fleet={fleet}
        drivers={null}
        locale="en-US"
        labels={fleetLabels}
      />,
    )
    expect(
      screen.getByText('Trucks idle').parentElement?.textContent,
    ).toContain('87')
    expect(screen.queryByText('Top drivers by gross')).toBeNull()
    expect(container.querySelector('ol')).toBeNull()
    // AND NO HIDDEN TABLE EITHER, which is where a figure would otherwise still
    // reach a screen reader after being taken off the screen.
    expect(container.querySelector('table')).toBeNull()
  })
})

const cashLabels = {
  heading: 'Cash',
  aging: 'Receivables aging',
  agingNote: 'Invoiced and unpaid. Factored invoices are excluded.',
  d0_30: '0–30 days',
  d31_60: '31–60 days',
  d61_90: '61–90 days',
  d90plus: '90+ days',
  bucket: 'Age',
  amount: 'Amount',
  unapplied: 'Unapplied',
  pipeline: 'Settlement pipeline',
  draft: 'Draft',
  final: 'Final',
  paid: 'Paid',
  empty: 'Nothing invoiced and unpaid.',
}

const aging = {
  d0_30: 464_800,
  d31_60: 120_000,
  d61_90: 40_000,
  d90plus: 15_000,
}
const pipeline = {
  draftCents: 65_305_600,
  finalCents: 18_432_500,
  paidCents: 0,
}

describe('CashPanel', () => {
  it('prints the money on every aging bucket', () => {
    // PART 2B'S RULE APPLIED TO A STACKED BAR: a segment two pixels wide is
    // unreadable, and the figure beside it is not.
    const { container } = render(
      <CashPanel
        aging={aging}
        pipeline={pipeline}
        unapplied={{ cents: 0, count: 0 }}
        locale="en-US"
        labels={cashLabels}
      />,
    )
    // THE VISIBLE KEY, not the hidden table: the table is asserted separately
    // and matching either copy would let a missing on-screen figure pass.
    const keys = [...container.querySelectorAll('ul > li')]
    expect(keys).toHaveLength(4)
    const pairs = [
      ['0–30 days', '$4,648.00'],
      ['31–60 days', '$1,200.00'],
      ['61–90 days', '$400.00'],
      ['90+ days', '$150.00'],
    ]
    pairs.forEach(([label, money], index) => {
      expect(keys[index]!.textContent).toContain(label!)
      expect(keys[index]!.textContent).toContain(money!)
    })
  })

  it('says that factored paper is not in the figure', () => {
    // "RECEIVABLES" THAT SILENTLY OMITTED A THIRD OF THE BOOK is the wrong
    // number to take to a bank. The exclusion is on screen, not in a comment.
    render(
      <CashPanel
        aging={aging}
        pipeline={pipeline}
        unapplied={{ cents: 0, count: 0 }}
        locale="en-US"
        labels={cashLabels}
      />,
    )
    expect(
      screen.getByText('Invoiced and unpaid. Factored invoices are excluded.'),
    ).toBeTruthy()
  })

  it('keeps all four buckets listed when the book is empty', () => {
    render(
      <CashPanel
        aging={{ d0_30: 0, d31_60: 0, d61_90: 0, d90plus: 0 }}
        pipeline={pipeline}
        unapplied={{ cents: 0, count: 0 }}
        locale="en-US"
        labels={cashLabels}
      />,
    )
    expect(screen.getByText('Nothing invoiced and unpaid.')).toBeTruthy()
    expect(screen.getAllByText('$0.00').length).toBeGreaterThanOrEqual(4)
  })

  it('draws one flat placeholder on an empty book, not four zero shares', () => {
    // A SHARE OF AN EMPTY BOOK IS `0 / 0` — `NaN%` — so the empty case takes a
    // branch that does no arithmetic and draws one flat segment.
    //
    // THIS ASSERTION USED TO BE `innerHTML` NOT CONTAINING "NaN" AND IT PROVED
    // NOTHING. Watched under `watch-guard.mjs`, the break that deletes the
    // placeholder branch left the suite GREEN: React assigns the width through
    // the CSSOM, jsdom rejects `NaN%` as invalid CSS and drops it silently, so
    // the string never reaches the markup. The defect was real and the
    // instrument could not see it — rule 4, and the second time a `toContain`
    // on rendered text has been the weak half of a guard here.
    //
    // SO THE STRUCTURE IS THE CLAIM: one segment when there is nothing to
    // divide, four when there is.
    const empty = render(
      <CashPanel
        aging={{ d0_30: 0, d31_60: 0, d61_90: 0, d90plus: 0 }}
        pipeline={pipeline}
        unapplied={{ cents: 0, count: 0 }}
        locale="en-US"
        labels={cashLabels}
      />,
    )
    // The bar is the element immediately before the list of bucket keys.
    const emptyBar = empty.container.querySelector('ul')?.previousElementSibling
    expect(emptyBar?.children).toHaveLength(1)

    cleanup()

    const full = render(
      <CashPanel
        aging={aging}
        pipeline={pipeline}
        unapplied={{ cents: 0, count: 0 }}
        locale="en-US"
        labels={cashLabels}
      />,
    )
    const fullBar = full.container.querySelector('ul')?.previousElementSibling
    expect(fullBar?.children).toHaveLength(4)
  })

  it('puts the count beside the unapplied money', () => {
    // "$14,200 UNAPPLIED" is the fact; "across 3 payments" is what says how
    // long it takes to clear.
    render(
      <CashPanel
        aging={aging}
        pipeline={pipeline}
        unapplied={{ cents: 1_420_000, count: 3 }}
        locale="en-US"
        labels={cashLabels}
      />,
    )
    const term = screen.getByText('Unapplied')
    expect(term.parentElement?.textContent).toContain('$14,200.00')
    expect(term.parentElement?.textContent).toContain('(3)')
  })

  it('shows the pipeline as three figures, including a zero', () => {
    // A ZERO IS AN ANSWER HERE. Nothing has been paid in this window, and
    // omitting the cell would read as "not computed".
    render(
      <CashPanel
        aging={aging}
        pipeline={pipeline}
        unapplied={{ cents: 0, count: 0 }}
        locale="en-US"
        labels={cashLabels}
      />,
    )
    expect(screen.getByText('Draft').parentElement?.textContent).toContain(
      '$653,056.00',
    )
    expect(screen.getByText('Final').parentElement?.textContent).toContain(
      '$184,325.00',
    )
    expect(screen.getByText('Paid').parentElement?.textContent).toContain(
      '$0.00',
    )
  })

  it('repeats the four buckets in a hidden table', () => {
    render(
      <CashPanel
        aging={aging}
        pipeline={pipeline}
        unapplied={{ cents: 0, count: 0 }}
        locale="en-US"
        labels={cashLabels}
      />,
    )
    const table = screen.getByRole('table')
    expect(table.querySelectorAll('tbody tr')).toHaveLength(4)
  })
})

const compLabels = {
  heading: 'Compliance',
  expiring: 'Expiring',
  expiringNote: 'Cumulative: within 60 days includes the ones within 30.',
  d30: 'Within 30 days',
  d60: 'Within 60 days',
  d90: 'Within 90 days',
  dqf: 'Driver qualification files',
  complete: 'Complete',
  incomplete: 'Incomplete',
  horizon: 'Horizon',
  count: 'Count',
}

describe('CompliancePanel', () => {
  it('shows the three horizons and sends each one to safety', () => {
    const { container } = render(
      <CompliancePanel
        expiring={{ d30: 119, d60: 120, d90: 120 }}
        dqf={{ complete: 44, incomplete: 13 }}
        labels={compLabels}
      />,
    )
    // §10: AN INTERFACE SAYS WHAT IS POSSIBLE. A count somebody cannot act on
    // is a notification, so it is the anchors that get enumerated — each one
    // carrying its own label and its own figure.
    const links = [...container.querySelectorAll('a')]
    expect(links).toHaveLength(3)
    const expected = [
      ['Within 30 days', '119'],
      ['Within 60 days', '120'],
      ['Within 90 days', '120'],
    ]
    expected.forEach(([label, count], index) => {
      expect(links[index]!.getAttribute('href')).toBe('/safety')
      expect(links[index]!.textContent).toContain(label!)
      expect(links[index]!.textContent).toContain(count!)
    })
  })

  it('says the horizons are cumulative', () => {
    // WITHOUT THIS, 90 READS AS "a comfortable quarter away" when it is in fact
    // the same 119 certificates the 30-day figure is about.
    render(
      <CompliancePanel
        expiring={{ d30: 119, d60: 120, d90: 120 }}
        dqf={{ complete: 44, incomplete: 13 }}
        labels={compLabels}
      />,
    )
    expect(
      screen.getByText(
        'Cumulative: within 60 days includes the ones within 30.',
      ),
    ).toBeTruthy()
  })

  it('states the DQF split as a figure, not only as an arc', () => {
    // A RING ALONE IS A PROPORTION. The ruling asks for complete/incomplete as
    // numbers, so the legend beside the ring is what carries them — scoped by
    // its position next to the svg, because the hidden table says the same
    // words and would satisfy a looser query while the screen said nothing.
    const { container } = render(
      <CompliancePanel
        expiring={{ d30: 0, d60: 0, d90: 0 }}
        dqf={{ complete: 44, incomplete: 13 }}
        labels={compLabels}
      />,
    )
    const legend = container.querySelector('svg + ul')
    expect(legend?.textContent).toContain('Complete')
    expect(legend?.textContent).toContain('44')
    expect(legend?.textContent).toContain('Incomplete')
    expect(legend?.textContent).toContain('13')
    // AND THE ARC SAYS THE DENOMINATOR, which the legend does not: 44 of 57 is
    // the claim, and 44 beside 13 leaves the reader to add.
    //
    // QUERIED DIRECTLY, not with `getByTitle`. The `<title>` is a child of the
    // `circle` it describes, which is how SVG attaches a tooltip to a shape;
    // Testing Library's title query only looks at `[title]` and `svg > title`,
    // so it reported the element as absent when it is present and correct.
    const titles = [...container.querySelectorAll('title')].map(
      (node) => node.textContent,
    )
    expect(titles).toContain('Complete: 44 / 57')
  })

  it('draws no arc at all when there is no qualifiable roster', () => {
    // 0/0 IS A DIVISION, and the ring is skipped rather than drawn at `NaN`.
    const { container } = render(
      <CompliancePanel
        expiring={{ d30: 0, d60: 0, d90: 0 }}
        dqf={{ complete: 0, incomplete: 0 }}
        labels={compLabels}
      />,
    )
    expect(container.innerHTML).not.toContain('NaN')
    expect(container.querySelectorAll('circle')).toHaveLength(1)
  })

  it('repeats every figure in a hidden table', () => {
    render(
      <CompliancePanel
        expiring={{ d30: 119, d60: 120, d90: 120 }}
        dqf={{ complete: 44, incomplete: 13 }}
        labels={compLabels}
      />,
    )
    const table = screen.getByRole('table')
    expect(table.querySelectorAll('tbody tr')).toHaveLength(5)
  })
})
