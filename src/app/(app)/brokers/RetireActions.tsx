'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/Button'
import { Modal } from '@/components/ui/Modal'

// A broker has no authority to be transferred between, so this is the retire
// half of AssetActions and nothing else. Kept separate rather than adding an
// `if (!authorities) hide the transfer` branch to that component: a control
// that is sometimes absent for domain reasons is a component with two jobs.

interface Props {
  isRetired: boolean
  retireAction: () => Promise<void>
  restoreAction: () => Promise<void>
  labels: {
    retire: string
    retireConfirm: string
    retireBody: string
    restore: string
    cancel: string
  }
}

export function RetireActions({
  isRetired,
  retireAction,
  restoreAction,
  labels,
}: Props) {
  const [open, setOpen] = useState(false)

  if (isRetired) {
    return (
      <section className="mt-z6 max-w-[520px] border-t border-border pt-z4">
        <form action={restoreAction}>
          <Button type="submit" variant="secondary">
            {labels.restore}
          </Button>
        </form>
      </section>
    )
  }

  return (
    <section className="mt-z6 max-w-[520px] border-t border-border pt-z4">
      {/* Standing rule 11: destructive actions are never accent-coloured. */}
      <Button type="button" variant="danger" onClick={() => setOpen(true)}>
        {labels.retire}
      </Button>

      <Modal
        open={open}
        title={labels.retireConfirm}
        onClose={() => setOpen(false)}
      >
        <p className="text-sm text-ink-2">{labels.retireBody}</p>
        <div className="mt-z4 flex justify-end gap-z2">
          <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
            {labels.cancel}
          </Button>
          <form action={retireAction} onSubmit={() => setOpen(false)}>
            <Button type="submit" variant="danger">
              {labels.retire}
            </Button>
          </form>
        </div>
      </Modal>
    </section>
  )
}
