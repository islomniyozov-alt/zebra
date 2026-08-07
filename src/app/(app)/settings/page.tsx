import { notFound } from 'next/navigation'
import { currentUserCan, withCurrentOrg } from '@/lib/auth-context'
import { getLocaleContext } from '@/lib/locale'
import { companyIdScopeFilter } from '@/lib/tenancy'
import { settingsForScope } from '@/lib/settings'
import { bpsToInput, centsToInput } from '@/lib/money'
import { SettingsForm } from '../_reference/SettingsForm'
import type { MessageKey } from '@/lib/i18n'

// PHASE 4 §5 STEP 6 — the settings screen.
//
// `CompanySettings` has been read by the invoice service, the settlement
// service and the compliance queue since Phase 1, and written by nothing but
// the seed. So both carriers have been running on defaults nobody chose: a
// 30-day compliance horizon and a 3% factoring assumption that is neither
// carrier's actual rate.
//
// ONE FORM PER AUTHORITY. The fields are per-authority, and a single form
// covering both would either write two rows per save — two audit entries a
// reader has to reassemble — or claim a change to a carrier nobody touched.
//
// Reading is `organization:read` and saving is `organization:update`, which
// OWNER and ADMIN hold. A MANAGER who could move the settlement week boundary
// could move every driver's pay period without touching a pay rule.

/** Which label names each field, for the confirmation line and the errors. */
const FIELD_KEYS: Record<string, MessageKey> = {
  invoiceNumberPrefix: 'settings.prefix',
  invoiceTermsDays: 'settings.terms',
  invoiceNotes: 'settings.notes',
  remitToText: 'settings.remitTo',
  defaultFuelCostPerMileCents: 'settings.fuelCost',
  defaultFuelCostPerMile: 'settings.fuelCost',
  defaultMpg: 'settings.mpg',
  factoringFeeBps: 'settings.factoringFee',
  factoringFeePercent: 'settings.factoringFee',
  dispatchFeeBps: 'settings.dispatchFee',
  dispatchFeePercent: 'settings.dispatchFee',
  complianceWarnDays: 'settings.complianceWarn',
  podMissingAlertDays: 'settings.podMissing',
  invoiceOverdueDays: 'settings.invoiceOverdue',
  settlementWeekEndsOn: 'settings.weekEndsOn',
}

const ERROR_KEYS: MessageKey[] = [
  'settings.error.notFound',
  'settings.error.badPrefix',
  'settings.error.badDays',
  'settings.error.badMoney',
  'settings.error.badMpg',
  'settings.error.badWeekday',
]

export default async function SettingsPage() {
  if (!(await currentUserCan('read', 'organization'))) notFound()
  const mayEdit = await currentUserCan('update', 'organization')

  const { t } = await getLocaleContext()

  const rows = await withCurrentOrg('read', 'organization', (tx, session) =>
    // Scoped, so a user restricted to one authority edits one authority.
    settingsForScope(tx, companyIdScopeFilter(session.companyScopes)),
  )

  const fieldLabels = Object.fromEntries(
    Object.entries(FIELD_KEYS).map(([field, key]) => [field, t(key)]),
  )

  const weekdays = [0, 1, 2, 3, 4, 5, 6].map((day) => ({
    value: String(day),
    label: t(`weekday.${day}` as MessageKey),
  }))

  return (
    <>
      <div className="flex items-baseline justify-between gap-z4 border-b border-border bg-surface px-gutter py-z3">
        <h1 className="text-lg font-medium text-ink">{t('settings.title')}</h1>
        <p className="max-w-[64ch] text-sm text-ink-3">{t('settings.hint')}</p>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto bg-surface-2 px-gutter py-z5">
        <div className="flex max-w-[900px] flex-col gap-z5">
          {rows.map((row) => (
            <section
              key={row.companyId}
              className="rounded-card border border-border bg-surface p-z4"
            >
              <SettingsForm
                values={{
                  companyId: row.companyId,
                  companyName: row.companyName,
                  invoiceNumberPrefix: row.invoiceNumberPrefix,
                  invoiceTermsDays: String(row.invoiceTermsDays),
                  invoiceNotes: row.invoiceNotes ?? '',
                  remitToText: row.remitToText ?? '',
                  // Cents and basis points OUT through money.ts, the same way
                  // they came in. Nothing here divides by 100.
                  defaultFuelCostPerMile: centsToInput(
                    row.defaultFuelCostPerMileCents,
                  ),
                  defaultMpg: row.defaultMpg,
                  factoringFeePercent: bpsToInput(row.factoringFeeBps),
                  dispatchFeePercent: bpsToInput(row.dispatchFeeBps),
                  complianceWarnDays: String(row.complianceWarnDays),
                  podMissingAlertDays: String(row.podMissingAlertDays),
                  invoiceOverdueDays: String(row.invoiceOverdueDays),
                  settlementWeekEndsOn: String(row.settlementWeekEndsOn),
                }}
                weekdays={weekdays}
                mayEdit={mayEdit}
                fieldLabels={fieldLabels}
                translate={Object.fromEntries(
                  ERROR_KEYS.map((key) => [key, t(key)]),
                )}
                labels={{
                  invoicing: t('settings.invoicing'),
                  prefix: t('settings.prefix'),
                  prefixHint: t('settings.prefixHint'),
                  terms: t('settings.terms'),
                  notes: t('settings.notes'),
                  remitTo: t('settings.remitTo'),
                  assumptions: t('settings.assumptions'),
                  fuelCost: t('settings.fuelCost'),
                  mpg: t('settings.mpg'),
                  mpgHint: t('settings.mpgHint'),
                  factoringFee: t('settings.factoringFee'),
                  dispatchFee: t('settings.dispatchFee'),
                  leadTimes: t('settings.leadTimes'),
                  complianceWarn: t('settings.complianceWarn'),
                  podMissing: t('settings.podMissing'),
                  invoiceOverdue: t('settings.invoiceOverdue'),
                  week: t('settings.week'),
                  weekEndsOn: t('settings.weekEndsOn'),
                  weekHint: t('settings.weekHint'),
                  save: t('settings.save'),
                  saved: t('settings.saved'),
                  savedNothing: t('settings.savedNothing'),
                  readOnly: t('settings.readOnly'),
                }}
              />
            </section>
          ))}
        </div>
      </div>
    </>
  )
}
