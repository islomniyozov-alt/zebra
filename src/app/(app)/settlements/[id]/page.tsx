import Link from 'next/link'
import { notFound } from 'next/navigation'
import { currentUserCan, withCurrentOrg } from '@/lib/auth-context'
import { getLocaleContext } from '@/lib/locale'
import { isDeduction } from '@/lib/settlements'
import { basisSentence, type BasisTemplates } from '@/lib/settlement-view'
import { readSnapshot } from '@/lib/driver-pay'
import { readCharge } from '@/lib/settlement-charge'
import { statementTitle } from '@/lib/settlement-number'
import { formatCents } from '@/lib/money'
import { Button } from '@/components/ui/Button'
import { Table, type Column } from '@/components/ui/Table'
import {
  addableTrips,
  fuelAndTollsFor,
  statementNeighbours,
} from '@/lib/statement-workbench'
import { sumCents, totalsLabel } from '@/lib/list-view'
import { StatusBadge } from '@/components/ui/StatusBadge'
import { PageHeader } from '../../_grid/PageHeader'
import { ColumnsChooser } from '../../_grid/ColumnsChooser'
import { keepColumns } from '../../_grid/grid-page'
import { readGridColumns } from '@/lib/grid-columns'
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
  SettlementStatus,
} from '@/generated/prisma/client'
import type { MessageKey } from '@/lib/i18n'
import type { StatusTone } from '@/lib/status'

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

const TONE: Record<SettlementStatus, StatusTone> = {
  DRAFT: 'neutral',
  APPROVED: 'progress',
  PAID: 'success',
  VOID: 'muted',
}

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
]

