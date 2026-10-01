import Link from 'next/link'
import { notFound } from 'next/navigation'
import { currentUserCan, withCurrentOrg } from '@/lib/auth-context'
import { getLocaleContext } from '@/lib/locale'
import { companyScopeFilter } from '@/lib/tenancy'
import { normalizeTypedDate } from '@/lib/typed-date'
import { documentTypeLabels } from '@/lib/document-types'
import {
  browseDocuments,
  browserFacets,
  readableEntities,
  type BrowserRow,
} from '@/lib/document-browser'
import { FilterBar } from '@/components/ui/FilterBar'
import { Table, type Column } from '@/components/ui/Table'
import { EmptyState } from '@/components/ui/EmptyState'
import { DocumentLink } from '../_reference/DocumentLink'
import type { DocumentType } from '@/generated/prisma/client'
import type { TargetEntity } from '@/lib/documents'
import type { MessageKey } from '@/lib/i18n'

// PHASE 4 §5 STEP 6 — the documents browser.
//
// §2.7 described exactly what was missing: "the pipeline exists — upload,
// confirm, download, all on the load screen — and what is missing is the
// reading room over it."
//
// PERMISSION-AWARE PER ENTITY, not per role. Every other list here covers one
// kind of thing and asks one permission; this one covers fourteen, and a
// settlement PDF sitting next to a rate confirmation is a dispatcher reading
// driver pay. So the query only returns documents hanging off something the
// session may already open — a WHERE clause, so the chips and the page agree —
// and the download endpoint now asks the SAME question, because a browser that
// hides a row while the API still serves it hides nothing at all.

/** The types worth a chip. The enum has eighteen; a filter bar cannot. */
const CHIP_TYPES: DocumentType[] = [
  'POD',
  'RATE_CONFIRMATION',
  'BOL',
  'INVOICE_PDF',
  'SETTLEMENT_PDF',
  'INSPECTION_REPORT',
  'MAINTENANCE_RECEIPT',
  'INSURANCE_CERT',
]

