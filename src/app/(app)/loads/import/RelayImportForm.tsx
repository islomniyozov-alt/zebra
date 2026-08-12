'use client'

import { useActionState, useRef, useState } from 'react'
import Link from 'next/link'
import { Button } from '@/components/ui/Button'
import { Select } from '@/components/ui/Select'
import { Table, type Column } from '@/components/ui/Table'
import { cx } from '@/lib/cx'
import { relayImportAction } from './actions'
import { EMPTY_IMPORT, type PlanRowView, type SkipView } from './state'

// ---------------------------------------------------------------------------
// THE IMPORT SCREEN (Phase 6 §3a).
//
// THE FILE IS READ IN THE BROWSER, as text, and posted as text. Not because
// uploading it would be hard — Phase 5's mint does exactly that for PDFs — but
// because a Relay export is a page of columns and nothing about it needs to be
// STORED. The rate confirmation is kept because it is the contract; a CSV of
// planned times is a courier. Reading it here means no R2 object, no pending
// row to reconcile and nothing to clean up when somebody changes their mind at
// the preview.
//
// THE PREVIEW IS THE REVIEW SCREEN, and it is the one place in this
// application that has one. §1's ruling — the form IS the review — was about a
// single prefilled load a dispatcher is looking at field by field. Forty-five
// loads written by one click cannot be reviewed that way, so the list of what
// WILL be created is shown first, with everything that will be skipped and why
// beneath it.
// ---------------------------------------------------------------------------

interface Labels {
  authority: string
  mode: string
  modeBooked: string
  modeBookedHint: string
  modeDelivered: string
  modeDeliveredHint: string
  choose: string
  file: string
  preview: string
  previewTitle: string
  previewOne: string
  previewNone: string
  confirm: string
  back: string
  row: string
  loadId: string
  lane: string
  stops: string
  first: string
  last: string
  miles: string
  rate: string
  skippedTitle: string
  warningsTitle: string
  done: string
  doneFailed: string
  stale: string
  toLoads: string
  noFile: string
  why: string
}

