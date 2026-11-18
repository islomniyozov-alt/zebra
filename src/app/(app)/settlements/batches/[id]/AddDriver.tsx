'use client'

import { useActionState } from 'react'
import { Button } from '@/components/ui/Button'
import { addDriverAction, type BatchState } from '../actions'

const INITIAL: BatchState = { error: null, blocked: [] }

interface Props {
  batchId: string
  /** The drivers this batch has left a trip of out, with how many. */
  drivers: readonly { driverId: string; driverName: string; trips: number }[]
  labels: { add: string; hint: string; none: string }
}

/**
 * ADD DRIVER (§6.2.10 part 7 step 3, R14 (b)): put back every trip of one
 * driver that this batch left out. The server reads which trips from the
 * batch's own exclusions; the form names only the driver.
 */
export function AddDriver({ batchId, drivers, labels }: Props) {
  const [state, add, adding] = useActionState(
    addDriverAction.bind(null, batchId),
    INITIAL,
  )
  if (drivers.length === 0) {
    return <p className="text-xs text-ink-3">{labels.none}</p>
  }
  return (
    <form action={add} className="flex flex-wrap items-center gap-z2">
      <label className="flex items-center gap-z2 text-xs text-ink-2">
        <span className="sr-only">{labels.add}</span>
        <select
          name="driverId"
          className="h-control rounded-control border border-border-strong bg-surface px-z2 text-sm text-ink"
        >
          {drivers.map((driver) => (
            <option key={driver.driverId} value={driver.driverId}>
              {driver.driverName} · {driver.trips}
            </option>
          ))}
        </select>
      </label>
      <Button
        type="submit"
        variant="secondary"
        size="compact"
        disabled={adding}
        title={labels.hint}
      >
        {labels.add}
      </Button>
      {state.error ? (
        <p className="text-xs text-danger" role="alert">
          {state.error}
        </p>
      ) : null}
    </form>
  )
}
