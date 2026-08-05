import Link from 'next/link'
import { notFound } from 'next/navigation'
import { currentUserCan, withCurrentOrg } from '@/lib/auth-context'
import { getLocaleContext } from '@/lib/locale'
import { factorsForCompanies } from '@/lib/factoring'
import { bpsToInput, formatCents } from '@/lib/money'
import { Button } from '@/components/ui/Button'
import { StatusBadge } from '@/components/ui/StatusBadge'
import { MarkSent } from './MarkSent'
import { MarkFactored } from './MarkFactored'
import type { MessageKey } from '@/lib/i18n'

// The preview: what the PDF will say, on a screen, in the reader's language.
// The DOCUMENT is English-only because base-14 fonts are WinAnsi — this is
// not, and that difference is deliberate rather than an oversight.

const SENT_ERROR_KEYS: MessageKey[] = [
  'invoices.error.alreadySent',
  'invoices.error.noChannel',
  'invoices.error.notFound',
  'factoring.error.invoiceNotFound',
  'factoring.error.factorNotFound',
  'factoring.error.alreadyFactored',
  'factoring.error.notSent',
  'factoring.error.noTerms',
  'factoring.error.wrongCarrier',
  'factoring.error.badRate',
  'factoring.error.overHundred',
]

export default async function InvoicePage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  if (!(await currentUserCan('read', 'invoice'))) notFound()

  const { id } = await params
  const { t, locale } = await getLocaleContext()
  const mayUpdate = await currentUserCan('update', 'invoice')

  const data = await withCurrentOrg('read', 'invoice', async (tx) => {
    const invoice = await tx.invoice.findUnique({
      where: { id },
      select: {
        id: true,
        companyId: true,
        invoiceNumber: true,
        status: true,
        issueDate: true,
        dueDate: true,
        termsDays: true,
        subtotalCents: true,
        accessorialsCents: true,
        totalCents: true,
        balanceCents: true,
        sentAt: true,
        notes: true,
        isFactored: true,
        factoredAt: true,
        advanceCents: true,
        factoringFeeCents: true,
        reserveReleasedAt: true,
        factoringCompany: { select: { name: true } },
        company: { select: { name: true } },
        customer: { select: { name: true } },
        lines: {
          orderBy: { sortOrder: 'asc' },
          select: {
            id: true,
            description: true,
            amountCents: true,
            load: { select: { id: true, loadNumber: true } },
          },
        },
      },
    })
    if (!invoice) return null

    // Only this invoice's own authority. Offering a factor belonging to the
    // other carrier would produce a choice `markFactored` refuses, and a
    // dropdown whose entries are rejected on submit is a worse screen than one
    // that never offers them.
    const factors =
      mayUpdate && !invoice.isFactored
        ? await factorsForCompanies(tx, { companyId: invoice.companyId })
        : []

    return { invoice, factors }
  })

  if (!data) notFound()
  const { invoice } = data

  const day = (value: Date | null) =>
    value ? value.toISOString().slice(0, 10) : '—'

  const translate = Object.fromEntries(
    SENT_ERROR_KEYS.map((key) => [key, t(key)]),
  )

  return (
    <>
      <div className="flex items-baseline justify-between gap-z4 border-b border-border bg-surface px-gutter py-z3">
        <div className="flex items-center gap-z3">
          <h1 className="text-lg font-medium text-ink">
            <span className="font-mono">{invoice.invoiceNumber}</span>
          </h1>
          <StatusBadge
            tone={invoice.sentAt ? 'progress' : 'neutral'}
            label={t(`invoiceStatus.${invoice.status}` as MessageKey)}
          />
        </div>
        {/* A real link, not a fetch. The browser handles a PDF better than
         * anything worth writing here, and open-in-new-tab should behave the
         * way it does everywhere else. */}
        <a
          href={`/api/invoices/${invoice.id}/pdf`}
          target="_blank"
          rel="noopener"
        >
          <Button variant="secondary" size="compact">
            {t('invoices.download')}
          </Button>
        </a>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto bg-surface-2 px-gutter py-z5">
        <div className="flex max-w-[760px] flex-col gap-z4">
          <section className="rounded-card border border-border bg-surface p-z4">
            <dl className="grid grid-cols-[auto_1fr] gap-x-z4 gap-y-z1 text-sm">
              <dt className="text-ink-2">{t('invoices.customer')}</dt>
              <dd className="text-ink">{invoice.customer.name}</dd>
              <dt className="text-ink-2">{t('ref.authority')}</dt>
              <dd className="text-ink">{invoice.company.name}</dd>
              <dt className="text-ink-2">{t('invoices.issued')}</dt>
              <dd className="font-mono text-ink">{day(invoice.issueDate)}</dd>
              <dt className="text-ink-2">{t('invoices.due')}</dt>
              <dd className="font-mono text-ink">
                {day(invoice.dueDate)}{' '}
                <span className="text-ink-3">(Net {invoice.termsDays})</span>
              </dd>
              <dt className="text-ink-2">{t('invoices.sentOn')}</dt>
              <dd className="text-ink">
                {invoice.sentAt ? (
                  <>
                    <span className="font-mono">{day(invoice.sentAt)}</span>
                    {invoice.notes ? (
                      <span className="text-ink-3"> · {invoice.notes}</span>
                    ) : null}
                  </>
                ) : (
                  <span className="text-ink-3">{t('invoices.notSent')}</span>
                )}
              </dd>
            </dl>
          </section>

          <section className="rounded-card border border-border bg-surface p-z4">
            <h2 className="text-md font-medium text-ink">
              {t('invoices.lines')}
            </h2>
            <ul className="mt-z3 flex flex-col">
              {invoice.lines.map((line) => (
                <li
                  key={line.id}
                  className="flex items-baseline gap-z3 border-b border-border py-z2 text-sm last:border-b-0"
                >
                  <span className="text-ink">{line.description}</span>
                  {line.load ? (
                    <Link
                      href={`/loads/${line.load.id}`}
                      className="z-identifier font-mono text-xs text-ink-3 hover:text-accent"
                    >
                      {line.load.loadNumber}
                    </Link>
                  ) : null}
                  <span className="ms-auto font-mono tabular-nums text-ink">
                    {formatCents(line.amountCents, locale)}
                  </span>
                </li>
              ))}
            </ul>

            {/* Every figure here is the lines added, and the lines are the
             * loads' own stored integers — so a reader can check the document
             * against the freight it came from (rule 9-money). */}
            <dl className="mt-z4 grid grid-cols-[1fr_auto] gap-x-z4 gap-y-z1 text-sm">
              <dt className="text-ink-2">{t('invoices.subtotal')}</dt>
              <dd className="text-end font-mono tabular-nums text-ink">
                {formatCents(invoice.subtotalCents, locale)}
              </dd>
              {invoice.accessorialsCents !== 0 ? (
                <>
                  <dt className="text-ink-2">{t('invoices.accessorials')}</dt>
                  <dd className="text-end font-mono tabular-nums text-ink">
                    {formatCents(invoice.accessorialsCents, locale)}
                  </dd>
                </>
              ) : null}
              <dt className="border-t border-border pt-z1 font-medium text-ink">
                {t('invoices.total')}
              </dt>
              <dd className="border-t border-border pt-z1 text-end font-mono tabular-nums font-medium text-ink">
                {formatCents(invoice.totalCents, locale)}
              </dd>
              <dt className="text-ink-2">{t('invoices.balance')}</dt>
              <dd className="text-end font-mono tabular-nums text-ink">
                {formatCents(invoice.balanceCents, locale)}
              </dd>
            </dl>
          </section>

          {mayUpdate && !invoice.sentAt ? (
            <section className="rounded-card border border-border bg-surface p-z4">
              <MarkSent
                invoiceId={invoice.id}
                translate={translate}
                labels={{
                  markSent: t('invoices.markSent'),
                  channel: t('invoices.channel'),
                  channelHint: t('invoices.channelHint'),
                }}
              />
            </section>
          ) : null}

          {/* Sold. The three figures and the date, because "we factored it" is
           * not an answer to "how much did we actually get, and when". */}
          {invoice.isFactored ? (
            <section className="rounded-card border border-border bg-surface p-z4">
              <h2 className="text-md font-medium text-ink">
                {t('receivables.factored')}
              </h2>
              <dl className="mt-z3 grid grid-cols-[auto_1fr] gap-x-z4 gap-y-z1 text-sm">
                <dt className="text-ink-2">{t('receivables.factor')}</dt>
                <dd className="text-ink">
                  {invoice.factoringCompany?.name ?? '—'}
                </dd>
                <dt className="text-ink-2">{t('factoring.soldOn')}</dt>
                <dd className="font-mono text-ink">
                  {day(invoice.factoredAt)}
                </dd>
                <dt className="text-ink-2">{t('receivables.advance')}</dt>
                <dd className="font-mono tabular-nums text-ink">
                  {formatCents(invoice.advanceCents, locale)}
                </dd>
                <dt className="text-ink-2">{t('receivables.fee')}</dt>
                <dd className="font-mono tabular-nums text-ink">
                  {formatCents(invoice.factoringFeeCents, locale)}
                </dd>
                <dt className="text-ink-2">
                  {invoice.reserveReleasedAt
                    ? t('receivables.reserveReleased')
                    : t('receivables.reserveOutstanding')}
                </dt>
                {/* Derived from the three stored integers on the row above it,
                 * so a reader can check it without leaving the screen. */}
                <dd className="font-mono tabular-nums text-ink">
                  {formatCents(
                    invoice.totalCents -
                      invoice.advanceCents -
                      invoice.factoringFeeCents,
                    locale,
                  )}
                </dd>
              </dl>
            </section>
          ) : null}

          {mayUpdate && !invoice.isFactored && data.factors.length > 0 ? (
            <section className="rounded-card border border-border bg-surface p-z4">
              <MarkFactored
                invoiceId={invoice.id}
                factors={[
                  { value: '', label: '—' },
                  ...data.factors.map((factor) => ({
                    value: factor.id,
                    label:
                      factor.advanceRateBps === null || factor.feeBps === null
                        ? factor.name
                        : `${factor.name} — ${bpsToInput(factor.advanceRateBps)}% / ${bpsToInput(factor.feeBps)}%`,
                  })),
                ]}
                translate={translate}
                labels={{
                  markFactored: t('factoring.markFactored'),
                  hint: t('factoring.markFactoredHint'),
                  factor: t('factoring.chooseFactor'),
                  advanceRate: t('factoring.advanceRate'),
                  feeRate: t('factoring.feeRate'),
                  overrideHint: t('factoring.overrideHint'),
                }}
              />
            </section>
          ) : null}
        </div>
      </div>
    </>
  )
}