export default async function SettlementPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  if (!(await currentUserCan('read', 'settlement'))) notFound()

  const { id } = await params
  const { t, locale } = await getLocaleContext()
  const mayEdit = await currentUserCan('update', 'settlement')
  const mayApprove = await currentUserCan('approve', 'settlement')
  const mayVoid = await currentUserCan('delete', 'settlement')

  const settlement = await withCurrentOrg('read', 'settlement', (tx) =>
    tx.settlement.findUnique({
      where: { id },
      select: {
        id: true,
        settlementNumber: true,
        periodStart: true,
        periodEnd: true,
        status: true,
        grossCents: true,
        earningsCents: true,
        deductionsCents: true,
        reimbursementsCents: true,
        advancesCents: true,
        otherPayCents: true,
        netCents: true,
        milesHundredths: true,
        approvedAt: true,
        paidAt: true,
        paymentMethod: true,
        paymentReference: true,
        unitNumber: true,
        payTariffLabel: true,
        payoutDate: true,
        batchId: true,
        company: { select: { name: true } },
        driver: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            email: true,
            employmentType: true,
          },
        },
        _count: { select: { documents: true } },
        batch: {
          select: {
            id: true,
            batchNumber: true,
            // READ FOR THE EXPORT GATE. The statement route refuses on the
            // BATCH's status, not the settlement's — see the gate below.
            status: true,
            statementDate: true,
            checkDate: true,
          },
        },
        // ── THE TRIPS, FROM THE FROZEN SNAPSHOT ────────────────────────
        //
        // `SettlementLoadLine` carries the load's number, its two places, its
        // two dates, its gross and its miles AS THEY WERE when the statement
        // was cut. §7 freezes those at FINAL for exactly this reason: a load
        // re-dated or re-rated afterwards must not change a document somebody
        // was handed.
        loadLines: {
          orderBy: { sortOrder: 'asc' },
          select: {
            id: true,
            loadId: true,
            loadNumber: true,
            companyName: true,
            puPlace: true,
            delPlace: true,
            puDate: true,
            delDate: true,
            grossCents: true,
            milesHundredths: true,
            amountCents: true,
            // THE TWO LIVE FIELDS ON THIS PAGE, AND NEITHER IS MONEY. The
            // artefact's grid carries a broker reference and an operational
            // status, and the snapshot freezes neither — correctly, because
            // both are facts about the LOAD TODAY rather than about what was
            // paid. They are read through the relation and nothing on the
            // statement depends on them.
            load: {
              select: { referenceNumber: true, operationalStatus: true },
            },
          },
        },
        lines: {
          orderBy: { sortOrder: 'asc' },
          select: {
            id: true,
            type: true,
            description: true,
            amountCents: true,
            payRuleSnapshot: true,
            load: { select: { id: true, loadNumber: true } },
          },
        },
      },
    }),
  )

  if (!settlement) notFound()

  // ── THE THREE READS THE HEADER NEEDS, AND NOTHING THE PAGE WILL NOT SHOW ─
  //
  // `addable` is DRAFT-only: on an approved statement the panel would offer
  // buttons that `addTripsToSettlement` refuses, and the read costs a
  // `batchInputForOrg`, which is not free.
  const [addable, fuel, storedColumns, neighbours] = await Promise.all([
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
    withCurrentOrg('read', 'settlement', (tx) =>
      fuelAndTollsFor(tx, {
        driverId: settlement.driver.id,
        periodStart: settlement.periodStart,
        periodEnd: settlement.periodEnd,
      }),
    ),
    withCurrentOrg('read', 'settlement', (tx, session) =>
      readGridColumns(
        tx,
        session.userId,
        'settlements.trips',
        TRIP_COLUMN_KEYS,
      ),
    ),
    withCurrentOrg('read', 'settlement', (tx) =>
      statementNeighbours(tx, {
        settlementId: settlement.id,
        batchId: settlement.batchId,
        driverId: settlement.driver.id,
        settlementNumber: settlement.settlementNumber,
        periodStart: settlement.periodStart,
      }),
    ),
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
  const loadPayLines = settlement.lines.filter(
    (line) => line.type === 'LOAD_PAY',
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
      render: (row) => (
        <span className="z-identifier font-mono" dir="ltr">
          {row.loadNumber}
        </span>
      ),
    },
    {
      key: 'load',
      header: t('workbench.loadId'),
      render: (row) =>
        row.load?.referenceNumber ? (
          <span className="font-mono text-xs text-ink-2" dir="ltr">
            {row.load.referenceNumber}
          </span>
        ) : (
          <span className="text-ink-3">—</span>
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
      key: 'totalPay',
      header: t('workbench.totalPay'),
      align: 'end',
      // THE GROSS THE RULE WAS APPLIED TO — the artefact's "Total pay" and the
      // PDF's "Load gross" are the same column under two names.
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

  return (
    <>
      <PageHeader
        title={title}
        breadcrumb={[t('nav.group.payroll'), t('nav.statements')]}
        action={
          // ── THE ACTION ROW (§6.2.2) ────────────────────────────────
          //
          // It belongs to the PAGE and does not move as the statement changes
          // state — except that a control which cannot act is absent rather
          // than disabled, which is this codebase's existing rule and the
          // reason Post disappears once a statement is approved.
          <div className="flex flex-wrap items-center gap-z2">
            {/* ── ADD TRIPS AND ADD CHARGES ARE JUMPS, NOT SECOND CONTROLS ──
             *
             * Both things they would open already exist further down the page,
             * and a toolbar copy would be a second control writing the same
             * rows — two places to fix when the rule changes. An anchor is
             * honest about that: it takes you to the one control.
             *
             * ADD TRIPS IS ABSENT WHEN THERE IS NOTHING TO ADD rather than
             * disabled, which is this codebase's rule — "you cannot do that
             * yet" is better said by the control not being there. */}
            {mayAdd && addable.length > 0 ? (
              <a href="#trips-to-add">
                <Button variant="secondary" size="compact">
                  {t('settlements.addTrips')}
                </Button>
              </a>
            ) : null}
            {mayAdd ? (
              <a href="#charges-to-add">
                <Button variant="secondary" size="compact">
                  {t('workbench.addCharges')}
                </Button>
              </a>
            ) : null}
            {mayAdd ? (
              <Recalculate
                settlementId={settlement.id}
                label={t('settlements.recalculate')}
              />
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
            {/* ── EXPORT PDF POINTS AT THE STATEMENT, NOT THE OLD STUB ────
             *
             * Owner, 2026-09-30: "the statement PDF is a stub — gross and net
             * only, no lines". It was, because this button linked
             * `/api/settlements/{id}/pdf` — a SECOND renderer, older and
             * thinner, while the batch detail page had been linking the real
             * Datatruck-layout one all along. Two documents for one
             * settlement, and the workbench was showing the wrong one.
             *
             * ABSENT WHEN THE ROUTE WOULD REFUSE, on exactly the route's own
             * condition: no batch, or a batch still in DRAFT. A draft's lines
             * are thrown away and rebuilt on every refresh, so a PDF of one
             * is a figure that will be different tomorrow.
             *
             * THE FIRST VERSION GATED ON THE SETTLEMENT'S STATUS AND WAS
             * WRONG. A settlement can be PAID inside a batch that is still a
             * draft — dev holds exactly that row — so the button appeared and
             * the route answered 409. Two conditions that were supposed to
             * agree, written twice. Found by fetching the real bytes from the
             * deployed worker, not by the suite. */}
            {settlement.batch !== null &&
            settlement.batch.status !== 'DRAFT' ? (
              <a
                href={`/api/settlements/statement/${settlement.id}`}
                target="_blank"
                rel="noopener"
              >
                <Button variant="secondary" size="compact">
                  {t('workbench.exportPdf')}
                </Button>
              </a>
            ) : null}
          </div>
        }
      />

      <div className="min-h-0 flex-1 overflow-y-auto bg-surface-2 px-gutter py-z4">
        <div className="flex flex-col gap-z4">
          {/* ── THE HEADER BOX (§6.2.2) ──────────────────────────────── */}
          <section className="rounded-card border border-border bg-surface px-z4 py-z3">
            <div className="flex flex-wrap items-baseline gap-x-z5 gap-y-z2">
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
                  {/* THE ID MAY APPEAR HERE (§8): a field in mono is where
                   * a value somebody might have to quote belongs. It is the
                   * HEADING that must be a name. */}
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
              <Fact label={t('settlements.driver')}>
                <Link
                  href={`/drivers/${settlement.driver.id}`}
                  className="text-ink hover:text-accent"
                >
                  {driverName}
                </Link>
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
                  `drivers.employment.${settlement.driver.employmentType}` as MessageKey,
                )}
              </Fact>
              <Fact label={t('settlements.tariff')}>
                {/* §12: `dir="ltr"` ON A FROZEN LATIN STRING. `payTariffLabel`
                 * is stored as the statement printed it — "3% from gross" —
                 * and the bidi algorithm reorders that to "from gross 3%" on
                 * the Farsi screen, which is the same class of bug the
                 * `basisSentence` templates exist to avoid. It cannot be
                 * templated, because it is frozen; it can be given a
                 * direction. */}
                {settlement.payTariffLabel === null ? (
                  <span className="text-ink-3">—</span>
                ) : (
                  <span dir="ltr">{settlement.payTariffLabel}</span>
                )}
              </Fact>
              <Fact label={t('ref.authority')}>{settlement.company.name}</Fact>
              {/* BACK IN THE HEADER (v10.2). One truck per settlement, frozen
               * — as a grid column it was the same number on every row, and
               * ST-005562 prints it here. */}
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
              <span className="ms-auto">
                <StatusBadge
                  tone={TONE[settlement.status]}
                  label={t(
                    `settlementStatus.${settlement.status}` as MessageKey,
                  )}
                />
              </span>
            </div>

            {/* THE FIGURES, ON THEIR OWN ROW AND SEPARATED BY A RULE. They are
             * what the page is for; the block above is who and when. */}
            <div className="mt-z3 flex flex-wrap items-baseline gap-x-z5 gap-y-z2 border-t border-border pt-z3">
              <Fact label={t('workbench.totalPay')}>
                {money(settlement.grossCents)}
              </Fact>
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
              <Fact label={t('workbench.tripsCount')}>
                <span className="font-mono tabular-nums">
                  {settlement.loadLines.length}
                </span>
              </Fact>
              <Fact label={t('workbench.balances')}>
                {money(
                  balanceLines.reduce((sum, line) => sum + line.amountCents, 0),
                )}
              </Fact>
              {/* §6.2.3: A READ IS NOT A CHARGE. The label says what was
               * burned, and the second figure says what is already coming off
               * the cheque — without it a reader cannot tell a company-fuel
               * driver from one about to be charged the whole of it. */}
              <Fact label={t('workbench.fuelTolls')}>
                {money(fuel.totalCents)}
                <span className="ms-z1 text-xs text-ink-3">
                  {t('workbench.burned')}
                  {fuel.alreadyDeductedCents > 0
                    ? ` · ${t('workbench.deducted')} ${formatCents(
                        fuel.alreadyDeductedCents,
                        locale,
                      )}`
                    : ''}
                </span>
              </Fact>
              <Fact label={t('workbench.attachments')}>
                <Link
                  href={`/documents?settlementId=${settlement.id}`}
                  className="font-mono tabular-nums text-ink hover:text-accent"
                >
                  {settlement._count.documents}
                </Link>
              </Fact>
              <span className="ms-auto flex items-baseline gap-z2">
                <span className="text-xs uppercase tracking-[0.04em] text-ink-2">
                  {t('settlements.net')}
                </span>
                <span className="font-mono text-lg font-medium tabular-nums text-ink">
                  {formatCents(settlement.netCents, locale)}
                </span>
              </span>
            </div>
          </section>

          {/* ── THE TRIPS GRID ─────────────────────────────────────────── */}
          {settlement.loadLines.length > 0 ? (
            <section className="overflow-hidden rounded-card border border-border bg-surface">
              <div className="flex items-baseline justify-between gap-z3 border-b border-border px-z4 py-z3">
                <h2 className="text-md font-medium text-ink">
                  {t('settlements.trips')}
                </h2>
                {/* THE CHOOSER IS WHY THIS GRID IS LEGAL. Eleven columns, nine
                 * shown — §6.2.2 as corrected in v10.2, and the other two are
                 * a tick away rather than gone. */}
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
              </div>
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
            </section>
          ) : null}

          {/* ── ADD TRIPS ──────────────────────────────────────────────
           *
           * Still a panel and not an add-row, because it is not one: the
           * add-row writes a figure somebody typed, and this offers a LIST of
           * this driver's unsettled freight with the held ones marked. There
           * is nothing to type. */}
          {mayAdd && addable.length > 0 ? (
            <section
              id="trips-to-add"
              className="scroll-mt-z4 rounded-card border border-border bg-surface p-z4"
            >
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
                      : t(HELD_REASON[trip.held.kind] ?? 'batch.held.short'),
                }))}
                translate={translate}
                labels={{
                  heading: t('settlements.addTrips'),
                  hint: t('settlements.addTripsHint'),
                  add: t('settlements.add'),
                  heldNote: t('settlements.heldNote'),
                }}
              />
            </section>
          ) : null}

          {/* ── THE THREE LINE GRIDS, EACH WITH ITS ADD-ROW ─────────────
           *
           * Rendered even when empty, unlike the old page — because an empty
           * grid here is not a claim that somebody looked and found nothing,
           * it is the row you add the first deduction in. That is the whole
           * difference the add-row makes: the section IS the control. */}
          {otherPayLines.length > 0 || mayAdd ? (
            <ChargeGrid
              settlementId={settlement.id}
              rows={otherPayLines.map(toChargeRow)}
              types={typeOptions(OTHER_PAY_TYPES)}
              canAdd={mayAdd}
              locale={locale}
              translate={translate}
              labels={{
                ...gridLabels,
                heading: t('settlements.group.otherPay'),
              }}
            />
          ) : null}

          {deductionLines.length > 0 || mayAdd ? (
            <div id="charges-to-add" className="scroll-mt-z4">
              <ChargeGrid
                settlementId={settlement.id}
                rows={deductionLines.map(toChargeRow)}
                types={typeOptions(DEDUCTION_TYPES)}
                canAdd={mayAdd}
                locale={locale}
                translate={translate}
                labels={{
                  ...gridLabels,
                  heading: t('settlements.group.deductions'),
                }}
              />
            </div>
          ) : null}

          {balanceLines.length > 0 || mayAdd ? (
            <ChargeGrid
              settlementId={settlement.id}
              rows={balanceLines.map(toChargeRow)}
              types={typeOptions(BALANCE_TYPES)}
              canAdd={mayAdd}
              locale={locale}
              translate={translate}
              labels={{
                ...gridLabels,
                heading: t('settlements.group.balances'),
              }}
            />
          ) : null}

          {/* LOAD PAY STAYS VISIBLE even though the trips grid shows the same
           * freight: the grid is the SNAPSHOT and these are the LINES that
           * make the total. Dropping them leaves the header's gross
           * unexplained by anything on the page. */}
          {loadPayLines.length > 0 ? (
            <section className="rounded-card border border-border bg-surface p-z4">
              <div className="flex items-baseline justify-between gap-z3">
                <h2 className="text-md font-medium text-ink">
                  {t('settlements.group.loadPay')}
                </h2>
                <span className="font-mono text-sm font-medium tabular-nums text-ink">
                  {formatCents(
                    loadPayLines.reduce(
                      (sum, line) => sum + line.amountCents,
                      0,
                    ),
                    locale,
                  )}
                </span>
              </div>
              <ul className="mt-z3 flex flex-col">
                {loadPayLines.map((line) => (
                  <li
                    key={line.id}
                    className="flex items-baseline gap-z3 border-b border-border py-z2 text-sm last:border-b-0"
                  >
                    {line.load ? (
                      <Link
                        href={`/loads/${line.load.id}`}
                        className="z-identifier w-[70px] font-mono text-xs text-ink-3 hover:text-accent"
                      >
                        {line.load.loadNumber}
                      </Link>
                    ) : (
                      <span className="w-[70px] text-xs text-ink-3" />
                    )}
                    <span className="text-ink">{line.description}</span>
                    <span className="text-xs text-ink-3">
                      {basisSentence(
                        readSnapshot(line.payRuleSnapshot),
                        locale,
                        basisTemplates,
                      )}
                    </span>
                    <span className="ms-auto font-mono tabular-nums text-ink">
                      {formatCents(line.amountCents, locale)}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

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
