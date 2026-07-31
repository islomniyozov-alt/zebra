'use client'

import { useActionState } from 'react'
import Link from 'next/link'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { Select, type SelectOption } from '@/components/ui/Select'

// §7.5 — label above input, required marked (never optional), errors under the
// field saying what to do. Four reference forms share this rather than each
// growing its own version of the same twelve lines, because the version that
// drifts is the one nobody notices drifting.
//
// Not a form BUILDER. It renders a list of fields and posts them; it holds no
// validation and no domain knowledge. Every rule lives in src/lib/fleet.ts and
// src/lib/brokers.ts, where the routes can't reach past it.

export type FieldSpec =
  | {
      kind: 'text' | 'tel' | 'email' | 'date' | 'number'
      name: string
      label: string
      required?: boolean
      hint?: string
      autoFocus?: boolean
      /** Identifiers read character by character — VIN, MC, plate (§4). */
      mono?: boolean
    }
  | {
      kind: 'select'
      name: string
      label: string
      options: readonly SelectOption[]
      required?: boolean
      hint?: string
      autoFocus?: boolean
    }
  | { kind: 'textarea'; name: string; label: string; hint?: string }

export interface RecordFormState {
  /** Pre-translated sentence, or null. */
  error: string | null
  /** Which field the message belongs under, when it belongs under one. */
  field: string | null
}

export const RECORD_FORM_INITIAL: RecordFormState = { error: null, field: null }

interface RecordFormProps {
  fields: readonly FieldSpec[]
  values: Readonly<Record<string, string>>
  action: (
    previous: RecordFormState,
    formData: FormData,
  ) => Promise<RecordFormState>
  labels: { save: string; cancel: string }
  cancelHref: string
  /** Rendered under the buttons — retire, restore, transfer. */
  children?: React.ReactNode
}

export function RecordForm({
  fields,
  values,
  action,
  labels,
  cancelHref,
  children,
}: RecordFormProps) {
  const [state, formAction, pending] = useActionState(
    action,
    RECORD_FORM_INITIAL,
  )

  return (
    <>
      <form action={formAction} className="flex max-w-[520px] flex-col gap-z4">
        {fields.map((field) => {
          const error =
            state.field === field.name && state.error ? state.error : undefined

          if (field.kind === 'select') {
            return (
              <Select
                key={field.name}
                name={field.name}
                label={field.label}
                options={field.options}
                defaultValue={values[field.name] ?? ''}
                required={field.required}
                autoFocus={field.autoFocus}
                error={error}
              />
            )
          }

          if (field.kind === 'textarea') {
            return (
              <div key={field.name} className="flex flex-col gap-z1">
                <label
                  htmlFor={`field-${field.name}`}
                  className="text-sm font-medium text-ink-2"
                >
                  {field.label}
                </label>
                <textarea
                  id={`field-${field.name}`}
                  name={field.name}
                  rows={3}
                  defaultValue={values[field.name] ?? ''}
                  className="w-full rounded-control border border-border-strong bg-surface px-z2 py-z2 text-base text-ink"
                />
              </div>
            )
          }

          return (
            <Input
              key={field.name}
              name={field.name}
              label={field.label}
              type={field.kind === 'number' ? 'text' : field.kind}
              // inputMode rather than type=number: a spinner on a VIN or an
              // odometer is noise, and type=number silently drops what it
              // cannot parse instead of letting validation say why.
              inputMode={field.kind === 'number' ? 'numeric' : undefined}
              defaultValue={values[field.name] ?? ''}
              required={field.required}
              autoFocus={field.autoFocus}
              hint={field.hint}
              error={error}
              className={field.mono ? 'font-mono' : undefined}
            />
          )
        })}

        {/* A message with no field of its own still has to land somewhere. */}
        {state.error && !state.field ? (
          <p role="alert" className="text-base text-danger">
            {state.error}
          </p>
        ) : null}

        <div className="flex items-center gap-z2">
          <Button type="submit" variant="primary" disabled={pending}>
            {labels.save}
          </Button>
          <Link
            href={cancelHref}
            className="inline-flex h-control items-center rounded-control px-z3 text-base font-medium text-ink-2 hover:bg-surface-3"
          >
            {labels.cancel}
          </Link>
        </div>
      </form>

      {children}
    </>
  )
}
