import {
  MAINTENANCE_CATEGORIES,
  historyForSubject,
  receiptsFor,
  type MaintenanceSubject,
} from '@/lib/maintenance'
import { formatCents } from '@/lib/money'
import type { TxClient } from '@/lib/tenancy'
import type { Translate, MessageKey } from '@/lib/i18n'
import type { WorkOrderRowView } from './MaintenancePanel'

// The maintenance panel's props, built once for both asset screens.
//
// Truck and trailer ask the identical question and must get the identical
// answer — the same reason `compliance-view.ts` exists.
//
// `maySeeCost` is decided by the caller through `currentUserCan` and threaded
// all the way down: the service omits the field, this omits the formatting,
// and the panel has nothing to render. No layer of the three has to trust
// another to have done it.

const ERROR_KEYS: MessageKey[] = [
  'maintPanel.error.subjectNotFound',
  'maintPanel.error.noDate',
  'maintPanel.error.badOdometer',
  'maintPanel.error.badCost',
]

export interface MaintenancePanelData {
  rows: WorkOrderRowView[]
  categories: { value: string; label: string }[]
  totals?: { cost: string; perMile: string | null; span: string | null }
  today: string
  translate: Record<string, string>
  labels: Record<string, string>
}

export async function maintenancePanelData(
  tx: TxClient,
  subject: MaintenanceSubject,
  subjectId: string,
  maySeeCost: boolean,
  t: Translate,
  locale: string,
): Promise<MaintenancePanelData> {
  const history = await historyForSubject(tx, subject, subjectId, maySeeCost)
  const receipts = await receiptsFor(
    tx,
    history.rows.map((row) => row.id),
  )

  const day = (value: Date) => value.toISOString().slice(0, 10)
  const miles = (value: number) =>
    `${value.toLocaleString(locale)} ${t('maint.mi')}`

  return {
    rows: history.rows.map((row) => ({
      id: row.id,
      categoryLabel: t(`maintCategory.${row.category}` as MessageKey),
      description: row.description,
      vendorName: row.vendorName,
      serviced: day(row.servicedAt),
      odometer: row.odometer === null ? null : miles(row.odometer),
      // Spread rather than assigned, so a role without the permission gets a
      // props object with no `cost` key at all.
      ...(row.costCents === undefined
        ? {}
        : { cost: formatCents(row.costCents, locale) }),
      next:
        row.nextServiceAt !== null
          ? day(row.nextServiceAt)
          : row.nextServiceOdometer !== null
            ? miles(row.nextServiceOdometer)
            : null,
      documents: receipts.get(row.id) ?? [],
    })),
    categories: MAINTENANCE_CATEGORIES.map((category) => ({
      value: category,
      label: t(`maintCategory.${category}` as MessageKey),
    })),
    ...(history.totals
      ? {
          totals: {
            cost: formatCents(history.totals.costCents, locale),
            // Cents per mile, shown as cents — "38¢/mi" is the figure an owner
            // compares, and rendering it as $0.38 makes two of them look the
            // same at a glance.
            perMile:
              history.totals.perMileCents === null
                ? null
                : t('maint.perMileValue').replace(
                    '{cents}',
                    String(history.totals.perMileCents),
                  ),
            span:
              history.totals.fromOdometer !== null &&
              history.totals.toOdometer !== null
                ? `${miles(history.totals.fromOdometer)} – ${miles(
                    history.totals.toOdometer,
                  )}`
                : null,
          },
        }
      : {}),
    today: new Date().toISOString().slice(0, 10),
    translate: Object.fromEntries(ERROR_KEYS.map((key) => [key, t(key)])),
    labels: {
      title: t('maintPanel.title'),
      hint: t('maintPanel.hint'),
      none: t('maintPanel.none'),
      add: t('maintPanel.add'),
      category: t('maintPanel.category'),
      serviced: t('maintPanel.serviced'),
      servicedHint: t('maintPanel.servicedHint'),
      odometer: t('maintPanel.odometer'),
      vendor: t('maintPanel.vendor'),
      description: t('maintPanel.description'),
      cost: t('maintPanel.cost'),
      costHint: t('maintPanel.costHint'),
      nextService: t('maintPanel.nextService'),
      nextOdometer: t('maintPanel.nextOdometer'),
      notes: t('maintPanel.notes'),
      save: t('maintPanel.save'),
      total: t('maint.total'),
      perMile: t('maint.perMile'),
      over: t('maint.over'),
      nextDue: t('maint.nextDue'),
      attach: t('maintPanel.attach'),
      preparing: t('compliancePanel.preparing'),
      uploading: t('compliancePanel.uploading'),
      failed: t('compliancePanel.failed'),
    },
  }
}
