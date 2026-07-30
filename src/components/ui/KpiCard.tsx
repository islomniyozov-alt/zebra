import { cx } from '@/lib/cx'

// §7.3. Label 11px ink-2 uppercase, value 24px weight 600 mono, delta 12px in
// success or danger with an explicit comparison period.
//
// No gradients. No sparkline unless the trend changes a decision. No icons
// (§14 lists all three as things that ship in every dashboard template and
// none of them here).
//
// The delta always names its period — "vs last week", never a bare arrow. An
// arrow on its own is a number without a denominator.

interface KpiCardProps {
  label: string
  /** Pre-formatted. Abbreviation ($2.5k) is permitted here and only here. */
  value: string
  delta?: {
    value: string
    direction: 'up' | 'down'
    /** "vs last week". Required — a bare arrow is not a comparison. */
    period: string
  }
}

export function KpiCard({ label, value, delta }: KpiCardProps) {
  return (
    <div className="flex flex-col gap-z1 rounded-card border border-border bg-surface p-z4">
      <span className="text-xs font-medium uppercase tracking-[0.06em] text-ink-2">
        {label}
      </span>
      <span className="font-mono text-xl font-semibold text-ink">{value}</span>
      {delta ? (
        <span
          className={cx(
            'text-sm',
            delta.direction === 'up' ? 'text-success' : 'text-danger',
          )}
        >
          {delta.value} <span className="text-ink-3">{delta.period}</span>
        </span>
      ) : null}
    </div>
  )
}
