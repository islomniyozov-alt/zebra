import Link from 'next/link'
import { notFound } from 'next/navigation'
import { currentUserCan, withCurrentOrg } from '@/lib/auth-context'
import { getLocaleContext } from '@/lib/locale'
import { isDeduction } from '@/lib/settlements'
import { basisSentence, type BasisTemplates } from '@/lib/settlement-view'
import { readSnapshot } from '@/lib/driver-pay'
import { formatCents } from '@/lib/money'
import { Button } from '@/components/ui/Button'
import { Table, type Column } from '@/components/ui/Table'
import { sumCents, totalsLabel } from '@/lib/list-view'
import { StatusBadge } from '@/components/ui/StatusBadge'
import {
  AddLine,
  Approve,
  MarkPaid,
  RemoveLine,
  VoidSettlement,
} from './SettlementActions'
import type {
  PaymentMethod,
  SettlementLineType,
  SettlementStatus,
} from '@/generated/prisma/client'
import type { MessageKey } from '@/lib/i18n'
import type { StatusTone } from '@/lib/status'

// One settlement, and the working behind every figure on it.
//
// THE CALCULATION COLUMN IS THE POINT. Not "$897.00" but "30% of $2,990.00
// gross" beside it, rendered from the line's OWN frozen snapshot — the same
// sentence the PDF prints, from the same function, so the paper and the screen
// cannot disagree in front of a driver.

const TONE: Record<SettlementStatus, StatusTone> = {
  DRAFT: 'neutral',
  APPROVED: 'progress',
  PAID: 'success',
  VOID: 'muted',
}

/** Offered on the add-line control. LOAD_PAY is not among them — it is earned. */
const ADDABLE: SettlementLineType[] = [
  'DEDUCTION_ADVANCE',
  'DEDUCTION_FUEL',
  'DEDUCTION_INSURANCE',
  'DEDUCTION_ESCROW',
  'DEDUCTION_EQUIPMENT',
  'DEDUCTION_VIOLATION',
  'DEDUCTION_OTHER',
  'REIMBURSEMENT',
  'BONUS',
]

