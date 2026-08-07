'use client'

import { useActionState } from 'react'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { Select, type SelectOption } from '@/components/ui/Select'
import { StatusBadge } from '@/components/ui/StatusBadge'
import { moveChallengeAction, openChallengeAction } from './dataqs-actions'
import { CLAIM_INITIAL, type ClaimState } from './claim-state'
import type { StatusTone } from '@/lib/status'

// PHASE 4 §5 STEP 5 — DataQs challenges, on the inspection they dispute.
//
// §4's acceptance box asks that a challenge TRACE:
//
//     inspection → violation → challenge → outcome
//
// It lives here rather than on a screen of its own so the whole trace is
// readable without navigating: the inspection is the page, the violation is
// named on the row, the challenge is the row, and the outcome is on it.
//
// STATUS AND OUTCOME ARE TWO CONTROLS because they are two facts. Closing a
// challenge asks for the outcome in the same submit, and the service refuses
// the close without one — otherwise "closed" would not say whether the
// violation came off the carrier's record, which is the only thing anybody
// files a DataQs to find out.

export interface ChallengeRowView {
  id: string
  violationCode: string | null
  statusLabel: string
  status: string
  outcomeLabel: string | null
  outcome: string | null
  basis: string
  outcomeNote: string | null
  referenceNumber: string | null
  submitted: string | null
  decided: string | null
  /** Where this one may go next. Empty once it is closed. */
  nextStatuses: SelectOption[]
}

const OUTCOME_TONE: Record<string, StatusTone> = {
  ACCEPTED: 'success',
  PARTIALLY_ACCEPTED: 'warning',
  REJECTED: 'danger',
  WITHDRAWN: 'muted',
}

interface Props {
  inspectionId: string
  rows: readonly ChallengeRowView[]
  /** The violations on THIS inspection, plus the whole-inspection option. */
  violations: readonly SelectOption[]
  outcomes: readonly SelectOption[]
  mayWrite: boolean
  translate: Record<string, string>
  labels: {
    title: string
    hint: string
    none: string
    add: string
    violation: string
    basis: string
    reference: string
    save: string
    status: string
    outcome: string
    outcomeNote: string
    submitted: string
    decided: string
    move: string
    moveTo: string
    pickOutcome: string
    noOutcome: string
  }
}

export function DataQsPanel({
  inspectionId,
  rows,
  violations,
  outcomes,
  mayWrite,
  translate,
  labels,
}: Props) {
  const [state, act, pending] = useActionState<ClaimState, FormData>(
    openChallengeAction.bind(null, inspectionId),
    CLAIM_INITIAL,
  )

  return (
    <section className="rounded-card border border-border bg-surface p-z4">
      <h2 className="text-md font-medium text-ink">{labels.title}</h2>
      <p className="mt-z1 max-w-[68ch] text-sm text-ink-3">{labels.hint}</p>

      {rows.length === 0 ? (
        <p className="mt-z3 text-sm text-ink-2">{labels.none}</p>
      ) : (
        <ul className="mt-z3 flex flex-col gap-z3">
          {rows.map((row) => (
            <li
              key={row.id}
              className="flex flex-col gap-z2 border-b border-border pb-z3 last:border-b-0 last:pb-0"
            >
              <div className="flex flex-wrap items-baseline gap-x-z3 gap-y-z1 text-sm">
                {/* The middle link of the trace, named on the row. */}
                <span className="font-mono font-medium text-ink">
                  {row.violationCode ?? labels.title}
                </span>
                <StatusBadge
                  tone={row.status === 'CLOSED' ? 'muted' : 'progress'}
                  label={row.statusLabel}
                />
                {row.outcomeLabel ? (
                  <StatusBadge
                    tone={OUTCOME_TONE[row.outcome ?? ''] ?? 'muted'}
                    label={row.outcomeLabel}
                  />
                ) : null}
                {row.referenceNumber ? (
                  <span className="font-mono text-xs text-ink-2">
                    {row.referenceNumber}
                  </span>
                ) : null}
                {row.submitted ? (
                  <span className="text-xs text-ink-3">
                    {labels.submitted} {row.submitted}
                  </span>
                ) : null}
                {row.decided ? (
                  <span className="text-xs text-ink-3">
                    {labels.decided} {row.decided}
                  </span>
                ) : null}
              </div>

              <p className="max-w-[68ch] text-sm text-ink-2">{row.basis}</p>
              {row.outcomeNote ? (
                <p className="max-w-[68ch] text-sm text-ink-3">
                  {row.outcomeNote}
                </p>
              ) : null}

              {/* No control at all once it is closed — the ladder is empty and
               * a disabled select would invite the click anyway. */}
              {mayWrite && row.nextStatuses.length > 0 ? (
                <MoveChallenge
                  inspectionId={inspectionId}
                  challengeId={row.id}
                  nextStatuses={row.nextStatuses}
                  outcomes={outcomes}
                  translate={translate}
                  labels={labels}
                />
              ) : null}
            </li>
          ))}
        </ul>
      )}

      {mayWrite ? (
        <form action={act} className="mt-z4 flex flex-col gap-z3">
          <h3 className="text-sm font-medium text-ink-2">{labels.add}</h3>
          <div className="grid grid-cols-[repeat(auto-fit,minmax(200px,1fr))] gap-z3">
            <Select
              name="violationId"
              label={labels.violation}
              options={violations}
            />
            <Input name="basis" label={labels.basis} required />
            <Input name="referenceNumber" label={labels.reference} identifier />
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

function MoveChallenge({
  inspectionId,
  challengeId,
  nextStatuses,
  outcomes,
  translate,
  labels,
}: {
  inspectionId: string
  challengeId: string
  nextStatuses: SelectOption[]
  outcomes: readonly SelectOption[]
  translate: Record<string, string>
  labels: Props['labels']
}) {
  const [state, act, pending] = useActionState<ClaimState, FormData>(
    moveChallengeAction.bind(null, inspectionId, challengeId),
    CLAIM_INITIAL,
  )

  return (
    <form action={act} className="flex flex-wrap items-end gap-z3">
      <Select name="to" label={labels.moveTo} options={nextStatuses} />
      {/* Offered on every move and required only on a close. The service is
       * the one that refuses — the form does not try to guess which option the
       * select currently holds. */}
      <Select
        name="outcome"
        label={labels.pickOutcome}
        options={[{ value: '', label: labels.noOutcome }, ...outcomes]}
      />
      <Input name="outcomeNote" label={labels.outcomeNote} />
      <Input name="referenceNumber" label={labels.reference} identifier />
      <Button type="submit" variant="ghost" size="compact" disabled={pending}>
        {labels.move}
      </Button>
      {state.error ? (
        <p role="alert" className="text-sm text-danger">
          {translate[state.error] ?? state.error}
        </p>
      ) : null}
    </form>
  )
}
