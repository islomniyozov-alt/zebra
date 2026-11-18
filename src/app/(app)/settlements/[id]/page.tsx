import Link from 'next/link'
import { notFound } from 'next/navigation'
import {
  currentUserCan,
  readCurrentOrg,
  withCurrentOrg,
} from '@/lib/auth-context'
import { getLocaleContext } from '@/lib/locale'
import { isDeduction } from '@/lib/settlements'
import { basisSentence, type BasisTemplates } from '@/lib/settlement-view'
import { readSnapshot } from '@/lib/driver-pay'
import { readCharge } from '@/lib/settlement-charge'
import { statementTitle } from '@/lib/settlement-number'
import { formatCents, ratePerMileCents } from '@/lib/money'
import {
  deductionLineTab,
  STATEMENT_TABS,
  statementTabCounts,
  statementTabOf,
  type LineTab,
} from '@/lib/statement-tabs'
import { BATCH_CHARGE_TYPES } from '@/lib/batch-charges'
import type { RawParams } from '@/lib/list-view'
import { Tabs } from '@/components/ui/Tabs'
import { AddStatementDeduction } from './AddStatementDeduction'
import { Button } from '@/components/ui/Button'
import { Table, type Column } from '@/components/ui/Table'
import { addableTrips } from '@/lib/statement-workbench'
import {
  readSettlementPageHead,
  SETTLEMENT_TRIPS_GRID,
} from '@/lib/settlement-page-head'
import { sumCents, totalsLabel } from '@/lib/list-view'
import { StatusBadge } from '@/components/ui/StatusBadge'
import { EmptyState } from '@/components/ui/EmptyState'
import { PageHeader } from '../../_grid/PageHeader'
import { ColumnsChooser } from '../../_grid/ColumnsChooser'
import { keepColumns } from '../../_grid/grid-page'
import { gridColumnsFromRow, readGridColumns } from '@/lib/grid-columns'
import { ChargeGrid, type ChargeRow } from './ChargeGrid'
import {
  AddTrips,
  Approve,
  Recalculate,
  MarkPaid,
  SendToDriver,
  VoidSettlement,
} from './SettlementActions'
import type {
  PaymentMethod,
  SettlementLineType,
} from '@/generated/prisma/client'
import type { MessageKey } from '@/lib/i18n'
import { STATEMENT_WORDS } from '@/lib/pay-status'

// ---------------------------------------------------------------------------
// THE SETTLEMENT WORKBENCH (TMS-DESIGN-SYSTEM §6.2.2).
//
// Owner's ruling, 2026-09-29, against ST-005562 and the six screenshots in
// `corpus/datatruck/ui/`.
//
// ── WHAT THIS REPLACED, AND WHY THE SHAPE WAS THE PROBLEM ─────────────────
//
// Nine stacked full-width cards: header, trips, three line groups, totals, add
// trips, add line, recalculate, approve, mark paid, void. Every one of them
// correct, and a four-load statement still ran past three screens — so the net
// pay, which is the figure somebody opens a statement to check, was below the
// fold under a form for adding deductions.
//
// THE ARTEFACT FITS THE SAME WORK ON ONE SCREEN by treating the totals as a
// HEADER and the edits as ROWS. That is the whole idea being adopted: nothing
// here computes anything the old page did not.
//
// ── THE HEADER'S RULE ─────────────────────────────────────────────────────
//
// §6.2.2: every figure in the header box is the sum of something on the page
// below it. Gross, earnings, deductions and net come off the settlement's own
// stored integers and each one has its grid underneath. The two that do not —
// balances and fuel & tolls — carry a Review link to where their rows live,
// which is why they are links and not bare numbers.
// ---------------------------------------------------------------------------

/** The held reasons, in the reader's language. Same three the batch names. */
const HELD_REASON: Record<string, MessageKey> = {
  no_remittance: 'batch.held.noRemittance',
  over: 'batch.held.over',
  short: 'batch.held.short',
}

/** Offered on the add-rows. LOAD_PAY is not among them — it is earned. */
const OTHER_PAY_TYPES: SettlementLineType[] = ['REIMBURSEMENT', 'BONUS']
const DEDUCTION_TYPES: SettlementLineType[] = [
  'DEDUCTION_ADVANCE',
  'DEDUCTION_FUEL',
  // Migration 61, §6.2.3. Offered on the add-row because a toll charged by
  // hand is the normal case until the toll import exists — `TollTransaction`
  // has a model and no importer.
  'DEDUCTION_TOLL',
  'DEDUCTION_INSURANCE',
  'DEDUCTION_EQUIPMENT',
  'DEDUCTION_VIOLATION',
  'DEDUCTION_OTHER',
]
const BALANCE_TYPES: SettlementLineType[] = ['DEDUCTION_ESCROW']

const PAY_METHODS: PaymentMethod[] = ['ACH', 'CHECK', 'WIRE', 'ZELLE', 'CASH']

// ── THE TRIPS GRID'S ELEVEN COLUMNS, AND THE NINE THAT SHOW ──────────────
//
// §7.1 caps a table at nine and `Table` throws above it. §6.2.2 (v10.2) names
// which two go behind the chooser and why: `load` is the BROKER's reference, a
// key somebody looks a load up by rather than a column read down, and `unit`
// repeats — Zebra freezes one truck per settlement, so it is the same number on
// every row, and it belongs in the header box where ST-005562 prints it.
//
// THE ORDER HERE IS THE TABLE'S ORDER. `readGridColumns` returns a SET; the
// column list below decides where each one sits.
const TRIP_COLUMN_KEYS = [
  'trip',
  'load',
  'unit',
  'totalPay',
  'driverGross',
  'status',
  'delDate',
  'puDate',
  'pu',
  'del',
  'miles',
] as const

