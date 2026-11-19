'use client'

import { useActionState, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { ADD_AUTHORITY_VALUE } from '@/lib/return-path'
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
  /**
   * "+ Add authority" at the end of the Move-to list (v11.35) — present only
   * for a role holding `company:create`. `href` is Admin → Authorities → new
   * carrying this record as the way back.
   */
  addAuthority?: { href: string; label: string }
  /** Open the Transfer dialog on arrival — the way back from Add authority. */
  openTransfer?: boolean
  transferAction: (
    previous: RecordFormState,
    formData: FormData,
  ) => Promise<RecordFormState>
  /**
   * Absent when the viewer may not remove the asset — then there is no Remove
   * button. It was a no-op server action behind a live button and a
   * confirmation modal (clickable audit, 2026-11-17).
   */
  retireAction?: () => Promise<void>
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
  addAuthority,
  openTransfer,
  transferAction,
  retireAction,
  restoreAction,
  labels,
}: Props) {
  const router = useRouter()
  // Another authority to move to, or the means to add one.
  const mayTransfer = authorities.length > 0 || addAuthority !== undefined
  const [transferOpen, setTransferOpen] = useState(
    Boolean(openTransfer) && mayTransfer && !isRetired,
  )
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
            {/* NO OTHER AUTHORITY, NO BUTTON. It was rendered disabled for
             * ever in a one-authority organization, with nothing saying why
             * (clickable audit, 2026-11-17). */}
            {mayTransfer ? (
              <Button
                type="button"
                variant="secondary"
                onClick={() => setTransferOpen(true)}
              >
                {labels.transfer}
              </Button>
            ) : null}
            {/* Standing rule 11 of the design system: destructive actions are
             * never accent-coloured. Danger or ghost only. */}
            {retireAction ? (
              <Button
                type="button"
                variant="danger"
                onClick={() => setRetireOpen(true)}
              >
                {labels.retire}
              </Button>
            ) : null}
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
          {authorities.length > 0 ? (
            <Select
              name="toCompanyId"
              label={labels.transferTo}
              options={
                addAuthority
                  ? [
                      ...authorities,
                      { value: ADD_AUTHORITY_VALUE, label: addAuthority.label },
                    ]
                  : authorities
              }
              required
              onChange={(event) => {
                // "+ Add authority" is a way out, not a choice: put the
                // selection back and go to the new-authority form.
                if (
                  addAuthority &&
                  event.target.value === ADD_AUTHORITY_VALUE
                ) {
                  event.target.value = authorities[0]?.value ?? ''
                  router.push(addAuthority.href)
                }
              }}
            />
          ) : addAuthority ? (
            // No other authority yet: the only way forward is to add one.
            <Link
              href={addAuthority.href}
              className="text-sm text-accent underline-offset-2 hover:underline"
            >
              {addAuthority.label}
            </Link>
          ) : null}
          <Input name="reason" label={labels.transferReason} type="text" />
          <div className="flex justify-end gap-z2">
            <Button
              type="button"
              variant="ghost"
              onClick={() => setTransferOpen(false)}
            >
              {labels.cancel}
            </Button>
            <Button
              type="submit"
              variant="primary"
              disabled={pending || authorities.length === 0}
            >
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
