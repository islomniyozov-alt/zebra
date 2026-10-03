import { describe, expect, it } from 'vitest'
import { Prisma } from '@/generated/prisma/client'
import { panelFigures } from '@/lib/dashboard-counts'

// ---------------------------------------------------------------------------
// WHAT THE PANEL STATEMENT ASKS FOR, read off the statement itself.
//
// ── WHY A FAKE TRANSACTION AND NOT POSTGRES ──────────────────────────────
//
// §6.1.1 makes Cash money-roles-only, and the owner's ruling is that its QUERY
// DOES NOT RUN for a role without `load.financials` — not that its answer is
// dropped. Those are different claims and only one of them is about the
// database's reply.
//
// THE INTEGRATION TEST COULD NOT TELL THEM APART. It asserts `aging === null`,
// which the return branch decides, so a `cashColumns` that always emitted the
// seven receivables subqueries still satisfied it: watched under
// `watch-guard.mjs`, that break left the suite GREEN. Third time today that a
// guard proved a weaker claim than its name.
//
// So this reads the SQL. A stub `tx` records the `Prisma.Sql` it is handed and
// returns one canned row, which is enough for the whole reader — the claim is
// about what was SENT, and the only thing that can witness it is the text.
// ---------------------------------------------------------------------------

const WINDOW = {
  from: new Date(Date.UTC(2026, 6, 5)),
  to: new Date(Date.UTC(2026, 9, 4)),
}
const NOW = new Date(Date.UTC(2026, 9, 2))

/** Every column the reader destructures, so the stub survives the mapping. */
const ROW = {
  trucks_paired: 1n,
  trucks_idle: 2n,
  drivers_paired: 3n,
  drivers_idle: 4n,
  moving_now: 5n,
  d0_30: 6n,
  d31_60: 7n,
  d61_90: 8n,
  d90plus: 9n,
  draft_cents: 10n,
  final_cents: 11n,
  paid_cents: 12n,
  exp_30: 13n,
  exp_60: 14n,
  exp_90: 15n,
}

/**
 * A `tx` that records the statement text instead of running it.
 *
 * `$queryRaw` IS CALLED AS A TAGGED TEMPLATE, so what arrives is the strings
 * array and the interpolated values — not a `Prisma.Sql`. Reading `.sql` off it
 * gave `undefined`, and chai answered with "the given combination of arguments
 * (undefined and string) is invalid" rather than with a failed assertion about
 * SQL. Joining the fragments reconstructs what Postgres would be sent, with a
 * placeholder where each value went, which is all these assertions are about.
 */
function recordingTx() {
  const sent: string[] = []
  const tx = {
    $queryRaw: (
      query: TemplateStringsArray | Prisma.Sql,
      ...values: unknown[]
    ) => {
      // COMPOSED WITH `Prisma.sql`, WHICH IS WHAT PRISMA ITSELF DOES. Joining
      // the strings array by hand left a placeholder wherever a NESTED fragment
      // was interpolated — and the cash columns and every company-scope clause
      // are nested fragments, so the half of the statement these tests are
      // about was exactly the half that went missing. The assertions then
      // "failed" against a reconstruction rather than against the SQL.
      sent.push(
        Array.isArray(query)
          ? Prisma.sql(query as TemplateStringsArray, ...values).sql
          : (query as Prisma.Sql).sql,
      )
      return Promise.resolve([ROW])
    },
  }
  return { tx: tx as never, sent }
}

const textOf = (sent: string[]) => {
  expect(sent).toHaveLength(1)
  return sent[0]!
}

/**
 * HOW MANY TIMES, not whether at all.
 *
 * Two breaks refused to fire against `toContain` and both were the same
 * mistake: a predicate removed from ONE of four aging buckets left the phrase
 * in the other three, and a horizon replaced by `0::bigint AS exp_30` left its
 * own alias in the text. Presence is satisfied by a survivor; the claim is
 * about every copy. AGENTS.md: count the thing you are claiming.
 */
const occurrences = (haystack: string, needle: string) =>
  haystack.split(needle).length - 1

describe('panelFigures sends one statement', () => {
  it('and it is one statement, whoever is asking', async () => {
    // THE WHOLE POINT OF THE READER. Five tiles, four aging buckets, three
    // pipeline figures and three horizons in a single round trip — flag 31 is
    // the screen that expired a transaction with eighteen statements in it.
    const money = recordingTx()
    await panelFigures(money.tx, [], WINDOW, NOW, { cash: true })
    expect(money.sent).toHaveLength(1)

    const dispatcher = recordingTx()
    await panelFigures(dispatcher.tx, [], WINDOW, NOW, { cash: false })
    expect(dispatcher.sent).toHaveLength(1)
  })
})