const TRIP_COLUMNS_DEFAULT = TRIP_COLUMN_KEYS.filter(
  (key) => key !== 'load' && key !== 'unit',
)

/** §7.1, and `Table` throws above it rather than scrolling sideways. */
const MAX_VISIBLE_COLUMNS = 9

/**
 * Which trip columns to render, from what this user has stored.
 *
 * TWO CASES THAT BOTH LOOK LIKE "EVERYTHING". `visibleColumns` returns the
 * whole available list when no preference exists — sensible for a grid of
 * eight columns, and eleven here, which is the throw. So a set that is
 * literally all eleven is read as "never chosen" and becomes the default nine.
 *
 * AND THE SLICE IS NOT DECORATION. A preference row outlives every deploy
 * (§7.1.4), so one written before this cap existed, or edited by hand, can
 * still arrive holding ten. Handing that to `Table` would 500 the page for one
 * person in a way nobody else could reproduce.
 */
function visibleTripColumns(stored: readonly string[]): string[] {
  const kept = TRIP_COLUMN_KEYS.filter((key) => stored.includes(key))
  const chosen =
    kept.length === TRIP_COLUMN_KEYS.length ? TRIP_COLUMNS_DEFAULT : kept
  return chosen.slice(0, MAX_VISIBLE_COLUMNS)
}

const ERROR_KEYS: MessageKey[] = [
  'settlements.error.notFound',
  'settlements.error.notDraft',
  'settlements.error.notApproved',
  'settlements.error.alreadyPaid',
  'settlements.error.negativeNet',
  'settlements.error.noReference',
  'settlements.error.badAmount',
  'settlements.error.noDescription',
  'settlements.error.wrongSign',
  'settlements.error.notFinal',
  'settlements.error.voided',
  'settlements.error.noEmail',
  'settlements.error.notProduction',
  'settlements.error.mailNotConfigured',
  'settlements.error.mailRejected',
  'settlements.error.mailUnreachable',
  'settlements.error.mailMisconfigured',
  // ADD DEDUCTION on a batch statement (§6.2.10 part 7 step 4).
  'deduction.error.unknownType',
]

