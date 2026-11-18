import { readFileSync } from 'node:fs'
import { beforeEach, describe, expect, it, vi } from 'vitest'

// ---------------------------------------------------------------------------
// §6.2.10 PART 7 STEP 3 — THE BATCH SCREEN IN DATATRUCK'S SHAPE (v11.32).
//
// Every figure the screen shows is a stored statement column or a sum of
// them; the verbs it adds refresh the draft through the engine's own
// `refreshDraft`, which is mocked here so the verbs' own decisions are what
// is under test. The page's one-statement head is held equal to Prisma reads
// in tests/integration/batch-page-head.test.ts.
// ---------------------------------------------------------------------------

const refreshDraft = vi.fn(async () => ({ ok: true as const }))
vi.mock('@/lib/settlement-batch', () => ({
  refreshDraft: (...args: unknown[]) =>
    (refreshDraft as (...a: unknown[]) => unknown)(...args),
}))
const sendStatementToDriver = vi.fn()
vi.mock('@/lib/statement-send', () => ({
  sendStatementToDriver: (...args: unknown[]) =>
    (sendStatementToDriver as (...a: unknown[]) => unknown)(...args),
}))

const {
  BATCH_STATEMENT_COLUMNS,
  BATCH_STATEMENT_COLUMNS_HIDDEN,
  batchEditable,
  batchTabCounts,
  batchTabOf,
  batchTotals,
  datatruckWeekNumber,
  excludedDrivers,
  statementsForTab,
} = await import('@/lib/batch-statements')
const { addBatchCharge, batchChargeInputRefusal, BATCH_CHARGE_TYPES } =
  await import('@/lib/batch-charges')
const { includeDriver } = await import('@/lib/batch-exclusions')
const { sendBatchStatement, BATCH_SEND_REASON } = await import(
  '@/lib/batch-send'
)
const { gridColumnsFromRow } = await import('@/lib/grid-columns')
const { isMessageKey, translator } = await import('@/lib/i18n')

beforeEach(() => {
  refreshDraft.mockClear()
  sendStatementToDriver.mockReset()
})

const figures = (
  status: string,
  over: Partial<Record<string, number>> = {},
) => ({
  status,
  lines: 2,
  grossCents: 100_000,
  earningsCents: 90_000,
  otherPayCents: 1_000,
  reimbursementsCents: 500,
  deductionsCents: -20_000,
  advancesCents: 0,
  netCents: 71_500,
  ...over,
})

describe('the tabs: All · Unposted · Posted · Paid', () => {
  const rows = [
    figures('DRAFT'),
    figures('APPROVED'),
    figures('APPROVED'),
    figures('PAID'),
    figures('VOID'),
  ]

  it('filter by the stored status the office word names', () => {
    expect(statementsForTab(rows, 'unposted').map((r) => r.status)).toEqual([
      'DRAFT',
    ])
    expect(statementsForTab(rows, 'posted')).toHaveLength(2)
    expect(statementsForTab(rows, 'paid').map((r) => r.status)).toEqual([
      'PAID',
    ])
    // All includes the void one; no tab is Void's alone.
    expect(statementsForTab(rows, 'all')).toHaveLength(5)
    expect(batchTabCounts(rows)).toEqual({
      all: 5,
      unposted: 1,
      posted: 2,
      paid: 1,
    })
  })

  it('reads ?tab= and falls back to All, never an empty table', () => {
    expect(batchTabOf('posted')).toBe('posted')
    expect(batchTabOf(['paid', 'x'])).toBe('paid')
    expect(batchTabOf('void')).toBe('all')
    expect(batchTabOf(undefined)).toBe('all')
  })

  it('is editable while any statement is Unposted', () => {
    expect(batchEditable('DRAFT')).toBe(true)
    expect(batchEditable('PARTIAL')).toBe(true)
    expect(batchEditable('FINAL')).toBe(false)
    expect(batchEditable('PAID')).toBe(false)
  })
})

