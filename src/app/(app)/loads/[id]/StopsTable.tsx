import type { ReactNode } from 'react'
import { cx } from '@/lib/cx'

// ---------------------------------------------------------------------------
// THE STOPS, AS A TABLE — DATATRUCK'S SHAPE, FOR THE REASON DATATRUCK HAS IT.
//
// A Relay trip runs six to eight stops. Read as a stack of cards it is a scroll;
// read as a table it is a route, and the columns line up so the eye can run
// down "checked in at" and see the day.
//
//   POSITION carries the ordinal AND the type — "1 · PICKUP". Datatruck does
//   this and it is right: a number printed twice is a number that can disagree
//   with itself, and the type needs no column of its own.
//
//   THE "BY" COLUMNS COME FROM THE AUDIT LOG, because `LoadStop` has no actor.
//   They read "<name> via Integration" only when the writer stamped itself; a
//   write we cannot classify names the person and says NOTHING about how. See
//   src/lib/stop-attribution.ts.
//
//   WAITING IS DWELL: departure minus arrival, from the two actual clocks.
//   Not detention — that measures against the appointment, is billable, and
//   `DETENTION` is already an accessorial type.
//
// THE ADDRESS LIVES UNDER THE LOCATION, not in a column of its own, because it
// is prose of variable length and a table column would be either truncated or
// ruinous to the layout. Its editor and its missing-address flag are unchanged.
// ---------------------------------------------------------------------------

export interface StopRow {
  id: string
  position: string
  location: string
  place: string | null
  checkedInAt: string
  checkedInBy: string
  checkedOutAt: string
  checkedOutBy: string
  scheduled: string
  waiting: string
  /** Rendered under the location: the address, its flag, its editor. */
  address: ReactNode
}

interface Props {
  stops: readonly StopRow[]
  labels: {
    title: string
    position: string
    location: string
    checkedInAt: string
    checkedInBy: string
    checkedOutAt: string
    checkedOutBy: string
    scheduled: string
    waiting: string
    empty: string
  }
}

export function StopsTable({ stops, labels }: Props) {
  return (
    <section className="rounded-card border border-border bg-surface p-z4">
      <h2 className="text-md font-medium text-ink">{labels.title}</h2>

      {stops.length === 0 ? (
        <p className="mt-z2 text-sm text-ink-2">{labels.empty}</p>
      ) : (
        // THE TABLE SCROLLS, THE PAGE DOES NOT. Eight columns on a laptop is
        // wider than the panel; a horizontally scrolling page is how a
        // dispatcher loses the left-hand column entirely.
        <div className="mt-z3 overflow-x-auto">
          <table className="w-full min-w-[860px] border-collapse text-sm">
            <thead>
              <tr className="border-b border-border text-start">
                {[
                  labels.position,
                  labels.location,
                  labels.checkedInAt,
                  labels.checkedInBy,
                  labels.checkedOutAt,
                  labels.checkedOutBy,
                  labels.scheduled,
                  labels.waiting,
                ].map((heading) => (
                  <th
                    key={heading}
                    scope="col"
                    className="whitespace-nowrap px-z2 pb-z2 text-start text-xs font-medium uppercase tracking-[0.04em] text-ink-3"
                  >
                    {heading}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {stops.map((stop) => (
                <tr
                  key={stop.id}
                  className="border-b border-border last:border-b-0 align-top"
                >
                  <td className="whitespace-nowrap px-z2 py-z2 text-xs uppercase tracking-[0.04em] text-ink-2">
                    {stop.position}
                  </td>
                  <td className="px-z2 py-z2">
                    <div className="text-ink">{stop.location}</div>
                    {stop.place ? (
                      <div className="text-xs text-ink-3">{stop.place}</div>
                    ) : null}
                    {stop.address}
                  </td>
                  <Clock value={stop.checkedInAt} />
                  <By value={stop.checkedInBy} />
                  <Clock value={stop.checkedOutAt} />
                  <By value={stop.checkedOutBy} />
                  <Clock value={stop.scheduled} muted />
                  <td className="whitespace-nowrap px-z2 py-z2 text-end font-mono tabular-nums text-ink">
                    {stop.waiting}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}

/** A time. Mono and tabular so a column of them reads as a column. */
function Clock({ value, muted }: { value: string; muted?: boolean }) {
  return (
    <td
      className={cx(
        'whitespace-nowrap px-z2 py-z2 font-mono tabular-nums',
        muted ? 'text-ink-3' : 'text-ink',
      )}
    >
      {value}
    </td>
  )
}

/** A person, or the integration, or an honest em dash. */
function By({ value }: { value: string }) {
  return (
    <td className="whitespace-nowrap px-z2 py-z2 text-xs text-ink-2">
      {value}
    </td>
  )
}
