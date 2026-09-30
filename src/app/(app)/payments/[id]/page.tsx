import Link from 'next/link'
import { notFound } from 'next/navigation'
import { currentUserCan, withCurrentOrg } from '@/lib/auth-context'
import { getLocaleContext } from '@/lib/locale'
import { invoiceCandidates, statementCandidates } from '@/lib/payments'
import { formatCents } from '@/lib/money'
import { StatusBadge } from '@/components/ui/StatusBadge'
import { OpenItems, type OpenItem } from './OpenItems'
import type { MessageKey } from '@/lib/i18n'

// One payment: what landed, what it has been said to pay, and what is left.
//
// The two apply panels are BOTH offered, and which of them has anything in it
// answers the question by itself — a Relay ACH finds direct-settled loads and
// no open invoices, a broker's check finds the opposite. Hiding the empty one
// would be tidier and would also hide the reason there are two.

const ERROR_KEYS: MessageKey[] = [
  'payments.error.paymentNotFound',
  'payments.error.invoiceNotFound',
  'payments.error.loadNotFound',
  'payments.error.noLoads',
  'payments.error.badAmount',
  'payments.error.exceedsUnapplied',
  'payments.error.exceedsBalance',
  'payments.error.exceedsLoadBalance',
  'payments.error.wrongCarrier',
  'payments.error.notDirectSettled',
  'payments.error.factoredInvoice',
  'payments.error.notFactored',
]

