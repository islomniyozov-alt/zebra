'use client'

import { useTransition } from 'react'
import { Button } from '@/components/ui/Button'
import type { FmcsaLabels, FmcsaPanelData } from './fmcsa-labels'

// ---------------------------------------------------------------------------
// THE LOOKUP CONTROL AND WHAT THE REGISTER SAID.
//
// Shared by the Add authority form and the broker form, because the two must
// not learn to say different things about the same record. What differs
// between them — which column a field lands in, which audience the concerns
// are judged for — is decided in each screen's action, not here.
//
// THE BUTTON IS NEVER A SUBMIT. Both forms have exactly one submit and it is
// Save; a lookup that submitted would be the save button wearing a different
// word. It is also the only control disabled while a lookup runs: the form
// stays typeable throughout, because the whole contract is that the register
// is an offer.
// ---------------------------------------------------------------------------

export function FmcsaLookup({
  labels,
  found,
  error,
  onRun,
}: {
  labels: FmcsaLabels
  found: FmcsaPanelData | null
  error: string | null
  /** Runs the caller's server action. The caller owns the resulting state. */
  onRun: () => Promise<void>
}) {
  const [pending, start] = useTransition()

  return (
    <>
      <div className="flex flex-col gap-z1">
        <div>
          <Button
            type="button"
            variant="secondary"
            onClick={() => start(onRun)}
            disabled={pending}
          >
            {pending ? labels.lookupPending : labels.lookup}
          </Button>
        </div>
        <p className="text-xs text-ink-3">{labels.lookupHint}</p>
      </div>

      {/* `role="status"` and not `role="alert"`: a lookup that could not answer
       * is not an error on this form. Nothing was lost and nothing is blocked
       * — every one of these sentences ends by saying type it instead. */}
      {error ? (
        <p role="status" className="text-sm text-warning">
          {error}
        </p>
      ) : null}

      {found ? (
        <section
          role="status"
          className="flex flex-col gap-z2 rounded-card border border-border bg-surface-2 p-z3"
        >
          <h2 className="text-sm font-medium text-ink">{labels.title}</h2>

          {/* SHOWN, NOT STORED. Neither `Company` nor `Customer` has a column
           * for entity type, operation or safety rating, and inventing three
           * would be a migration to hold what the register can be asked
           * again. */}
          <dl className="flex flex-wrap gap-x-z4 gap-y-z1 text-sm">
            {(
              [
                [labels.status, found.status],
                [labels.entity, found.entityType],
                [labels.operation, found.operation],
                [labels.rating, found.safetyRating],
                [labels.dba, found.dbaName],
              ] as const
            )
              .filter(([, value]) => value)
              .map(([term, value]) => (
                <div key={term} className="flex gap-z1">
                  <dt className="text-ink-3">{term}</dt>
                  <dd className="text-ink">{value}</dd>
                </div>
              ))}
          </dl>

          {/* IN WORDS, EACH ITS OWN SENTENCE — the load warnings' posture. A
           * badge has to be interpreted; a sentence can be acted on. */}
          {found.concerns.length > 0 ? (
            <ul className="flex flex-col gap-z1">
              {found.concerns.map((concern) => (
                <li key={concern} className="text-sm font-medium text-danger">
                  {concern}
                </li>
              ))}
            </ul>
          ) : null}

          <p className="text-xs text-ink-3">{labels.lookupFilled}</p>
        </section>
      ) : null}
    </>
  )
}
