'use client'

import { useActionState, useRef, useState } from 'react'
import Link from 'next/link'
import { Button } from '@/components/ui/Button'
import { Select } from '@/components/ui/Select'
import { Table, type Column } from '@/components/ui/Table'
import { cx } from '@/lib/cx'
import { stageSentence } from '@/lib/trips-preview'
import { tripsImportAction } from './actions'
import { EMPTY_TRIPS_IMPORT, type TripRowView } from './state'

// ---------------------------------------------------------------------------
// THE TRIPS IMPORT SCREEN — the load-board import's sibling, deliberately.
//
// It is the same two beats for the same reason: this writes freight in bulk,
// and forty trips booked by one click cannot be reviewed field by field
// afterwards. Where the shapes match the screen beside it, they match on
// purpose — a dispatcher who has used one has used both.
//
// THE FILE IS READ IN THE BROWSER and posted as text. A trips export is a
// table; nothing about it needs to be STORED. No upload, no R2 object, no
// pending row to clean up when somebody changes their mind at the preview.
//
// TWO COUNTS, NOT ONE. Relay's booking email and Relay's trips export describe
// the same freight from different ends, so a trip in this file may be a load
// that already exists. The preview says which are new and which are being
// FILLED IN before it says anything else, because those are two different
// promises and confirming is one button.
//
// NOTHING IS AUTO-ASSIGNED. Driver and equipment are columns here because a
// dispatcher recognises a trip by them — not because this screen will attach
// them to a Driver or a Truck record. That is its own feature and it has not
// been built.
// ---------------------------------------------------------------------------

export interface TripsImportLabels {
  authority: string
  choose: string
  file: string
  preview: string
  previewTitle: string
  previewOne: string
  previewNone: string
  trip: string
  lane: string
  stops: string
  miles: string
  what: string
  driver: string
  equipment: string
  rate: string
  willCreate: string
  willEnrich: string
  unchanged: string
  skippedLegs: string
  previewTrip: string
  previewTrips: string
  stageUpcoming: string
  stageFinished: string
  stageRunning: string
  unresolvedTitle: string
  /** Facilities the book has, with no street. Its own line, its own fix. */
  noAddressTitle: string
  warningsTitle: string
  countDelivered: string
  countCrewSeated: string
  countClosed: string
  crewRefusalsTitle: string
  notAssigned: string
  confirm: string
  perRow: string
  back: string
  stale: string
  done: string
  toLoads: string
}

