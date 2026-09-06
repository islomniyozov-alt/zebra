'use client'

import { useState } from 'react'
import Link from 'next/link'
import { cx } from '@/lib/cx'
import { Button } from '@/components/ui/Button'
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

/** The four ways a load gets into Zebra (spec §16). */
type Method = 'manual' | 'upload' | 'paste' | 'amazon'

export interface Prefill {
  pendingUploadId: string
  extracted: Extracted | ExtractedWithoutMoney
  /** Dotted paths the model was unsure about, for the form to mark. */
  lowConfidence: string[]
  cost: string
  /**
   * A broker name that came from a PAST CORRECTION rather than from this page.
   *
   * Carried separately, and carrying the printed string with it, because the
   * substitution has to be visible. A field showing a name the document does
   * not contain, under a hint reading "From the document", is a false
   * statement — and the one field where being quietly wrong routes a load to
   * the wrong company's invoice.
   */
  remembered?: { name: string; printed: string }
  /** One per stop the document gave a street address for (§3 step 4). */
  facilities?: Facility[]
}

/**
 * A stop's dock, as the server answered it.
 *
 * `known` carries what the office wrote down; `new` carries only what the
 * document said, and exists so the form can OFFER to save it. Neither is
 * present for a stop with no street address, which is most of them — a lane
 * endpoint typed "Salem, OR" is not a facility.
 */
export type Facility =
  | {
      index: number
      status: 'known'
      locationId: string
      name: string
      hasMemory: boolean
      memory: {
        gateCode: string | null
        dockNotes: string | null
        hours: string | null
        instructions: string | null
        contactName: string | null
        contactPhone: string | null
        notes: string | null
      }
    }
  | { index: number; status: 'new'; name: string | null; address: string }

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
    failedUnreadable: string
    failedTryAgain: string
    failedMissing: string
    methodAmazonSoon: string
    methodPasteRead: string
    methodPastePlaceholder: string
    methodDropHint: string
    methodManualHint: string
    methodAmazon: string
    methodAmazonImport: string
    methodPaste: string
    methodUpload: string
    methodManual: string
  }
}

/** The offer's own words, named so `messageOf` can take them. */
type Labels = Props['labels']

