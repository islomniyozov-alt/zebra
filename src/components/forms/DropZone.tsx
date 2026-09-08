'use client'

import { useRef, useState } from 'react'
import { cx } from '@/lib/cx'

// ---------------------------------------------------------------------------
// A PLACE TO PUT A DOCUMENT: DROP IT, PASTE IT, OR CLICK TO BROWSE.
//
// SHARED, AND THAT IS THE POINT. This was inline in `NewDriverFlow` until the
// medical certificate needed the same control on a different screen. Copying
// it would have made two upload zones — and two places to fix the paste
// handler, the focus ring, the accept list and the keyboard path, every time
// any of them is wrong. Same reasoning as extracting `envelope-parse.ts`.
//
// THREE WAYS TO GIVE IT A FILE, because a photograph arrives three ways and
// nobody should have to know which one a screen wanted: DROP it, PASTE it
// (a phone photo straight out of the clipboard, which is how they actually
// arrive), or CLICK to browse.
//
// PASTE LANDS ON THE ZONE, NOT ON THE WINDOW. A paste handler on the document
// swallows Ctrl+V in every other control on the page — the authority select
// beside the CDL zone was the case that found this.
//
// IT HOLDS NO UPLOAD LOGIC. It hands a `File` to its caller and knows nothing
// about routes, drivers or licences; what to do with the file is the caller's
// business, and keeping it that way is what lets two very different screens
// share one control.
// ---------------------------------------------------------------------------

export interface DropZoneLabels {
  title: string
  body: string
  hint: string
  /** Shown while the caller is working. */
  busy: string
}

interface Props {
  labels: DropZoneLabels
  /** Files this zone will offer. Stated by the caller, not assumed here. */
  accept?: string
  busy?: boolean
  onFile: (file: File) => void
}

const DEFAULT_ACCEPT =
  'image/jpeg,image/png,image/webp,image/gif,application/pdf'

export function DropZone({ labels, accept, busy = false, onFile }: Props) {
  const [over, setOver] = useState(false)
  const input = useRef<HTMLInputElement>(null)

  const take = (file: File | null | undefined) => {
    if (file) onFile(file)
  }

  return (
    <div
      onDragOver={(event) => {
        event.preventDefault()
        setOver(true)
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(event) => {
        event.preventDefault()
        setOver(false)
        take(event.dataTransfer.files?.[0])
      }}
      onPaste={(event) => take(event.clipboardData.files?.[0])}
      tabIndex={0}
      role="button"
      aria-label={labels.title}
      onClick={() => input.current?.click()}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault()
          input.current?.click()
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
      <p className="text-base font-medium text-ink">{labels.title}</p>
      <p className="text-sm text-ink-2">{labels.body}</p>
      <p className="text-xs text-ink-3">{labels.hint}</p>
      {busy ? (
        <p role="status" className="text-sm text-accent">
          {labels.busy}
        </p>
      ) : null}
      <input
        ref={input}
        type="file"
        accept={accept ?? DEFAULT_ACCEPT}
        className="sr-only"
        onChange={(event) => take(event.target.files?.[0])}
      />
    </div>
  )
}
