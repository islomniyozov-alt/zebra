'use client'

import { useState } from 'react'
import { cx } from '@/lib/cx'
import type { ExtractedWithoutMoney } from '@/lib/extraction'
import type { Extracted } from '@/lib/extraction-shape'

// PHASE 5 §3 STEP 2 — the offer slot.
//
// AN OFFER, NOT A GATE. The brief's opening sentence is the whole design
// constraint: "the repeat load is already 6.4 s by keyboard; extraction does
// not compete with that and must never slow it: the typing path stays exactly
// as it is, upload-first is an OFFER." So this sits above the form, the form
// below it is complete and usable without ever touching this, and nothing here
// disables anything there.
//
// ELEVEN SECONDS. That is what one real extraction measured on the deployed
// worker, and it is why this is a visible three-phase progress line rather than
// a spinner: a dispatcher who cannot tell "uploading" from "reading" from
// "stuck" will hit the button again, and the second press costs another three
// cents.
//
// THE MINT IS TARGETLESS (§1.5). The load does not exist yet, so the document
// rides the PendingUpload path and attaches at save — which is the pipeline's
// real shape rather than a load created early to hang a file on.

type Phase = 'idle' | 'hashing' | 'uploading' | 'reading' | 'done' | 'failed'

export interface Prefill {
  pendingUploadId: string
  extracted: Extracted | ExtractedWithoutMoney
  /** Dotted paths the model was unsure about, for the form to mark. */
  lowConfidence: string[]
  cost: string
}

interface Props {
  /** The authority the form currently has selected. A mint needs one. */
  companyId: string
  onExtracted: (prefill: Prefill) => void
  labels: {
    title: string
    hint: string
    choose: string
    hashing: string
    uploading: string
    reading: string
    done: string
    failed: string
    typeInstead: string
  }
}

export function RateConOffer({ companyId, onExtracted, labels }: Props) {
  const [phase, setPhase] = useState<Phase>('idle')
  const [detail, setDetail] = useState<string | null>(null)

  const caption =
    phase === 'hashing'
      ? labels.hashing
      : phase === 'uploading'
        ? labels.uploading
        : phase === 'reading'
          ? labels.reading
          : phase === 'done'
            ? labels.done
            : phase === 'failed'
              ? (detail ?? labels.failed)
              : labels.hint

  async function handle(file: File) {
    setDetail(null)
    try {
      setPhase('hashing')
      const bytes = new Uint8Array(await file.arrayBuffer())
      const digest = await crypto.subtle.digest('SHA-256', bytes)
      const sha256 = btoa(String.fromCharCode(...new Uint8Array(digest)))

      // No entity: the load does not exist. The authority comes from the form's
      // own select, and the server checks it is one this user may act for.
      const minted = await fetch('/api/documents/upload-url', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          companyId,
          filename: file.name,
          mimeType: file.type,
          sizeBytes: file.size,
          sha256,
          documentType: 'RATE_CONFIRMATION',
        }),
      })
      if (!minted.ok) throw new Error(await messageOf(minted))
      const { pendingUploadId, url, headers } = (await minted.json()) as {
        pendingUploadId: string
        url: string
        headers: Record<string, string>
      }

      setPhase('uploading')
      const put = await fetch(url, { method: 'PUT', headers, body: bytes })
      if (!put.ok) throw new Error(`Upload failed (${put.status}).`)

      setPhase('reading')
      const read = await fetch(`/api/documents/${pendingUploadId}/extract`, {
        method: 'POST',
      })
      if (!read.ok) throw new Error(await messageOf(read))

      const answer = (await read.json()) as {
        extracted: Extracted
        cost: { display: string }
      }

      setPhase('done')
      onExtracted({
        pendingUploadId,
        extracted: answer.extracted,
        lowConfidence: lowConfidencePaths(
          answer.extracted as unknown as Record<string, unknown>,
        ),
        cost: answer.cost.display,
      })
    } catch (error) {
      setPhase('failed')
      // The reason, not "something went wrong". A document that cannot be read
      // and a network that dropped call for different next moves.
      setDetail(error instanceof Error ? error.message : String(error))
    }
  }

  return (
    <section
      className={cx(
        'flex flex-col gap-z2 rounded-card border border-dashed p-z3',
        phase === 'failed' ? 'border-danger' : 'border-border-strong',
      )}
    >
      <h2 className="text-sm font-medium text-ink">{labels.title}</h2>

      <div className="flex flex-wrap items-center gap-z3">
        {/* A label wrapping the input, styled as the secondary button — the
         * file control has no accessible way to be a <button>, and a real
         * button that clicks a hidden input is two things to keep in step. */}
        <label className="inline-flex h-control-compact cursor-pointer items-center rounded-control border border-border-strong bg-surface px-z3 text-xs font-medium text-ink hover:bg-surface-3">
          {labels.choose}
          <input
            type="file"
            accept="application/pdf,image/*"
            className="sr-only"
            onChange={(event) => {
              const file = event.target.files?.[0]
              if (file) void handle(file)
            }}
          />
        </label>

        <p
          role="status"
          className={cx(
            'text-sm',
            phase === 'failed' ? 'text-danger' : 'text-ink-2',
          )}
        >
          {caption}
        </p>
      </div>

      {/* The way out, always visible. An offer that looks like a step is a
       * gate, whatever the copy says. */}
      <p className="text-xs text-ink-3">{labels.typeInstead}</p>
    </section>
  )
}

async function messageOf(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as { message?: string; error?: string }
    return body.message ?? body.error ?? `Request failed (${response.status}).`
  } catch {
    return `Request failed (${response.status}).`
  }
}

/**
 * Which fields the model was unsure about.
 *
 * The same walk `lowConfidenceFields` does on the server, repeated here because
 * the response has already been stripped of money for a dispatcher and the
 * client is what knows which inputs exist.
 */
function lowConfidencePaths(extracted: Record<string, unknown>): string[] {
  const found: string[] = []
  const check = (path: string, field: unknown) => {
    if (
      field &&
      typeof field === 'object' &&
      (field as { confidence?: string }).confidence === 'low'
    ) {
      found.push(path)
    }
  }

  for (const [key, value] of Object.entries(extracted)) {
    if (key === 'stops' || key === 'money') continue
    check(key, value)
  }
  const stops = (extracted['stops'] ?? []) as Record<string, unknown>[]
  for (const [index, stop] of stops.entries()) {
    for (const [key, value] of Object.entries(stop)) {
      check(`stops[${index}].${key}`, value)
    }
  }
  const money = extracted['money'] as Record<string, unknown> | undefined
  if (money) {
    for (const key of ['linehaul', 'fuelSurcharge', 'total']) {
      check(`money.${key}`, money[key])
    }
  }
  return found
}
