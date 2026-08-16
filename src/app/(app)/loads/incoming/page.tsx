import Link from 'next/link'
import { notFound } from 'next/navigation'
import { currentUserCan, withCurrentOrg } from '@/lib/auth-context'
import { getLocaleContext } from '@/lib/locale'
import { Table, type Column } from '@/components/ui/Table'
import { StatusBadge } from '@/components/ui/StatusBadge'
import { EmptyState } from '@/components/ui/EmptyState'
import { renderDateOnly } from '@/lib/stop-time'
import { Button } from '@/components/ui/Button'
import { dismissEmailAction } from './actions'
import type { LoadWarning } from '@/lib/load-warnings'
import type { MessageKey } from '@/lib/i18n'

// Loads → Incoming (Phase 6 §4 step 4, spec §10).
//
// A QUEUE OF UNFINISHED FORMS, which is §1.1's ruling. Opening a row goes to
// `/loads/new` with the email's own extraction prefilled — the same form, the
// same validations, the same Save as a paste or an upload. Nothing on this
// screen creates a load, and there is no second editing surface.
//
// GATED ON `load:create`, because that is what opening one leads to. A role
// that cannot book freight has nothing to do with a queue of freight waiting
// to be booked.
//
// THE STATE IS NOT A CONFIDENCE SCORE. Spec §10 sketches percentages; the
// brief overrode that with "from real validation results, not vibes". What the
// stripe means here is whether the office has a REASON to stop — a duplicate
// BOL, a missing pickup date — and each reason is a sentence rather than a
// number.

interface Row {
  id: string
  state: string
  /**
   * Only for UNREAD: which kind of nothing. `ocrStatus` is the WHY behind the
   * state, and without it "Not read" is a dead end — a dispatcher cannot tell
   * a deferred reading from one that came back empty.
   */
  unreadBecause: string | null
  from: string
  subject: string
  received: string
  reasons: string[]
  /** Spec §12 — present when the message itself was kept. */
  hasOriginal: boolean
}

const TONE: Record<string, 'success' | 'warning' | 'danger' | 'neutral'> = {
  READY: 'success',
  REVIEW: 'warning',
  CONFLICT: 'danger',
  // Not a failure and not a warning about the freight: nothing was read, and
  // the row is waiting on somebody rather than telling them something.
  UNREAD: 'neutral',
  CONFIRMED: 'neutral',
  DISMISSED: 'neutral',
}

