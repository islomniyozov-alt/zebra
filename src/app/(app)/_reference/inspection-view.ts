import {
  inspectionsForSubject,
  type InspectionRow,
  type InspectionSubject,
} from '@/lib/inspections'
import type { TxClient } from '@/lib/tenancy'
import type { Translate, MessageKey } from '@/lib/i18n'
import type { InspectionPanelRow } from './InspectionPanel'

// The inspection panel's props, built once for all three detail screens.
//
// Truck, trailer and driver ask the identical question and must get the
// identical answer — a per-screen copy of this is three chances for one of them
// to describe an out-of-service order differently from the list.

export interface InspectionPanelData {
  rows: InspectionPanelRow[]
  labels: { title: string; hint: string; none: string }
}

/** "Clean", "Out of service", or how many were written. */
export function resultLabel(row: InspectionRow, t: Translate): string {
  if (row.outOfService) return t('ins.oos')
  if (row.isClean) return t('ins.clean')
  return row.violations.length === 1
    ? t('ins.oneViolation')
    : t('ins.violationCount').replace('{count}', String(row.violations.length))
}

export async function inspectionPanelData(
  tx: TxClient,
  subject: InspectionSubject,
  subjectId: string,
  t: Translate,
): Promise<InspectionPanelData> {
  const rows = await inspectionsForSubject(tx, subject, subjectId)

  return {
    rows: rows.map((row) => ({
      id: row.id,
      date: row.inspectedAt.toISOString().slice(0, 10),
      state: row.state,
      levelLabel: t(`insLevel.${row.level}` as MessageKey),
      outOfService: row.outOfService,
      isClean: row.isClean,
      resultLabel: resultLabel(row, t),
      codes: row.violations.map((violation) => violation.code).join(' · '),
      reportNumber: row.reportNumber,
    })),
    labels: {
      title: t('insPanel.title'),
      hint: t('insPanel.hint'),
      none: t('insPanel.none'),
    },
  }
}
