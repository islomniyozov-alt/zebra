import { readFileSync } from 'node:fs'
import { beforeEach, describe, expect, it, vi } from 'vitest'

// ---------------------------------------------------------------------------
// TMS §6.2.10 PART 7 STEP 4 — THE STATEMENT PAGE IN DATATRUCK'S SHAPE (v11.33).
//
// RPM is the one figure that is not a stored column or a sum: a ratio, in
// `money.ts`. The tabs are one split of the lines (`statement-tabs.ts`) that
// the strip's counts and the rows both read. Add deduction on a batch
// statement is step 3's scoped one-time charge for one statement. The head's
// new CTEs are held equal to Prisma reads in
// tests/integration/settlement-page-head.test.ts.
// ---------------------------------------------------------------------------

const refreshDraft = vi.fn(async () => ({ ok: true as const }))
vi.mock('@/lib/settlement-batch', () => ({
  refreshDraft: (...args: unknown[]) =>
    (refreshDraft as (...a: unknown[]) => unknown)(...args),
}))

const { ratePerMileCents } = await import('@/lib/money')
const {
  STATEMENT_TABS,
  deductionLineTab,
  handLineTab,
  statementTabCounts,
  statementTabOf,
} = await import('@/lib/statement-tabs')
const { addStatementCharge } = await import('@/lib/batch-charges')

beforeEach(() => refreshDraft.mockClear())

describe('RPM (R15): gross ÷ miles, shown and never stored', () => {
  it('matches Datatruck’s sample: $6,940.68 over 2,055.77 mi is $3.38', () => {
    expect(ratePerMileCents(694_068, 205_577)).toBe(338)
  })

  it('rounds half up on the cent, mirrored for a negative gross', () => {
    // 100 cents over 0.40 mi = 250 exactly; 1 cent over 2 mi = 0.5 → 1.
    expect(ratePerMileCents(100, 40)).toBe(250)
    expect(ratePerMileCents(1, 200)).toBe(1)
    expect(ratePerMileCents(1, 201)).toBe(0)
    expect(ratePerMileCents(-1, 200)).toBe(-1)
  })

  it('is null — a dash — with no miles, never a zero', () => {
    expect(ratePerMileCents(694_068, 0)).toBeNull()
    expect(ratePerMileCents(694_068, -5)).toBeNull()
    expect(ratePerMileCents(1.5, 100)).toBeNull()
  })

  it('is stored nowhere: no column, no write', () => {
    const schema = readFileSync('prisma/schema.prisma', 'utf8')
    expect(schema).not.toMatch(/rpm|ratePerMile/i)
  })
})

describe('the seven tabs (R16): one split, counts from it, a zero shown', () => {
  it('lists the seven in Datatruck’s order and reads ?tab=, Trips by default', () => {
    expect(STATEMENT_TABS).toEqual([
      'trips',
      'fuel',
      'toll',
      'balances',
      'recurring',
      'oneTime',
      'attachments',
    ])
    expect(statementTabOf('recurring')).toBe('recurring')
    expect(statementTabOf(['toll'])).toBe('toll')
    expect(statementTabOf('nope')).toBe('trips')
    expect(statementTabOf(undefined)).toBe('trips')
  })

  it('sends each batch line to one tab: escrow before rule, imports before rule', () => {
    const line = (type: string, rule: string | null = null) => ({
      type,
      recurringDeductionId: rule,
    })
    // Escrow is a rule too, and it belongs with the balances.
    expect(deductionLineTab(line('Escrow', 'rule-1'))).toBe('balances')
    expect(deductionLineTab(line('Fuel'))).toBe('fuel')
    expect(deductionLineTab(line('Tolls'))).toBe('toll')
    expect(deductionLineTab(line('Insurance', 'rule-2'))).toBe('recurring')
    expect(deductionLineTab(line('Other'))).toBe('oneTime')
    expect(deductionLineTab(line('Insurance'))).toBe('oneTime')
  })

  it('puts hand-added escrow with the balances and every other hand line in one-time', () => {
    expect(handLineTab('DEDUCTION_ESCROW')).toBe('balances')
    expect(handLineTab('DEDUCTION_OTHER')).toBe('oneTime')
    expect(handLineTab('REIMBURSEMENT')).toBe('oneTime')
  })

  it('counts what each tab renders, a zero kept, the fuel line not counted twice', () => {
    expect(
      statementTabCounts({
        trips: 3,
        fuelRows: 2,
        tollRows: 0,
        deductionLines: [
          { type: 'Escrow', recurringDeductionId: 'r1' },
          { type: 'Insurance', recurringDeductionId: 'r2' },
          { type: 'Admin Fee', recurringDeductionId: 'r3' },
          { type: 'Fuel', recurringDeductionId: null },
          { type: 'Other', recurringDeductionId: null },
        ],
        handLineTypes: ['DEDUCTION_ESCROW', 'BONUS'],
        documents: 1,
        hasNotes: true,
      }),
    ).toEqual({
      trips: 3,
      fuel: 2,
      toll: 0,
      balances: 2,
      recurring: 2,
      oneTime: 2,
      attachments: 2,
    })
  })
})