export function RelayImportForm({
  companies,
  defaultCompanyId,
  labels,
}: {
  companies: readonly { id: string; name: string }[]
  defaultCompanyId: string
  labels: Labels
}) {
  const [state, submit, pending] = useActionState(
    relayImportAction,
    EMPTY_IMPORT,
  )
  const [csv, setCsv] = useState('')
  const [fileName, setFileName] = useState('')
  const [mode, setMode] = useState<'booked' | 'delivered'>('booked')
  const [companyId, setCompanyId] = useState(defaultCompanyId)
  // Cleared after a run so the same file cannot be chosen twice by accident
  // without re-picking it.
  const fileInput = useRef<HTMLInputElement>(null)
  // THE PREVIEW IS SERVER STATE AND DOES NOT CLEAR ITSELF. `useActionState`
  // holds the last result until the next submit, so "choose a different file"
  // emptied the textarea and left the old plan on screen — a list of loads
  // above a confirm button, with no file behind either. This is the local
  // "I am done looking at that" flag, dropped again the moment a new submit
  // starts.
  const [dismissed, setDismissed] = useState(false)

  const plan = dismissed ? null : state.plan
  const done = state.created !== null

  return (
    <form
      action={submit}
      onSubmit={() => setDismissed(false)}
      className="flex flex-col gap-z4"
    >
      {/* Posted on every submit, so the confirm re-parses the SAME text the
       * preview was built from rather than trusting a plan that came back
       * from the browser. */}
      <input type="hidden" name="csv" value={csv} />
      <input type="hidden" name="companyId" value={companyId} />
      <input type="hidden" name="mode" value={mode} />

      {done ? (
        <section className="flex flex-col items-start gap-z3 rounded-card border border-border bg-surface-2 p-z4">
          <p className="text-sm text-ink">
            {(state.failed ? labels.doneFailed : labels.done)
              .replace('{created}', String(state.created))
              .replace('{failed}', String(state.failed ?? 0))}
          </p>
          <Link href="/loads">
            <Button type="button" variant="secondary">
              {labels.toLoads}
            </Button>
          </Link>
        </section>
      ) : null}

      {!done && plan === null ? (
        <section className="flex flex-col gap-z4 rounded-card border border-border bg-surface-2 p-z4">
          {/* AUTHORITY IS FIELD 1 — Zebra's standing rule, and it decides
           * which carrier's load-number series these forty-five loads take. */}
          <Select
            label={labels.authority}
            value={companyId}
            onChange={(event) => setCompanyId(event.target.value)}
            options={companies.map((company) => ({
              value: company.id,
              label: company.name,
            }))}
          />

          {/* THE TWO BUTTONS. Radios rather than a select: they are not two
           * settings of one thing, they read different columns and end in
           * different states, and both need their sentence visible at once. */}
          <fieldset className="flex flex-col gap-z2">
            <legend className="text-sm font-medium text-ink-2">
              {labels.mode}
            </legend>
            {(
              [
                ['booked', labels.modeBooked, labels.modeBookedHint],
                ['delivered', labels.modeDelivered, labels.modeDeliveredHint],
              ] as const
            ).map(([value, label, hint]) => (
              <label
                key={value}
                className={cx(
                  'flex cursor-pointer items-start gap-z2 rounded-control border p-z3',
                  mode === value
                    ? 'border-accent bg-accent-soft'
                    : 'border-border-strong bg-surface',
                )}
              >
                <input
                  type="radio"
                  name="modeChoice"
                  checked={mode === value}
                  onChange={() => setMode(value)}
                  className="mt-1"
                />
                <span className="flex flex-col gap-z1">
                  <span className="text-sm font-medium text-ink">{label}</span>
                  <span className="text-xs text-ink-3">{hint}</span>
                </span>
              </label>
            ))}
          </fieldset>

          <div className="flex flex-wrap items-center gap-z3">
            {/* A label wrapping the input, styled as the secondary button —
             * the same shape the rate-con chooser uses, for the same reason:
             * a file input has no accessible way to be a <button>. */}
            <label className="inline-flex h-control-compact cursor-pointer items-center rounded-control border border-border-strong bg-surface px-z3 text-xs font-medium text-ink hover:bg-surface-3">
              {labels.choose}
              <input
                ref={fileInput}
                type="file"
                accept=".csv,text/csv"
                className="sr-only"
                onChange={async (event) => {
                  const file = event.target.files?.[0]
                  if (!file) return
                  setFileName(file.name)
                  setCsv(await file.text())
                }}
              />
            </label>
            {fileName ? (
              <p className="text-xs text-ink-3">
                {labels.file}: {fileName}
              </p>
            ) : null}
          </div>

          <div>
            <Button
              type="submit"
              variant="primary"
              disabled={csv.trim() === '' || pending || companyId === ''}
            >
              {labels.preview}
            </Button>
          </div>

          {state.error ? (
            <p role="alert" className="text-sm text-danger">
              {state.error}
            </p>
          ) : null}
        </section>
      ) : null}

      {!done && plan !== null ? (
        <section className="flex flex-col gap-z4">
          {state.stale ? (
            <p role="alert" className="text-sm text-warning">
              {labels.stale}
            </p>
          ) : null}

          <h2 className="text-base font-medium text-ink">
            {plan.create.length === 0
              ? labels.previewNone
              : plan.create.length === 1
                ? labels.previewOne
                : labels.previewTitle.replace(
                    '{count}',
                    String(plan.create.length),
                  )}
          </h2>

          <p className="text-sm text-ink-2">{plan.settlement}</p>

          {plan.create.length > 0 ? (
            <Table
              rows={plan.create}
              columns={createColumns(labels, plan.showsMoney)}
              rowKey={(row) => `${row.rowNumber}-${row.loadId}`}
              caption={labels.previewTitle.replace(
                '{count}',
                String(plan.create.length),
              )}
              // Never reached — the table only renders when there are rows —
              // but the prop is required, and a table that could render
              // nothing with nothing to say is the bug it guards against.
              empty={<p className="text-sm text-ink-2">{labels.previewNone}</p>}
            />
          ) : null}

          {/* EVERY WARNING, IN WORDS, BEFORE THE BUTTON. Same posture as the
           * create form: each names the record it conflicts with. */}
          {plan.create.some((row) => row.warnings.length > 0) ? (
            <div className="flex flex-col gap-z1 rounded-card border border-warning bg-surface-2 p-z3">
              <p className="text-sm font-medium text-ink">
                {labels.warningsTitle}
              </p>
              <ul className="flex flex-col gap-z1">
                {plan.create.flatMap((row) =>
                  row.warnings.map((warning) => (
                    <li
                      key={`${row.rowNumber}-${warning}`}
                      className="text-sm text-ink-2"
                    >
                      {labels.row} {row.rowNumber}: {warning}
                    </li>
                  )),
                )}
              </ul>
            </div>
          ) : null}

          {plan.skip.length > 0 ? (
            <div className="flex flex-col gap-z2">
              <h3 className="text-sm font-medium text-ink-2">
                {labels.skippedTitle.replace(
                  '{count}',
                  String(plan.skip.length),
                )}
              </h3>
              <Table
                rows={plan.skip}
                columns={skipColumns(labels)}
                rowKey={(row) => `skip-${row.rowNumber}`}
                caption={labels.skippedTitle.replace(
                  '{count}',
                  String(plan.skip.length),
                )}
                empty={
                  <p className="text-sm text-ink-2">{labels.previewNone}</p>
                }
              />
            </div>
          ) : null}

          <div className="flex flex-wrap gap-z3">
            {plan.create.length > 0 ? (
              <>
                {/* The signature of exactly this plan. Its presence is what
                 * turns the next submit from a preview into a write. */}
                <input
                  type="hidden"
                  name="signature"
                  value={state.signature ?? ''}
                />
                <Button type="submit" variant="primary" disabled={pending}>
                  {labels.confirm}
                </Button>
              </>
            ) : null}
            <Button
              type="button"
              variant="secondary"
              onClick={() => {
                setCsv('')
                setFileName('')
                setDismissed(true)
                if (fileInput.current) fileInput.current.value = ''
              }}
            >
              {labels.back}
            </Button>
          </div>
        </section>
      ) : null}
    </form>
  )
}

