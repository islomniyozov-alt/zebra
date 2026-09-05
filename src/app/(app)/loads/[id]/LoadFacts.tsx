import type { ReactNode } from 'react'

// ---------------------------------------------------------------------------
// WHO, FOR WHOM, IN WHAT — ACROSS THE HEADER RATHER THAN DOWN A CARD.
//
// These four facts were a `dl` in a "Summary" card occupying half the width of
// the screen to hold four short strings and a number. They are the load's
// identity rather than its detail: the same class of thing as the load number
// beside them, which is why they belong in the header and why the card they
// came from no longer exists.
//
// EVERY FACT HERE IS UNGATED, AND THAT IS A CONSTRAINT ON THE FILE, not an
// accident of the current four. Operating authority, customer, truck unit and
// driver name are readable by anyone who can open the load. A permission-gated
// fact must not be added here: in a fixed horizontal run it would leave a
// viewer-dependent hole — a gap that says "something is here you may not see",
// which is a worse disclosure than the value would have been, and a ragged
// header for one role and not another. Driver gross is the specific case that
// was asked about and refused; it is behind `load.financials` and lives in the
// rate panel where the rest of the money already is.
//
// A MISSING VALUE IS AN EM DASH, not an omitted column. Unassigned freight is
// the normal state of a new load, and the strip keeps its shape so the eye
// learns where truck and driver sit.
// ---------------------------------------------------------------------------

export interface Fact {
  label: string
  /** The rendered value, or null for "not set" — which prints an em dash. */
  value: ReactNode | null
}

export function LoadFacts({ facts }: { facts: readonly Fact[] }) {
  return (
    <dl className="flex flex-wrap items-baseline gap-x-z5 gap-y-z2">
      {facts.map((fact) => (
        <div key={fact.label} className="flex items-baseline gap-z2">
          <dt className="text-xs uppercase tracking-[0.04em] text-ink-3">
            {fact.label}
          </dt>
          <dd className="text-sm text-ink">{fact.value ?? '—'}</dd>
        </div>
      ))}
    </dl>
  )
}
