import { notFound } from 'next/navigation'
import { currentUserCan, withCurrentOrg } from '@/lib/auth-context'
import { getLocaleContext } from '@/lib/locale'
import { documentTypeLabels } from '@/lib/document-types'
import { renderDateOnly } from '@/lib/stop-time'
import {
  currentLoad,
  documentsNeeded,
  ownDocuments,
  ownDriver,
} from '@/lib/portal'
import { PORTAL_DOCUMENT_TYPES } from '@/lib/portal-documents'
import { NoDriverRow } from '../../NoDriverRow'
import { OpenDocument } from './OpenDocument'
import { CaptureUpload } from './CaptureUpload'

// DOCUMENTS (§9; brief §1.3): the driver's own — on their loads, or filed
// under them (CDL copy, medical card) — and, since step 5, THE UPLOAD: camera
// first, one of the seven types, onto the current load, through the portal's
// own routes under the own-load predicate. The offline queue is step 6.
// Opening one goes through the portal's own download route, gated by the
// own-documents predicate, never the operator's.

export default async function PortalDocumentsPage() {
  const { t, locale } = await getLocaleContext()
  if (!(await currentUserCan('read', 'portal.document'))) notFound()

  const data = await withCurrentOrg(
    'read',
    'portal.document',
    async (tx, session) => {
      const driver = await ownDriver(tx, session)
      if (!driver) return null
      // The upload's target is the current load — one more relation read,
      // the same one Home makes.
      const load = await currentLoad(tx, driver.id)
      return { rows: await ownDocuments(tx, driver.id), load }
    },
  )
  if (!data) return <NoDriverRow sentence={t('portal.noDriver')} />
  const typeLabels = documentTypeLabels(t)
  const needed = data.load ? documentsNeeded(data.load) : []

  return (
    <section className="flex flex-col gap-z3 px-z4 py-z4">
      <h1 className="text-lg font-medium">{t('portal.documents.title')}</h1>
      {data.load ? (
        <CaptureUpload
          loadId={data.load.id}
          loadNumber={data.load.loadNumber}
          types={PORTAL_DOCUMENT_TYPES.map((type) => ({
            value: type,
            label: typeLabels[type],
          }))}
          defaultType={needed[0] ?? 'POD'}
          labels={{
            title: t('portal.upload.title'),
            hint:
              needed.length > 0
                ? `${t('portal.home.needs')}: ${needed.map((type) => typeLabels[type]).join(', ')}`
                : t('portal.upload.hint'),
            type: t('portal.upload.type'),
            takePhoto: t('portal.upload.takePhoto'),
            chooseFile: t('portal.upload.chooseFile'),
            preparing: t('portal.upload.preparing'),
            uploading: t('portal.upload.uploading'),
            done: t('portal.upload.done'),
            failed: t('portal.upload.failed'),
          }}
        />
      ) : (
        <p className="text-sm text-ink-2">{t('portal.upload.noLoad')}</p>
      )}
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