export function RateConOffer({ companyId, onExtracted, labels }: Props) {
  const [phase, setPhase] = useState<Phase>('idle')
  const [detail, setDetail] = useState<string | null>(null)
  const [method, setMethod] = useState<Method>('manual')
  const [pasted, setPasted] = useState('')
  const [dragging, setDragging] = useState(false)

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

  /**
   * A PASTE IS A DOCUMENT (Phase 6 §1.2, spec §16).
   *
   * The words a dispatcher pastes are minted, stored and extracted by exactly
   * the same path a PDF takes — so the correction memory, the facility memory,
   * the attachment at save and the audit trail all work without knowing which
   * method was used. Spec §16: "All three methods should create the same
   * standardized Load/Stop data structure."
   */
  async function handleText(text: string) {
    const body = new TextEncoder().encode(text)
    await handle(
      new File([body], `pasted-${Date.now()}.txt`, { type: 'text/plain' }),
    )
  }

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
      if (!minted.ok) throw new Error(await messageOf(minted, labels))
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
      if (!read.ok) throw new Error(await messageOf(read, labels))

      const answer = (await read.json()) as {
        extracted: Extracted
        broker?: { customerId: string; name: string; via: 'alias' | 'exact' }
        facilities?: Facility[]
        cost: { display: string }
      }

      // §1.4 — THE MEMORY'S ONLY VISIBLE EFFECT. If somebody has typed over
      // this printed name before, the form offers the customer they chose
      // rather than the string on the page. The document's own words stay in
      // `extracted`, so the correction log still compares against what the
      // model said and not against what memory substituted.
      let remembered: Prefill['remembered']
      if (answer.broker && answer.extracted.brokerName) {
        const printed = String(answer.extracted.brokerName.value ?? '')
        // Only when memory changed the answer. An alias that resolves to the
        // name already on the page has nothing to disclose.
        if (answer.broker.via === 'alias' && answer.broker.name !== printed) {
          remembered = { name: answer.broker.name, printed }
        }
        answer.extracted.brokerName = {
          ...answer.extracted.brokerName,
          value: answer.broker.name,
        }
      }

      setPhase('done')
      onExtracted({
        pendingUploadId,
        extracted: answer.extracted,
        lowConfidence: lowConfidencePaths(
          answer.extracted as unknown as Record<string, unknown>,
        ),
        cost: answer.cost.display,
        remembered,
        facilities: answer.facilities,
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
        phase === 'failed'
          ? 'border-danger'
          : dragging
            ? 'border-accent bg-accent-soft'
            : 'border-border-strong',
      )}
      // THE DROPZONE IS THE WHOLE SURFACE, not a target inside it. A
      // dispatcher dragging a rate confirmation out of an email aims at the
      // box, and a smaller hit area inside a box that already looks droppable
      // is a trap. `preventDefault` on dragOver is what makes a drop land at
      // all — without it the browser navigates to the file.
      onDragOver={(event) => {
        event.preventDefault()
        setDragging(true)
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={(event) => {
        event.preventDefault()
        setDragging(false)
        const file = event.dataTransfer.files?.[0]
        if (file) {
          setMethod('upload')
          void handle(file)
        }
      }}
    >
      <h2 className="text-sm font-medium text-ink">{labels.title}</h2>

      {/* THE METHOD CHOOSER (Phase 6 §4 step 2, spec §16's three ways in).
       *
       * Tabs rather than a select: there are four, they are the first
       * decision on the screen, and a select hides three of them behind a
       * click. Manual is first and selected, because the typed path is the
       * one §9 measures and the one that must not feel like a fallback. */}
      <div role="tablist" className="flex flex-wrap gap-z1">
        {(
          [
            ['manual', labels.methodManual],
            ['upload', labels.methodUpload],
            ['paste', labels.methodPaste],
            ['amazon', labels.methodAmazon],
          ] as const
        ).map(([value, label]) => (
          <button
            key={value}
            type="button"
            role="tab"
            aria-selected={method === value}
            onClick={() => setMethod(value)}
            className={cx(
              'h-control-compact rounded-control px-z3 text-xs font-medium',
              method === value
                ? 'bg-accent-soft text-accent'
                : 'text-ink-2 hover:bg-surface-3',
            )}
          >
            {label}
          </button>
        ))}
      </div>

      {method === 'manual' ? (
        <p className="text-sm text-ink-2">{labels.methodManualHint}</p>
      ) : null}

      {method === 'upload' ? (
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
          <p className="text-xs text-ink-3">{labels.methodDropHint}</p>
        </div>
      ) : null}

      {method === 'paste' ? (
        <div className="flex flex-col gap-z2">
          <textarea
            value={pasted}
            onChange={(event) => setPasted(event.target.value)}
            rows={6}
            placeholder={labels.methodPastePlaceholder}
            className="w-full rounded-control border border-border-strong bg-surface p-z2 text-sm text-ink"
          />
          <div>
            <Button
              type="button"
              variant="secondary"
              disabled={pasted.trim().length < 20 || phase === 'reading'}
              onClick={() => void handleText(pasted)}
            >
              {labels.methodPasteRead}
            </Button>
          </div>
        </div>
      ) : null}

      {method === 'amazon' ? (
        // §3a LANDED HALF OF THIS. The Relay Trips export is a bulk import and
        // therefore a screen of its own — it creates many loads and this form
        // creates one, so the tab points at it rather than pretending a
        // forty-five-row file belongs in a single-load form. The booking
        // sheet, which IS one load, is still §3b's.
        <div className="flex flex-col gap-z2">
          {/* STRAIGHT AT THE ONE SCREEN. This pointed at /loads/import, the
           * one-load-per-row reading, which is wrong for about 95% of this
           * office's files — a tab whose only button was a wrong default. */}
          <Link href="/loads/import/trips" tabIndex={-1}>
            <Button type="button" variant="secondary">
              {labels.methodAmazonImport}
            </Button>
          </Link>
          <p className="text-sm text-ink-2">{labels.methodAmazonSoon}</p>
        </div>
      ) : null}

      <p
        role="status"
        className={cx(
          'text-sm',
          phase === 'failed' ? 'text-danger' : 'text-ink-2',
        )}
      >
        {caption}
      </p>

      {/* The way out, always visible. An offer that looks like a step is a
       * gate, whatever the copy says. */}
      <p className="text-xs text-ink-3">{labels.typeInstead}</p>
    </section>
  )
}

/**
 * What the dispatcher is told when a read fails.
 *
 * THE UPSTREAM'S WORDS ARE NOT A SENTENCE. `body.message` was shown verbatim,
 * so a dispatcher pasting a booking during a Gemini outage read
 *
 *   Gemini returned 503: {"error":{"code":503,"message":"This model is
 *   currently experiencing high demand…","status":"UNAVAILABLE"}}
 *
 * off the screen. That is a stack trace with a nicer font: it names a vendor
 * we do not want them thinking about, it is untranslated in a three-language
 * product, and §10 asks an error to say what happened AND what to do.
 *
 * So the REASON CODE picks the sentence — the codes are ours and finite — and
 * the upstream detail goes to the console, where somebody debugging can still
 * reach it. Anything unrecognised falls back to the caller's own wording
 * rather than inventing a new one.
 */
async function messageOf(response: Response, labels: Labels): Promise<string> {
  let body: { message?: string; error?: string } = {}
  try {
    body = (await response.json()) as typeof body
  } catch {
    // An empty or non-JSON body used to be the WHOLE story — see the route's
    // catch, which no longer lets that happen. Kept because a proxy or an
    // edge failure can still produce one.
    return labels.failed
  }

  if (body.message)
    console.warn(`[zebra.extract] ${body.error}: ${body.message}`)

  switch (body.error) {
    case 'not_readable':
      return labels.failedUnreadable
    case 'unparsable':
    case 'call_failed':
    case 'too_slow':
    case 'extract_failed':
      return labels.failedTryAgain
    case 'not_found':
      return labels.failedMissing
    default:
      return labels.failed
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