export default async function IncomingPage() {
  if (!(await currentUserCan('create', 'load'))) notFound()

  const { t } = await getLocaleContext()

  const emails = await withCurrentOrg('read', 'load', (tx) =>
    tx.inboundEmail.findMany({
      // The handled ones leave the queue. They are still rows — the audit
      // trail of what arrived does not shrink — but a queue that keeps what
      // has been dealt with is a queue nobody reaches the bottom of.
      where: { state: { in: ['READY', 'REVIEW', 'CONFLICT', 'UNREAD'] } },
      orderBy: { receivedAt: 'desc' },
      take: 200,
      select: {
        id: true,
        state: true,
        ocrStatus: true,
        fromAddress: true,
        subject: true,
        receivedAt: true,
        concerns: true,
        ocrError: true,
        rawR2Key: true,
      },
    }),
  )

  const rows: Row[] = emails.map((email) => {
    // Stored as `LoadWarning[]` — kinds and values, never sentences — so the
    // words are chosen here, in the reader's own language.
    const warnings = Array.isArray(email.concerns)
      ? (email.concerns as unknown as LoadWarning[])
      : []

    const reasons = warnings.map((warning) =>
      Object.entries(warning.values ?? {}).reduce(
        (message, [key, value]) => message.replaceAll(`{${key}}`, value),
        t(warning.messageKey as MessageKey),
      ),
    )

    // A message that could not be read has no warnings — it has a failure, and
    // saying so is more use than an empty cell.
    if (reasons.length === 0 && email.ocrError) {
      reasons.push(t('incoming.unreadable'))
    }

    return {
      id: email.id,
      state: email.state,
      unreadBecause: email.state === 'UNREAD' ? email.ocrStatus : null,
      from: email.fromAddress,
      subject: email.subject ?? '—',
      received: renderDateOnly(email.receivedAt) ?? '—',
      reasons,
      hasOriginal: email.rawR2Key !== null,
    }
  })

  const columns: Column<Row>[] = [
    {
      key: 'subject',
      header: t('incoming.subject'),
      truncate: true,
      render: (row) => row.subject,
    },
    {
      key: 'from',
      header: t('incoming.from'),
      truncate: true,
      render: (row) => row.from,
    },
    {
      key: 'received',
      header: t('incoming.received'),
      render: (row) => row.received,
    },
    {
      key: 'state',
      header: t('ref.status'),
      render: (row) => (
        <>
          <StatusBadge
            tone={TONE[row.state] ?? 'neutral'}
            label={t(`incoming.state.${row.state}` as MessageKey)}
          />
          {/* THE WHY, BESIDE THE STATE. "Not read" on its own tells a
              dispatcher to do nothing in particular; "Not read · Nothing
              found in it" tells them to open the original. One state, one
              label, no second column to sort by. */}
          {row.unreadBecause ? (
            <span className="unread-because">
              {t(`incoming.unread.${row.unreadBecause}` as MessageKey)}
            </span>
          ) : null}
        </>
      ),
    },
    {
      key: 'reasons',
      header: t('incoming.reasons'),
      truncate: true,
      // EVERY REASON, IN WORDS. The brief's "not vibes" cuts both ways: a
      // state nobody can explain is a badge, and a badge has to be
      // interpreted. The first is shown and the count says there are more.
      render: (row) =>
        row.reasons.length === 0 ? (
          <span className="text-ink-3">—</span>
        ) : (
          <span title={row.reasons.join(' · ')}>
            {row.reasons[0]}
            {row.reasons.length > 1 ? ` (+${row.reasons.length - 1})` : ''}
          </span>
        ),
    },
    {
      key: 'actions',
      header: t('incoming.actions'),
      // §7.1: interactive controls inside a clickable row raise z-index as
      // dead zones, or the stretched link swallows them and Dismiss opens the
      // form instead.
      render: (row) => (
        <div className="relative z-10 flex items-center gap-z2">
          {row.hasOriginal ? (
            <a
              href={`/api/inbound-email/${row.id}/original`}
              className="text-xs font-medium text-ink-2 hover:text-accent"
            >
              {t('incoming.original')}
            </a>
          ) : null}
          <form action={dismissEmailAction.bind(null, row.id)}>
            <Button type="submit" variant="ghost" size="compact">
              {t('incoming.dismiss')}
            </Button>
          </form>
        </div>
      ),
    },
  ]

  return (
    <>
      <div className="flex items-baseline justify-between gap-z4 border-b border-border bg-surface px-gutter py-z3">
        <h1 className="text-lg font-medium text-ink">{t('incoming.title')}</h1>
        <p className="text-xs text-ink-3">{t('incoming.stripeMeaning')}</p>
      </div>

      <Table
        caption={t('incoming.title')}
        columns={columns}
        rows={rows}
        rowKey={(row) => row.id}
        // §7.1's whole-row link. It leads to the CREATE FORM, prefilled —
        // §1.1's "a queue of unfinished forms, not a second editing surface".
        rowHref={(row) => `/loads/new?from=${row.id}`}
        stripeTone={(row) => TONE[row.state] ?? 'neutral'}
        empty={
          <EmptyState
            title={t('incoming.empty.title')}
            body={t('incoming.empty.body')}
            action={
              <Link
                href="/loads/new"
                className="text-sm font-medium text-accent"
              >
                {t('loads.add')}
              </Link>
            }
          />
        }
      />
    </>
  )
}
