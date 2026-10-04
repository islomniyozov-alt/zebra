import { describe, expect, it } from 'vitest'
import { Prisma } from '@/generated/prisma/client'
import { netPayByDriverWeek, pipelineStrip } from '@/lib/accounting-reports'

// ---------------------------------------------------------------------------
// WHAT THE PAYROLL READERS SEND, read off the statement itself.
//
// ── WHY THIS IS NOT IN THE INTEGRATION FILE ──────────────────────────────
//
// `tests/integration/payroll-figures.test.ts` asserted "asks Postgres nothing
// when there are no drivers on screen" by checking the RESULT was empty — and
// the break that removes the early return left it green, because
// `= ANY('{}')` matches nothing and the result is empty either way. The claim is
// about the ROUND TRIP, and only the statement can witness it.
//
// Same stub as `tests/dashboard-counts.test.ts`: a `tx` that records what it is
// handed instead of running it.
// ---------------------------------------------------------------------------

function recordingTx() {
  const sent: string[] = []
  const tx = {
    $queryRaw: (
      query: TemplateStringsArray | Prisma.Sql,
      ...values: unknown[]
    ) => {
      // COMPOSED WITH `Prisma.sql`, which is what Prisma itself does — joining
      // the strings by hand loses every nested fragment, and the scope clauses
      // and bucket expressions here are all nested fragments.
      sent.push(
        Array.isArray(query)
          ? Prisma.sql(query as TemplateStringsArray, ...values).sql
          : (query as Prisma.Sql).sql,
      )
      return Promise.resolve([])
    },
  }
  return { tx: tx as never, sent }
}

describe('netPayByDriverWeek', () => {
  it('sends NOTHING when there are no drivers on screen', async () => {
    const { tx, sent } = recordingTx()
    const series = await netPayByDriverWeek(tx, [], new Date())

    // THE ROUND TRIP IS THE CLAIM. A query with `= ANY('{}')` would return the
    // same empty map after 200ms over the wire to us-east-2.
    expect(sent).toHaveLength(0)
    expect(series.size).toBe(0)
  })

  it('and one statement for however many drivers there are', async () => {
    const { tx, sent } = recordingTx()
    await netPayByDriverWeek(tx, ['drv_1', 'drv_2', 'drv_3'], new Date())

    // ONE, not one per driver: a query per row is fifty round trips on a list of
    // fifty, which is the shape flag 31 is about.
    expect(sent).toHaveLength(1)
    expect(sent[0]).toContain('"Settlement"')
    // FINAL AND PAID ONLY — a draft is recomputed on every refresh.
    //
    // THE SQL LITERAL, not the bare word: the statement's own comment explains
    // why a DRAFT is excluded, and `not.toContain('DRAFT')` failed on the
    // explanation rather than on a predicate.
    expect(sent[0]).toContain("'FINAL', 'PAID'")
    expect(sent[0]).not.toContain("'DRAFT'")
  })

  it('buckets on a SUNDAY, not on Postgres’s Monday', async () => {
    const { tx, sent } = recordingTx()
    await netPayByDriverWeek(tx, ['drv_1'], new Date())

    // MONEY-DESIGN §0. `date_trunc('week')` is Monday in Postgres, so the day is
    // shifted in and back out; getting this wrong moves a Sunday's pay into the
    // week before the statement that paid it.
    expect(sent[0]).toContain("date_trunc('week'")
    expect(sent[0]).toContain("interval '1 day'")
  })
})

describe('pipelineStrip', () => {
  it('takes no period, so it cannot be windowed by accident', () => {
    // §6.2.9 AND §6.2.8's BALANCE RULE, enforced by the signature rather than by
    // a comment: there is no argument to pass a window to. Asserted on the
    // function's arity because a third parameter added later would be the first
    // step back to a windowed balance.
    expect(pipelineStrip).toHaveLength(2)
  })

  it('groups by the BATCH status and counts runs, not statements', async () => {
    const { tx, sent } = recordingTx()
    await pipelineStrip(tx, [])

    expect(sent).toHaveLength(1)
    // THE BATCH IS WHAT MOVES through draft, final and paid; a settlement's own
    // status does not carry "paid".
    expect(sent[0]).toContain('b."status"::text AS status')
    expect(sent[0]).toContain('COUNT(DISTINCT b."id")')
  })

  it('and an unscoped read means every authority, not none', async () => {
    const { tx, sent } = recordingTx()
    await pipelineStrip(tx, [])
    // `= ANY('{}')` MATCHES NOTHING, which would empty the strip — the failure
    // here that looks like good news.
    expect(sent[0]).not.toContain('"companyId" = ANY')
  })
})