describe('Add deduction on a statement: step 3’s scoped charge for one statement', () => {
  const periodEnd = new Date('2026-11-14T00:00:00.000Z')
  const fakeTx = (input: {
    statement: { batchId: string | null; driverId: string } | null
    status?: string
    rebuiltId?: string | null
  }) => {
    const created: unknown[] = []
    const tx = {
      settlement: {
        findFirst: async (args: { where: { id?: string } }) =>
          args.where.id
            ? input.statement
            : input.rebuiltId === null
              ? null
              : { id: input.rebuiltId ?? 'rebuilt' },
        findMany: async () =>
          input.statement
            ? [
                {
                  id: 's1',
                  batchId: input.statement.batchId,
                  status: input.status ?? 'DRAFT',
                  driverId: input.statement.driverId,
                  settlementNumber: 'ST-1',
                  driver: { firstName: 'A', lastName: 'B' },
                },
              ]
            : [],
      },
      settlementBatch: {
        findFirst: async () => ({
          id: 'b1',
          organizationId: 'org',
          companyId: 'ram',
          status: 'DRAFT',
          periodEnd,
        }),
      },
      settlementCharge: {
        createMany: async (args: { data: unknown[] }) => {
          created.push(...args.data)
          return { count: args.data.length }
        },
      },
    }
    return { tx: tx as never, created }
  }
  const ask = {
    settlementId: 's1',
    type: 'Other',
    description: 'Late delivery',
    amountCents: 5_000,
  }

  it('writes the batch’s scoped charge, refreshes, and names the rebuilt statement', async () => {
    const { tx, created } = fakeTx({
      statement: { batchId: 'b1', driverId: 'd1' },
      rebuiltId: 's1-new',
    })
    expect(await addStatementCharge(tx, ask)).toEqual({
      ok: true,
      settlementId: 's1-new',
    })
    expect(created).toEqual([
      {
        organizationId: 'org',
        driverId: 'd1',
        type: 'Other',
        description: 'Late delivery',
        amountCents: -5_000,
        appliesOn: periodEnd,
        companyId: 'ram',
        batchId: 'b1',
      },
    ])
    expect(refreshDraft).toHaveBeenCalledWith(tx, 'b1')
  })

  it('refuses a statement with no batch, a posted one and a missing one, by name', async () => {
    expect(
      await addStatementCharge(
        fakeTx({ statement: { batchId: null, driverId: 'd1' } }).tx,
        ask,
      ),
    ).toEqual({ ok: false, reason: 'no_batch' })
    expect(
      await addStatementCharge(
        fakeTx({
          statement: { batchId: 'b1', driverId: 'd1' },
          status: 'APPROVED',
        }).tx,
        ask,
      ),
    ).toEqual({ ok: false, reason: 'not_unposted' })
    expect(
      await addStatementCharge(fakeTx({ statement: null }).tx, ask),
    ).toEqual({ ok: false, reason: 'not_found' })
    expect(refreshDraft).not.toHaveBeenCalled()
  })
})

describe('the page, wired', () => {
  const page = readFileSync('src/app/(app)/settlements/[id]/page.tsx', 'utf8')
  const actions = readFileSync('src/app/(app)/settlements/actions.ts', 'utf8')

  it('carries the four cards and the four actions', () => {
    for (const card of ['settlement', 'earnings', 'fuel', 'trips'])
      expect(page, card).toContain(`t('statement.card.${card}')`)
    expect(page).toContain("approve: t('workbench.post')")
    expect(page).toContain("t('workbench.addDeduction')")
    expect(page).toContain("send: t('workbench.sendToDriver')")
    expect(page).toContain("t('workbench.download')")
  })

  it('shows every tab with its count from the one split (R16)', () => {
    expect(page).toContain('tabs={STATEMENT_TABS.map((key) => ({')
    expect(page).toContain('count: counts[key],')
    expect(page).toContain('statementTabCounts({')
  })

  it('prints RPM from money.ts and Total pay as the stored gross', () => {
    expect(page).toContain('ratePerMileCents(')
    const totalPay = page.slice(page.indexOf("t('statement.totalPay')"))
    expect(totalPay.slice(0, 120)).toContain('money(settlement.grossCents)')
  })

  it('adds a deduction to a batch draft through the scoped charge, never a hand line', () => {
    expect(page).toContain('const mayAddCharge = mayAdd && inBatch')
    expect(page).toContain('const mayAddLine = mayAdd && !inBatch')
    // Every add-row is gated on a statement with no batch.
    expect(page.match(/canAdd=\{mayAdd\}/g)).toBeNull()
    expect(actions).toContain('addStatementCharge(tx, {')
  })
})
