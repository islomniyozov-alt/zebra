'use client'

import { useActionState } from 'react'
import { Button } from '@/components/ui/Button'
import type { FilingActionState } from './factoring-actions'

// §7 — one button, one packet.
//
// ── THE DISABLED STATE NAMES THE PIECE ───────────────────────────────────
//
// "3 of 4 documents" sends somebody to open the load and work out which, and
// the one they are missing is the one they have to go and get. So the missing
// pieces are listed by name, under the button, always visible — not in a
// `title` attribute, which is a tooltip nobody on a phone can reach and no
// screen reader announces reliably.
//
// The LIST is the sentence. `packetReadiness` composes an English one for
// logs and refusals; a screen that must read in three languages joins its own,
// because "the POD and the rate confirmation" is grammar, not concatenation.

// NOT exported from factoring-actions.ts. A 'use server' file may only export
// async functions, and Next refuses that at BUILD time — which `npm run check`
// never reaches.
const FILING_INITIAL: FilingActionState = { error: null, filed: false }

interface Props {
  /** Live only when all four pieces exist and it is not filed already. */
  canFile: boolean
  /** Live only after filing. Factoring has no other way to reach PAID. */
  canMarkPaid: boolean
  /** Already-translated names of the pieces that are absent, in packet order. */
  missing: readonly string[]
  /** Set when this customer settles directly and is never factored at all. */
  notFactored: string | null
  /** Shown once the load is filed, so the status is not the only signal. */
  isFiled: boolean
  packetHref: string
  file: (previous: FilingActionState) => Promise<FilingActionState>
  markPaid: (previous: FilingActionState) => Promise<FilingActionState>
  labels: {
    title: string
    file: string
    filing: string
    filed: string
    markPaid: string
    marking: string
    openPacket: string
    missing: string
  }
}

export function FactoringPanel({
  canFile,
  canMarkPaid,
  missing,
  notFactored,
  isFiled,
  packetHref,
  file,
  markPaid,
  labels,
}: Props) {
  const [fileState, fileAction, filing] = useActionState(file, FILING_INITIAL)
  const [paidState, paidAction, marking] = useActionState(
    markPaid,
    FILING_INITIAL,
  )

  // A DIRECT-SETTLED CUSTOMER GETS THE SENTENCE, NOT A GREY BUTTON. Amazon
  // freight is never invoiced and never factored (§1); offering the button at
  // all would be offering to do something that cannot be done.
  if (notFactored) {
    return (
      <section className="rounded-card border border-border bg-surface p-z4">
        <h2 className="text-md font-medium text-ink">{labels.title}</h2>
        <p className="mt-z2 text-xs text-ink-3">{notFactored}</p>
      </section>
    )
  }

  const error = fileState.error ?? paidState.error

  return (
    <section className="rounded-card border border-border bg-surface p-z4">
      <h2 className="text-md font-medium text-ink">{labels.title}</h2>

      <div className="mt-z3 flex flex-wrap items-center gap-z2">
        <form action={fileAction}>
          <Button
            type="submit"
            size="compact"
            disabled={!canFile || filing}
            aria-disabled={!canFile}
          >
            {filing ? labels.filing : isFiled ? labels.filed : labels.file}
          </Button>
        </form>

        {/* THE PACKET IS A THING A PERSON SENDS. Filing is a status; this is
         * the PDF. Readable before the button is pressed and after, because
         * "what exactly did we file" is the question that comes next. */}
        {canFile || isFiled ? (
          <a
            className="text-xs text-ink-2 underline underline-offset-2"
            href={packetHref}
            target="_blank"
            rel="noreferrer"
          >
            {labels.openPacket}
          </a>
        ) : null}

        {canMarkPaid ? (
          <form action={paidAction}>
            <Button
              type="submit"
              variant="secondary"
              size="compact"
              disabled={marking}
            >
              {marking ? labels.marking : labels.markPaid}
            </Button>
          </form>
        ) : null}
      </div>

      {missing.length > 0 ? (
        <p className="mt-z2 text-xs text-ink-3">
          {labels.missing}{' '}
          <span className="text-ink-2">{missing.join(' · ')}</span>
        </p>
      ) : null}

      {error ? (
        <p className="mt-z2 text-xs text-danger" role="alert">
          {error}
        </p>
      ) : null}
    </section>
  )
}
