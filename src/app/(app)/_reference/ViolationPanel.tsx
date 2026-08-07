'use client'

import { useActionState, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { Select, type SelectOption } from '@/components/ui/Select'
import { StatusBadge } from '@/components/ui/StatusBadge'
import { uploadDocument, type UploadPhase } from '@/lib/upload-client'
import {
  addViolationAction,
  withdrawViolationAction,
} from './inspection-actions'
import { INSPECTION_INITIAL, type InspectionState } from './inspection-state'

// PHASE 4 §5 STEP 4 — the violations on one inspection.
//
// One line each, the way they read off the report, out-of-service first. The
// OOS flag lives on the VIOLATION and not on the inspection because that is
// where the officer writes it, and because step 5's DataQs challenge has to be
// able to say which violation it is challenging.
//
// WITHDRAWING IS FOR A TYPO AND SAYS SO. A violation the carrier challenges and
// wins keeps its row — the outcome is recorded on the challenge, so the history
// still shows what was written and what happened to it. The hint under the
// control is the only place that distinction can be made where somebody will
// read it.

export interface ViolationRowView {
  id: string
  code: string
  description: string | null
  unitLabel: string
  outOfService: boolean
  severityWeight: number | null
}

interface Props {
  inspectionId: string
  rows: readonly ViolationRowView[]
  units: readonly SelectOption[]
  documents: readonly { id: string; filename: string }[]
  mayEdit: boolean
  mayAttach: boolean
  translate: Record<string, string>
  labels: {
    title: string
    none: string
    add: string
    code: string
    codeHint: string
    description: string
    unit: string
    oos: string
    weight: string
    weightHint: string
    save: string
    withdraw: string
    withdrawnHint: string
    report: string
    attach: string
    preparing: string
    uploading: string
    failed: string
  }
}

export function ViolationPanel({
  inspectionId,
  rows,
  units,
  documents,
  mayEdit,
  mayAttach,
  translate,
  labels,
}: Props) {
  const [state, act, pending] = useActionState<InspectionState, FormData>(
    addViolationAction.bind(null, inspectionId),
    INSPECTION_INITIAL,
  )

  return (
    <section className="rounded-card border border-border bg-surface p-z4">
      <div className="flex flex-wrap items-baseline justify-between gap-z3">
        <h2 className="text-md font-medium text-ink">{labels.title}</h2>
        <span className="flex items-center gap-z3">
          <span className="text-xs text-ink-3">{labels.report}</span>
          {documents.map((document) => (
            <DocumentLink
              key={document.id}
              id={document.id}
              filename={document.filename}
              failedLabel={labels.failed}
            />
          ))}
          {mayAttach ? (
            <AttachReport
              inspectionId={inspectionId}
              labels={{
                attach: labels.attach,
                preparing: labels.preparing,
                uploading: labels.uploading,
                failed: labels.failed,
              }}
            />
          ) : null}
        </span>
      </div>

      {rows.length === 0 ? (
        <p className="mt-z3 max-w-[68ch] text-sm text-ink-2">{labels.none}</p>
      ) : (
        <ul className="mt-z3 flex flex-col">
          {rows.map((row) => (
            <li
              key={row.id}
              className="flex flex-wrap items-baseline gap-x-z3 gap-y-z1 border-b border-border py-z2 text-sm last:border-b-0"
            >
              {/* Never truncated: the code is what goes into a DataQs form. */}
              <span className="font-mono font-medium text-ink">{row.code}</span>
              {row.outOfService ? (
                <StatusBadge tone="danger" label={labels.oos} />
              ) : null}
              <span className="text-ink-3">{row.unitLabel}</span>
              {row.description ? (
                <span className="text-ink-2">{row.description}</span>
              ) : null}
              {row.severityWeight === null ? null : (
                <span className="font-mono text-xs text-ink-3">
                  {labels.weight} {row.severityWeight}
                </span>
              )}
              {mayEdit ? (
                <form
                  action={withdrawViolationAction.bind(
                    null,
                    inspectionId,
                    row.id,
                  )}
                  className="ms-auto"
                >
                  {/* Ghost, not danger-coloured accent — standing rule 11 keeps
                   * the blue button the safe one. */}
                  <Button type="submit" variant="ghost" size="compact">
                    {labels.withdraw}
                  </Button>
                </form>
              ) : null}
            </li>
          ))}
        </ul>
      )}

      {mayEdit ? (
        <>
          <form action={act} className="mt-z4 flex flex-col gap-z3">
            <h3 className="text-sm font-medium text-ink-2">{labels.add}</h3>

            <div className="grid grid-cols-[repeat(auto-fit,minmax(180px,1fr))] gap-z3">
              <Input
                name="code"
                label={labels.code}
                hint={labels.codeHint}
                identifier
                required
              />
              <Input name="description" label={labels.description} />
              <Select name="unit" label={labels.unit} options={units} />
              <Input
                name="severityWeight"
                label={labels.weight}
                hint={labels.weightHint}
                inputMode="numeric"
              />
            </div>

            <label className="flex items-center gap-z2 text-sm text-ink">
              <input
                type="checkbox"
                name="outOfService"
                className="size-4 accent-danger"
              />
              {labels.oos}
            </label>

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

          <p className="mt-z3 max-w-[68ch] text-xs text-ink-3">
            {labels.withdrawnHint}
          </p>
        </>
      ) : null}
    </section>
  )
}

/**
 * A document link that fetches its own signed URL on click.
 *
 * The URL is short-lived and minted per request, so it cannot be rendered into
 * the page ahead of time — the same pattern every other document link uses.
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

function AttachReport({
  inspectionId,
  labels,
}: {
  inspectionId: string
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
                // `inspection`, the TARGETS key — which maps to the
                // `roadsideInspection` delegate. See documents.ts.
                entity: 'inspection',
                entityId: inspectionId,
                documentType: 'INSPECTION_REPORT',
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
