import Link from 'next/link'
import { notFound } from 'next/navigation'
import { currentUserCan, withCurrentOrg } from '@/lib/auth-context'
import { getLocaleContext } from '@/lib/locale'
import { formatCents } from '@/lib/money'
import { Button } from '@/components/ui/Button'
import { StatusBadge } from '@/components/ui/StatusBadge'
import { MarkSent } from './MarkSent'
import type { MessageKey } from '@/lib/i18n'

// The preview: what the PDF will say, on a screen, in the reader's language.
// The DOCUMENT is English-only because base-14 fonts are WinAnsi — this is
// not, and that difference is deliberate rather than an oversight.

const SENT_ERROR_KEYS: MessageKey[] = [
  'invoices.error.alreadySent',
  'invoices.error.noChannel',
  'invoices.error.notFound',
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

  const invoice = await withCurrentOrg('read', 'invoice', (tx) =>
    tx.invoice.findUnique({
      where: { id },
      select: {
        id: true,
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
    }),
  )

  if (!invoice) notFound()

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
        </div>
      </div>
    </>
  )
}
