'use client'

import { useActionState, useRef, useState } from 'react'
import Link from 'next/link'
import { Button } from '@/components/ui/Button'
import { Table } from '@/components/ui/Table'
import { remittanceImportAction } from './actions'
import {
  EMPTY_REMITTANCE_IMPORT,
  type RemittanceImportState,
  type RemittanceRowView,
} from './state'

// ---------------------------------------------------------------------------
// PREVIEW THEN CONFIRM, THE SHAPE THE TRIPS IMPORTER USES.
//
// ── THE FILE IS POSTED TWICE, AND THAT IS DELIBERATE ──────────────────────
//
// The trips importer holds the CSV as a string in state and posts it with both
// submits. A workbook is binary, so this keeps the `File` itself in a ref'd
// input and posts the same input both times — the browser re-reads it, and the
// signature check catches a person who swapped the file between the two.
//
// NOTHING IS PARSED IN THE BROWSER. `readRemittance` runs on the server, where
// the refusals live; a client-side peek would be a second reader of the same
// bytes, free to disagree with the one that matters.
// ---------------------------------------------------------------------------

interface Props {
  labels: {
    title: string
    hint: string
    choose: string
    file: string
    preview: string
    confirm: string
    back: string
    invoice: string
    period: string
    carrier: string
    company: string
    total: string
    reference: string
    loads: string
    remitted: string
    rated: string
    outcomeColumn: string
    credit: string
    unmatchedTitle: string
    done: string
    alreadyImported: string
    applied: string
    unapplied: string
    toPayments: string
    stale: string
  }
  translate: Record<string, string>
}

