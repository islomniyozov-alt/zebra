import type { ButtonHTMLAttributes, ReactNode } from 'react'
import { cx } from '@/lib/cx'

// §7.7. Four variants, and the third rule is the one that gets broken:
// destructive actions are never accent-coloured (standing rule 11). Danger or
// ghost only, so the blue button is always the safe one.
//
// Labels are verbs that name the outcome — "Add load", "Generate settlement".
// Never "Submit", never "OK" (§10). Nothing here can enforce that; the review
// can.

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger'
export type ButtonSize = 'compact' | 'default' | 'large'

const VARIANTS: Record<ButtonVariant, string> = {
  primary:
    'bg-accent text-surface border-accent hover:bg-accent-hover hover:border-accent-hover',
  secondary: 'bg-surface text-ink border-border-strong hover:bg-surface-3',
  ghost: 'bg-transparent text-ink border-transparent hover:bg-surface-3',
  danger: 'bg-danger text-surface border-danger hover:opacity-90',
}

const SIZES: Record<ButtonSize, string> = {
  compact: 'h-control-compact px-z3 text-xs',
  default: 'h-control px-z3 text-base',
  large: 'h-control-large px-z4 text-base',
}

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant
  size?: ButtonSize
  children: ReactNode
}

export function Button({
  variant = 'secondary',
  size = 'default',
  className,
  children,
  ...rest
}: ButtonProps) {
  return (
    <button
      {...rest}
      className={cx(
        'inline-flex items-center justify-center gap-z2 rounded-control border font-medium',
        'transition-colors duration-120 ease-out',
        'disabled:cursor-not-allowed disabled:opacity-50',
        // No fixed width anywhere: Russian runs ~30% longer than English and a
        // fixed-width button is where that shows up first (§12).
        'whitespace-nowrap',
        VARIANTS[variant],
        SIZES[size],
        className,
      )}
    >
      {children}
    </button>
  )
}