export default async function DocumentsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  if (!(await currentUserCan('read', 'document'))) notFound()

  const params = await searchParams
  const { t, locale } = await getLocaleContext()
  const docTypeLabels = documentTypeLabels(t)

  const typeParam =
    typeof params['type'] === 'string'
      ? (params['type'] as DocumentType)
      : undefined
  const entityParam =
    typeof params['on'] === 'string'
      ? (params['on'] as TargetEntity)
      : undefined
  // Typed the same way every date in this application is typed: "810" is the
  // 10th of August. A browser date input would be a second convention.
  const from = normalizeTypedDate(
    typeof params['from'] === 'string' ? params['from'] : '',
  )
  const to = normalizeTypedDate(
    typeof params['to'] === 'string' ? params['to'] : '',
  )

  const { rows, counts, allowed } = await withCurrentOrg(
    'read',
    'document',
    async (tx, session) => {
      const scope = companyScopeFilter(session.companyScopes)
      const window = {
        ...(from ? { from } : {}),
        ...(to ? { to } : {}),
      }

      // ONE HEAVY QUERY AND ONE CHEAP ONE. The browse joins twelve relations to
      // build the labels and links; the facets need none of that. Running the
      // browse twice — once for the rows, once for the counts — blew the
      // 5-second interactive transaction budget on the deployed worker and the
      // page 500'd. `wrangler tail` said so in words.
      const [filtered, facets] = await Promise.all([
        browseDocuments(tx, session, scope, {
          ...(typeParam ? { type: typeParam } : {}),
          ...(entityParam ? { entity: entityParam } : {}),
          ...window,
        }),
        browserFacets(tx, session, scope, window, CHIP_TYPES),
      ])

      return {
        rows: filtered,
        allowed: readableEntities(session),
        counts: facets,
      }
    },
  )

  const isFiltered = Boolean(typeParam || entityParam || from || to)
  const day = (value: Date) => value.toISOString().slice(0, 10)
  /** Kilobytes, because a document is never megabytes and never bytes. */
  const size = (bytes: number) => `${Math.max(1, Math.round(bytes / 1024))} KB`

  const columns: Column<BrowserRow>[] = [
    {
      key: 'filename',
      header: t('docs.column.filename'),
      truncate: true,
      render: (row) => (
        // The link mints its own short-lived URL on click, the way every other
        // document link in the application does.
        <DocumentLink
          id={row.id}
          filename={row.filename}
          failedLabel={t('docs.failed')}
        />
      ),
    },
    {
      key: 'type',
      header: t('docs.column.type'),
      truncate: true,
      // THE EXHAUSTIVE MAP, NOT A TEMPLATE AND A CAST. `as MessageKey` told
      // the compiler to stop asking, and the compiler was the only thing that
      // knew the three DQF types had no label — they printed
      // `docType.EMPLOYMENT_APPLICATION` in this very column. See
      // `document-types.ts`.
      render: (row) => docTypeLabels[row.type],
    },
    {
      key: 'entity',
      header: t('docs.column.entity'),
      render: (row) =>
        row.entity ? t(`docsEntity.${row.entity}` as MessageKey) : '—',
    },
    {
      key: 'subject',
      header: t('docs.column.subject'),
      render: (row) =>
        row.entityHref ? (
          <Link
            href={row.entityHref}
            className="z-identifier text-accent hover:underline"
          >
            {row.entityLabel}
          </Link>
        ) : (
          <span className="z-identifier text-ink-2">
            {row.entityLabel ?? '—'}
          </span>
        ),
    },
    {
      key: 'authority',
      header: t('docs.column.authority'),
      truncate: true,
      render: (row) => row.companyName,
    },
    {
      key: 'uploaded',
      header: t('docs.column.uploaded'),
      render: (row) => <span className="font-mono">{day(row.uploadedAt)}</span>,
    },
    {
      key: 'by',
      header: t('docs.column.by'),
      truncate: true,
      render: (row) => row.uploadedByName ?? '—',
    },
    {
      key: 'size',
      header: t('docs.column.size'),
      align: 'end',
      render: (row) => (
        <span className="font-mono tabular-nums text-ink-3">
          {size(row.sizeBytes)}
        </span>
      ),
    },
  ]

  return (
    <>
      <div className="flex items-baseline justify-between gap-z4 border-b border-border bg-surface px-gutter py-z3">
        <h1 className="text-lg font-medium text-ink">{t('docs.title')}</h1>
        <p className="max-w-[64ch] text-sm text-ink-3">{t('docs.hint')}</p>
      </div>

      <FilterBar
        clearLabel={t('loads.filter.clear')}
        moreLabel={t('loads.filter.more')}
        groups={[
          {
            param: 'type',
            label: t('docs.type'),
            // ONLY THE TYPES THIS SESSION COULD EVER SEE. A departure from the
            // convention that a zero-count chip still renders ("Delivered (0)"
            // says the day is clear) — here a zero means "not yours" as often
            // as it means "none today", and a chip labelled Settlement on a
            // dispatcher's screen names a thing they cannot open. The selected
            // one always renders, so a filter can always be cleared.
            choices: CHIP_TYPES.filter(
              (type) => (counts.type[type] ?? 0) > 0 || type === typeParam,
            ).map((type) => ({
              value: type,
              label: docTypeLabels[type],
              count: counts.type[type] ?? 0,
            })),
          },
          {
            // ONLY THE KINDS THIS SESSION MAY READ. A chip for settlements on a
            // dispatcher's screen would name a thing they cannot see and then
            // filter to zero — which tells them it exists.
            param: 'on',
            label: t('docs.entity'),
            choices: allowed.map((entity) => ({
              value: entity,
              label: t(`docsEntity.${entity}` as MessageKey),
              count: counts.entity[entity] ?? 0,
            })),
          },
        ]}
      />

      <Table
        caption={t('docs.title')}
        columns={columns}
        rows={rows}
        rowKey={(row) => row.id}
        empty={
          allowed.length === 0 ? (
            // A role that can read `document` and nothing a document hangs
            // off. Its own sentence, because "nothing matches" would send them
            // looking for a filter to clear.
            <EmptyState
              title={t('docs.none.title')}
              body={t('docs.none.body')}
            />
          ) : isFiltered ? (
            <EmptyState
              title={t('docs.filtered.title')}
              body={t('docs.filtered.body')}
            />
          ) : (
            <EmptyState
              title={t('docs.empty.title')}
              body={t('docs.empty.body')}
            />
          )
        }
      />

      <div className="border-t border-border bg-surface px-gutter py-z2">
        {/* A GET form, so the dates land in the URL alongside the chips and a
         * filtered view is still a link somebody can send. */}
        <form className="flex flex-wrap items-end gap-z3">
          {typeParam ? (
            <input type="hidden" name="type" value={typeParam} />
          ) : null}
          {entityParam ? (
            <input type="hidden" name="on" value={entityParam} />
          ) : null}
          <label className="flex flex-col gap-z1 text-sm text-ink-2">
            {t('docs.from')}
            <input
              name="from"
              defaultValue={from ?? ''}
              inputMode="numeric"
              className="h-control-compact rounded-control border border-border-strong bg-surface px-z2 font-mono text-sm text-ink"
            />
          </label>
          <label className="flex flex-col gap-z1 text-sm text-ink-2">
            {t('docs.to')}
            <input
              name="to"
              defaultValue={to ?? ''}
              inputMode="numeric"
              className="h-control-compact rounded-control border border-border-strong bg-surface px-z2 font-mono text-sm text-ink"
            />
          </label>
          <button
            type="submit"
            className="h-control-compact rounded-control border border-border-strong bg-surface px-z3 text-xs font-medium text-ink-2 hover:bg-surface-3"
          >
            {t('docs.apply')}
          </button>
          <span className="text-xs text-ink-3">{t('docs.dateHint')}</span>
          <span className="ms-auto font-mono text-xs tabular-nums text-ink-3">
            {rows.length.toLocaleString(locale)}
          </span>
        </form>
      </div>
    </>
  )
}
