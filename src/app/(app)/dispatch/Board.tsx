'use client'

import { useActionState, useState } from 'react'
import Link from 'next/link'
import { Button } from '@/components/ui/Button'
import { Modal } from '@/components/ui/Modal'
import { cx } from '@/lib/cx'
import { TONE_STRIPE, type StatusTone } from '@/lib/status'
import { assignAction } from './actions'
import { ASSIGN_INITIAL, type AssignState } from './assign-state'

// §11 — a working surface, not a wall display.
//
// Rows are trucks with their current driver, columns are days, cells are loads
// positioned by their stop windows. Unassigned loads sit in a leading rail.
//
// CLICK-TO-ASSIGN IS THE KEYBOARD PATH AND IT SHIPS FIRST. Every cell that can
// take a load is a real <button>, so Tab reaches it and Enter works, and the
// unassigned rail is a list of real buttons too. Drag-and-drop is optional
// polish (§11) and is deliberately absent: it would have to be built on top of
// this without replacing it, and half-built drag that swallows a click is
// worse than no drag at all.

export interface BoardLoad {
  id: string
  loadNumber: string
  customerName: string
  route: string
  tone: StatusTone
  /** Index into `days`, or null when the load has no dated stop. */
  dayIndex: number | null
  isCancelled: boolean
}

export interface BoardTruck {
  id: string
  unitNumber: string
  driverName: string | null
  driverId: string | null
  companyName: string
  /** Loads already on this truck, by day column. */
  loadsByDay: Record<number, BoardLoad[]>
}

export interface BoardDriver {
  id: string
  name: string
}

interface Props {
  days: readonly string[]
  trucks: readonly BoardTruck[]
  drivers: readonly BoardDriver[]
  unassigned: readonly BoardLoad[]
  canAssign: boolean
  labels: {
    truck: string
    unassigned: string
    unassignedEmpty: string
    assign: string
    assignTitle: string
    assignBody: string
    driverNone: string
    driverKeep: string
    cancel: string
    empty: string
    noTrucks: string
  }
}

