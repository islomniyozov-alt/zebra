import { StatusBadge } from '@/components/ui/StatusBadge'
import { cx } from '@/lib/cx'

// §10 / the Step 5 instruction: the timeline IS the audit answer, not a
// decoration. So it renders two things a decoration would leave out.
//
//   SOURCE. Whether a transition was a human clicking or the system reacting.
//   "Delivered — manual, by Aziz" and "POD received — automatic" are different
//   facts, and the difference is what tells you whether to go ask somebody.
//
//   REFUSALS. A transition that was attempted and declined for arriving late
//   is recorded (LoadStatusEvent.outcome = REFUSED_STALE) and shown. Somebody
//   clicked Delivered on Tuesday after the POD had already landed; the load
//   did not move, and the fact that they tried is exactly what a dispute turns
//   on. A timeline that showed only what succeeded would be a timeline that
//   quietly agrees with whoever is telling the story.

export interface TimelineEvent {
  id: string
  fromStatus: string | null
  toStatus: string
  outcome: 'APPLIED' | 'REFUSED_STALE'
  source: string
  /** Already rendered in the company's zone by the server. */
  at: string
  by: string | null
  note: string | null
}

interface Props {
  events: readonly TimelineEvent[]
  statusLabels: Record<string, string>
  labels: {
    title: string
    manual: string
    automatic: string
    driverPortal: string
    integration: string
    refused: string
    refusedBody: string
    by: string
    empty: string
  }
}

export function StatusTimeline({ events, statusLabels, labels }: Props) {
  const sourceLabel = (source: string) =>
    source === 'MANUAL'
      ? labels.manual
      : source === 'AUTOMATIC'
        ? labels.automatic
        : source === 'DRIVER_PORTAL'
          ? labels.driverPortal
          : labels.integration

  return (
    <section className="rounded-card border border-border bg-surface p-z4">
      <h2 className="text-md font-medium text-ink">{labels.title}</h2>

      {events.length === 0 ? (
        <p className="mt-z2 text-sm text-ink-2">{labels.empty}</p>
      ) : (
        <ol className="mt-z3 flex flex-col gap-z3">
          {events.map((event) => {
            const refused = event.outcome === 'REFUSED_STALE'
            return (
              <li key={event.id} className="flex gap-z3">
                {/* The rail. A refusal is hollow, so the eye can skip it when
                 * reading what actually happened. */}
                <div className="flex flex-col items-center pt-[5px]">
                  <span
                    aria-hidden
                    className={cx(
                      'h-z2 w-z2 rounded-full border',
                      refused
                        ? 'border-danger bg-surface'
                        : 'border-progress bg-progress',
                    )}
                  />
                  <span aria-hidden className="mt-z1 w-px flex-1 bg-border" />
                </div>

                <div className="flex-1 pb-z2">
                  <div className="flex flex-wrap items-center gap-z2">
                    <StatusBadge
                      tone={refused ? 'danger' : 'progress'}
                      variant={refused ? 'outlined' : 'filled'}
                      label={statusLabels[event.toStatus] ?? event.toStatus}
                    />
                    <span
                      className={cx(
                        'text-xs',
                        refused ? 'text-danger' : 'text-ink-3',
                      )}
                    >
                      {refused ? labels.refused : sourceLabel(event.source)}
                    </span>
                    <span className="font-mono text-xs text-ink-3">
                      {event.at}
                    </span>
                    {event.by ? (
                      <span className="text-xs text-ink-3">
                        {labels.by} {event.by}
                      </span>
                    ) : null}
                  </div>

                  {refused ? (
                    <p className="mt-z1 text-sm text-ink-2">
                      {labels.refusedBody
                        .replace(
                          '{attempted}',
                          statusLabels[event.toStatus] ?? event.toStatus,
                        )
                        .replace(
                          '{stayed}',
                          event.fromStatus
                            ? (statusLabels[event.fromStatus] ??
                                event.fromStatus)
                            : '—',
                        )}
                    </p>
                  ) : null}

                  {event.note ? (
                    <p className="mt-z1 text-sm text-ink-2">{event.note}</p>
                  ) : null}
                </div>
              </li>
            )
          })}
        </ol>
      )}
    </section>
  )
}
