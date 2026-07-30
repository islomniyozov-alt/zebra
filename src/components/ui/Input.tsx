import type { InputHTMLAttributes } from 'react'
import { cx } from '@/lib/cx'

// §7.5. Label above input, 12px ink-2. Mark required fields, not optional ones.
// Validate on blur, never on keystroke — that is the caller's job, but the
// error slot below exists so there is one place for it to land.
//
// Errors say what happened and what to do (§10): "Miles must be a whole
// number", not "Invalid input".

interface InputProps
  extends Omit<InputHTMLAttributes<HTMLInputElement>, 'size'> {
  label: string
  /** Shown under the field, in danger. Presence also sets aria-invalid. */
  error?: string | undefined
  /** Marks required. Optional fields are never marked (§7.5). */
  required?: boolean
  hint?: string | undefined
}

export function Input({
  label,
  error,
  hint,
  required,
  id,
  className,
  ...rest
}: InputProps) {
  const inputId = id ?? `input-${label.replace(/\s+/g, '-').toLowerCase()}`
  const errorId = `${inputId}-error`
  const hintId = `${inputId}-hint`

  return (
    <div className="flex flex-col gap-z1">
      <label htmlFor={inputId} className="text-sm font-medium text-ink-2">
        {label}
        {required ? (
          <span aria-hidden className="text-danger ms-z1">
            *
          </span>
        ) : null}
      </label>

      <input
        {...rest}
        id={inputId}
        required={required}
        aria-invalid={error ? true : undefined}
        aria-describedby={
          cx(error ? errorId : undefined, hint ? hintId : undefined) ||
          undefined
        }
        className={cx(
          'h-control w-full rounded-control border bg-surface px-z2 text-base text-ink',
          'placeholder:text-ink-3',
          'transition-colors duration-120 ease-out',
          'disabled:cursor-not-allowed disabled:bg-surface-2 disabled:text-ink-3',
          error ? 'border-danger' : 'border-border-strong',
          className,
        )}
      />

      {hint && !error ? (
        <p id={hintId} className="text-sm text-ink-3">
          {hint}
        </p>
      ) : null}

      {error ? (
        <p id={errorId} className="text-sm text-danger">
          {error}
        </p>
      ) : null}
    </div>
  )
}