export function Board({
  days,
  trucks,
  drivers,
  unassigned,
  canAssign,
  labels,
}: Props) {
  const [picking, setPicking] = useState<BoardLoad | null>(null)

  return (
    <div className="flex min-h-0 flex-1">
      {/* The leading rail. Loads with nowhere to be yet. */}
      <aside className="flex w-[220px] shrink-0 flex-col border-e border-border bg-surface">
        <h2 className="border-b border-border px-z3 py-z2 text-xs font-semibold uppercase tracking-[0.04em] text-ink-2">
          {labels.unassigned}
        </h2>
        <div className="min-h-0 flex-1 overflow-y-auto">
          {unassigned.length === 0 ? (
            <p className="px-z3 py-z3 text-sm text-ink-3">
              {labels.unassignedEmpty}
            </p>
          ) : (
            <ul className="flex flex-col">
              {unassigned.map((load) => (
                <li key={load.id} className="border-b border-border">
                  <div className="flex items-stretch">
                    <span
                      aria-hidden
                      className={cx('w-[3px]', TONE_STRIPE[load.tone])}
                    />
                    <div className="flex-1 px-z2 py-z2">
                      <Link
                        href={`/loads/${load.id}`}
                        className="z-identifier text-sm font-medium text-ink hover:text-accent"
                      >
                        {load.loadNumber}
                      </Link>
                      <p className="truncate text-xs text-ink-2">
                        {load.customerName}
                      </p>
                      <p className="truncate text-xs text-ink-3">
                        {load.route}
                      </p>
                      {canAssign ? (
                        <Button
                          type="button"
                          variant="ghost"
                          size="compact"
                          className="mt-z1 px-0"
                          onClick={() => setPicking(load)}
                        >
                          {labels.assign}
                        </Button>
                      ) : null}
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </aside>

      {/* The board itself. One scroll container, per standing rule 6. */}
      <div className="min-h-0 flex-1 overflow-auto bg-surface">
        {trucks.length === 0 ? (
          <p className="px-gutter py-z5 text-sm text-ink-2">
            {labels.noTrucks}
          </p>
        ) : (
          <table className="w-full border-collapse">
            <thead>
              <tr>
                <th
                  scope="col"
                  className="sticky top-0 z-10 border-b border-e border-border bg-surface-2 px-z3 py-z2 text-start text-xs font-semibold uppercase tracking-[0.04em] text-ink-2"
                >
                  {labels.truck}
                </th>
                {days.map((day) => (
                  <th
                    key={day}
                    scope="col"
                    className="sticky top-0 z-10 border-b border-e border-border bg-surface-2 px-z2 py-z2 text-start text-xs font-semibold uppercase tracking-[0.04em] text-ink-2"
                  >
                    {day}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {trucks.map((truck) => (
                <tr key={truck.id} className="border-b border-border">
                  <th
                    scope="row"
                    className="border-e border-border px-z3 py-z2 text-start align-top"
                  >
                    <span className="z-identifier text-sm font-medium text-ink">
                      {truck.unitNumber}
                    </span>
                    <span className="block text-xs text-ink-2">
                      {truck.driverName ?? '—'}
                    </span>
                    <span className="block text-xs text-ink-3">
                      {truck.companyName}
                    </span>
                  </th>

                  {days.map((day, index) => {
                    const cell = truck.loadsByDay[index] ?? []
                    return (
                      <td
                        key={day}
                        className="border-e border-border p-z1 align-top"
                      >
                        {cell.map((load) => (
                          <Link
                            key={load.id}
                            href={`/loads/${load.id}`}
                            className={cx(
                              'mb-z1 flex items-stretch rounded-control border border-border bg-surface hover:bg-surface-3',
                              load.isCancelled && 'opacity-60',
                            )}
                          >
                            <span
                              aria-hidden
                              className={cx(
                                'w-[3px] rounded-s-control',
                                TONE_STRIPE[
                                  load.isCancelled ? 'muted' : load.tone
                                ],
                              )}
                            />
                            <span className="min-w-0 flex-1 px-z2 py-z1">
                              <span className="z-identifier block text-xs font-medium text-ink">
                                {load.loadNumber}
                              </span>
                              <span className="block truncate text-xs text-ink-3">
                                {load.route}
                              </span>
                            </span>
                          </Link>
                        ))}
                      </td>
                    )
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {picking ? (
        <AssignModal
          load={picking}
          trucks={trucks}
          drivers={drivers}
          onClose={() => setPicking(null)}
          labels={labels}
        />
      ) : null}
    </div>
  )
}

function AssignModal({
  load,
  trucks,
  drivers,
  onClose,
  labels,
}: {
  load: BoardLoad
  trucks: readonly BoardTruck[]
  drivers: readonly BoardDriver[]
  onClose: () => void
  labels: Props['labels']
}) {
  const [choice, setChoice] = useState<BoardTruck | null>(null)
  const [driver, setDriver] = useState<BoardDriver | null>(null)
  const [state, act, pending] = useActionState<AssignState, FormData>(
    assignAction.bind(null, load.id),
    ASSIGN_INITIAL,
  )

  // A truck with a driver brings its own; a truck with nobody in it needs one
  // named here. §7 dispatches on truck AND driver, so a board that could only
  // attach a truck would leave the load at Booked and look like it had failed.
  const driverId = choice?.driverId ?? driver?.id ?? ''

  return (
    <Modal
      open
      title={`${labels.assignTitle} ${load.loadNumber}`}
      onClose={onClose}
    >
      <p className="text-sm text-ink-2">{labels.assignBody}</p>

      <form action={act} className="mt-z3 flex flex-col gap-z2">
        {/* The choice travels in the form. See the note in ./actions.ts. */}
        <input type="hidden" name="truckId" value={choice?.id ?? ''} />
        <input type="hidden" name="driverId" value={driverId} />
        {/* Real buttons in a real list: Tab reaches every truck and Enter
         * picks one. This is the keyboard path §11 requires, and it is the
         * only path — there is no drag to fall back from. */}
        <ul className="flex max-h-[280px] flex-col overflow-y-auto">
          {trucks.map((truck) => (
            <li key={truck.id}>
              <button
                type="button"
                aria-pressed={choice?.id === truck.id}
                onClick={() => {
                  setChoice(truck)
                  // A driver picked for the previous truck is not a driver
                  // picked for this one.
                  setDriver(null)
                }}
                className={cx(
                  'flex w-full items-baseline gap-z2 border-b border-border px-z2 py-z2 text-start',
                  choice?.id === truck.id
                    ? 'bg-accent-soft text-accent'
                    : 'hover:bg-surface-3',
                )}
              >
                <span className="z-identifier text-sm font-medium">
                  {truck.unitNumber}
                </span>
                <span className="text-xs text-ink-2">
                  {truck.driverName ?? '—'}
                </span>
                <span className="ms-auto text-xs text-ink-3">
                  {truck.companyName}
                </span>
              </button>
            </li>
          ))}
        </ul>

        {/* Only when the truck has nobody in it. A truck that already has a
         * driver keeps them, which is what the body text promises — offering
         * a second list there would be inviting a change nobody asked for. */}
        {choice && choice.driverId === null ? (
          <>
            <p className="text-sm text-ink-2">{labels.driverNone}</p>
            <ul className="flex max-h-[200px] flex-col overflow-y-auto">
              {drivers.map((candidate) => (
                <li key={candidate.id}>
                  <button
                    type="button"
                    aria-pressed={driver?.id === candidate.id}
                    onClick={() => setDriver(candidate)}
                    className={cx(
                      'flex w-full items-baseline gap-z2 border-b border-border px-z2 py-z2 text-start',
                      driver?.id === candidate.id
                        ? 'bg-accent-soft text-accent'
                        : 'hover:bg-surface-3',
                    )}
                  >
                    <span className="text-sm">{candidate.name}</span>
                  </button>
                </li>
              ))}
            </ul>
          </>
        ) : null}

        {choice && choice.driverId !== null ? (
          <p className="text-sm text-ink-2">
            {labels.driverKeep.replace('{driver}', choice.driverName ?? '')}
          </p>
        ) : null}

        {state.error ? (
          <p role="alert" className="text-base text-danger">
            {state.error}
          </p>
        ) : null}

        <div className="flex justify-end gap-z2">
          <Button type="button" variant="ghost" onClick={onClose}>
            {labels.cancel}
          </Button>
          <Button
            type="submit"
            variant="primary"
            disabled={pending || choice === null}
          >
            {labels.assign}
          </Button>
        </div>
      </form>
    </Modal>
  )
}