export default async function PaymentPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  if (!(await currentUserCan('read', 'payment'))) notFound()

  const { id } = await params
  const { t, locale } = await getLocaleContext()
  const mayApply = await currentUserCan('update', 'payment')

  const data = await withCurrentOrg('read', 'payment', async (tx) => {
    const payment = await tx.payment.findUnique({
      where: { id },
      select: {
        id: true,
        companyId: true,
        customerId: true,
        method: true,
        referenceNumber: true,
        receivedAt: true,
        amountCents: true,
        unappliedCents: true,
        notes: true,
        company: { select: { name: true } },
        customer: { select: { name: true } },
        applications: {
          orderBy: { appliedAt: 'asc' },
          select: {
            id: true,
            amountCents: true,
            invoice: {
              select: { id: true, invoiceNumber: true, balanceCents: true },
            },
          },
        },
        loadApplications: {
          orderBy: { appliedAt: 'asc' },
          select: {
            id: true,
            amountCents: true,
            load: { select: { id: true, loadNumber: true } },
          },
        },
      },
    })
    if (!payment) return null

    // Only what `applyToInvoice`/`applyToLoads` will actually accept. A
    // dropdown whose entries are rejected on submit is a worse screen than one
    // that never offers them.
    const [invoices, loads] = mayApply
      ? await Promise.all([
          invoiceCandidates(
            tx,
            payment.companyId,
            payment.customerId,
            payment.method,
          ),
          statementCandidates(tx, payment.companyId, payment.customerId),
        ])
      : [[], []]

    return { payment, invoices, loads }
  })

  if (!data) notFound()
  const { payment } = data

  const day = (value: Date) => value.toISOString().slice(0, 10)
  const translate = Object.fromEntries(ERROR_KEYS.map((key) => [key, t(key)]))

  // ── THE PAYER'S OPEN ITEMS, BOTH KINDS IN ONE LIST (§6.2.5) ───────────
  //
  // The question this page answers is "what does this payer owe us". Two
  // mappings into two tables made somebody add up two subtotals to see
  // whether the wire was covered, so the kind is a COLUMN here rather than a
  // heading.
  //
  // ORDERED BY WHAT IS OWED, LARGEST FIRST, and deliberately not grouped by
  // kind — a grouping would reintroduce the two lists this one replaces.
  const openItems: OpenItem[] = [
    ...data.invoices.map(
      (invoice): OpenItem => ({
        kind: 'invoice',
        id: invoice.invoiceId,
        label: invoice.invoiceNumber,
        when: invoice.dueDate ? day(invoice.dueDate) : '—',
        balanceCents: invoice.balanceCents,
      }),
    ),
    ...data.loads
      .filter((load) => load.outstandingCents > 0)
      .map(
        (load): OpenItem => ({
          kind: 'load',
          id: load.loadId,
          label: load.loadNumber,
          when: day(load.bookedAt),
          balanceCents: load.outstandingCents,
        }),
      ),
  ].sort((left, right) => right.balanceCents - left.balanceCents)

  const appliedCents = payment.amountCents - payment.unappliedCents

  return (
    <>
      <div className="flex items-baseline justify-between gap-z4 border-b border-border bg-surface px-gutter py-z3">
        <div className="flex items-center gap-z3">
          <h1 className="text-lg font-medium text-ink">
            <span className="font-mono">
              {formatCents(payment.amountCents, locale)}
            </span>
          </h1>
          <StatusBadge
            tone={payment.unappliedCents > 0 ? 'warning' : 'success'}
            label={
              payment.unappliedCents > 0
                ? `${t('payments.unapplied')} ${formatCents(payment.unappliedCents, locale)}`
                : t('payments.fullyApplied')
            }
          />
        </div>
        <Link href="/payments" className="text-sm text-accent hover:underline">
          {t('payments.title')}
        </Link>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto bg-surface-2 px-gutter py-z5">
        <div className="flex max-w-[860px] flex-col gap-z4">
          <section className="rounded-card border border-border bg-surface p-z4">
            <dl className="grid grid-cols-[auto_1fr] gap-x-z4 gap-y-z1 text-sm">
              <dt className="text-ink-2">{t('payments.received')}</dt>
              <dd className="font-mono text-ink">{day(payment.receivedAt)}</dd>
              <dt className="text-ink-2">{t('payments.method')}</dt>
              <dd className="text-ink">
                {t(`payments.method.${payment.method}` as MessageKey)}
              </dd>
              <dt className="text-ink-2">{t('payments.reference')}</dt>
              <dd className="font-mono text-ink">
                {payment.referenceNumber ?? '—'}
              </dd>
              <dt className="text-ink-2">{t('payments.payer')}</dt>
              <dd className="text-ink">{payment.customer?.name ?? '—'}</dd>
              <dt className="text-ink-2">{t('ref.authority')}</dt>
              <dd className="text-ink">{payment.company.name}</dd>
              <dt className="text-ink-2">{t('payments.applied')}</dt>
              {/* amount − unapplied, both stored integers, so a reader can
               * check the figure without leaving the screen (rule 9-money). */}
              <dd className="font-mono tabular-nums text-ink">
                {formatCents(appliedCents, locale)}
              </dd>
              {payment.notes ? (
                <>
                  <dt className="text-ink-2">{t('payments.notes')}</dt>
                  <dd className="text-ink">{payment.notes}</dd>
                </>
              ) : null}
            </dl>
          </section>

          <section className="rounded-card border border-border bg-surface p-z4">
            <h2 className="text-md font-medium text-ink">
              {t('payments.applications')}
            </h2>
            {payment.applications.length === 0 &&
            payment.loadApplications.length === 0 ? (
              <p className="mt-z2 text-sm text-ink-3">
                {t('payments.noApplications')}
              </p>
            ) : (
              <ul className="mt-z3 flex flex-col">
                {payment.applications.map((application) => (
                  <li
                    key={application.id}
                    className="flex items-baseline gap-z3 border-b border-border py-z2 text-sm last:border-b-0"
                  >
                    <span className="text-ink-2">{t('payments.invoice')}</span>
                    <Link
                      href={`/invoices/${application.invoice.id}`}
                      className="font-mono font-medium text-ink hover:text-accent"
                    >
                      {application.invoice.invoiceNumber}
                    </Link>
                    <span className="ms-auto font-mono tabular-nums text-ink">
                      {formatCents(application.amountCents, locale)}
                    </span>
                  </li>
                ))}
                {payment.loadApplications.map((application) => (
                  <li
                    key={application.id}
                    className="flex items-baseline gap-z3 border-b border-border py-z2 text-sm last:border-b-0"
                  >
                    <span className="text-ink-2">{t('payments.load')}</span>
                    <Link
                      href={`/loads/${application.load.id}`}
                      className="z-identifier font-mono font-medium text-ink hover:text-accent"
                    >
                      {application.load.loadNumber}
                    </Link>
                    <span className="ms-auto font-mono tabular-nums text-ink">
                      {formatCents(application.amountCents, locale)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>

          {/* ── APPLY, ONE LIST, ONE TRANSACTION (§6.2.5) ──────────────
           *
           * This replaced two panels — one for invoices, one for
           * direct-settled loads — each applying in its own transaction. Two
           * tables made somebody add up two subtotals to see whether the
           * wire was covered, and two transactions meant a person dividing
           * one payment could get half of their split.
           *
           * SHOWN WHENEVER THERE IS MONEY LEFT, even with nothing open: the
           * empty state says the payer has nothing outstanding, which is an
           * answer somebody came here for. */}
          {mayApply && payment.unappliedCents > 0 ? (
            <section className="rounded-card border border-border bg-surface p-z4">
              <OpenItems
                paymentId={payment.id}
                items={openItems}
                unappliedCents={payment.unappliedCents}
                locale={locale}
                labels={{
                  heading: t('payments.applyOpenItems'),
                  hint: t('payments.applyHint'),
                  allOrNothing: t('payments.applyAllOrNothing'),
                  item: t('payments.invoice'),
                  when: t('invoices.due'),
                  balance: t('payments.outstanding'),
                  amount: t('payments.amount'),
                  apply: t('payments.apply'),
                  applied: t('payments.applied'),
                  remains: t('payments.remainsUnapplied'),
                  unapplied: t('payments.unapplied'),
                  emptyTitle: t('payments.noOpenItems'),
                  emptyBody: t('payments.noOpenItemsHint'),
                  kindInvoice: t('payments.openItem.invoice'),
                  kindLoad: t('payments.openItem.load'),
                }}
                reasons={translate}
              />
            </section>
          ) : null}
        </div>
      </div>
    </>
  )
}
