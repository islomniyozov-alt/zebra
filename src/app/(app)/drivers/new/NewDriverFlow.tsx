'use client'

import { useRef, useState } from 'react'
import { RecordForm, type FieldSpec } from '@/components/forms/RecordForm'
import { Select, type SelectOption } from '@/components/ui/Select'
import { cx } from '@/lib/cx'
import { downscaleImage } from './downscale'
import { createDriverAction } from '../actions'

// ---------------------------------------------------------------------------
// TWO CONTROLS, THEN A CONFIRM. Daler's ruling, precise: Add driver opens an
// authority at the top and a place to put the CDL at the bottom, and nothing
// else. The thirteen-field form is not the front door — it is what you confirm
// AFTER the licence has been read.
//
// THREE WAYS TO GIVE IT A CARD, because a photograph arrives three ways and a
// dispatcher should not have to know which one this screen wanted: DROP it,
// PASTE it (phone photo straight out of the clipboard, which is how they
// actually arrive), or CLICK to browse.
//
// THE READ NEVER BLOCKS THE PATH. `readCdl` returns nothing today and the
// confirm form opens empty, with the reason said out loud — a screen that
// silently produced a blank form would read as an upload that failed, and the
// dispatcher would try again with a better photograph of a licence that was
// never the problem.
//
// AND MANUAL ENTRY STAYS REACHABLE, as a link rather than a second front door.
// It is the same confirm form with nothing filled in, which is exactly what
// the old screen was.
// ---------------------------------------------------------------------------

interface Props {
  authorities: readonly SelectOption[]
  defaultAuthority: string
  fields: FieldSpec[]
  labels: {
    authority: string
    dropTitle: string
    dropBody: string
    dropHint: string
    browse: string
    manual: string
    reading: string
    save: string
    cancel: string
    notices: Record<string, string>
  }
}

export function NewDriverFlow({
  authorities,
  defaultAuthority,
  fields,
  labels,
}: Props) {
  const [companyId, setCompanyId] = useState(defaultAuthority)
  const [manual, setManual] = useState(false)
  const [over, setOver] = useState(false)
  const [reading, setReading] = useState(false)
  const [read, setRead] = useState<{
    values: Record<string, string>
    notice: string | null
  } | null>(null)
  const fileInput = useRef<HTMLInputElement>(null)

  // The confirm step is reached by reading or by asking. Same form; the only
  // difference is whether anything is in it.
  const confirming = manual || read !== null

  // ── THE UPLOAD IS A FETCH TO A ROUTE HANDLER, NOT A SERVER ACTION ────────
  //
  // It was an action, with the file base64'd into a hidden field, and Next
  // rejected the body at its 1MB default — base64 inflating by 4/3 put the
  // real ceiling at ~750KB, so every phone photo failed as a bare 500. See
  // src/app/api/cdl/read/route.ts for why the fix is a handler rather than a
  // raised global limit.
  //
  // AND THE IMAGE IS SHRUNK FIRST. A licence is legible at 1600px; sending
  // 4MB of phone camera is transfer time and model cost for no accuracy.
  const take = async (chosen: File | null | undefined) => {
    if (!chosen) return
    setReading(true)
    try {
      const file = await downscaleImage(chosen)
      const body = new FormData()
      body.append('file', file)

      const response = await fetch('/api/cdl/read', { method: 'POST', body })
      if (!response.ok) {
        // THE HANDLER'S REFUSALS ARE SHOWN AS THEMSELVES. A 413 means the file
        // is too big and a 415 means it is the wrong kind, and a dispatcher who
        // is told "something went wrong" photographs the licence again for no
        // reason. The confirm form still opens, because the driver can always
        // be typed in.
        const notice =
          response.status === 413
            ? 'drivers.cdl.tooLarge'
            : response.status === 415
              ? 'drivers.cdl.wrongType'
              : response.status === 403
                ? 'drivers.cdl.notAllowed'
                : 'drivers.cdl.failed'
        setRead({ values: {}, notice })
        return
      }

      const result = (await response.json()) as {
        values: Record<string, string>
        notice: string | null
      }
      setRead(result)
    } catch {
      setRead({ values: {}, notice: 'drivers.cdl.failed' })
    } finally {
      setReading(false)
    }
  }

  if (confirming) {
    return (
      <div className="flex flex-col gap-z4">
        {read?.notice ? (
          <p
            role="status"
            className="max-w-[520px] rounded-card border border-warning bg-warning-soft px-z3 py-z2 text-sm text-warning"
          >
            {labels.notices[read.notice] ?? read.notice}
          </p>
        ) : null}
        <RecordForm
          fields={fields}
          values={{
            companyId,
            employmentType: 'OWNED',
            ...(read?.values ?? {}),
          }}
          action={createDriverAction}
          cancelHref="/drivers"
          labels={{ save: labels.save, cancel: labels.cancel }}
        />
      </div>
    )
  }

  return (
    <div className="flex max-w-[520px] flex-col gap-z4">
      <Select
        label={labels.authority}
        value={companyId}
        onChange={(event) => setCompanyId(event.target.value)}
        options={authorities}
      />

      <div
        onDragOver={(event) => {
          event.preventDefault()
          setOver(true)
        }}
        onDragLeave={() => setOver(false)}
        onDrop={(event) => {
          event.preventDefault()
          setOver(false)
          void take(event.dataTransfer.files?.[0])
        }}
        // PASTE LANDS ON THE ZONE, not on the window: a paste handler on the
        // document would swallow Ctrl+V in the authority select beside it.
        onPaste={(event) => void take(event.clipboardData.files?.[0])}
        tabIndex={0}
        role="button"
        aria-label={labels.dropTitle}
        onClick={() => fileInput.current?.click()}
        onKeyDown={(event) => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault()
            fileInput.current?.click()
          }
        }}
        className={cx(
          'flex cursor-pointer flex-col items-center gap-z2 rounded-card border-2 border-dashed px-z4 py-z5 text-center',
          'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent',
          over
            ? 'border-accent bg-accent-soft'
            : 'border-border-strong bg-surface hover:bg-surface-3',
        )}
      >
        <p className="text-base font-medium text-ink">{labels.dropTitle}</p>
        <p className="text-sm text-ink-2">{labels.dropBody}</p>
        <p className="text-xs text-ink-3">{labels.dropHint}</p>
        {reading ? (
          <p role="status" className="text-sm text-accent">
            {labels.reading}
          </p>
        ) : null}
        <input
          ref={fileInput}
          type="file"
          accept="image/jpeg,image/png,image/webp,image/gif,application/pdf"
          className="sr-only"
          onChange={(event) => void take(event.target.files?.[0])}
        />
      </div>

      <button
        type="button"
        onClick={() => setManual(true)}
        className={cx(
          'self-start rounded-control text-sm text-ink-2',
          'underline decoration-border-strong underline-offset-2',
          'hover:text-accent focus-visible:outline focus-visible:outline-2',
          'focus-visible:outline-offset-2 focus-visible:outline-accent',
        )}
      >
        {labels.manual}
      </button>
    </div>
  )
}
