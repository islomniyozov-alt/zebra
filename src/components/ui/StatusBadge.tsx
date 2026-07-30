import { TONE_FILLED, TONE_OUTLINED, type StatusTone } from '@/lib/status'
import { cx } from '@/lib/cx'

// §7.2. 11px, weight 500, 4px radius, 2px/8px padding, 1px border in the text
// hue.
//
// A load carries TWO badges side by side and they must be distinguishable at a
// glance, so they differ in construction rather than only in hue:
//
//   operational → filled    (soft background, solid border)
//   billing     → outlined  (transparent background, 1px border, coloured text)
//
// A dispatcher learns that in about ten seconds and then never reads carefully
// again. And the word is always present — never colour alone (standing rule 5).

interface StatusBadgeProps {
  tone: StatusTone
  /** The status word. Colour reinforces it; it never replaces it. */
  label: string
  variant?: 'filled' | 'outlined'
}

export function StatusBadge({
  tone,
  label,
  variant = 'filled',
}: StatusBadgeProps) {
  return (
    <span
      className={cx(
        'inline-flex items-center rounded-control border px-z2 py-[2px] text-xs font-medium whitespace-nowrap',
        variant === 'filled' ? TONE_FILLED[tone] : TONE_OUTLINED[tone],
      )}
    >
      {label}
    </span>
  )
}
