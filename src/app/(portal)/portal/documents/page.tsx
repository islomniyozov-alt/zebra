import { notFound } from 'next/navigation'
import { currentUserCan, withCurrentOrg } from '@/lib/auth-context'
import { getLocaleContext } from '@/lib/locale'
import { documentTypeLabels } from '@/lib/document-types'
import { renderDateOnly } from '@/lib/stop-time'
import { ownDocuments, ownDriver } from '@/lib/portal'
import { NoDriverRow } from '../../NoDriverRow'
import { OpenDocument } from './OpenDocument'

// DOCUMENTS (§9; brief §1.3): the driver's own — on their loads, or filed
// under them (CDL copy, medical card). READ ONLY in step 2: camera-first
// upload, the seven types and the offline queue are step 5. Opening one goes
// through the portal's own download route, gated by the own-documents
// predicate, never the operator's.

export default async function PortalDocumentsPage() {
  const { t, locale } = await getLocaleContext()
  if (!(await currentUserCan('read', 'portal.document'))) notFound()

  const data = await withCurrentOrg(
    'read',
    'portal.document',
    async (tx, session) => {
      const driver = await ownDriver(tx, session)
      if (!driver) return null
      return { rows: await ownDocuments(tx, driver.id) }
    },
  )
  if (!data) return <NoDriverRow sentence={t('portal.noDriver')} />
  const typeLabels = documentTypeLabels(t)

  return (
    <section className="flex flex-col gap-z3 px-z4 py-z4">
      <h1 className="text-lg font-medium">{t('portal.documents.title')}</h1>
      {data.rows.length === 0 ? (
        <p className="text-base text-ink-2">{t('portal.documents.none')}</p>
      ) : (
        <ul className="flex flex-col gap-z2">
          {data.rows.map((row) => (
            <li
              key={row.id}
              className="flex items-center justify-between gap-z3 rounded-card border border-border bg-surface p-z3"
            >
              <div className="min-w-0">
                <p className="text-base font-medium">{typeLabels[row.type]}</p>
                <p className="truncate text-sm text-ink-2" dir="ltr">
                  {row.loadNumber ? `${row.loadNumber} · ` : ''}
                  {row.filename}
                </p>
                <p className="text-xs text-ink-3" dir="ltr">
                  {renderDateOnly(row.uploadedAt, locale)}
                </p>
              </div>
              <OpenDocument
                documentId={row.id}
                labels={{
                  open: t('portal.documents.open'),
                  opening: t('portal.documents.opening'),
                  failed: t('portal.documents.failed'),
                }}
              />
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