describe('the rail: every figure a sum of a stored column', () => {
  it('sums the non-void statements, column by column', () => {
    const totals = batchTotals([
      figures('DRAFT'),
      figures('APPROVED', { grossCents: 50_000, netCents: 40_000, lines: 1 }),
      // A VOID statement is history: not money, not counted.
      figures('VOID', { grossCents: 999_999, netCents: 999_999, lines: 9 }),
    ])
    expect(totals).toEqual({
      trips: 3,
      statements: 2,
      unposted: 1,
      posted: 1,
      paid: 0,
      grossCents: 150_000,
      totalPayCents: 150_000,
      earningsCents: 180_000,
      otherPayCents: 2_000,
      reimbursementsCents: 1_000,
      deductionsCents: -40_000,
      advancesCents: 0,
      netCents: 111_500,
    })
  })

  it('prints Total pay as the same stored figure as Total gross (R12 as reversed)', () => {
    const totals = batchTotals([figures('DRAFT', { grossCents: 694_068 })])
    expect(totals.totalPayCents).toBe(totals.grossCents)
    expect(totals.totalPayCents).toBe(694_068)
  })

  it('is zero, not undefined, for an empty batch', () => {
    expect(batchTotals([]).netCents).toBe(0)
    expect(batchTotals([]).statements).toBe(0)
  })
})

describe('the week number (R8, provisional)', () => {
  const day = (iso: string) => new Date(`${iso}T00:00:00.000Z`)

  it('matches the one Datatruck sample: 11/01/2026 is week 44', () => {
    expect(datatruckWeekNumber(day('2026-11-01'))).toBe(44)
    expect(datatruckWeekNumber(day('2026-11-08'))).toBe(45)
  })

  it('counts week 1 from the year’s first Sunday', () => {
    expect(datatruckWeekNumber(day('2026-01-04'))).toBe(1)
    expect(datatruckWeekNumber(day('2026-01-10'))).toBe(1)
    expect(datatruckWeekNumber(day('2026-01-11'))).toBe(2)
  })

  it('puts a period starting before that Sunday in the previous year’s count', () => {
    // 2025's first Sunday is 01/05; 2026-01-01 is 361 days on.
    expect(datatruckWeekNumber(day('2026-01-01'))).toBe(52)
  })
})

