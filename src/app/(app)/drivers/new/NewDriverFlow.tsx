'use client'

import { useActionState, useEffect, useRef, useState } from 'react'
import { RecordForm, type FieldSpec } from '@/components/forms/RecordForm'
import { Select, type SelectOption } from '@/components/ui/Select'
import { cx } from '@/lib/cx'
import { createDriverAction } from '../actions'
import { readCdlAction } from './cdl-actions'
import { EMPTY_CDL_READ } from './cdl-state'

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
  const [state, read, pending] = useActionState(readCdlAction, EMPTY_CDL_READ)
  const [companyId, setCompanyId] = useState(defaultAuthority)
  const [manual, setManual] = useState(false)
  const [over, setOver] = useState(false)
  const fileInput = useRef<HTMLInputElement>(null)
  const formRef = useRef<HTMLFormElement>(null)
  const [file, setFile] = useState<{
    base64: string
    type: string
    name: string
  } | null>(null)

  // THE CONFIRM STEP IS REACHED BY READING OR BY ASKING. Both land on the same
  // form; the difference is only whether anything is in it.
  const confirming = manual || state.attempted

  // A FILE CHOSEN IS A FILE SUBMITTED. Requiring a second click on an Upload
  // button after dropping a card is the kind of step that gets called a bug.
  useEffect(() => {
    if (file && formRef.current) formRef.current.requestSubmit()
  }, [file])

  const take = async (chosen: File | null | undefined) => {
    if (!chosen) return
    const buffer = await chosen.arrayBuffer()
    let binary = ''
    const bytes = new Uint8Array(buffer)
    for (let i = 0; i < bytes.length; i++)
      binary += String.fromCharCode(bytes[i]!)
    setFile({ base64: btoa(binary), type: chosen.type, name: chosen.name })
  }

  if (confirming) {
    return (
      <div className="flex flex-col gap-z4">
        {state.notice ? (
          <p
            role="status"
            className="max-w-[520px] rounded-card border border-warning bg-warning-soft px-z3 py-z2 text-sm text-warning"
          >
            {labels.notices[state.notice] ?? state.notice}
          </p>
        ) : null}
        <RecordForm
          fields={fields}
          values={{
            companyId,
            employmentType: 'OWNED',
            ...state.values,
          }}
          action={createDriverAction}
          cancelHref="/drivers"
          labels={{ save: labels.save, cancel: labels.cancel }}
        />
      </div>
    )
  }

  return (
    <form
      ref={formRef}
      action={read}
      className="flex max-w-[520px] flex-col gap-z4"
    >
      <Select
        label={labels.authority}
        value={companyId}
        onChange={(event) => setCompanyId(event.target.value)}
        options={authorities}
      />

      {/* The file rides as hidden fields so the drop zone can be a div and the
       * form can still be a form — no fetch, no JSON endpoint, one action. */}
      <input type="hidden" name="cdl" value={file?.base64 ?? ''} />
      <input type="hidden" name="cdlType" value={file?.type ?? ''} />
      <input type="hidden" name="cdlName" value={file?.name ?? ''} />

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
        {pending ? (
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
    </form>
  )
}