export function TripsImportForm({
  companies,
  defaultCompanyId,
  labels,
}: {
  companies: readonly { id: string; name: string }[]
  defaultCompanyId: string
  labels: TripsImportLabels
}) {
  const [state, submit, pending] = useActionState(
    tripsImportAction,
    EMPTY_TRIPS_IMPORT,
  )
  const [csv, setCsv] = useState('')
  const [fileName, setFileName] = useState('')
  const [companyId, setCompanyId] = useState(defaultCompanyId)
  const fileInput = useRef<HTMLInputElement>(null)
  // THE PREVIEW IS SERVER STATE AND DOES NOT CLEAR ITSELF — the same bug the
  // screen beside it hit. `useActionState` holds the last result until the
  // next submit, so "choose a different file" would leave the old plan on
  // screen above a confirm button with no file behind either.
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

      {done ? (
        <section className="flex flex-col items-start gap-z3 rounded-card border border-border bg-surface-2 p-z4">
          <p className="text-sm text-ink">
            {labels.done
              .replace('{created}', String(state.created))
              .replace('{enriched}', String(state.enriched ?? 0))}
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
           * which carrier's load-number series these trips take. */}
          <Select
            label={labels.authority}
            value={companyId}
            onChange={(event) => setCompanyId(event.target.value)}
            options={companies.map((company) => ({
              value: company.id,
              label: company.name,
            }))}
          />

          <div className="flex flex-wrap items-center gap-z3">
            {/* A label wrapping the input, styled as the secondary button —
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
            {plan.rows.length === 0
              ? labels.previewNone
              : plan.rows.length === 1
                ? labels.previewOne
                : labels.previewTitle.replace(
                    '{count}',
                    String(plan.rows.length),
                  )}
          </h2>

          {/* THE SENTENCE DALER SAID, PRINTED AS HE SAID IT:
           *
           *     "3 trips: 1 books, 1 in transit, 1 files as delivered"
           *
           * It answers the only question the screen is opened with — what will
           * this file DO — in the words the office already uses, and it names
           * the landing state rather than the export's vocabulary. "Still
           * running" was a fourth word for a state the tracker, the badge and
           * the dispatcher all call In Transit; a screen that invents a synonym
           * makes the reader translate before they can decide.
           *
           * IN THE FREIGHT'S OWN ORDER — books, in transit, delivered — not the
           * order the counts happen to sit in on the plan object. */}
          <p className="text-sm text-ink-2">
            {stageSentence(plan.tripCount, plan.stageCounts, labels)}
          </p>

          {/* THE COUNTS BEFORE THE ROWS. Someone deciding whether to confirm
           * needs the shape of the thing before its detail, and "12 to book,
           * 3 to add to" is the whole decision for most files. */}
          <ul className="flex flex-wrap gap-z3 text-sm text-ink-2">
            <li>
              {plan.createCount} {labels.willCreate}
            </li>
            <li>
              {plan.enrichCount} {labels.willEnrich}
            </li>
            <li>
              {plan.unchangedCount} {labels.unchanged}
            </li>
            {plan.skippedLegTotal > 0 ? (
              <li>
                {plan.skippedLegTotal} {labels.skippedLegs}
              </li>
            ) : null}
            {/* ── THE RULING'S OTHER COUNTS, AND ONLY WHEN THEY ARE NOT ZERO ──
             * A row of zeroes buries the one number that matters, which is the
             * same reason `stageSentence` omits an empty stage. */}
            {plan.deliveredCount > 0 ? (
              <li>
                {labels.countDelivered.replace(
                  '{n}',
                  String(plan.deliveredCount),
                )}
              </li>
            ) : null}
            {plan.crewSeatedCount > 0 ? (
              <li>
                {labels.countCrewSeated.replace(
                  '{n}',
                  String(plan.crewSeatedCount),
                )}
              </li>
            ) : null}
            {plan.closedCount > 0 ? (
              <li className="text-ink-3">
                {labels.countClosed.replace('{n}', String(plan.closedCount))}
              </li>
            ) : null}
          </ul>

          {plan.rows.length > 0 ? (
            <Table
              rows={plan.rows}
              columns={tripColumns(labels, plan.showsMoney)}
              rowKey={(row) => row.tripId}
              caption={labels.previewTitle.replace(
                '{count}',
                String(plan.rows.length),
              )}
              // Never reached — the table only renders when there are rows —
              // but the prop is required, and a table that could render
              // nothing with nothing to say is the bug it guards against.
              empty={<p className="text-sm text-ink-2">{labels.previewNone}</p>}
            />
          ) : null}

          <p className="text-xs text-ink-3">{labels.notAssigned}</p>

          {/* EVERY WARNING, IN WORDS, BEFORE THE BUTTON. The near-miss prefix
           * ones are why this box exists: T-118R and 118R are one trip written
           * two ways somewhere in the wild, and this screen refuses to guess
           * which — it says so and lets a person decide. */}
          {plan.warnings.length > 0 ? (
            <div className="flex flex-col gap-z1 rounded-card border border-warning bg-surface-2 p-z3">
              <p className="text-sm font-medium text-ink">
                {labels.warningsTitle}
              </p>
              <ul className="flex flex-col gap-z1">
                {plan.warnings.map((warning) => (
                  <li key={warning} className="text-sm text-ink-2">
                    {warning}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          {/* ── REFUSED CREW, BY NAME ──────────────────────────────────────
           * Owner's ruling, 2026-09-26: "refusals by name". Its own box rather
           * than a line in the warnings, because these have a fix a dispatcher
           * can perform — add the driver, resolve the duplicate unit — and the
           * near-miss warnings above are decisions only the office can make.
           *
           * NOT AN ERROR AND NOT A REFUSAL OF THE IMPORT. The freight still
           * books; the seat stays empty and is named here. */}
          {plan.crewRefusals.length > 0 ? (
            <div className="flex flex-col gap-z1 rounded-card border border-line bg-surface-2 p-z3">
              <p className="text-sm font-medium text-ink">
                {labels.crewRefusalsTitle}
              </p>
              <ul className="flex flex-col gap-z1">
                {plan.crewRefusals.map((line) => (
                  <li key={line} className="text-sm text-ink-2">
                    {line}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          {/* UNRESOLVED CODES ARE NOT AN ERROR. The stop is still written,
           * with the code as its name — a dock nobody has recorded yet is a
           * fact about the location book, not a reason to refuse the trip. */}
          {plan.unresolvedCodes.length > 0 ? (
            <p className="text-sm text-ink-2">
              {labels.unresolvedTitle.replace(
                '{codes}',
                plan.unresolvedCodes.join(', '),
              )}
            </p>
          ) : null}

          {/* AND THE OTHER CONDITION, ON ITS OWN LINE. A facility the book has
           * with no street on it: the stop resolves, the load looks complete,
           * and a driver is sent to a code nobody has an address for. Counted
           * apart from unresolved because the fix is different — that one
           * needs a facility, this one needs a street. */}
          {plan.noAddressCodes.length > 0 ? (
            <p className="text-sm text-danger">
              {labels.noAddressTitle.replace(
                '{codes}',
                plan.noAddressCodes.join(', '),
              )}
            </p>
          ) : null}

          {state.error ? (
            <p role="alert" className="text-sm text-danger">
              {state.error}
            </p>
          ) : null}

          <div className="flex flex-wrap gap-z3">
            {plan.createCount + plan.enrichCount > 0 ? (
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

          {/* THE ESCAPE HATCH, AND IT SAYS WHAT IT WOULD DO.
           *
           * "Import each row as its own load instead — 12 loads instead of 3."
           * The count is IN the control, because the thing this replaces was a
           * cross-link that read like a refinement and silently switched the
           * unit of the output. Four bad imports came from clicking something
           * that looked like a settings tweak, so the number goes where the
           * decision is made rather than on the screen it lands on.
           *
           * IT RE-POSTS THE FILE THIS FORM ALREADY HOLDS, with grouping=row.
           * No navigation, no re-choosing the file, no second authority
           * question — which is what made the old cross-link a trap rather
           * than an option.
           *
           * ONLY OFFERED WHEN IT WOULD DIFFER. On a file where every trip is
           * one row the two readings produce identical output, and a control
           * promising "12 loads instead of 12" is noise inviting a pointless
           * decision. */}
          {plan.grouping === 'trip' && plan.rowCount > plan.tripCount ? (
            <button
              type="submit"
              name="grouping"
              value="row"
              disabled={pending}
              className={cx(
                'self-start rounded-control text-sm text-ink-2',
                'underline decoration-border-strong underline-offset-2',
                'hover:text-accent focus-visible:outline focus-visible:outline-2',
                'focus-visible:outline-offset-2 focus-visible:outline-accent',
              )}
            >
              {labels.perRow
                .replace('{rows}', String(plan.rowCount))
                .replace('{trips}', String(plan.tripCount))}
            </button>
          ) : null}
        </section>
      ) : null}
    </form>
  )
}

function tripColumns(
  labels: TripsImportLabels,
  showsMoney: boolean,
): Column<TripRowView>[] {
  const columns: Column<TripRowView>[] = [
    {
      key: 'tripId',
      header: labels.trip,
      render: (row) => (
        <span className="font-mono" dir="ltr">
          {row.tripId}
        </span>
      ),
    },
    {
      key: 'lane',
      header: labels.lane,
      truncate: true,
      render: (row) => row.lane,
    },
    {
      key: 'stops',
      header: labels.stops,
      align: 'end',
      render: (row) => String(row.stops),
    },
    {
      key: 'miles',
      header: labels.miles,
      align: 'end',
      render: (row) => (
        <span className="tabular-nums" dir="ltr">
          {row.miles}
        </span>
      ),
    },
    { key: 'what', header: labels.what, render: (row) => row.actionDetail },
    {
      key: 'driver',
      header: labels.driver,
      truncate: true,
      render: (row) => row.driver,
    },
    {
      key: 'equipment',
      header: labels.equipment,
      truncate: true,
      render: (row) => row.equipment,
    },
  ]

  // THE COLUMN EXISTS ONLY IF THE ROLE DOES — the render half of §1.3, and the
  // same shape the board importer beside it uses. `showsMoney` comes from the
  // server's own permission check, and the rows carry no `rate` key at all
  // when it is false, so this cannot render a value that was never sent.
  //
  // WHAT IT SHOWS IS WHAT WILL LAND. A trip whose load already carries money
  // reads '—', because enrichment adds and never replaces; a multi-leg trip
  // reads '—', because its per-leg cost was never a price. See
  // `rateThatWouldLand`.
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