export default async function SettlementPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams: Promise<RawParams>
}) {
  if (!(await currentUserCan('read', 'settlement'))) notFound()

  const { id } = await params
  const raw = await searchParams
  const { t, locale } = await getLocaleContext()
  const mayEdit = await currentUserCan('update', 'settlement')
  const mayApprove = await currentUserCan('approve', 'settlement')
  const mayVoid = await currentUserCan('delete', 'settlement')

  // THE PAGE'S OWN READS IN ONE CALL (§6.2.2 v11.09): the statement, fuel and
  // tolls, the trips grid's column memory and the four neighbours, through
  // the tenant reader and no transaction.
  const head = await readCurrentOrg('read', 'settlement', (reader, session) =>
    readSettlementPageHead(reader, {
      settlementId: id,
      userId: session.userId,
    }),
  )
  if (!head) notFound()
  const { settlement, fuel, neighbours, tabs } = head

  // `addable` is DRAFT-only: on an approved statement the panel would offer
  // buttons that `addTripsToSettlement` refuses, and the read costs a
  // `batchInputForOrg` — the engine's reader, in a transaction of its own, no
  // second spelling of it (owner's ruling 2026-11-15). The column memory opens
  // one only when its row is the legacy shape and is rewritten once (§6.7).
  const plan = gridColumnsFromRow(
    SETTLEMENT_TRIPS_GRID,
    TRIP_COLUMN_KEYS,
    [],
    head.columnsRow,
  )
  const [addable, storedColumns] = await Promise.all([
    settlement.status === 'DRAFT' && mayEdit
      ? withCurrentOrg('read', 'settlement', (tx, session) =>
          addableTrips(tx, {
            organizationId: session.organizationId,
            driverId: settlement.driver.id,
            periodStart: settlement.periodStart,
            periodEnd: settlement.periodEnd,
          }),
        )
      : Promise.resolve([]),
    plan.rewrite
      ? withCurrentOrg('read', 'settlement', (tx, session) =>
          readGridColumns(
            tx,
            session.userId,
            SETTLEMENT_TRIPS_GRID,
            TRIP_COLUMN_KEYS,
            [],
            { row: head.columnsRow },
          ),
        )
      : Promise.resolve(plan.visible),
  ])

  const day = (value: Date | null) =>
    value ? value.toISOString().slice(0, 10) : '—'
  const translate = Object.fromEntries(ERROR_KEYS.map((key) => [key, t(key)]))

  const isDraft = settlement.status === 'DRAFT'
  const mayAdd = isDraft && mayEdit

  const basisTemplates: BasisTemplates = {
    percentGross: t('payRule.basis.percentGross'),
    percentLinehaul: t('payRule.basis.percentLinehaul'),
    perMile: t('payRule.basis.perMile'),
    perMileDispatched: t('payRule.basis.perMileDispatched'),
    flatPerLoad: t('payRule.basis.flatPerLoad'),
  }

  const money = (cents: number) => (
    <span className="font-mono tabular-nums">{formatCents(cents, locale)}</span>
  )

  // ── THE LINES, SPLIT THE WAY THE PRINTED STATEMENT SPLITS THEM ─────────
  //
  // BALANCES is escrow: the only line that is neither pay nor a charge but a
  // transfer into a balance somebody gets back, which is why the statements
  // print it apart. `isDeduction` is the existing one-place answer and is not
  // second-guessed here.
  const balanceSet = new Set<SettlementLineType>(BALANCE_TYPES)
  const toChargeRow = (line: (typeof settlement.lines)[number]): ChargeRow => {
    const charge = readCharge(line.payRuleSnapshot)
    return {
      id: line.id,
      typeLabel: t(`settlementLine.${line.type}` as MessageKey),
      description: line.description,
      // THE SIGN LIVES ON THE TOTAL AND NOWHERE ELSE. A rate of -$50.00 beside
      // a total of -$50.00 reads as two deductions to anybody scanning.
      rateCents: charge ? charge.rateCents : null,
      quantity: charge ? charge.quantity : null,
      amountCents: line.amountCents,
      removable: mayAdd && line.type !== 'LOAD_PAY',
      basis: basisSentence(
        readSnapshot(line.payRuleSnapshot),
        locale,
        basisTemplates,
      ),
    }
  }

  const otherPayLines = settlement.lines.filter(
    (line) => !isDeduction(line.type) && line.type !== 'LOAD_PAY',
  )
  const deductionLines = settlement.lines.filter(
    (line) => isDeduction(line.type) && !balanceSet.has(line.type),
  )
  const balanceLines = settlement.lines.filter((line) =>
    balanceSet.has(line.type),
  )

  const typeOptions = (types: readonly SettlementLineType[]) =>
    types.map((type) => ({
      value: type,
      label: t(`settlementLine.${type}` as MessageKey),
    }))

  const gridLabels = {
    type: t('settlements.lineType'),
    amount: t('settlements.amount'),
    quantity: t('workbench.quantity'),
    total: t('workbench.total'),
    description: t('settlements.description'),
    add: t('settlements.add'),
    remove: t('settlements.remove'),
  }

  type TripRow = (typeof settlement.loadLines)[number]

  const tripColumns: Column<TripRow>[] = [
    {
      key: 'trip',
      header: t('workbench.trip'),
      // THE BROKER'S NUMBER, FALLING BACK TO ZEBRA'S (§6.2.2, v10.6). The
      // statement PDF leads with the reference because the artefact does, and
      // a grid leading with DT-016018 beside a sheet leading with 116RX75DK
      // would make the two look like different weeks.
      //
      // `||` AND NOT `??`, so a load carrying an empty string for a reference
      // falls back too instead of rendering an empty anchor cell — the first
      // cell is the row's accessible name (§7.1).
      //
      // ── FROZEN FIRST, LIVE AS A FALLBACK, THEN THE DT- ID ──────────────
      //
      // Migration 61 froze the reference onto the line. Rows written before it
      // have none and there is no frozen value to show, so those fall through
      // to the relation — which is what they have always shown and is the only
      // honest answer for them. A new statement never reaches the second term.
      render: (row) => (
        <span className="z-identifier font-mono" dir="ltr">
          {row.referenceNumber || row.load?.referenceNumber || row.loadNumber}
        </span>
      ),
    },
    {
      key: 'load',
      header: t('workbench.loadId'),
      // ZEBRA'S OWN NUMBER, behind the chooser. It is what the load is called
      // everywhere else here, so somebody reconciling against a load page
      // needs it — and it is frozen, unlike the reference above.
      render: (row) => (
        <span className="font-mono text-xs text-ink-2" dir="ltr">
          {row.loadNumber}
        </span>
      ),
    },
    {
      key: 'unit',
      header: t('payroll.unit'),
      // ONE UNIT FOR THE WHOLE STATEMENT, repeated down the column. Zebra
      // freezes the truck per settlement (`Settlement.unitNumber`) rather than
      // per line, because the letterhead is chosen from it — so every row
      // carries the same number and that is the truth, not a rendering
      // shortcut.
      render: () =>
        settlement.unitNumber === null ? (
          <span className="text-ink-3">—</span>
        ) : (
          <span className="z-identifier font-mono text-xs" dir="ltr">
            {settlement.unitNumber}
          </span>
        ),
    },
    {
      // THE KEY STAYS `totalPay` UNDER THE NEW HEADER (§6.2.2, 2026-10-06):
      // a column chooser preference is a row in somebody's settings, and
      // renaming the key would silently drop it.
      key: 'totalPay',
      header: t('workbench.loadGross'),
      align: 'end',
      // THE FREIGHT THE RULE WAS APPLIED TO — "Load gross", Datatruck's own
      // header and the word the PDF already prints. Freight is never called
      // pay (owner's ruling, 2026-10-06).
      render: (row) => money(row.grossCents),
      foot: (rows) => money(sumCents(rows, (row) => row.grossCents)),
    },
    {
      key: 'driverGross',
      header: t('workbench.driverGross'),
      align: 'end',
      render: (row) => money(row.amountCents),
      foot: (rows) => money(sumCents(rows, (row) => row.amountCents)),
    },
    {
      key: 'status',
      header: t('payroll.status'),
      render: (row) =>
        row.load ? (
          <span className="text-xs text-ink-2">
            {t(`status.${row.load.operationalStatus}` as MessageKey)}
          </span>
        ) : (
          <span className="text-ink-3">—</span>
        ),
    },
    {
      key: 'delDate',
      header: t('settlements.trip.delDate'),
      render: (row) => (
        <span className="font-mono text-xs" dir="ltr">
          {day(row.delDate)}
        </span>
      ),
    },
    {
      key: 'puDate',
      header: t('settlements.trip.puDate'),
      render: (row) => (
        <span className="font-mono text-xs" dir="ltr">
          {day(row.puDate)}
        </span>
      ),
    },
    {
      key: 'pu',
      header: t('settlements.trip.pu'),
      truncate: true,
      render: (row) => row.puPlace,
    },
    {
      key: 'del',
      header: t('settlements.trip.del'),
      truncate: true,
      render: (row) => row.delPlace,
    },
    {
      key: 'miles',
      header: t('workbench.totalMiles'),
      align: 'end',
      // TOTAL, NOT LOADED, and labelled as such (§6.2.2 as corrected in
      // v10.1). The snapshot freezes ONE mileage — the one the PDF prints — so
      // calling it "loaded" here would make the screen disagree with the paper
      // by the deadhead. The second column is the held migration.
      render: (row) => (
        <span className="font-mono tabular-nums">
          {Math.round(row.milesHundredths / 100).toLocaleString(locale)}
        </span>
      ),
      foot: (rows) => (
        <span className="font-mono tabular-nums">
          {Math.round(
            sumCents(rows, (row) => row.milesHundredths) / 100,
          ).toLocaleString(locale)}
        </span>
      ),
    },
  ]

  const driverName = `${settlement.driver.firstName} ${settlement.driver.lastName}`

  // ── THE TITLE IS A NAME, NOT A ROW ID (§8, §6.2.2) ────────────────────
  //
  // Owner's ruling, 2026-09-30. A draft has no issued number yet, and the
  // placeholder it carries is two cuid fragments — unreadable, unquotable, and
  // sitting exactly where the name belongs. So a draft is titled by the two
  // things that tell one apart from another: who it pays and for which week.
  const title = statementTitle({
    settlementNumber: settlement.settlementNumber,
    driverName,
    periodStart: settlement.periodStart,
    periodEnd: settlement.periodEnd,
    draftTemplate: t('workbench.draftTitle'),
  })

  // ── THE SEVEN TABS (§6.2.10 part 7 step 4, R16) ────────────────────────
  //
  // Each line goes to ONE tab by `statement-tabs.ts`, and the counts on the
  // strip are taken from the same split, so a count and the rows under it
  // cannot disagree. A zero tab is shown with its zero (R16, reaffirmed
  // 2026-11-18).
  const tab = statementTabOf(raw.tab)
  const handLines = settlement.lines.filter((line) => line.type !== 'LOAD_PAY')
  const linesOn = (which: LineTab) =>
    tabs.deductionLines.filter((line) => deductionLineTab(line) === which)
  const counts = statementTabCounts({
    trips: settlement.loadLines.length,
    fuelRows: tabs.fuelRows.length,
    tollRows: tabs.tollRows.length,
    deductionLines: tabs.deductionLines,
    handLineTypes: handLines.map((line) => line.type),
    documents: settlement._count.documents,
    hasNotes: Boolean(settlement.notes?.trim()),
  })
  const path = `/settlements/${settlement.id}`
  const hrefFor = (key: string) =>
    key === 'trips' ? path : `${path}?tab=${key}`

  // ADD DEDUCTION: on a batch draft the batch's one-time charge (a line added
  // by hand would be deleted by the next refresh); on a statement with no
  // batch, the add-rows below, which nothing rebuilds.
  const inBatch = settlement.batchId !== null
  const mayAddCharge = mayAdd && inBatch
  const mayAddLine = mayAdd && !inBatch

  // THE BALANCES FIGURE: escrow, the batch's lines and any added by hand.
  const balancesCents =
    linesOn('balances').reduce((sum, line) => sum + line.totalCents, 0) +
    balanceLines.reduce((sum, line) => sum + line.amountCents, 0)
  const rpm = ratePerMileCents(
    settlement.grossCents,
    settlement.milesHundredths,
  )

  type DeductionRow = (typeof tabs.deductionLines)[number]
  const deductionColumns: Column<DeductionRow>[] = [
    {
      key: 'description',
      header: t('settlements.description'),
      render: (row) => row.description || '—',
    },
    {
      key: 'type',
      header: t('settlements.lineType'),
      render: (row) => row.type,
    },
    {
      key: 'quantity',
      header: t('workbench.quantity'),
      align: 'end',
      render: (row) => <span className="font-mono">{row.quantity}</span>,
    },
    {
      key: 'rate',
      header: t('settlements.amount'),
      align: 'end',
      render: (row) => money(row.rateCents),
    },
    {
      key: 'total',
      header: t('workbench.total'),
      align: 'end',
      render: (row) => money(row.totalCents),
      foot: (rows) => money(sumCents(rows, (row) => row.totalCents)),
    },
  ]
  const deductionTable = (rows: DeductionRow[], caption: string) =>
    rows.length === 0 ? null : (
      <Table
        columns={deductionColumns}
        rows={rows}
        rowKey={(row) => row.id}
        caption={caption}
        footRows={rows}
        totals={{
          label: totalsLabel(
            t('accounting.total'),
            rows.length,
            t('accounting.rows'),
          ),
        }}
        empty={null}
      />
    )

  type FuelRow = (typeof tabs.fuelRows)[number]
  const fuelColumns: Column<FuelRow>[] = [
    {
      key: 'date',
      header: t('statement.col.date'),
      render: (row) => (
        <span className="font-mono text-xs" dir="ltr">
          {day(row.purchasedAt)}
        </span>
      ),
    },
    {
      key: 'vendor',
      header: t('statement.col.vendor'),
      truncate: true,
      render: (row) => row.vendorName ?? '—',
    },
    {
      key: 'place',
      header: t('statement.col.place'),
      render: (row) => [row.city, row.state].filter(Boolean).join(', ') || '—',
    },
    {
      key: 'gallons',
      header: t('statement.col.gallons'),
      align: 'end',
      render: (row) => (
        <span className="font-mono" dir="ltr">
          {row.gallons}
        </span>
      ),
    },
    {
      key: 'total',
      header: t('workbench.total'),
      align: 'end',
      render: (row) => money(row.totalCents),
      foot: (rows) => money(sumCents(rows, (row) => row.totalCents)),
    },
    {
      key: 'onStatement',
      header: t('statement.col.onStatement'),
      render: (row) =>
        row.settlementId === null ? t('statement.no') : t('statement.yes'),
    },
  ]

  type TollRow = (typeof tabs.tollRows)[number]
  const tollColumns: Column<TollRow>[] = [
    {
      key: 'date',
      header: t('statement.col.date'),
      render: (row) => (
        <span className="font-mono text-xs" dir="ltr">
          {day(row.incurredAt)}
        </span>
      ),
    },
    {
      key: 'vendor',
      header: t('statement.col.vendor'),
      truncate: true,
      render: (row) => row.vendorName ?? '—',
    },
    {
      key: 'amount',
      header: t('settlements.amount'),
      align: 'end',
      render: (row) => money(row.amountCents),
      foot: (rows) => money(sumCents(rows, (row) => row.amountCents)),
    },
    {
      key: 'deducted',
      header: t('statement.col.deducted'),
      render: (row) =>
        row.isDriverDeduction ? t('statement.yes') : t('statement.no'),
    },
  ]

  const emptyLine = (key: MessageKey) => (
    <p className="px-z4 py-z4 text-sm text-ink-3">{t(key)}</p>
  )

  return (
    <>
      <PageHeader
        title={title}
        breadcrumb={[t('nav.group.payroll'), t('nav.statements')]}
        action={
          // ── THE ACTION ROW (§6.2.10 part 7 step 4): Post · Add deduction ·
          // Send to driver · Download, with Recalculate on a draft. A control
          // that cannot act is absent rather than disabled — the codebase's
          // rule, and the reason Post disappears once a statement is posted.
          <div className="flex flex-wrap items-center gap-z2">
            {isDraft && mayApprove ? (
              <Approve
                settlementId={settlement.id}
                translate={translate}
                inToolbar
                labels={{
                  approve: t('workbench.post'),
                  hint: t('settlements.approveHint'),
                }}
              />
            ) : null}
            {/* ADD DEDUCTION IS A JUMP to the one control, on the One-time
             * tab — a toolbar copy would be a second control writing the same
             * rows. */}
            {mayAdd ? (
              <a href={`${path}?tab=oneTime#charges-to-add`}>
                <Button variant="secondary" size="compact">
                  {t('workbench.addDeduction')}
                </Button>
              </a>
            ) : null}
            {settlement.status !== 'DRAFT' && settlement.status !== 'VOID' ? (
              <SendToDriver
                settlementId={settlement.id}
                email={settlement.driver.email}
                labels={{
                  send: t('workbench.sendToDriver'),
                  confirm: t('workbench.sendConfirm'),
                  sent: t('workbench.sent'),
                }}
                translate={translate}
              />
            ) : null}
            {/* ── DOWNLOAD, ON EVERY STATEMENT (§6.2.2) ───────────────
             *
             * Owner's ruling, 2026-09-30: drafts export with a watermark, so
             * the route renders everything and the button is always there —
             * a control whose availability had to track a server rule drifted
             * from it twice. */}
            <a
              href={`/api/settlements/statement/${settlement.id}`}
              target="_blank"
              rel="noopener"
            >
              <Button variant="secondary" size="compact">
                {t('workbench.download')}
              </Button>
            </a>
            {mayAdd ? (
              <Recalculate
                settlementId={settlement.id}
                label={t('settlements.recalculate')}
              />
            ) : null}
          </div>
        }
      />

      <div className="min-h-0 flex-1 overflow-y-auto bg-surface-2 px-gutter py-z4">
        <div className="flex flex-col gap-z4">
          {/* ── THE FOUR CARDS (§6.2.10 part 7 step 4) ─────────────────── */}
          <div className="grid gap-z4 md:grid-cols-2 xl:grid-cols-4">
            <Card title={t('statement.card.settlement')}>
              <Fact label={t('settlements.driver')}>
                <Link
                  href={`/drivers/${settlement.driver.id}`}
                  className="text-ink hover:text-accent"
                >
                  {driverName}
                </Link>
              </Fact>
              <Fact label={t('workbench.settlement')}>
                <span className="flex items-baseline gap-z1">
                  <Step
                    href={
                      neighbours.prevInBatch
                        ? `/settlements/${neighbours.prevInBatch.id}`
                        : null
                    }
                    label={t('workbench.previous')}
                    glyph="‹"
                  />
                  {/* THE ID MAY APPEAR HERE (§8): a field in mono is where a
                   * value somebody might quote belongs. */}
                  <span className="font-mono text-ink" dir="ltr">
                    {settlement.settlementNumber}
                  </span>
                  <Step
                    href={
                      neighbours.nextInBatch
                        ? `/settlements/${neighbours.nextInBatch.id}`
                        : null
                    }
                    label={t('workbench.next')}
                    glyph="›"
                  />
                </span>
              </Fact>
              <Fact label={t('settlements.period')}>
                <span className="flex items-baseline gap-z1">
                  <Step
                    href={
                      neighbours.prevPeriod
                        ? `/settlements/${neighbours.prevPeriod.id}`
                        : null
                    }
                    label={t('workbench.previousPeriod')}
                    glyph="‹"
                  />
                  <span className="font-mono text-ink" dir="ltr">
                    {day(settlement.periodStart)} — {day(settlement.periodEnd)}
                  </span>
                  <Step
                    href={
                      neighbours.nextPeriod
                        ? `/settlements/${neighbours.nextPeriod.id}`
                        : null
                    }
                    label={t('workbench.nextPeriod')}
                    glyph="›"
                  />
                </span>
              </Fact>
              <Fact label={t('workbench.driverType')}>
                {t(
                  // THE FROZEN COPY, falling back to the live row only for a
                  // statement issued before migration 66 (§6.2.10 part 6).
                  `drivers.type.${settlement.driverType ?? settlement.driver.driverType}` as MessageKey,
                )}
              </Fact>
              <Fact label={t('ref.authority')}>{settlement.company.name}</Fact>
              <Fact label={t('payroll.unit')}>
                {settlement.unitNumber === null ? (
                  <span className="text-ink-3">—</span>
                ) : (
                  <span className="z-identifier font-mono" dir="ltr">
                    {settlement.unitNumber}
                  </span>
                )}
              </Fact>
              <Fact label={t('batches.batch')}>
                {settlement.batch === null ? (
                  <span className="text-ink-3">{t('statements.noBatch')}</span>
                ) : (
                  <Link
                    href={`/settlements/batches/${settlement.batch.id}`}
                    className="z-identifier font-mono hover:text-accent"
                    dir="ltr"
                  >
                    {settlement.batch.batchNumber ??
                      settlement.batch.id.slice(0, 8)}
                  </Link>
                )}
              </Fact>
              <Fact label={t('batch.checkDate')}>
                <span className="font-mono" dir="ltr">
                  {day(
                    settlement.payoutDate ??
                      settlement.batch?.checkDate ??
                      null,
                  )}
                </span>
              </Fact>
              <Fact label={t('payroll.status')}>
                {/* Unposted · Posted · Paid · Void (§6.2.10 part 7). */}
                <StatusBadge
                  tone={STATEMENT_WORDS[settlement.status].tone}
                  label={t(STATEMENT_WORDS[settlement.status].label)}
                />
              </Fact>
            </Card>

            <Card title={t('statement.card.earnings')}>
              {/* FREIGHT IS NEVER CALLED PAY (§6.2.2, 2026-10-06). Earnings is
               * the driver's cut before deductions. */}
              <Fact label={t('workbench.earnings')}>
                {money(settlement.earningsCents)}
              </Fact>
              <Fact label={t('workbench.otherPayReimbursements')}>
                {money(settlement.otherPayCents)} /{' '}
                {money(settlement.reimbursementsCents)}
              </Fact>
              <Fact label={t('workbench.deductionsAdvances')}>
                <span className="text-danger">
                  {money(-settlement.deductionsCents)}
                </span>{' '}
                / {money(settlement.advancesCents)}
              </Fact>
              {/* THE NET, ABOVE THE FOLD — §6.2.2's reason for one box holds
               * with four cards. */}
              <div className="mt-z1 flex items-baseline justify-between gap-z3 border-t border-border pt-z2">
                <span className="text-xs uppercase tracking-[0.04em] text-ink-2">
                  {t('workbench.netPay')}
                </span>
                <span
                  className={`font-mono text-lg font-medium tabular-nums ${settlement.netCents < 0 ? 'text-danger' : 'text-ink'}`}
                >
                  {formatCents(settlement.netCents, locale)}
                </span>
              </div>
            </Card>

            <Card title={t('statement.card.fuel')}>
              <Fact label={t('workbench.balances')}>
                <a href={`${path}?tab=balances`} className="hover:text-accent">
                  {money(balancesCents)}
                </a>
              </Fact>
              {/* §6.2.3: A READ IS NOT A CHARGE. The figure is what was
               * burned; the note says what is already coming off. */}
              <Fact label={t('statement.fuel')}>
                <a href={`${path}?tab=fuel`} className="hover:text-accent">
                  {money(fuel.fuelCents)}
                </a>
                <span className="ms-z1 text-xs text-ink-3">
                  {t('workbench.burned')}
                </span>
              </Fact>
              <Fact label={t('statement.tolls')}>
                <a href={`${path}?tab=toll`} className="hover:text-accent">
                  {money(fuel.tollCents)}
                </a>
                {fuel.alreadyDeductedCents > 0 ? (
                  <span className="ms-z1 text-xs text-ink-3">
                    {t('workbench.deducted')}{' '}
                    {formatCents(fuel.alreadyDeductedCents, locale)}
                  </span>
                ) : null}
              </Fact>
              <Fact label={t('settlements.tariff')}>
                {/* §12: `dir="ltr"` ON A FROZEN LATIN STRING — "3% from gross"
                 * cannot be templated, because it is frozen; it can be given
                 * a direction. */}
                {settlement.payTariffLabel === null ? (
                  <span className="text-ink-3">—</span>
                ) : (
                  <span dir="ltr">{settlement.payTariffLabel}</span>
                )}
              </Fact>
            </Card>

            <Card title={t('statement.card.trips')}>
              {/* R12 AS REVERSED: Total pay and Total gross are the same
               * stored figure, printed twice as Datatruck prints them. */}
              <Fact label={t('statement.totalPay')}>
                {money(settlement.grossCents)}
              </Fact>
              <Fact label={t('workbench.totalGross')}>
                {money(settlement.grossCents)}
              </Fact>
              <Fact label={t('workbench.tripsCount')}>
                <span className="font-mono tabular-nums">
                  {settlement.loadLines.length}
                </span>
              </Fact>
              <Fact label={t('workbench.totalMiles')}>
                <span className="font-mono tabular-nums">
                  {Math.round(settlement.milesHundredths / 100).toLocaleString(
                    locale,
                  )}
                </span>
              </Fact>
              {/* R15: gross ÷ miles, shown and never stored — `money.ts`. */}
              <Fact label={t('statement.rpm')}>
                {rpm === null ? (
                  <span className="text-ink-3">—</span>
                ) : (
                  money(rpm)
                )}
              </Fact>
            </Card>
          </div>

          {/* ── THE SEVEN TABS, EACH WITH ITS COUNT, A ZERO SHOWN (R16) ───── */}
          <section className="overflow-hidden rounded-card border border-border bg-surface">
            <Tabs
              tabs={STATEMENT_TABS.map((key) => ({
                key,
                label: t(`statement.tab.${key}` as MessageKey),
                count: counts[key],
              }))}
              active={tab}
              hrefFor={hrefFor}
              label={t('grid.tabs')}
              trailing={
                tab === 'trips' && settlement.loadLines.length > 0 ? (
                  /* THE CHOOSER IS WHY THE TRIPS GRID IS LEGAL. Eleven
                   * columns, nine shown — §6.2.2 as corrected in v10.2. */
                  <ColumnsChooser
                    grid="settlements.trips"
                    columns={tripColumns.map((column) => ({
                      key: column.key,
                      header: String(column.header),
                    }))}
                    visible={visibleTripColumns(storedColumns)}
                    labels={{
                      open: t('grid.columns'),
                      apply: t('grid.columns.apply'),
                      cancel: t('grid.columns.cancel'),
                      firstLocked: t('grid.columns.firstLocked'),
                    }}
                    errors={translate}
                  />
                ) : null
              }
            />

            {tab === 'trips' ? (
              <>
                {settlement.loadLines.length > 0 ? (
                  <Table
                    columns={keepColumns(
                      tripColumns,
                      visibleTripColumns(storedColumns),
                    )}
                    rows={settlement.loadLines}
                    rowKey={(row) => row.id}
                    rowHref={(row) => `/loads/${row.loadId}`}
                    caption={t('settlements.trips')}
                    footRows={settlement.loadLines}
                    totals={{
                      label: totalsLabel(
                        t('accounting.total'),
                        settlement.loadLines.length,
                        t('accounting.rows'),
                      ),
                    }}
                    empty={null}
                  />
                ) : null}
                {/* ADD TRIPS, UNDER THE GRID, WHENEVER THE STATEMENT IS
                 * EDITABLE — empty or not (§6.2.2, v10.6): confirming nothing
                 * is missing is an answer somebody needs to reach. */}
                {mayAdd ? (
                  <div
                    id="trips-to-add"
                    className="scroll-mt-z4 border-t border-border p-z4"
                  >
                    {addable.length === 0 ? (
                      <EmptyState
                        title={t('workbench.noAddableTrips')}
                        body={t('workbench.noAddableTripsHint')}
                      />
                    ) : null}
                    <AddTrips
                      settlementId={settlement.id}
                      trips={addable.map((trip) => ({
                        loadId: trip.loadId,
                        loadNumber: trip.loadNumber,
                        route: `${trip.puPlace} → ${trip.delPlace}`,
                        gross: formatCents(trip.grossCents, locale),
                        held:
                          trip.held === null
                            ? null
                            : t(
                                HELD_REASON[trip.held.kind] ??
                                  'batch.held.short',
                              ),
                      }))}
                      translate={translate}
                      labels={{
                        heading: t('settlements.addTrips'),
                        hint: t('settlements.addTripsHint'),
                        add: t('settlements.add'),
                        heldNote: t('settlements.heldNote'),
                      }}
                    />
                  </div>
                ) : null}
              </>
            ) : null}

            {tab === 'fuel' ? (
              <>
                <Table
                  columns={fuelColumns}
                  rows={tabs.fuelRows}
                  rowKey={(row) => row.id}
                  caption={t('statement.tab.fuel')}
                  footRows={tabs.fuelRows}
                  totals={{
                    label: totalsLabel(
                      t('accounting.total'),
                      tabs.fuelRows.length,
                      t('accounting.rows'),
                    ),
                  }}
                  empty={emptyLine('statement.empty.fuel')}
                />
                {deductionTable(linesOn('fuel'), t('statement.line'))}
              </>
            ) : null}

            {tab === 'toll' ? (
              <>
                <Table
                  columns={tollColumns}
                  rows={tabs.tollRows}
                  rowKey={(row) => row.id}
                  caption={t('statement.tab.toll')}
                  footRows={tabs.tollRows}
                  totals={{
                    label: totalsLabel(
                      t('accounting.total'),
                      tabs.tollRows.length,
                      t('accounting.rows'),
                    ),
                  }}
                  empty={emptyLine('statement.empty.toll')}
                />
                {deductionTable(linesOn('toll'), t('statement.line'))}
              </>
            ) : null}

            {tab === 'balances' ? (
              <>
                {deductionTable(
                  linesOn('balances'),
                  t('statement.tab.balances'),
                )}
                {balanceLines.length > 0 || mayAddLine ? (
                  <ChargeGrid
                    settlementId={settlement.id}
                    rows={balanceLines.map(toChargeRow)}
                    types={typeOptions(BALANCE_TYPES)}
                    canAdd={mayAddLine}
                    locale={locale}
                    translate={translate}
                    labels={{
                      ...gridLabels,
                      heading: t('settlements.group.balances'),
                    }}
                  />
                ) : null}
                {counts.balances === 0 && !mayAddLine
                  ? emptyLine('statement.empty.balances')
                  : null}
              </>
            ) : null}

            {tab === 'recurring' ? (
              <>
                {deductionTable(
                  linesOn('recurring'),
                  t('statement.tab.recurring'),
                )}
                {counts.recurring === 0
                  ? emptyLine('statement.empty.recurring')
                  : null}
              </>
            ) : null}

            {tab === 'oneTime' ? (
              <>
                {mayAddCharge && settlement.batchId ? (
                  <AddStatementDeduction
                    settlementId={settlement.id}
                    batchId={settlement.batchId}
                    types={BATCH_CHARGE_TYPES}
                    translate={translate}
                    labels={{
                      heading: t('statement.deduction.heading'),
                      hint: t('statement.deduction.hint'),
                      type: t('batch.deduction.type'),
                      description: t('batch.deduction.description'),
                      amount: t('batch.deduction.amount'),
                      add: t('settlements.add'),
                    }}
                  />
                ) : null}
                {deductionTable(linesOn('oneTime'), t('statement.tab.oneTime'))}
                {/* THE ADD-ROWS, on a statement with no batch only: nothing
                 * rebuilds it, so a line added by hand stays. */}
                {otherPayLines.length > 0 || mayAddLine ? (
                  <ChargeGrid
                    settlementId={settlement.id}
                    rows={otherPayLines.map(toChargeRow)}
                    types={typeOptions(OTHER_PAY_TYPES)}
                    canAdd={mayAddLine}
                    locale={locale}
                    translate={translate}
                    labels={{
                      ...gridLabels,
                      heading: t('settlements.group.otherPay'),
                    }}
                  />
                ) : null}
                {deductionLines.length > 0 || mayAddLine ? (
                  <div
                    id={mayAddLine ? 'charges-to-add' : undefined}
                    className="scroll-mt-z4"
                  >
                    <ChargeGrid
                      settlementId={settlement.id}
                      rows={deductionLines.map(toChargeRow)}
                      types={typeOptions(DEDUCTION_TYPES)}
                      canAdd={mayAddLine}
                      locale={locale}
                      translate={translate}
                      labels={{
                        ...gridLabels,
                        heading: t('settlements.group.deductions'),
                      }}
                    />
                  </div>
                ) : null}
                {counts.oneTime === 0 && !mayAdd
                  ? emptyLine('statement.empty.oneTime')
                  : null}
              </>
            ) : null}

            {tab === 'attachments' ? (
              <div className="flex flex-col gap-z3 p-z4">
                <Fact label={t('statement.documents')}>
                  <Link
                    href={`/documents?settlementId=${settlement.id}`}
                    className="font-mono tabular-nums text-ink hover:text-accent"
                  >
                    {settlement._count.documents}
                  </Link>
                </Fact>
                <div>
                  <h3 className="text-xs uppercase tracking-[0.04em] text-ink-2">
                    {t('statement.notes')}
                  </h3>
                  <p className="mt-z1 whitespace-pre-wrap text-sm text-ink">
                    {settlement.notes?.trim() || (
                      <span className="text-ink-3">
                        {t('statement.noNotes')}
                      </span>
                    )}
                  </p>
                </div>
              </div>
            ) : null}
          </section>

          {settlement.status === 'APPROVED' && mayEdit ? (
            <section className="rounded-card border border-border bg-surface p-z4">
              <MarkPaid
                settlementId={settlement.id}
                methods={PAY_METHODS.map((method) => ({
                  value: method,
                  label: t(`payments.method.${method}` as MessageKey),
                }))}
                translate={translate}
                labels={{
                  heading: t('settlements.markPaid'),
                  method: t('settlements.paymentMethod'),
                  reference: t('settlements.paymentReference'),
                  referenceHint: t('settlements.paymentReferenceHint'),
                  markPaid: t('settlements.markPaid'),
                }}
              />
            </section>
          ) : null}

          {settlement.status !== 'PAID' &&
          settlement.status !== 'VOID' &&
          mayVoid ? (
            <section className="rounded-card border border-border bg-surface p-z4">
              <VoidSettlement
                settlementId={settlement.id}
                translate={translate}
                labels={{
                  void: t('settlements.void'),
                  hint: t('settlements.voidHint'),
                }}
              />
            </section>
          ) : null}
        </div>
      </div>
    </>
  )
}

