'use client'

import { useActionState, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { Select, type SelectOption } from '@/components/ui/Select'
import { uploadDocument, type UploadPhase } from '@/lib/upload-client'
import { recordWorkOrderAction } from './maintenance-actions'
import { MAINTENANCE_INITIAL, type MaintenanceState } from './maintenance-state'
import type { MaintenanceSubject } from '@/lib/maintenance'

// PHASE 4 §5 STEP 3 — the maintenance panel on an asset.
//
// A service history, newest first, with a running total underneath it. The
// total is the point: the question this screen exists to answer is "what has
// this tractor cost us", and a list of dates does not answer it.
//
// THE COST COLUMN IS ABSENT, NOT BLANK, for a role that cannot see money —
// `costCents` never leaves the server for a DISPATCHER, and the totals block
// is not rendered because there is nothing to total. A column of dashes would
// tell them exactly how many numbers they were not being shown.
//
// Receipts go on AFTER the work order exists, same as the compliance panel:
// the upload pipeline mints a URL against an entity that must already be there,
// which is also what attaches the receipt to the specific service rather than
// to the truck in general.

export interface WorkOrderRowView {
  id: string
  categoryLabel: string
  description: string | null
  vendorName: string | null
  serviced: string
  odometer: string | null
  /** Already formatted; absent for a role without `truck.financials:read`. */
  cost?: string
  next: string | null
  documents: { id: string; filename: string }[]
}

interface Props {
  subject: MaintenanceSubject
  subjectId: string
  rows: readonly WorkOrderRowView[]
  categories: readonly SelectOption[]
  /** Formatted running totals, absent where costs are not visible. */
  totals?: {
    cost: string
    perMile: string | null
    span: string | null
  }
  mayRecord: boolean
  mayAttach: boolean
  today: string
  translate: Record<string, string>
  labels: {
    title: string
    hint: string
    none: string
    add: string
    category: string
    serviced: string
    servicedHint: string
    odometer: string
    vendor: string
    description: string
    cost: string
    costHint: string
    nextService: string
    nextOdometer: string
    notes: string
    save: string
    // The three money labels travel only when the totals do. A label is not a
    // field, so leaving them in would not leak a number — but "Spent on this
    // asset" sitting unused in a dispatcher's payload still announces a figure
    // they are not being shown, and there is no reason to send it.
    total?: string
    perMile?: string
    over?: string
    nextDue: string
    attach: string
    preparing: string
    uploading: string
    failed: string
  }
}

export function MaintenancePanel({
  subject,
  subjectId,
  rows,
  categories,
  totals,
  mayRecord,
  mayAttach,
  today,
  translate,
  labels,
}: Props) {
  const [state, act, pending] = useActionState<MaintenanceState, FormData>(
    recordWorkOrderAction.bind(null, subject, subjectId),
    MAINTENANCE_INITIAL,
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
              <span className="font-mono text-xs text-ink-2">
                {row.serviced}
              </span>
              <span className="font-medium text-ink">{row.categoryLabel}</span>
              {row.description ? (
                <span className="text-ink-2">{row.description}</span>
              ) : null}
              {row.vendorName ? (
                <span className="text-ink-3">{row.vendorName}</span>
              ) : null}
              {row.odometer ? (
                <span className="font-mono text-xs text-ink-3">
                  {row.odometer}
                </span>
              ) : null}
              {row.next ? (
                <span className="text-xs text-ink-3">
                  {labels.nextDue} {row.next}
                </span>
              ) : null}

              <span className="ms-auto flex items-center gap-z3">
                {row.documents.map((document) => (
                  <DocumentLink
                    key={document.id}
                    id={document.id}
                    filename={document.filename}
                    failedLabel={labels.failed}
                  />
                ))}
                {mayAttach ? (
                  <AttachReceipt
                    recordId={row.id}
                    labels={{
                      attach: labels.attach,
                      preparing: labels.preparing,
                      uploading: labels.uploading,
                      failed: labels.failed,
                    }}
                  />
                ) : null}
                {/* Absent, not blank — see the note at the top of the file. */}
                {row.cost === undefined ? null : (
                  <span className="font-mono tabular-nums text-ink">
                    {row.cost}
                  </span>
                )}
              </span>
            </li>
          ))}
        </ul>
      )}

      {totals ? (
        <dl className="mt-z3 flex flex-wrap items-baseline gap-x-z5 gap-y-z1 border-t border-border pt-z3 text-sm">
          <div className="flex items-baseline gap-z2">
            <dt className="text-ink-3">{labels.total}</dt>
            <dd className="font-mono tabular-nums font-medium text-ink">
              {totals.cost}
            </dd>
          </div>
          {totals.perMile ? (
            <div className="flex items-baseline gap-z2">
              <dt className="text-ink-3">{labels.perMile}</dt>
              <dd className="font-mono tabular-nums text-ink">
                {totals.perMile}
                {totals.span ? (
                  <span className="text-ink-3">
                    {' '}
                    {labels.over} {totals.span}
                  </span>
                ) : null}
              </dd>
            </div>
          ) : null}
        </dl>
      ) : null}

      {mayRecord ? (
        <form action={act} className="mt-z4 flex flex-col gap-z3">
          <h3 className="text-sm font-medium text-ink-2">{labels.add}</h3>

          <div className="grid grid-cols-[repeat(auto-fit,minmax(180px,1fr))] gap-z3">
            <Select
              name="category"
              label={labels.category}
              required
              options={categories}
            />
            <Input
              name="servicedAt"
              label={labels.serviced}
              hint={labels.servicedHint}
              required
              defaultValue={today}
              inputMode="numeric"
            />
            <Input
              name="odometer"
              label={labels.odometer}
              inputMode="numeric"
            />
            <Input
              name="cost"
              label={labels.cost}
              hint={labels.costHint}
              inputMode="decimal"
            />
            <Input name="vendorName" label={labels.vendor} />
            <Input name="description" label={labels.description} />
            <Input
              name="nextServiceAt"
              label={labels.nextService}
              inputMode="numeric"
            />
            <Input
              name="nextServiceOdometer"
              label={labels.nextOdometer}
              inputMode="numeric"
            />
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
 * the page ahead of time — the same pattern the load and compliance documents
 * use.
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

function AttachReceipt({
  recordId,
  labels,
}: {
  recordId: string
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
                // `maintenance`, the TARGETS key — which maps to the
                // `maintenanceRecord` delegate. The two are deliberately not
                // the same string; see documents.ts.
                entity: 'maintenance',
                entityId: recordId,
                documentType: 'MAINTENANCE_RECEIPT',
              },
              (progress) => setPhase(progress.phase),
            )
            setPhase('done')
            // The row's receipts are server-rendered, so the page has to
            // re-read before the new one appears next to it.
            router.refresh()
          } catch {
            setPhase('failed')
          }
        }}
      />
    </label>
  )
}
