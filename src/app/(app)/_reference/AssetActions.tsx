'use client'

import { useActionState, useState } from 'react'
import { Button } from '@/components/ui/Button'
import { Modal } from '@/components/ui/Modal'
import { Select, type SelectOption } from '@/components/ui/Select'
import { Input } from '@/components/ui/Input'
import {
  RECORD_FORM_INITIAL,
  type RecordFormState,
} from '@/components/forms/RecordForm'
import type { FleetKind } from '@/lib/fleet'

// The two irreversible-looking things on a fleet record, both behind a Modal
// confirmation (§7.5, and the Modal component finally earns its place).
//
// Neither is actually irreversible: retire is a soft delete with a restore
// next to it, and a transfer closes a period rather than overwriting one. The
// confirmation is there because they LOOK irreversible to the person clicking,
// and a dispatcher at 6am should not have to know which is which.
//
// Standing rule 11 applies to how these were checked: the refusal cases below
// are only evidence if the same request succeeds once the reason for refusal
// is removed. Both directions are in tests/integration/fleet.test.ts.

interface Props {
  kind: FleetKind
  id: string
  isRetired: boolean
  /** Authorities this user may move the asset to. Excludes its current one. */
  authorities: readonly SelectOption[]
  currentAuthorityName: string | null
  transferAction: (
    previous: RecordFormState,
    formData: FormData,
  ) => Promise<RecordFormState>
  retireAction: () => Promise<void>
  restoreAction: () => Promise<void>
  labels: {
    transfer: string
    transferTitle: string
    transferBody: string
    transferTo: string
    transferReason: string
    transferConfirm: string
    retire: string
    retireConfirm: string
    retireBody: string
    restore: string
    cancel: string
    currentAuthority: string
    noOpenPeriod: string
  }
}

export function AssetActions({
  isRetired,
  authorities,
  currentAuthorityName,
  transferAction,
  retireAction,
  restoreAction,
  labels,
}: Props) {
  const [transferOpen, setTransferOpen] = useState(false)
  const [retireOpen, setRetireOpen] = useState(false)
  const [state, formAction, pending] = useActionState(
    transferAction,
    RECORD_FORM_INITIAL,
  )

  return (
    <section className="mt-z6 max-w-[520px] border-t border-border pt-z4">
      <p className="text-sm text-ink-2">
        {labels.currentAuthority}:{' '}
        <span className="text-ink">
          {currentAuthorityName ?? labels.noOpenPeriod}
        </span>
      </p>

      <div className="mt-z3 flex items-center gap-z2">
        {isRetired ? (
          <form action={restoreAction}>
            <Button type="submit" variant="secondary">
              {labels.restore}
            </Button>
          </form>
        ) : (
          <>
            <Button
              type="button"
              variant="secondary"
              onClick={() => setTransferOpen(true)}
              disabled={authorities.length === 0}
            >
              {labels.transfer}
            </Button>
            {/* Standing rule 11 of the design system: destructive actions are
             * never accent-coloured. Danger or ghost only. */}
            <Button
              type="button"
              variant="danger"
              onClick={() => setRetireOpen(true)}
            >
              {labels.retire}
            </Button>
          </>
        )}
      </div>

      <Modal
        open={transferOpen}
        title={labels.transferTitle}
        onClose={() => setTransferOpen(false)}
      >
        <form
          action={formAction}
          onSubmit={() => setTransferOpen(false)}
          className="flex flex-col gap-z4"
        >
          <p className="text-sm text-ink-2">{labels.transferBody}</p>
          <Select
            name="toCompanyId"
            label={labels.transferTo}
            options={authorities}
            required
          />
          <Input name="reason" label={labels.transferReason} type="text" />
          <div className="flex justify-end gap-z2">
            <Button
              type="button"
              variant="ghost"
              onClick={() => setTransferOpen(false)}
            >
              {labels.cancel}
            </Button>
            <Button type="submit" variant="primary" disabled={pending}>
              {labels.transferConfirm}
            </Button>
          </div>
        </form>
      </Modal>

      <Modal
        open={retireOpen}
        title={labels.retireConfirm}
        onClose={() => setRetireOpen(false)}
      >
        <p className="text-sm text-ink-2">{labels.retireBody}</p>
        <div className="mt-z4 flex justify-end gap-z2">
          <Button
            type="button"
            variant="ghost"
            onClick={() => setRetireOpen(false)}
          >
            {labels.cancel}
          </Button>
          <form action={retireAction} onSubmit={() => setRetireOpen(false)}>
            <Button type="submit" variant="danger">
              {labels.retire}
            </Button>
          </form>
        </div>
      </Modal>

      {state.error ? (
        <p role="alert" className="mt-z3 text-base text-danger">
          {state.error}
        </p>
      ) : null}
    </section>
  )
}
