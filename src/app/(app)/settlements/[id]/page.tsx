import Link from 'next/link'
import { notFound } from 'next/navigation'
import { currentUserCan, withCurrentOrg } from '@/lib/auth-context'
import { getLocaleContext } from '@/lib/locale'
import { isDeduction } from '@/lib/settlements'
import { basisSentence, type BasisTemplates } from '@/lib/settlement-view'
import { readSnapshot } from '@/lib/driver-pay'
import { formatCents } from '@/lib/money'
import { Button } from '@/components/ui/Button'
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
        company: { select: { name: true } },
        driver: { select: { id: true, firstName: true, lastName: true } },
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
          <section className="rounded-card border border-border bg-surface p-z4">
            <dl className="grid grid-cols-[auto_1fr] gap-x-z4 gap-y-z1 text-sm">
              <dt className="text-ink-2">{t('settlements.driver')}</dt>
              <dd className="text-ink">
                <Link
                  href={`/drivers/${settlement.driver.id}`}
                  className="hover:text-accent"
                >
                  {settlement.driver.firstName} {settlement.driver.lastName}
                </Link>
              </dd>
              <dt className="text-ink-2">{t('ref.authority')}</dt>
              <dd className="text-ink">{settlement.company.name}</dd>
              <dt className="text-ink-2">{t('settlements.period')}</dt>
              <dd className="font-mono text-ink">
                {day(settlement.periodStart)} → {day(settlement.periodEnd)}
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
