'use client'

import { useActionState } from 'react'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { Select, type SelectOption } from '@/components/ui/Select'
import { saveSettingsAction } from './settings-actions'
import { SETTINGS_INITIAL, type SettingsState } from './settings-state'

// PHASE 4 §5 STEP 6 — one authority's settings.
//
// ONE FORM PER AUTHORITY, and one save per form. Not a single form covering
// both carriers: the fields are per-authority and a save that wrote two rows
// would produce two audit entries a reader has to reassemble, or one that
// claims a change to a carrier nobody touched.
//
// THE CONFIRMATION NAMES WHAT MOVED. "Saved" is the message every form gives;
// "Saved: invoice prefix, week ends on" is the one that lets somebody notice
// they changed a field they did not mean to. It is the same set the audit row
// records, which is the point — the screen and the log agree because they come
// from the same comparison.

export interface SettingsValues {
  companyId: string
  companyName: string
  invoiceNumberPrefix: string
  invoiceTermsDays: string
  invoiceNotes: string
  remitToText: string
  defaultFuelCostPerMile: string
  defaultMpg: string
  factoringFeePercent: string
  dispatchFeePercent: string
  complianceWarnDays: string
  podMissingAlertDays: string
  invoiceOverdueDays: string
  settlementWeekEndsOn: string
}

interface Props {
  values: SettingsValues
  weekdays: readonly SelectOption[]
  mayEdit: boolean
  /** Field name → label, for naming what changed in the reader's language. */
  fieldLabels: Record<string, string>
  translate: Record<string, string>
  labels: {
    invoicing: string
    prefix: string
    prefixHint: string
    terms: string
    notes: string
    remitTo: string
    assumptions: string
    fuelCost: string
    mpg: string
    mpgHint: string
    factoringFee: string
    dispatchFee: string
    leadTimes: string
    complianceWarn: string
    podMissing: string
    invoiceOverdue: string
    week: string
    weekEndsOn: string
    weekHint: string
    save: string
    saved: string
    savedNothing: string
    readOnly: string
  }
}

export function SettingsForm({
  values,
  weekdays,
  mayEdit,
  fieldLabels,
  translate,
  labels,
}: Props) {
  const [state, act, pending] = useActionState<SettingsState, FormData>(
    saveSettingsAction.bind(null, values.companyId),
    SETTINGS_INITIAL,
  )

  const group = 'grid grid-cols-[repeat(auto-fit,minmax(180px,1fr))] gap-z3'
  const heading = 'text-sm font-medium text-ink-2'

  return (
    <form action={act} className="flex flex-col gap-z4">
      <h2 className="text-md font-medium text-ink">{values.companyName}</h2>

      <fieldset disabled={!mayEdit} className="flex flex-col gap-z4">
        <div className="flex flex-col gap-z2">
          <h3 className={heading}>{labels.invoicing}</h3>
          <div className={group}>
            <Input
              name="invoiceNumberPrefix"
              label={labels.prefix}
              hint={labels.prefixHint}
              defaultValue={values.invoiceNumberPrefix}
              required
            />
            <Input
              name="invoiceTermsDays"
              label={labels.terms}
              defaultValue={values.invoiceTermsDays}
              inputMode="numeric"
              required
            />
            <Input
              name="remitToText"
              label={labels.remitTo}
              defaultValue={values.remitToText}
            />
            <Input
              name="invoiceNotes"
              label={labels.notes}
              defaultValue={values.invoiceNotes}
            />
          </div>
        </div>

        <div className="flex flex-col gap-z2">
          <h3 className={heading}>{labels.assumptions}</h3>
          <div className={group}>
            <Input
              name="defaultFuelCostPerMile"
              label={labels.fuelCost}
              defaultValue={values.defaultFuelCostPerMile}
              inputMode="decimal"
              required
            />
            <Input
              name="defaultMpg"
              label={labels.mpg}
              hint={labels.mpgHint}
              defaultValue={values.defaultMpg}
              inputMode="decimal"
              required
            />
            <Input
              name="factoringFeePercent"
              label={labels.factoringFee}
              defaultValue={values.factoringFeePercent}
              inputMode="decimal"
              required
            />
            <Input
              name="dispatchFeePercent"
              label={labels.dispatchFee}
              defaultValue={values.dispatchFeePercent}
              inputMode="decimal"
              required
            />
          </div>
        </div>

        <div className="flex flex-col gap-z2">
          <h3 className={heading}>{labels.leadTimes}</h3>
          <div className={group}>
            <Input
              name="complianceWarnDays"
              label={labels.complianceWarn}
              defaultValue={values.complianceWarnDays}
              inputMode="numeric"
              required
            />
            <Input
              name="podMissingAlertDays"
              label={labels.podMissing}
              defaultValue={values.podMissingAlertDays}
              inputMode="numeric"
              required
            />
            <Input
              name="invoiceOverdueDays"
              label={labels.invoiceOverdue}
              defaultValue={values.invoiceOverdueDays}
              inputMode="numeric"
              required
            />
          </div>
        </div>

        <div className="flex flex-col gap-z2">
          <h3 className={heading}>{labels.week}</h3>
          <div className={group}>
            <Select
              name="settlementWeekEndsOn"
              label={labels.weekEndsOn}
              defaultValue={values.settlementWeekEndsOn}
              options={weekdays}
            />
          </div>
          <p className="max-w-[68ch] text-sm text-ink-3">{labels.weekHint}</p>
        </div>
      </fieldset>

      {mayEdit ? (
        <div className="flex flex-wrap items-center gap-z3">
          <Button type="submit" variant="primary" disabled={pending}>
            {labels.save}
          </Button>
          {state.error ? (
            <p role="alert" className="text-sm text-danger">
              {translate[state.error] ?? state.error}
              {state.field
                ? ` — ${fieldLabels[state.field] ?? state.field}`
                : ''}
            </p>
          ) : null}
          {state.changed !== null && !state.error ? (
            <p role="status" className="text-sm text-ink-2">
              {state.changed.length === 0
                ? labels.savedNothing
                : labels.saved.replace(
                    '{fields}',
                    state.changed
                      .map((field) => fieldLabels[field] ?? field)
                      .join(', '),
                  )}
            </p>
          ) : null}
        </div>
      ) : (
        <p className="text-sm text-ink-3">{labels.readOnly}</p>
      )}
    </form>
  )
}