/** One of the four summary cards (§6.2.10 part 7 step 4). */
function Card({
  title,
  children,
}: {
  title: string
  children: React.ReactNode
}) {
  return (
    <section className="flex flex-col gap-z2 rounded-card border border-border bg-surface px-z4 py-z3">
      <h2 className="text-sm font-medium text-ink">{title}</h2>
      {children}
    </section>
  )
}

/** One label:value pair in the header box. */
function Fact({
  label,
  children,
}: {
  label: string
  children: React.ReactNode
}) {
  return (
    <span className="flex items-baseline gap-z2">
      <span className="text-xs uppercase tracking-[0.04em] text-ink-2">
        {label}
      </span>
      <span className="text-sm text-ink">{children}</span>
    </span>
  )
}

/**
 * One chevron.
 *
 * RENDERED AS INERT TEXT WHEN THERE IS NOWHERE TO GO, never as a link to the
 * current page: a control that looks live and does nothing is the thing §10
 * objects to, and at the first or last statement in a batch that is exactly
 * what the other half of the pair would be.
 */
function Step({
  href,
  label,
  glyph,
}: {
  href: string | null
  label: string
  glyph: string
}) {
  if (href === null) {
    return (
      <span aria-hidden className="text-ink-3">
        {glyph}
      </span>
    )
  }
  return (
    <Link
      href={href}
      aria-label={label}
      className="text-ink-2 hover:text-accent"
    >
      <span aria-hidden>{glyph}</span>
    </Link>
  )
}
