'use client'

import { useEffect, useMemo, useState } from 'react'
import { orientationPlan } from '@/lib/image-orientation'

// ---------------------------------------------------------------------------
// TURN THE CARD UPRIGHT BEFORE ANYBODY READS IT (owner's ruling, 2026-09-12).
//
// ── WHY A PERSON IS IN THIS LOOP AT ALL ───────────────────────────────────
//
// EXIF answers the question when it is there, and `downscaleImage` applies it
// without asking. This is the other case, and it is the common one for a card
// photographed flat on a desk: no orientation tag, so nothing in the file says
// which way up it is, and no amount of server-side cleverness can invent it.
//
// What that costs, measured 2026-09-12 on the medical certificate in the
// corpus: lying on its side, one engine returned FOUR different examiner names
// across four reads — one of them the driver's own surname — and four
// different registry numbers, one of them eleven digits at high confidence.
// The dates stayed correct throughout, which is why nobody would have caught
// it: the spine looked stable while the doctor's identity did not. Upright,
// the same engine was perfect across five reads.
//
// ── IT BLOCKS THE READ, IT DOES NOT WARN AFTER IT ─────────────────────────
//
// A warning shown beside a finished answer is a warning somebody dismisses.
// The read does not start until the person has looked at the card the right
// way up, because the whole point is that the engine sees what they see.
// ---------------------------------------------------------------------------

interface Props {
  file: File
  labels: {
    title: string
    hint: string
    rotateLeft: string
    rotateRight: string
    read: string
    cancel: string
  }
  /** Called with the quarter-turns the person settled on. */
  onConfirm: (quarterTurns: number) => void
  onCancel: () => void
}

/**
 * Whether this file needs a person to say which way up it is.
 *
 * EXPORTED SO THE CALLER CAN ASK BEFORE RENDERING ANYTHING. A screen that
 * mounted this component for every upload would put a confirmation step in
 * front of the majority of cards, which carry EXIF and need nothing.
 */
export async function needsUprightStep(file: File): Promise<boolean> {
  if (!file.type.startsWith('image/')) return false
  try {
    const plan = orientationPlan(new Uint8Array(await file.arrayBuffer()))
    return plan.needsPerson
  } catch {
    // FAILS OPEN, like the downscaler it sits beside. A file this cannot read
    // is one the route will refuse on its own terms; adding a rotate step to
    // an upload that was going to fail anyway helps nobody.
    return false
  }
}

export function UprightCard({ file, labels, onConfirm, onCancel }: Props) {
  const [turns, setTurns] = useState(0)
  const url = useMemo(() => URL.createObjectURL(file), [file])
  useEffect(() => () => URL.revokeObjectURL(url), [url])

  return (
    <section className="flex flex-col gap-z3 rounded-card border border-border bg-surface p-z4">
      <div>
        <h2 className="text-md font-medium text-ink">{labels.title}</h2>
        <p className="mt-z1 text-sm text-ink-2">{labels.hint}</p>
      </div>

      {/* THE PREVIEW TURNS, NOT THE FILE. Nothing is re-encoded until the
       * person is finished — a rotate button that rewrote a 4MB photograph on
       * every press would make the step feel broken on a phone. */}
      <div className="flex items-center justify-center overflow-hidden rounded-card bg-surface-2 p-z3">
        {/* eslint-disable-next-line @next/next/no-img-element -- a blob: URL
            from a file the person just chose; next/image wants a loader and a
            known size, and has neither for an object URL. */}
        <img
          src={url}
          alt=""
          className="max-h-[50vh] w-auto"
          style={{ transform: `rotate(${String(turns * 90)}deg)` }}
        />
      </div>

      <div className="flex flex-wrap gap-z2">
        <button
          type="button"
          onClick={() => setTurns((was) => (was + 3) % 4)}
          className="rounded-card border border-border px-z3 py-z2 text-sm text-ink-2 hover:text-ink"
        >
          {labels.rotateLeft}
        </button>
        <button
          type="button"
          onClick={() => setTurns((was) => (was + 1) % 4)}
          className="rounded-card border border-border px-z3 py-z2 text-sm text-ink-2 hover:text-ink"
        >
          {labels.rotateRight}
        </button>
        <button
          type="button"
          onClick={() => onConfirm(turns)}
          className="rounded-card border border-accent bg-accent px-z3 py-z2 text-sm font-medium text-on-accent"
        >
          {labels.read}
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="rounded-card px-z3 py-z2 text-sm text-ink-3 hover:text-ink"
        >
          {labels.cancel}
        </button>
      </div>
    </section>
  )
}
