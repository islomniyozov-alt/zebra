import {
  TRACKED_TYPES,
  documentTypeFor,
  documentsForRecords,
  recordsForSubject,
  type ComplianceSubject,
} from '@/lib/compliance'
import type { TxClient } from '@/lib/tenancy'
import type { Translate, MessageKey } from '@/lib/i18n'
import type { ComplianceRowView } from './CompliancePanel'

// The panel's props, built once for all three detail screens.
//
// Truck, trailer and driver ask the identical question and must get the
// identical answer — a per-screen copy of this is three chances for one of
// them to render a date differently from the queue.

const ERROR_KEYS: MessageKey[] = [
  'compliancePanel.error.subjectNotFound',
  'compliancePanel.error.badDates',
  'compliancePanel.error.noExpiry',
  'compliancePanel.error.duplicate',
]

export interface CompliancePanelData {
  rows: ComplianceRowView[]
  types: { value: string; label: string }[]
  documentTypeFor: Record<string, string>
  today: string
  translate: Record<string, string>
  labels: Record<string, string>
}

export async function compliancePanelData(
  tx: TxClient,
  subject: ComplianceSubject,
  subjectId: string,
  t: Translate,
): Promise<CompliancePanelData> {
  const records = await recordsForSubject(tx, subject, subjectId)
  const documents = await documentsForRecords(
    tx,
    records.map((record) => record.id),
  )

  /** "in 14 days", "today", "40 days ago". Rendered here, not in the client. */
  const when = (daysLeft: number) => {
    if (daysLeft === 0) return t('safety.dueToday')
    if (daysLeft < 0)
      return t('safety.overdue').replace('{days}', String(-daysLeft))
    return t('safety.daysLeft').replace('{days}', String(daysLeft))
  }

  return {
    rows: records.map((record) => ({
      id: record.id,
      type: record.type,
      typeLabel: t(`complianceType.${record.type}` as MessageKey),
      identifier: record.identifier,
      issuer: record.issuer,
      issued: record.issuedAt
        ? record.issuedAt.toISOString().slice(0, 10)
        : null,
      expires: record.expiresAt.toISOString().slice(0, 10),
      when: when(record.daysLeft),
      status: record.status,
      isSuperseded: record.isSuperseded,
      documents: documents.get(record.id) ?? [],
    })),
    // The six the owner named, plus whatever types the asset ALREADY carries —
    // so a record of an untracked type can still be renewed from the screen
    // that shows it, rather than becoming unrenewable because no chip offers it.
    types: [
      ...new Set([...TRACKED_TYPES, ...records.map((record) => record.type)]),
    ].map((type) => ({
      value: type,
      label: t(`complianceType.${type}` as MessageKey),
    })),
    documentTypeFor: Object.fromEntries(
      [...new Set([...TRACKED_TYPES, ...records.map((r) => r.type)])].map(
        (type) => [type, documentTypeFor(type)],
      ),
    ),
    today: new Date().toISOString().slice(0, 10),
    translate: Object.fromEntries(ERROR_KEYS.map((key) => [key, t(key)])),
    labels: {
      title: t('compliancePanel.title'),
      hint: t('compliancePanel.hint'),
      none: t('compliancePanel.none'),
      add: t('compliancePanel.add'),
      type: t('compliancePanel.type'),
      identifier: t('compliancePanel.identifier'),
      issuer: t('compliancePanel.issuer'),
      issued: t('compliancePanel.issued'),
      expires: t('compliancePanel.expires'),
      expiresHint: t('compliancePanel.expiresHint'),
      notes: t('compliancePanel.notes'),
      save: t('compliancePanel.save'),
      superseded: t('compliancePanel.superseded'),
      attach: t('compliancePanel.attach'),
      preparing: t('compliancePanel.preparing'),
      uploading: t('compliancePanel.uploading'),
      failed: t('compliancePanel.failed'),
      statusCurrent: t('safety.status.current'),
      statusExpiring: t('safety.status.expiring'),
      statusExpired: t('safety.status.expired'),
    },
  }
}