describe("a role without load.financials: the cash query DOESN'T RUN", () => {
  it('leaves every receivables subquery out of the statement', async () => {
    const { tx, sent } = recordingTx()
    await panelFigures(tx, [], WINDOW, NOW, { cash: false })
    const sql = textOf(sent)

    for (const column of ['d0_30', 'd31_60', 'd61_90', 'd90plus']) {
      expect(sql).not.toContain(column)
    }
    // NOT MERELY THE ALIASES: the TABLE must not be read either, or the
    // carrier's receivables were scanned and the labels withheld.
    expect(sql).not.toContain('"Invoice"')
  })

  it('leaves the settlement pipeline out of the statement', async () => {
    const { tx, sent } = recordingTx()
    await panelFigures(tx, [], WINDOW, NOW, { cash: false })
    const sql = textOf(sent)

    for (const column of ['draft_cents', 'final_cents', 'paid_cents']) {
      expect(sql).not.toContain(column)
    }
    expect(sql).not.toContain('"SettlementBatch"')
  })

  it('still asks for the fleet and the compliance horizons', async () => {
    // THE CONTROL, AND THE REASON THIS IS ONE STATEMENT RATHER THAN TWO. If
    // withholding cash also withheld these, a dispatcher would get a page with
    // no fleet on it — which is what shipped for one commit.
    const { tx, sent } = recordingTx()
    await panelFigures(tx, [], WINDOW, NOW, { cash: false })
    const sql = textOf(sent)

    for (const column of [
      'trucks_paired',
      'trucks_idle',
      'drivers_paired',
      'drivers_idle',
      'moving_now',
      'exp_30',
      'exp_60',
      'exp_90',
    ]) {
      expect(sql).toContain(column)
    }

    // AND THE COLUMNS ARE COMPUTED, not just named. `0::bigint AS exp_30`
    // carries the alias and answers nothing — which is exactly what the guard
    // caught this assertion failing to notice. Three horizons, three reads of
    // the table; two trucks subqueries and one load scan for the tiles.
    expect(occurrences(sql, 'FROM "ComplianceItem"')).toBe(3)
    expect(occurrences(sql, 'FROM "Truck"')).toBe(2)
    expect(occurrences(sql, 'FROM "Load"')).toBe(1)
  })

  it('and reports the cash figures as null rather than as zero', async () => {
    // ZERO IS A CLAIM ABOUT THE CARRIER'S RECEIVABLES. Null is a claim about
    // the reader, and `Number(undefined)` would have been neither.
    const { tx } = recordingTx()
    const figures = await panelFigures(tx, [], WINDOW, NOW, { cash: false })

    expect(figures.aging).toBeNull()
    expect(figures.pipeline).toBeNull()
    expect(figures.fleet.trucksPaired).toBe(1)
    expect(figures.expiring.d30).toBe(13)
  })
})

describe('a money role gets the cash half', () => {
  it('asks for all seven figures in the same one statement', async () => {
    const { tx, sent } = recordingTx()
    const figures = await panelFigures(tx, [], WINDOW, NOW, { cash: true })
    const sql = textOf(sent)

    for (const column of [
      'd0_30',
      'd31_60',
      'd61_90',
      'd90plus',
      'draft_cents',
      'final_cents',
      'paid_cents',
    ]) {
      expect(sql).toContain(column)
    }
    expect(figures.aging).toEqual({
      d0_30: 6,
      d31_60: 7,
      d61_90: 8,
      d90plus: 9,
    })
    expect(figures.pipeline).toEqual({
      draftCents: 10,
      finalCents: 11,
      paidCents: 12,
    })
  })

  it('defaults to asking, so a caller that forgets does not silently hide money', async () => {
    // FAILING OPEN IS RIGHT HERE and failing closed would be wrong: the gate
    // is the PAGE's permission check, and a default of `cash: false` would make
    // every existing caller quietly return nulls that render as em dashes.
    const { tx, sent } = recordingTx()
    await panelFigures(tx, [], WINDOW, NOW)
    expect(textOf(sent)).toContain('d0_30')
  })

  it('excludes factored paper and unsent drafts in the statement itself', async () => {
    // THE PREDICATE IS THE CLAIM. The integration test proves the arithmetic
    // against real rows; this proves the two exclusions are in the text, which
    // is what a reviewer reading the panel's promise would check.
    const { tx, sent } = recordingTx()
    await panelFigures(tx, [], WINDOW, NOW, { cash: true })
    const sql = textOf(sent)

    // ONCE PER BUCKET, FOUR BUCKETS. Removing the clause from one of the four
    // leaves it in the other three, so `toContain` is satisfied by a survivor
    // while the 0–30 bucket quietly counts the factor's money — the break that
    // refused to fire, and the reason these are counts.
    expect(occurrences(sql, '"isFactored" = false')).toBe(4)
    expect(occurrences(sql, "'DRAFT', 'VOID', 'WRITTEN_OFF'")).toBe(4)
    expect(occurrences(sql, 'FROM "Invoice"')).toBe(4)
    // AND THE PIPELINE READS THE BATCH'S STATUS, three times, one per status.
    expect(occurrences(sql, 'FROM "Settlement"')).toBe(3)
    expect(occurrences(sql, '"SettlementBatch"')).toBe(3)
  })
})

describe('the company scope', () => {
  it('means every authority when it is empty, not none', async () => {
    // AN EMPTY ARRAY RENDERED AS `= ANY('{}')` MATCHES NOTHING, which would
    // empty all three panels at once — the failure here that looks like good
    // news. So an unscoped read carries no company clause at all.
    const { tx, sent } = recordingTx()
    await panelFigures(tx, [], WINDOW, NOW, { cash: true })
    expect(textOf(sent)).not.toContain('"companyId" = ANY')
  })

  it('and narrows every half when it is set', async () => {
    const { tx, sent } = recordingTx()
    await panelFigures(tx, ['company-1'], WINDOW, NOW, { cash: true })
    const sql = textOf(sent)

    // ONE CLAUSE PER TABLE THE STATEMENT TOUCHES, because each subquery has its
    // own alias and a scope applied to four of seven is a tenancy hole.
    for (const alias of ['"t"', '"dr"', '"l"', '"i"', '"s"', '"ci"']) {
      expect(sql).toContain(`AND ${alias}."companyId" = ANY`)
    }
  })
})
