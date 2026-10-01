'use client'

import { useActionState, useState } from 'react'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { Select } from '@/components/ui/Select'
import {
  closeStandingChargeAction,
  exemptDriverAction,
} from './standing-actions'
import { STANDING_INITIAL } from './standing-state'

interface Props {
  standingChargeId: string
  drivers: readonly { id: string; name: string }[]
  labels: {
    stop: string
    stopOn: string
    exempt: string
    driver: string
    reason: string
    save: string
    cancel: string
  }
  /** Refusal sentences, ALREADY TRANSLATED — a client cannot call `t`. */
  errors: Record<string, string>
}

/**
 * ONE STANDING CHARGE'S ACTIONS: stop it, or exempt a driver from it.
 *
 * ── NO EDITOR, AND THAT IS THE MODEL ─────────────────────────────────────
 *
 * `ChargeRowForm` beside this opens an amount field in place. This one does not,
 * because §6.2.4 and the schema both say a standing charge is SUPERSEDED, NEVER
 * EDITED: these land on statements that have been handed to a person, so a
 * change closes the old row with `effectiveTo` and opens a new one. Offering an
 * amount field here would offer to restate a document.
 *
 * It is the same posture `DriverPayRule` and `RecurringDeduction` take — and the
 * same one the workbench takes about per-cell edit pencils (§6.2.1, "no pencil;
 * remove and re-add"), for the same reason in all three places.
 *
 * ── AN EXEMPTION IS A ROW, NOT A BLANK ───────────────────────────────────
 *
 * §6.2.4. "This driver does not pay Ifta" is a decision somebody made and
 * should be able to explain, so the reason is a REQUIRED field here and a
 * required column in the schema. A form that let it through empty would be the
 * place that requirement quietly stopped being one.
 *
 * ── IN PLACE, NOT A MODAL, AND THE ROW DOES NOT MOVE ─────────────────────
 *
 * §7.5 would permit a modal at two fields; the question is comparative ("is
 * Admin Fee $35 for everybody?") and a modal covers the rows being compared.
 * §11: the editor replaces the cells' contents and slides nothing in.
 */
export function StandingRowForm({
  standingChargeId,
  drivers,
  labels,
  errors,
}: Props) {
  const [open, setOpen] = useState<'none' | 'stop' | 'exempt'>('none')
  const [stopState, stop, stopping] = useActionState(
    closeStandingChargeAction.bind(null, standingChargeId),
    STANDING_INITIAL,
  )
  const [exemptState, exempt, exempting] = useActionState(
    exemptDriverAction.bind(null, standingChargeId),
    STANDING_INITIAL,
  )

  const error = stopState.error ?? exemptState.error

  if (open === 'none') {
    return (
      <div className="flex items-center gap-z1">
        <Button
          variant="ghost"
          size="compact"
          onClick={() => setOpen('exempt')}
        >
          {labels.exempt}
        </Button>
        {/* Rule 11: a destructive action is never accent-coloured. And stopping
         * is not deleting — the row stays and `effectiveTo` closes it, because
         * a statement computed from this rule printed a line that has to remain
         * explicable. */}
        <Button
          variant="ghost"
          size="compact"
          className="text-danger"
          onClick={() => setOpen('stop')}
        >
          {labels.stop}
        </Button>
        {error ? (
          <span className="text-xs text-danger" role="alert">
            {errors[error] ?? error}
          </span>
        ) : null}
      </div>
    )
  }

  if (open === 'stop') {
    return (
      <form action={stop} className="flex flex-wrap items-end gap-z1">
        <Input
          name="effectiveTo"
          type="date"
          label={labels.stopOn}
          className="w-[150px]"
        />
        <Button
          type="submit"
          variant="danger"
          size="compact"
          disabled={stopping}
        >
          {labels.stop}
        </Button>
        <Button variant="ghost" size="compact" onClick={() => setOpen('none')}>
          {labels.cancel}
        </Button>
        {error ? (
          <p className="w-full text-xs text-danger" role="alert">
            {errors[error] ?? error}
          </p>
        ) : null}
      </form>
    )
  }

  return (
    <form action={exempt} className="flex flex-wrap items-end gap-z1">
      <Select
        name="driverId"
        label={labels.driver}
        options={drivers.map((driver) => ({
          value: driver.id,
          label: driver.name,
        }))}
        className="w-[200px]"
      />
      <Input name="reason" label={labels.reason} className="w-[220px]" />
      <Button
        type="submit"
        variant="primary"
        size="compact"
        disabled={exempting}
      >
        {labels.save}
      </Button>
      <Button variant="ghost" size="compact" onClick={() => setOpen('none')}>
        {labels.cancel}
      </Button>
      {error ? (
        <p className="w-full text-xs text-danger" role="alert">
          {errors[error] ?? error}
        </p>
      ) : null}
    </form>
  )
}