export function RemittanceImportForm({ labels, translate }: Props) {
  const [state, act, pending] = useActionState<RemittanceImportState, FormData>(
    remittanceImportAction,
    EMPTY_REMITTANCE_IMPORT,
  )
  const [fileName, setFileName] = useState('')
  const fileInput = useRef<HTMLInputElement>(null)

  const plan = state.plan
  const done = state.paymentId !== null

  const columns = [
    {
      key: 'reference',
      header: labels.reference,
      render: (row: RemittanceRowView) => (
        <span className="font-mono text-xs">{row.reference}</span>
      ),
    },
    {
      key: 'outcome',
      header: labels.outcomeColumn,
      render: (row: RemittanceRowView) => row.outcomeLabel,
    },
    {
      key: 'loads',
      header: labels.loads,
      render: (row: RemittanceRowView) => (
        <span className="font-mono text-xs">{row.loads}</span>
      ),
    },
    // THE MONEY COLUMNS EXIST ONLY WHERE THE PAYLOAD CARRIES THEM. §1.3 wants
    // the field absent, so the column is absent too — it cannot render what was
    // never sent.
    ...(plan?.showsMoney === true
      ? [
          {
            key: 'remitted',
            header: labels.remitted,
            align: 'end' as const,
            render: (row: RemittanceRowView) => (
              <span className="font-mono tabular-nums">{row.remitted}</span>
            ),
          },
          {
            key: 'rated',
            header: labels.rated,
            align: 'end' as const,
            render: (row: RemittanceRowView) => (
              <span className="font-mono tabular-nums">{row.rated}</span>
            ),
          },
        ]
      : []),
  ]

  return (
    <form action={act} className="flex flex-col gap-z4">
      <div>
        <h1 className="text-lg font-medium text-ink">{labels.title}</h1>
        <p className="mt-z1 max-w-[70ch] text-sm text-ink-3">{labels.hint}</p>
      </div>

      {done ? (
        <section className="flex flex-col gap-z3 rounded-card border border-border bg-surface-2 p-z4">
          <p className="text-sm text-ink">
            {state.alreadyImported
              ? labels.alreadyImported
              : labels.done.replace('{units}', String(state.appliedUnits ?? 0))}
          </p>
          {state.applied ? (
            <p className="text-sm text-ink-2">
              {labels.applied}: {state.applied} · {labels.unapplied}:{' '}
              {state.unapplied}
            </p>
          ) : null}
          <div>
            <Link href="/payments">
              <Button type="button" variant="secondary">
                {labels.toPayments}
              </Button>
            </Link>
          </div>
        </section>
      ) : null}

      {/* THE FILE INPUT STAYS MOUNTED THROUGH THE PREVIEW. Unmounting it would
       * drop the File and the confirm would post an empty field — which the
       * action refuses, but only after the person thought they had confirmed. */}
      {done ? null : (
        <section className="flex flex-col gap-z4 rounded-card border border-border bg-surface-2 p-z4">
          <div className="flex flex-wrap items-center gap-z3">
            <label className="inline-flex h-control-compact cursor-pointer items-center rounded-control border border-border-strong bg-surface px-z3 text-xs font-medium text-ink hover:bg-surface-3">
              {labels.choose}
              <input
                ref={fileInput}
                name="workbook"
                type="file"
                accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                className="sr-only"
                onChange={(event) => {
                  setFileName(event.target.files?.[0]?.name ?? '')
                }}
              />
            </label>
            {fileName ? (
              <p className="text-xs text-ink-3">
                {labels.file}: {fileName}
              </p>
            ) : null}
          </div>

          {plan === null ? (
            <div>
              <Button type="submit" disabled={fileName === '' || pending}>
                {labels.preview}
              </Button>
            </div>
          ) : null}

          {state.error ? (
            <p role="alert" className="text-sm text-danger">
              {translate[state.error] ?? state.error}
            </p>
          ) : null}
          {state.stale ? (
            <p role="alert" className="text-sm text-danger">
              {labels.stale}
            </p>
          ) : null}
        </section>
      )}

      {plan !== null && !done ? (
        <section className="flex flex-col gap-z4">
          <dl className="grid grid-cols-[repeat(auto-fit,minmax(180px,1fr))] gap-z3 rounded-card border border-border bg-surface p-z4 text-sm">
            <div>
              <dt className="text-xs uppercase text-ink-3">{labels.invoice}</dt>
              <dd className="font-mono text-ink">{plan.invoiceNumber}</dd>
            </div>
            <div>
              <dt className="text-xs uppercase text-ink-3">{labels.period}</dt>
              <dd className="text-ink">{plan.workPeriod}</dd>
            </div>
            <div>
              <dt className="text-xs uppercase text-ink-3">{labels.carrier}</dt>
              <dd className="text-ink">{plan.carrier}</dd>
            </div>
            <div>
              <dt className="text-xs uppercase text-ink-3">{labels.company}</dt>
              <dd className="text-ink">{plan.companyName}</dd>
            </div>
            {plan.total ? (
              <div>
                <dt className="text-xs uppercase text-ink-3">{labels.total}</dt>
                <dd className="font-mono tabular-nums text-ink">
                  {plan.total}
                </dd>
              </div>
            ) : null}
          </dl>

          {/* A CREDIT SAYS SO IN WORDS. Its row counts read `unmatched` and
           * `unkeyable`, every word true and all of it an invitation to hunt for
           * a load that was never there. */}
          {plan.isCredit ? (
            <div className="rounded-card border border-border-strong bg-surface-2 p-z3">
              <p className="text-sm text-ink">{labels.credit}</p>
              {plan.creditText ? (
                <p className="mt-z1 font-mono text-xs text-ink-2">
                  {plan.creditText}
                </p>
              ) : null}
            </div>
          ) : null}

          <ul className="flex flex-wrap gap-z3 text-sm text-ink-2">
            {plan.counts
              .filter((count) => count.n > 0)
              .map((count) => (
                <li key={count.label}>
                  {count.n} {count.label}
                </li>
              ))}
          </ul>

          {plan.rows.length > 0 ? (
            <Table
              rows={plan.rows}
              columns={columns}
              rowKey={(row) => `${row.reference}-${row.outcome}`}
              caption={labels.title}
              empty={<p className="text-sm text-ink-2">{labels.title}</p>}
            />
          ) : null}

          {plan.unmatchedReferences.length > 0 ? (
            <p className="text-sm text-ink-2">
              {labels.unmatchedTitle.replace(
                '{refs}',
                plan.unmatchedReferences.join(', '),
              )}
            </p>
          ) : null}

          <input type="hidden" name="signature" value={state.signature ?? ''} />
          <div className="flex flex-wrap gap-z3">
            <Button type="submit" disabled={pending}>
              {labels.confirm}
            </Button>
            <Link href="/payments/import">
              <Button type="button" variant="secondary">
                {labels.back}
              </Button>
            </Link>
          </div>
        </section>
      ) : null}
    </form>
  )
}