const PAY_METHODS: PaymentMethod[] = ['ACH', 'CHECK', 'WIRE', 'ZELLE', 'CASH']

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
        deductionsCents: true,
        reimbursementsCents: true,
        netCents: true,
        approvedAt: true,
        paidAt: true,
        paymentMethod: true,
        paymentReference: true,
        unitNumber: true,
        payTariffLabel: true,
        payoutDate: true,
        company: { select: { name: true } },
        driver: { select: { id: true, firstName: true, lastName: true } },
        batch: {
          select: {
            id: true,
            batchNumber: true,
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
        //
        // SO THE GRID READS THE SNAPSHOT AND NOT THE LOAD. Joining to `Load`
        // for the same columns would render today's values under a statement
        // number, which is the one thing a settlement must never do.
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

  const day = (value: Date | null) =>
    value ? value.toISOString().slice(0, 10) : '—'
  const translate = Object.fromEntries(ERROR_KEYS.map((key) => [key, t(key)]))

  const isDraft = settlement.status === 'DRAFT'

  // THE WORKING, IN THE READER'S LANGUAGE. Templates rather than glued words:
  // the first version concatenated English around the figures and the Farsi
  // screen rendered "of $2,450.00 gross 30%" — mirrored numbers, unmirrored
  // words, unreadable in the one place a driver checks their pay.
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

  type TripRow = (typeof settlement.loadLines)[number]

  const tripColumns: Column<TripRow>[] = [
    {
      key: 'loadNumber',
      header: t('settlements.trip.load'),
      render: (row) => (
        <span className="z-identifier font-mono" dir="ltr">
          {row.loadNumber}
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
      key: 'puDate',
      header: t('settlements.trip.puDate'),
      render: (row) => (
        <span className="font-mono text-xs" dir="ltr">
          {day(row.puDate)}
        </span>
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
      key: 'gross',
      header: t('settlements.trip.gross'),
      align: 'end',
      render: (row) => money(row.grossCents),
      foot: (rows) => money(sumCents(rows, (row) => row.grossCents)),
    },
    {
      key: 'miles',
      header: t('settlements.trip.miles'),
      align: 'end',
      // STORED IN HUNDREDTHS and printed whole: §8 says miles are an integer
      // with a thousands separator. The hundredths exist so a per-mile rate
      // does not lose a fraction of a cent, not so a statement prints 1,234.56
      // miles.
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
    {
      key: 'amount',
      header: t('settlements.trip.amount'),
      align: 'end',
      render: (row) => money(row.amountCents),
      foot: (rows) => money(sumCents(rows, (row) => row.amountCents)),
    },
  ]

  return (
    <>
      <div className="flex items-baseline justify-between gap-z4 border-b border-border bg-surface px-gutter py-z3">
        <div className="flex items-center gap-z3">
          <h1 className="text-lg font-medium text-ink">
            <span className="font-mono">{settlement.settlementNumber}</span>
          </h1>
          <StatusBadge
            tone={TONE[settlement.status]}
            label={t(`settlementStatus.${settlement.status}` as MessageKey)}
          />
        </div>
        {/* A real link, not a fetch — the browser handles a PDF better than
         * anything worth writing here. */}
        <a
          href={`/api/settlements/${settlement.id}/pdf`}
          target="_blank"
          rel="noopener"
        >
          <Button variant="secondary" size="compact">
            {t('settlements.download')}
          </Button>
        </a>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto bg-surface-2 px-gutter py-z5">
        <div className="flex max-w-[900px] flex-col gap-z4">
          {/* ── THE HEADER BOX ───────────────────────────────────────────
           *
           * The block the printed statement opens with, in the order it
           * prints: who, under which authority, on which run, against which
           * unit and tariff, for which period, paid on which date.
           *
           * IT IS THE PDF'S OWN HEADER, FIELD FOR FIELD — `statement-pdf.ts`
           * lays out Settlement, Batch ID, Driver, Unit Number and Payment
           * tariff across the top and the three dates down the right. A screen
           * that showed a different subset would make "the paper says
           * something else" a sentence somebody has to resolve in front of a
           * driver, which §7's whole freeze exists to prevent.
           *
           * THREE COLUMNS, NOT TWO. The old two-column list ran to eight rows
           * before the lines began; the same facts fit in three and leave the
           * trips above the fold at 1080p (rule 1).
           */}
          <section className="rounded-card border border-border bg-surface p-z4">
            <dl className="grid grid-cols-[auto_1fr_auto_1fr_auto_1fr] gap-x-z3 gap-y-z1 text-sm">
              <dt className="text-ink-2">{t('settlements.driver')}</dt>
              <dd className="text-ink">
                <Link
                  href={`/drivers/${settlement.driver.id}`}
                  className="hover:text-accent"
                >
                  {settlement.driver.firstName} {settlement.driver.lastName}
                </Link>
              </dd>
              <dt className="text-ink-2">{t('payroll.unit')}</dt>
              <dd className="text-ink">
                {settlement.unitNumber === null ? (
                  <span className="text-ink-3">—</span>
                ) : (
                  <span className="z-identifier font-mono" dir="ltr">
                    {settlement.unitNumber}
                  </span>
                )}
              </dd>
              <dt className="text-ink-2">{t('batches.batch')}</dt>
              <dd className="text-ink">
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
              </dd>

              <dt className="text-ink-2">{t('ref.authority')}</dt>
              <dd className="text-ink">{settlement.company.name}</dd>
              <dt className="text-ink-2">{t('settlements.period')}</dt>
              <dd className="font-mono text-ink" dir="ltr">
                {day(settlement.periodStart)} → {day(settlement.periodEnd)}
              </dd>
              <dt className="text-ink-2">{t('batch.checkDate')}</dt>
              <dd className="font-mono text-ink" dir="ltr">
                {day(
                  settlement.payoutDate ?? settlement.batch?.checkDate ?? null,
                )}
              </dd>

              {/* THE TARIFF SPANS, because it is a sentence rather than a
               * field — "30% from gross" is the whole of how this driver is
               * paid and it reads badly squeezed into a third of a row. */}
              <dt className="text-ink-2">{t('settlements.tariff')}</dt>
              <dd className="col-span-5 text-ink">
                {settlement.payTariffLabel ?? (
                  <span className="text-ink-3">—</span>
                )}
              </dd>
              {settlement.approvedAt ? (
                <>
                  <dt className="text-ink-2">{t('settlements.approvedOn')}</dt>
                  <dd className="font-mono text-ink">
                    {day(settlement.approvedAt)}
                  </dd>
                </>
              ) : null}
              {settlement.paidAt ? (
                <>
                  <dt className="text-ink-2">{t('settlements.paidOn')}</dt>
                  <dd className="text-ink">
                    <span className="font-mono">{day(settlement.paidAt)}</span>
                    {settlement.paymentReference ? (
                      <span className="text-ink-3">
                        {' · '}
                        {settlement.paymentMethod} {settlement.paymentReference}
                      </span>
                    ) : null}
                  </dd>
                </>
              ) : null}
            </dl>
          </section>

          {/* ── THE TRIPS GRID ───────────────────────────────────────────
           *
           * The freight this statement pays for, in the PDF's own columns:
           * load number, PU, DEL, the two dates, load gross, miles, and what
           * the driver was paid for it.
           *
           * ITS OWN GRID, ABOVE THE LINES, because they answer different
           * questions. A trip row says "this load, this money"; a settlement
           * LINE says "this adjustment". They were one list, so a $50 fuel
           * deduction sat between two loads and the reader had to tell them
           * apart by reading.
           *
           * `Table` RATHER THAN A LIST, for the sticky header and the totals
           * foot — a statement is a document somebody checks against a
           * printout, and the column sums are the check.
           */}
          {settlement.loadLines.length > 0 ? (
            <section className="overflow-hidden rounded-card border border-border bg-surface">
              <h2 className="border-b border-border px-z4 py-z3 text-md font-medium text-ink">
                {t('settlements.trips')}
              </h2>
              <Table
                columns={tripColumns}
                rows={settlement.loadLines}
                rowKey={(row) => row.id}
                rowHref={(row) => `/loads/${row.loadId}`}
                caption={t('settlements.trips')}
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

          <section className="rounded-card border border-border bg-surface p-z4">
            <h2 className="text-md font-medium text-ink">
              {t('settlements.lines')}
            </h2>

            <ul className="mt-z3 flex flex-col">
              {settlement.lines.map((line) => (
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
                    <span className="w-[70px] text-xs text-ink-3">
                      {t(`settlementLine.${line.type}` as MessageKey)}
                    </span>
                  )}
                  <span className="text-ink">{line.description}</span>
                  {/* The working, from the line's own snapshot. */}
                  <span className="text-xs text-ink-3">
                    {basisSentence(
                      readSnapshot(line.payRuleSnapshot),
                      locale,
                      basisTemplates,
                    )}
                  </span>
                  <span
                    className={
                      isDeduction(line.type)
                        ? 'ms-auto font-mono tabular-nums text-danger'
                        : 'ms-auto font-mono tabular-nums text-ink'
                    }
                  >
                    {formatCents(line.amountCents, locale)}
                  </span>
                  {isDraft && mayEdit && line.type !== 'LOAD_PAY' ? (
                    <RemoveLine
                      settlementId={settlement.id}
                      lineId={line.id}
                      label={t('settlements.remove')}
                    />
                  ) : null}
                </li>
              ))}
            </ul>

            {/* Every figure here is the lines added, and the lines are their
             * own stored integers — so a reader can check the document against
             * the freight it came from (rule 9-money). */}
            <dl className="mt-z4 grid grid-cols-[1fr_auto] gap-x-z4 gap-y-z1 text-sm">
              <dt className="text-ink-2">{t('settlements.gross')}</dt>
              <dd className="text-end font-mono tabular-nums text-ink">
                {formatCents(settlement.grossCents, locale)}
              </dd>
              {settlement.reimbursementsCents !== 0 ? (
                <>
                  <dt className="text-ink-2">
                    {t('settlements.reimbursements')}
                  </dt>
                  <dd className="text-end font-mono tabular-nums text-ink">
                    {formatCents(settlement.reimbursementsCents, locale)}
                  </dd>
                </>
              ) : null}
              {settlement.deductionsCents !== 0 ? (
                <>
                  <dt className="text-ink-2">{t('settlements.deductions')}</dt>
                  <dd className="text-end font-mono tabular-nums text-danger">
                    {formatCents(-settlement.deductionsCents, locale)}
                  </dd>
                </>
              ) : null}
              <dt className="border-t border-border pt-z1 font-medium text-ink">
                {t('settlements.net')}
              </dt>
              <dd className="border-t border-border pt-z1 text-end font-mono tabular-nums font-medium text-ink">
                {formatCents(settlement.netCents, locale)}
              </dd>
            </dl>
          </section>

          {isDraft && mayEdit ? (
            <section className="rounded-card border border-border bg-surface p-z4">
              <AddLine
                settlementId={settlement.id}
                types={ADDABLE.map((type) => ({
                  value: type,
                  label: t(`settlementLine.${type}` as MessageKey),
                }))}
                translate={translate}
                labels={{
                  heading: t('settlements.addLine'),
                  hint: t('settlements.addLineHint'),
                  type: t('settlements.lineType'),
                  description: t('settlements.description'),
                  amount: t('settlements.amount'),
                  add: t('settlements.add'),
                }}
              />
            </section>
          ) : null}

          {isDraft && mayApprove ? (
            <section className="rounded-card border border-border bg-surface p-z4">
              <Approve
                settlementId={settlement.id}
                translate={translate}
                labels={{
                  approve: t('settlements.approve'),
                  hint: t('settlements.approveHint'),
                }}
              />
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
