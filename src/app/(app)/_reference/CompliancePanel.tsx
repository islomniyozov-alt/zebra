'use client'

import { useActionState } from 'react'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { Select, type SelectOption } from '@/components/ui/Select'
import { StatusBadge } from '@/components/ui/StatusBadge'
import { AttachDocument, DocumentLink } from './DocumentControls'
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

  const typed = state.values

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
          {/* §0 rule 14: a refused save keeps what was typed. React resets an
           * action form after the action; these defaults are the typed
           * values on a refusal, so the reset lands on them, not on blanks. */}
          <h3 className="text-sm font-medium text-ink-2">{labels.add}</h3>

          <div className="grid grid-cols-[repeat(auto-fit,minmax(180px,1fr))] gap-z3">
            <Select
              name="type"
              label={labels.type}
              required
              options={types}
              defaultValue={typed?.type}
            />
            <Input
              name="expiresAt"
              label={labels.expires}
              hint={labels.expiresHint}
              required
              defaultValue={typed?.expiresAt ?? today}
              inputMode="numeric"
            />
            <Input
              name="issuedAt"
              label={labels.issued}
              inputMode="numeric"
              defaultValue={typed?.issuedAt}
            />
            <Input
              name="identifier"
              label={labels.identifier}
              defaultValue={typed?.identifier}
            />
            <Input
              name="issuer"
              label={labels.issuer}
              defaultValue={typed?.issuer}
            />
            <Input
              name="notes"
              label={labels.notes}
              defaultValue={typed?.notes}
            />
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
