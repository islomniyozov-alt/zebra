'use client'

import { useActionState, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { Select, type SelectOption } from '@/components/ui/Select'
import { StatusBadge } from '@/components/ui/StatusBadge'
import { uploadDocument, type UploadPhase } from '@/lib/upload-client'
import { cx } from '@/lib/cx'
import { recordRenewalAction } from './compliance-actions'
import { COMPLIANCE_INITIAL, type ComplianceState } from './compliance-state'
import type { ComplianceSubject } from '@/lib/compliance'
import type { StatusTone } from '@/lib/status'

// PHASE 4 §5 STEP 2 — the compliance panel on an asset.
//
// The queue answers "what needs doing across the fleet". This answers "what is
// the paperwork on THIS truck", which is the question somebody asks with an
// auditor on the phone — so it shows EVERYTHING, current and expired and
// superseded, newest expiry first.
//
// A RENEWAL IS A NEW ROW (§2.1). There is no edit control anywhere on this
// panel and there should not be one: the old registration is the evidence that
// the truck was legal last March, and editing it in place destroys that. The
// superseded rows stay visible, dimmed and labelled.
//
// The document goes on AFTER the record exists, because the upload pipeline
// mints a URL against an entity that has to be there already. That is the
// pipeline's real shape rather than a limitation worked around — and it means
// the certificate is attached to the specific renewal it belongs to, not to
// the truck in general.

export interface ComplianceRowView {
  id: string
  type: string
  typeLabel: string
  identifier: string | null
  issuer: string | null
  issued: string | null
  expires: string
  /** "in 14 days", "today", "40 days ago" — rendered by the server. */
  when: string
  status: 'current' | 'expiring' | 'expired'
  isSuperseded: boolean
  documents: { id: string; filename: string }[]
}

const TONE: Record<ComplianceRowView['status'], StatusTone> = {
  current: 'success',
  expiring: 'warning',
  expired: 'danger',
}

interface Props {
  subject: ComplianceSubject
  subjectId: string
  rows: readonly ComplianceRowView[]
  types: readonly SelectOption[]
  /** Which DocumentType each compliance type files under. */
  documentTypeFor: Record<string, string>
  mayRenew: boolean
  today: string
  translate: Record<string, string>
  labels: {
    title: string
    hint: string
    none: string
    add: string
    type: string
    identifier: string
    issuer: string
    issued: string
    expires: string
    expiresHint: string
    notes: string
    save: string
    superseded: string
    attach: string
    preparing: string
    uploading: string
    failed: string
    statusCurrent: string
    statusExpiring: string
    statusExpired: string
  }
}

export function CompliancePanel({
  subject,
  subjectId,
  rows,
  types,
  documentTypeFor,
  mayRenew,
  today,
  translate,
  labels,
}: Props) {
  const [state, act, pending] = useActionState<ComplianceState, FormData>(
    recordRenewalAction.bind(null, subject, subjectId),
    COMPLIANCE_INITIAL,
  )

  const statusLabel = {
    current: labels.statusCurrent,
    expiring: labels.statusExpiring,
    expired: labels.statusExpired,
  }

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
              className={cx(
                'flex flex-wrap items-baseline gap-x-z3 gap-y-z1 border-b border-border py-z2 text-sm last:border-b-0',
                // Superseded rows are HISTORY: dimmed so the live ones read
                // first, kept so nothing looks deleted.
                row.isSuperseded && 'opacity-60',
              )}
            >
              <span className="font-medium text-ink">{row.typeLabel}</span>
              <StatusBadge
                tone={row.isSuperseded ? 'muted' : TONE[row.status]}
                label={
                  row.isSuperseded ? labels.superseded : statusLabel[row.status]
                }
              />
              <span className="font-mono text-xs text-ink">
                {row.expires}
                {row.isSuperseded ? null : (
                  <span className="text-ink-3"> · {row.when}</span>
                )}
              </span>
              {row.identifier ? (
                <span className="font-mono text-xs text-ink-2">
                  {row.identifier}
                </span>
              ) : null}
              {row.issuer ? (
                <span className="text-ink-3">{row.issuer}</span>
              ) : null}

              <span className="ms-auto flex items-center gap-z2">
                {row.documents.map((document) => (
                  <DocumentLink
                    key={document.id}
                    id={document.id}
                    filename={document.filename}
                    failedLabel={labels.failed}
                  />
                ))}
                {mayRenew ? (
                  <AttachDocument
                    recordId={row.id}
                    documentType={documentTypeFor[row.type] ?? 'OTHER'}
                    labels={{
                      attach: labels.attach,
                      preparing: labels.preparing,
                      uploading: labels.uploading,
                      failed: labels.failed,
                    }}
                  />
                ) : null}
              </span>
            </li>
          ))}
        </ul>
      )}

      {mayRenew ? (
        <form action={act} className="mt-z4 flex flex-col gap-z3">
          <h3 className="text-sm font-medium text-ink-2">{labels.add}</h3>

          <div className="grid grid-cols-[repeat(auto-fit,minmax(180px,1fr))] gap-z3">
            <Select name="type" label={labels.type} required options={types} />
            <Input
              name="expiresAt"
              label={labels.expires}
              hint={labels.expiresHint}
              required
              defaultValue={today}
              inputMode="numeric"
            />
            <Input name="issuedAt" label={labels.issued} inputMode="numeric" />
            <Input name="identifier" label={labels.identifier} />
            <Input name="issuer" label={labels.issuer} />
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

/**
 * A document link that fetches its own signed URL on click.
 *
 * The URL is short-lived and minted per request, so it cannot be rendered into
 * the page ahead of time — the same pattern the load screen's documents use.
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

function AttachDocument({
  recordId,
  documentType,
  labels,
}: {
  recordId: string
  documentType: string
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
      className={cx(
        'cursor-pointer text-xs',
        phase === 'failed' ? 'text-danger' : 'text-ink-3 hover:text-accent',
      )}
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
                entity: 'complianceItem',
                entityId: recordId,
                documentType,
              },
              (progress) => setPhase(progress.phase),
            )
            setPhase('done')
            // The row's document list is server-rendered, so the page has to
            // re-read before the new certificate appears next to it.
            router.refresh()
          } catch {
            setPhase('failed')
          }
        }}
      />
    </label>
  )
}
