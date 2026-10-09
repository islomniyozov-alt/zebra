'use client'

import { setDensityAction } from './view-actions'
import type { Density } from '@/lib/preferences'

// §5.1 — density is a per-user preference. Submits on change: a "save" button
// beside a three-item select is a second click to confirm something the eye
// has already confirmed.
//
// ITS OWN COMPONENT since §6.7 chain two, because the loads list moved it into
// the filter bar's second row while `/drivers` keeps it on the saved-views row.
// One control, two places, one action.

interface Props {
  density: Density
  labels: {
    density: string
    densities: readonly { value: Density; label: string }[]
  }
}

export function DensityControl({ density, labels }: Props) {
  return (
    <form action={setDensityAction} className="flex items-center">
      <label htmlFor="density" className="me-z2 text-xs font-medium text-ink-3">
        {labels.density}
      </label>
      <select
        id="density"
        name="density"
        defaultValue={density}
        onChange={(event) => event.currentTarget.form?.requestSubmit()}
        className="h-control-compact rounded-control border border-border-strong bg-surface px-z1 text-xs text-ink-2"
      >
        {labels.densities.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </form>
  )
}
