'use client'

import { useActionState, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { Select, type SelectOption } from '@/components/ui/Select'
import { uploadDocument, type UploadPhase } from '@/lib/upload-client'
import {
  addClaimNoteAction,
  addClaimPartyAction,
  moveClaimAction,
  removeClaimPartyAction,
} from './claim-actions'
import { CLAIM_INITIAL, type ClaimState } from './claim-state'

// PHASE 4 §5 STEP 5 — the three panels on a claim.
//
// PARTIES, because a cargo claim has a claimant, our insurer, their adjuster
// and sometimes a lawyer, each with a reference number that is not ours.
//
// TIMELINE, carrying notes and status changes in ONE list. They are the same
// kind of event to whoever reads the history — "denied on the 8th, appealed on
// the 11th" is one story — and two lists would have to be merged by hand.
// Nothing on it is edited or deleted; the panel offers no control to do either.
//
// THE LADDER, which offers only the moves the service would accept. Where a
// claim can go depends on where it is, and a select full of refusals teaches
// people that the screen is guessing.

export interface PartyRowView {
  id: string
  roleLabel: string
  name: string
  phone: string | null
  email: string | null
  reference: string | null
  notes: string | null
}

export interface TimelineRowView {
  id: string
  when: string
  body: string | null
  /** "Open → Disputed", or "Opened" for the first row. Rendered by the server. */
  movement: string | null
  authorName: string | null
}

// --- parties -----------------------------------------------------------------

export function ClaimParties({
  claimId,
  rows,
  roles,
  mayWrite,
  translate,
  labels,
}: {
  claimId: string
  rows: readonly PartyRowView[]
  roles: readonly SelectOption[]
  mayWrite: boolean
  translate: Record<string, string>
  labels: {
    title: string
    hint: string
    none: string
    add: string
    role: string
    name: string
    phone: string
    email: string
    reference: string
    notes: string
    save: string
    remove: string
  }
}) {
  const [state, act, pending] = useActionState<ClaimState, FormData>(
    addClaimPartyAction.bind(null, claimId),
    CLAIM_INITIAL,
  )

  return (
    <section className="rounded-card border border-border bg-surface p-z4">
      <h2 className="text-md font-medium text-ink">{labels.title}</h2>
      <p className="mt-z1 max-w-[68ch] text-sm text-ink-3">{labels.hint}</p>

      {rows.length === 0 ? (
        <p className="mt-z3 text-sm text-ink-2">{labels.none}</p>
      ) : (
        <ul className="mt-z3 flex flex-col">
          {rows.map((row) => (
            <li
              key={row.id}
              className="flex flex-wrap items-baseline gap-x-z3 gap-y-z1 border-b border-border py-z2 text-sm last:border-b-0"
            >
              <span className="text-ink-3">{row.roleLabel}</span>
              <span className="font-medium text-ink">{row.name}</span>
              {row.reference ? (
                // Never truncated: their reference is what goes in a subject
                // line, and it is never our claim number.
                <span className="font-mono text-xs text-ink-2">
                  {row.reference}
                </span>
              ) : null}
              {row.phone ? (
                <span className="font-mono text-xs text-ink-3">
                  {row.phone}
                </span>
              ) : null}
              {row.email ? (
                <span className="text-xs text-ink-3">{row.email}</span>
              ) : null}
              {row.notes ? (
                <span className="text-ink-3">{row.notes}</span>
              ) : null}
              {mayWrite ? (
                <form
                  action={removeClaimPartyAction.bind(null, claimId, row.id)}
                  className="ms-auto"
                >
                  <Button type="submit" variant="ghost" size="compact">
                    {labels.remove}
                  </Button>
                </form>
              ) : null}
            </li>
          ))}
        </ul>
      )}

      {mayWrite ? (
        <form action={act} className="mt-z4 flex flex-col gap-z3">
          <h3 className="text-sm font-medium text-ink-2">{labels.add}</h3>
          <div className="grid grid-cols-[repeat(auto-fit,minmax(170px,1fr))] gap-z3">
            <Select name="role" label={labels.role} options={roles} />
            <Input name="name" label={labels.name} required />
            <Input name="reference" label={labels.reference} />
            <Input name="phone" label={labels.phone} inputMode="tel" />
            <Input name="email" label={labels.email} inputMode="email" />
            <Input name="notes" label={labels.notes} />
          </div>
          <div className="flex items-center gap-z3">
            <Button type="submit" variant="secondary" disabled={pending}>
              {labels.save}
            </Button>
            {state.error ? (
              <p role="alert" className="text-sm text-danger">
                {translate[state.error] ?? state.error}
              </p>
            ) : null}
          </div>
        </form>
      ) : null}
    </section>
  )
}

// --- timeline ----------------------------------------------------------------

export function ClaimTimeline({
  claimId,
  rows,
  mayWrite,
  translate,
  labels,
}: {
  claimId: string
  rows: readonly TimelineRowView[]
  mayWrite: boolean
  translate: Record<string, string>
  labels: {
    title: string
    hint: string
    none: string
    add: string
    body: string
    save: string
    by: string
  }
}) {
  const [state, act, pending] = useActionState<ClaimState, FormData>(
    addClaimNoteAction.bind(null, claimId),
    CLAIM_INITIAL,
  )

  return (
    <section className="rounded-card border border-border bg-surface p-z4">
      <h2 className="text-md font-medium text-ink">{labels.title}</h2>
      <p className="mt-z1 max-w-[68ch] text-sm text-ink-3">{labels.hint}</p>

      {rows.length === 0 ? (
        <p className="mt-z3 text-sm text-ink-2">{labels.none}</p>
      ) : (
        <ol className="mt-z3 flex flex-col">
          {rows.map((row) => (
            <li
              key={row.id}
              className="flex flex-col gap-z1 border-b border-border py-z2 text-sm last:border-b-0"
            >
              <div className="flex flex-wrap items-baseline gap-x-z3 gap-y-z1">
                <span className="font-mono text-xs text-ink-2">{row.when}</span>
                {row.movement ? (
                  <span className="font-medium text-ink">{row.movement}</span>
                ) : null}
                {row.authorName ? (
                  <span className="text-xs text-ink-3">
                    {labels.by} {row.authorName}
                  </span>
                ) : null}
              </div>
              {row.body ? (
                <p className="max-w-[68ch] text-ink-2">{row.body}</p>
              ) : null}
            </li>
          ))}
        </ol>
      )}

      {mayWrite ? (
        <form action={act} className="mt-z4 flex flex-col gap-z3">
          <Input name="body" label={labels.body} required />
          <div className="flex items-center gap-z3">
            <Button type="submit" variant="secondary" disabled={pending}>
              {labels.save}
            </Button>
            {state.error ? (
              <p role="alert" className="text-sm text-danger">
                {translate[state.error] ?? state.error}
              </p>
            ) : null}
          </div>
        </form>
      ) : null}
    </section>
  )
}

// --- the ladder --------------------------------------------------------------

export function ClaimMove({
  claimId,
  nextStatuses,
  translate,
  labels,
}: {
  claimId: string
  /** Exactly the moves the service would accept. Empty once closed. */
  nextStatuses: readonly SelectOption[]
  translate: Record<string, string>
  labels: {
    title: string
    hint: string
    to: string
    note: string
    paid: string
    resolution: string
    save: string
    closed: string
  }
}) {
  const [state, act, pending] = useActionState<ClaimState, FormData>(
    moveClaimAction.bind(null, claimId),
    CLAIM_INITIAL,
  )

  return (
    <section className="rounded-card border border-border bg-surface p-z4">
      <h2 className="text-md font-medium text-ink">{labels.title}</h2>
      <p className="mt-z1 max-w-[68ch] text-sm text-ink-3">{labels.hint}</p>

      {nextStatuses.length === 0 ? (
        // Closed. No control at all rather than a disabled one — the ladder is
        // empty and a greyed select still invites the click.
        <p className="mt-z3 text-sm text-ink-2">{labels.closed}</p>
      ) : (
        <form action={act} className="mt-z3 flex flex-col gap-z3">
          <div className="grid grid-cols-[repeat(auto-fit,minmax(180px,1fr))] gap-z3">
            <Select name="to" label={labels.to} options={nextStatuses} />
            <Input name="amountPaid" label={labels.paid} inputMode="decimal" />
            <Input name="resolution" label={labels.resolution} />
            <Input name="note" label={labels.note} />
          </div>
          <div className="flex items-center gap-z3">
            <Button type="submit" variant="secondary" disabled={pending}>
              {labels.save}
            </Button>
            {state.error ? (
              <p role="alert" className="text-sm text-danger">
                {translate[state.error] ?? state.error}
              </p>
            ) : null}
          </div>
        </form>
      )}
    </section>
  )
}

// --- documents ---------------------------------------------------------------

export function ClaimDocuments({
  claimId,
  documents,
  mayAttach,
  labels,
}: {
  claimId: string
  documents: readonly { id: string; filename: string }[]
  mayAttach: boolean
  labels: {
    title: string
    attach: string
    preparing: string
    uploading: string
    failed: string
  }
}) {
  return (
    <section className="rounded-card border border-border bg-surface p-z4">
      <div className="flex flex-wrap items-baseline justify-between gap-z3">
        <h2 className="text-md font-medium text-ink">{labels.title}</h2>
        <span className="flex items-center gap-z3">
          {documents.map((document) => (
            <DocumentLink
              key={document.id}
              id={document.id}
              filename={document.filename}
              failedLabel={labels.failed}
            />
          ))}
          {mayAttach ? (
            <AttachToClaim claimId={claimId} labels={labels} />
          ) : null}
        </span>
      </div>
    </section>
  )
}

/**
 * A document link that fetches its own signed URL on click.
 *
 * The URL is short-lived and minted per request, so it cannot be rendered into
 * the page ahead of time — the pattern every document link in the app uses.
 */
function DocumentLink({
  id,
  filename,
  failedLabel,
}: {
  id: string
  filename: string
  failedLabel: string
}) {
  const [failed, setFailed] = useState(false)

  return (
    <button
      type="button"
      className="font-mono text-xs text-accent hover:underline"
      onClick={async () => {
        try {
          const response = await fetch(`/api/documents/${id}/download-url`)
          if (!response.ok) throw new Error(String(response.status))
          const { url } = (await response.json()) as { url: string }
          window.open(url, '_blank', 'noopener')
        } catch {
          setFailed(true)
        }
      }}
    >
      {failed ? failedLabel : filename}
    </button>
  )
}

function AttachToClaim({
  claimId,
  labels,
}: {
  claimId: string
  labels: {
    attach: string
    preparing: string
    uploading: string
    failed: string
  }
}) {
  const router = useRouter()
  const [phase, setPhase] = useState<UploadPhase>('idle')

  const caption =
    phase === 'preparing'
      ? labels.preparing
      : phase === 'uploading'
        ? labels.uploading
        : phase === 'failed'
          ? labels.failed
          : labels.attach

  return (
    <label
      className={
        phase === 'failed'
          ? 'cursor-pointer text-xs text-danger'
          : 'cursor-pointer text-xs text-ink-3 hover:text-accent'
      }
    >
      {caption}
      <input
        type="file"
        className="sr-only"
        onChange={async (event) => {
          const file = event.target.files?.[0]
          if (!file) return
          try {
            await uploadDocument(
              file,
              {
                entity: 'claim',
                entityId: claimId,
                // Photographs and letters, mostly. `OTHER` rather than a type
                // invented for this screen — the enum is not this step's to
                // widen.
                documentType: 'OTHER',
              },
              (progress) => setPhase(progress.phase),
            )
            setPhase('done')
            router.refresh()
          } catch {
            setPhase('failed')
          }
        }}
      />
    </label>
  )
}