function createColumns(
  labels: Labels,
  showsMoney: boolean,
): Column<PlanRowView>[] {
  const columns: Column<PlanRowView>[] = [
    {
      key: 'loadId',
      header: labels.loadId,
      render: (row) => (
        <span className="font-mono" dir="ltr">
          {row.loadId}
        </span>
      ),
    },
    { key: 'lane', header: labels.lane, render: (row) => row.lane },
    {
      key: 'stops',
      header: labels.stops,
      align: 'end',
      render: (row) => String(row.stops),
    },
    { key: 'first', header: labels.first, render: (row) => row.first },
    { key: 'last', header: labels.last, render: (row) => row.last },
    {
      key: 'miles',
      header: labels.miles,
      align: 'end',
      render: (row) => row.miles,
    },
  ]

  // THE COLUMN EXISTS ONLY IF THE ROLE DOES. `showsMoney` comes from the
  // server's own permission check and the rows carry no `rate` key at all when
  // it is false — this is the render half of the same rule.
  if (showsMoney) {
    columns.push({
      key: 'rate',
      header: labels.rate,
      align: 'end',
      render: (row) => (
        <span className="tabular-nums" dir="ltr">
          {row.rate ?? '—'}
        </span>
      ),
    })
  }

  return columns
}

function skipColumns(labels: Labels): Column<SkipView>[] {
  return [
    {
      key: 'row',
      header: labels.row,
      align: 'end',
      render: (row) => String(row.rowNumber),
    },
    {
      key: 'loadId',
      header: labels.loadId,
      render: (row) => (
        <span className="font-mono" dir="ltr">
          {row.loadId}
        </span>
      ),
    },
    { key: 'reason', header: labels.why, render: (row) => row.reason },
  ]
}
