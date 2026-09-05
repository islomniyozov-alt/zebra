import { cx } from '@/lib/cx'
import {
  PIPELINE_STAGES,
  stageIndex,
  type PipelineStage,
} from '@/lib/load-pipeline'

// ---------------------------------------------------------------------------
// THE LOAD TRACKER — ONE STORY, IDENTICAL ON EVERY LOAD (item 9).
//
//     Upcoming → In-Transit → Delivered → Invoiced → Paid
//
// IT RENDERS A VIEW AND DECIDES NOTHING. Which stage is current comes from
// `pipelineStage`, which reads the operational and billing axes and is tested
// on its own. This file draws five segments and marks one; if the strip is ever
// wrong, the answer is in `src/lib/load-pipeline.ts` and not here.
//
// AND THE WORD "INVOICED" IS DELIBERATE ON DIRECT-SETTLED FREIGHT, where no
// invoice exists and none should. The reasoning — and the instruction not to
// make the word true by creating one — is in that file's header. It is not
// restated here, because a rule with two homes is a rule with two versions.
//
// NOT COLOUR ALONE (§ rule 5). Three cues carry the state and only one is
// hue: the current stage's bar is thicker than the rest, its label is the
// only one in full ink at medium weight, and it is the only element marked
// `aria-current`. Printed in greyscale, or read by a screen reader, the strip
// still says where the load is.
//
// A CANCELLED LOAD HAS NO CURRENT STAGE. Marking one would say the freight is
// somewhere in a pipeline it left; the strip goes uniformly muted and names the
// cancellation instead, which is the same thing the header's stripe does.
// ---------------------------------------------------------------------------

interface Props {
  stage: PipelineStage
  cancelled: boolean
  /** One per stage, in `PIPELINE_STAGES` order, plus the cancelled word. */
  labels: Record<PipelineStage, string> & { title: string; cancelled: string }
}

export function PipelineStrip({ stage, cancelled, labels }: Props) {
  const current = stageIndex(stage)

  return (
    <section className="rounded-card border border-border bg-surface p-z4">
      <div className="flex items-baseline justify-between gap-z3">
        <h2 className="text-md font-medium text-ink">{labels.title}</h2>
        {cancelled ? (
          <span className="text-xs uppercase tracking-[0.04em] text-muted">
            {labels.cancelled}
          </span>
        ) : null}
      </div>

      <ol className="mt-z3 flex gap-z2">
        {PIPELINE_STAGES.map((name, index) => {
          // REACHED, NOT "COMPLETED". The current stage is reached and not
          // finished — a load at Delivered has not finished being delivered —
          // so the bar fills up to and including where it stands.
          const reached = !cancelled && index <= current
          const isCurrent = !cancelled && index === current

          return (
            <li
              key={name}
              className="flex flex-1 flex-col gap-z2"
              {...(isCurrent ? { 'aria-current': 'step' as const } : {})}
            >
              <span
                aria-hidden="true"
                className={cx(
                  'block rounded-control',
                  // Thickness is the non-colour cue for "you are here".
                  isCurrent ? 'h-[6px]' : 'h-[3px]',
                  reached ? 'bg-progress' : 'bg-surface-3',
                )}
              />
              <span
                className={cx(
                  'text-xs uppercase tracking-[0.04em]',
                  isCurrent
                    ? 'font-medium text-ink'
                    : reached
                      ? 'text-ink-2'
                      : 'text-ink-3',
                )}
              >
                {labels[name]}
              </span>
            </li>
          )
        })}
      </ol>
    </section>
  )
}