describe('the table: ten columns, Truck behind the chooser (R11)', () => {
  it('declares the ten in Datatruck’s order, Statement first', () => {
    expect(BATCH_STATEMENT_COLUMNS).toEqual([
      'statement',
      'driverType',
      'truck',
      'payee',
      'status',
      'trips',
      'payRule',
      'totalPay',
      'totalGross',
      'netPay',
    ])
    expect(BATCH_STATEMENT_COLUMNS_HIDDEN).toEqual(['truck'])
  })

  it('shows nine by default, never more, and puts Truck back on request', () => {
    const none = gridColumnsFromRow(
      'settlements.batch',
      BATCH_STATEMENT_COLUMNS,
      BATCH_STATEMENT_COLUMNS_HIDDEN,
      null,
    ).visible
    expect(none).toHaveLength(9)
    expect(none).not.toContain('truck')
    const chosen = gridColumnsFromRow(
      'settlements.batch',
      BATCH_STATEMENT_COLUMNS,
      BATCH_STATEMENT_COLUMNS_HIDDEN,
      { value: { hidden: ['payRule'] }, organizationId: 'org' },
    ).visible
    expect(chosen).toContain('truck')
    expect(chosen).not.toContain('payRule')
    expect(chosen.length).toBeLessThanOrEqual(9)
  })

  it('renders each column from a stored statement field, Total pay from grossCents', () => {
    const page = readFileSync(
      'src/app/(app)/settlements/batches/[id]/page.tsx',
      'utf8',
    )
    for (const key of BATCH_STATEMENT_COLUMNS)
      expect(page, key).toContain(`key: '${key}'`)
    const totalPay = page.slice(page.indexOf("key: 'totalPay'"))
    expect(totalPay.slice(0, 400)).toContain('money(row.grossCents)')
    // Nothing priced on the page: no engine pricing call in the render.
    expect(page).not.toMatch(/payFor\(|grossFor\(|computeDriverSettlement/)
  })

  it('is a document-scoped grid: a chooser, no export', () => {
    const route = readFileSync('src/app/(app)/exports/route.ts', 'utf8')
    const notExportable = route.slice(
      route.indexOf('const NOT_EXPORTABLE'),
      route.indexOf('const isExportable'),
    )
    expect(notExportable).toContain("'settlements.batch'")
  })
})

describe('Add driver (R14 (b))', () => {
  it('lists each driver this batch left a trip of out, by id, with the trips', () => {
    expect(
      excludedDrivers([
        { excluded: true, driverId: 'd2', driverName: 'Zed', loadId: 'l1' },
        { excluded: false, driverId: 'd2', driverName: 'Zed', loadId: 'l2' },
        { excluded: true, driverId: 'd1', driverName: 'Amy', loadId: 'l3' },
        { excluded: true, driverId: 'd2', driverName: 'Zed', loadId: 'l4' },
        { excluded: true, driverId: null, driverName: null, loadId: 'l5' },
      ]),
    ).toEqual([
      { driverId: 'd1', driverName: 'Amy', loadIds: ['l3'] },
      { driverId: 'd2', driverName: 'Zed', loadIds: ['l1', 'l4'] },
    ])
  })

  const fakeTx = (input: { status: string | null; excluded: string[] }) => {
    const deleted: unknown[] = []
    const found: unknown[] = []
    const tx = {
      settlementBatch: {
        findFirst: async () =>
          input.status === null
            ? null
            : { id: 'b1', organizationId: 'o', status: input.status },
      },
      settlementBatchExclusion: {
        findMany: async (args: unknown) => {
          found.push(args)
          return input.excluded.map((loadId) => ({ loadId }))
        },
        deleteMany: async (args: unknown) => {
          deleted.push(args)
          return { count: input.excluded.length }
        },
        count: async () => 0,
      },
    }
    return { tx: tx as never, deleted, found }
  }

  it('puts back exactly that driver’s excluded trips, read from the batch, then refreshes', async () => {
    const { tx, deleted, found } = fakeTx({
      status: 'PARTIAL',
      excluded: ['l1', 'l4'],
    })
    const outcome = await includeDriver(tx, { batchId: 'b1', driverId: 'd2' })
    expect(outcome.ok).toBe(true)
    expect(found[0]).toEqual({
      where: { batchId: 'b1', load: { driverId: 'd2' } },
      select: { loadId: true },
    })
    expect(deleted[0]).toEqual({
      where: { batchId: 'b1', loadId: { in: ['l1', 'l4'] } },
    })
    expect(refreshDraft).toHaveBeenCalledWith(tx, 'b1')
  })

  it('refuses by name: nothing left out, a posted batch, a missing one', async () => {
    expect(
      await includeDriver(fakeTx({ status: 'DRAFT', excluded: [] }).tx, {
        batchId: 'b1',
        driverId: 'd9',
      }),
    ).toEqual({ ok: false, reason: { kind: 'no_trips' } })
    expect(
      await includeDriver(fakeTx({ status: 'FINAL', excluded: ['l1'] }).tx, {
        batchId: 'b1',
        driverId: 'd2',
      }),
    ).toEqual({ ok: false, reason: { kind: 'not_draft', status: 'FINAL' } })
    expect(
      await includeDriver(fakeTx({ status: null, excluded: [] }).tx, {
        batchId: 'b1',
        driverId: 'd2',
      }),
    ).toEqual({ ok: false, reason: { kind: 'not_found' } })
    expect(refreshDraft).not.toHaveBeenCalled()
  })
})

describe('Add deduction: a one-time charge the engine reads, then the draft refreshed', () => {
  const periodEnd = new Date('2026-11-14T00:00:00.000Z')
  const statement = (
    id: string,
    over: Partial<{ batchId: string; status: string; driverId: string }> = {},
  ) => ({
    id,
    batchId: 'b1',
    status: 'DRAFT',
    driverId: `drv-${id}`,
    settlementNumber: `ST-${id}`,
    driver: { firstName: 'First', lastName: id },
    ...over,
  })

  const fakeTx = (input: {
    status: string | null
    statements: ReturnType<typeof statement>[]
  }) => {
    const created: unknown[] = []
    const tx = {
      settlementBatch: {
        findFirst: async () =>
          input.status === null
            ? null
            : {
                id: 'b1',
                organizationId: 'org',
                companyId: 'ram',
                status: input.status,
                periodEnd,
              },
      },
      settlement: { findMany: async () => input.statements },
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
    batchId: 'b1',
    type: 'Other',
    description: '  Damaged pallet  ',
    amountCents: 12_500,
  }

  it('writes one negative charge per Unposted statement’s driver, dated the batch’s last day', async () => {
    const { tx, created } = fakeTx({
      status: 'PARTIAL',
      statements: [
        statement('a'),
        statement('b', { status: 'APPROVED' }),
        statement('c', { batchId: 'other' }),
      ],
    })
    const outcome = await addBatchCharge(tx, {
      ...ask,
      settlementIds: ['a', 'b', 'c', 'a'],
    })
    expect(created).toEqual([
      {
        organizationId: 'org',
        driverId: 'drv-a',
        type: 'Other',
        description: 'Damaged pallet',
        amountCents: -12_500,
        appliesOn: periodEnd,
        // THE BATCH'S AUTHORITY AND THE BATCH (MONEY-DESIGN §4, 2026-11-18).
        companyId: 'ram',
        batchId: 'b1',
      },
    ])
    expect(outcome).toEqual({
      ok: true,
      added: 1,
      refused: [
        { statement: 'ST-b', reason: 'not_unposted' },
        { statement: 'ST-c', reason: 'not_on_batch' },
      ],
    })
    expect(refreshDraft).toHaveBeenCalledWith(tx, 'b1')
  })

  it('writes nothing and refreshes nothing when every statement is refused', async () => {
    const { tx, created } = fakeTx({
      status: 'DRAFT',
      statements: [statement('b', { status: 'APPROVED' })],
    })
    const outcome = await addBatchCharge(tx, { ...ask, settlementIds: ['b'] })
    expect(outcome).toMatchObject({ ok: true, added: 0 })
    expect(created).toEqual([])
    expect(refreshDraft).not.toHaveBeenCalled()
  })

  it('refuses a posted or missing batch before writing a charge', async () => {
    for (const status of ['FINAL', 'PAID']) {
      const { tx, created } = fakeTx({ status, statements: [statement('a')] })
      expect(
        await addBatchCharge(tx, { ...ask, settlementIds: ['a'] }),
      ).toEqual({ ok: false, reason: 'not_draft' })
      expect(created).toEqual([])
    }
    expect(
      await addBatchCharge(fakeTx({ status: null, statements: [] }).tx, {
        ...ask,
        settlementIds: ['a'],
      }),
    ).toEqual({ ok: false, reason: 'not_found' })
  })

  it('refuses the form by name: no statement, no description, a bad amount, an engine type', () => {
    const ok = {
      settlementIds: ['a'],
      type: 'Other',
      description: 'x',
      amountCents: 1,
    }
    expect(batchChargeInputRefusal(ok)).toBeNull()
    expect(batchChargeInputRefusal({ ...ok, settlementIds: [] })).toBe(
      'no_statements',
    )
    expect(batchChargeInputRefusal({ ...ok, description: '   ' })).toBe(
      'no_description',
    )
    expect(batchChargeInputRefusal({ ...ok, amountCents: 0 })).toBe(
      'bad_amount',
    )
    expect(batchChargeInputRefusal({ ...ok, amountCents: -5 })).toBe(
      'bad_amount',
    )
    expect(batchChargeInputRefusal({ ...ok, amountCents: 1.5 })).toBe(
      'bad_amount',
    )
    expect(batchChargeInputRefusal({ ...ok, type: 'Escrow' })).toBe('bad_type')
    expect(batchChargeInputRefusal({ ...ok, type: 'Fuel' })).toBe('bad_type')
  })

  it('offers the known labels minus the two the engine branches on', () => {
    expect(BATCH_CHARGE_TYPES).toEqual([
      'Insurance',
      'Ifta',
      'Admin Fee',
      'Tolls',
      'Other',
    ])
  })
})

describe('Send (selected), posted only (R13)', () => {
  const fakeTx = (
    row: {
      batchId: string
      settlementNumber: string
    } | null,
  ) =>
    ({
      settlement: {
        findFirst: async () =>
          row === null
            ? null
            : { ...row, driver: { firstName: 'Ana', lastName: 'Lee' } },
      },
    }) as never
  const options = {
    origin: 'https://x',
    locale: 'en',
    labels: { subject: '', greeting: '', body: '', link: '' },
  }

  it('refuses a statement that is not on this batch, without sending', async () => {
    expect(
      await sendBatchStatement(
        fakeTx({ batchId: 'other', settlementNumber: 'ST-000018' }),
        { batchId: 'b1', settlementId: 's1' },
        options,
      ),
    ).toEqual({ statement: 'ST-000018', refusal: 'not_on_batch' })
    expect(sendStatementToDriver).not.toHaveBeenCalled()
  })

  it('carries sendStatementToDriver’s own refusal — a draft is not_final — by name', async () => {
    sendStatementToDriver.mockResolvedValueOnce({
      ok: false,
      reason: 'not_final',
    })
    expect(
      await sendBatchStatement(
        fakeTx({ batchId: 'b1', settlementNumber: 'DRAFT-abc' }),
        { batchId: 'b1', settlementId: 's1' },
        options,
      ),
    ).toMatchObject({ refusal: 'not_final' })
    sendStatementToDriver.mockResolvedValueOnce({ ok: true, to: 'a@b' })
    expect(
      await sendBatchStatement(
        fakeTx({ batchId: 'b1', settlementNumber: 'ST-000019' }),
        { batchId: 'b1', settlementId: 's2' },
        options,
      ),
    ).toEqual({ statement: 'ST-000019', refusal: null })
  })

  it('words every refusal with a key both locales have', () => {
    for (const key of Object.values(BATCH_SEND_REASON)) {
      expect(isMessageKey(key), key).toBe(true)
      for (const locale of ['en', 'ru'] as const)
        expect(translator(locale)(key), `${locale} ${key}`).not.toBe(key)
    }
  })
})

describe('the screen’s verbs, wired', () => {
  const page = readFileSync(
    'src/app/(app)/settlements/batches/[id]/page.tsx',
    'utf8',
  )
  const actions = readFileSync(
    'src/app/(app)/settlements/batches/actions.ts',
    'utf8',
  )
  const header = readFileSync(
    'src/app/(app)/settlements/batches/[id]/BatchActions.tsx',
    'utf8',
  )

  it('posts all unposted through finaliseBatch on a DRAFT or PARTIAL batch', () => {
    expect(header).toContain("status === 'DRAFT' || status === 'PARTIAL'")
    expect(actions).toContain('finaliseBatch(tx, batchId, session.userId)')
  })

  it('offers Delete only while nothing is posted, and deleteBatch decides', () => {
    expect(page).toContain('canDelete={deletableBatch(')
    expect(actions).toMatch(
      /withCurrentOrg\('delete', 'settlement', \(tx\) =>\s*deleteBatch\(tx, batchId\)/,
    )
  })

  it('each action reads the form and calls one lib verb', () => {
    expect(actions).toMatch(
      /sendBatchStatement\(\s*tx,\s*\{ batchId, settlementId \}/,
    )
    expect(actions).toContain('addBatchCharge(tx, {')
    expect(actions).toContain('includeDriver(tx, { batchId, driverId })')
    // Nothing writes a charge or an exclusion from the action itself.
    expect(actions).not.toMatch(/settlementCharge\.|settlementBatchExclusion\./)
  })

  it('keeps the blockers, the held lines and the tick grid (behind Add trip)', () => {
    expect(page).toContain("t('batch.blockers')")
    expect(page).toContain("t('batch.held')")
    expect(page).toContain("t('batch.addTrip')")
    expect(page).toContain('<BatchTicks')
  })
})

describe('a batch takes only its own authority’s one-off charges (MONEY-DESIGN §4, 2026-11-18)', () => {
  it('one predicate: unscoped charges for any batch, a scoped one for its authority', async () => {
    const { chargeScopeWhere } = await import('@/lib/charge-scope')
    expect(chargeScopeWhere('ram')).toEqual({
      OR: [{ companyId: null }, { companyId: 'ram' }],
    })
    // An org-wide batch takes every scope; the overlap rule keeps it off any
    // authority's dates.
    expect(chargeScopeWhere(null)).toEqual({})
  })

  it('is asked by the engine’s reader and by finaliseBatch’s mark-as-taken, nowhere spelled twice', () => {
    const engine = readFileSync('src/lib/settlement-batch.ts', 'utf8')
    const reader = engine.slice(
      engine.indexOf('tx.settlementCharge.findMany({'),
      engine.indexOf('tx.settlementCharge.findMany({') + 300,
    )
    expect(reader).toContain('...chargeScopeWhere(input.companyId ?? null)')
    const mark = engine.slice(
      engine.indexOf('await tx.settlementCharge.updateMany({'),
      engine.indexOf('await tx.settlementCharge.updateMany({') + 300,
    )
    expect(mark).toContain('...chargeScopeWhere(batch.companyId)')
    // No second spelling of the scope anywhere in the engine.
    expect(engine).not.toMatch(/companyId: null \}, \{ companyId/)
  })

  it('deleting the batch deletes its untaken charges, and keeps the taken ones', () => {
    const engine = readFileSync('src/lib/settlement-batch.ts', 'utf8')
    const body = engine.slice(
      engine.indexOf('export async function deleteBatch'),
    )
    expect(body).toContain(
      'tx.settlementCharge.deleteMany({ where: { batchId, settledAt: null } })',
    )
  })
})
