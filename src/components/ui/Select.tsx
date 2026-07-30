import type { SelectHTMLAttributes } from 'react'
import { cx } from '@/lib/cx'

// §7.5, same shape as Input so a form reads as one thing.

export interface SelectOption {
  value: string
  label: string
}

interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
  label: string
  options: readonly SelectOption[]
  error?: string | undefined
  /** Hide the label visually but keep it for screen readers — filter bars. */
  labelHidden?: boolean
}

export function Select({
  label,
  options,
  error,
  labelHidden,
  id,
  className,
  ...rest
}: SelectProps) {
  const selectId = id ?? `select-${label.replace(/\s+/g, '-').toLowerCase()}`

  return (
    <div className="flex flex-col gap-z1">
      <label
        htmlFor={selectId}
        className={cx(
          'text-sm font-medium text-ink-2',
          labelHidden && 'sr-only',
        )}
      >
        {label}
      </label>
      <select
        {...rest}
        id={selectId}
        aria-invalid={error ? true : undefined}
        className={cx(
          'h-control rounded-control border bg-surface px-z2 text-base text-ink',
          'transition-colors duration-120 ease-out',
          error ? 'border-danger' : 'border-border-strong',
          className,
        )}
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
      {error ? <p className="text-sm text-danger">{error}</p> : null}
    </div>
  )
}
