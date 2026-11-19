'use client'

import { useActionState, type ReactNode } from 'react'
import Link from 'next/link'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { Select, type SelectOption } from '@/components/ui/Select'
import {
  RECORD_FORM_INITIAL,
  type RecordFormState,
} from '@/components/forms/RecordForm'

// ---------------------------------------------------------------------------
// THE DRIVER RECORD'S MAIN TAB IN DATATRUCK'S SHAPE (§6.4 part 2, v11.22).
//
// Two columns, ONE form and one Save, posting to the same `updateDriverAction`
// as before — the layout moved, the writer did not. `RecordForm` is a single
// column by design and four forms share it, so this screen has its own frame
// and reuses the same `Input` and `Select`, the same state shape and the same
// error placement (§7.5: label above, the refusal under its own field).
//
// THE DERIVED FACTS ARE READ-ONLY TEXT, NOT DISABLED INPUTS. Driver status,
// tenure, the authority and the team are worked out elsewhere; a greyed field
// says "not now", and these mean "not here". Each says where it comes from.
// ---------------------------------------------------------------------------

export interface DriverMainField {
  name: string
  label: string
  // `number` since the truck record took this frame (TMS v11.36 §6.5 part 2).
  kind: 'text' | 'tel' | 'email' | 'date' | 'number' | 'select' | 'textarea'
  options?: readonly SelectOption[]
  required?: boolean
  hint?: string
  mono?: boolean
}

/** A read-only line: a label and what it says. */
export interface DriverMainFact {
  label: string
  value: ReactNode
  hint?: string
}

export interface DriverMainSection {
  title: string
  /** Rendered at the top of the section — the photo. */
  lead?: ReactNode
  /** Fields and facts in the order the brief lists them. */
  items: readonly (
    | { field: DriverMainField }
    | { fact: DriverMainFact }
    | { note: ReactNode }
  )[]
}

export function DriverMainForm({
  left,
  right,
  values,
  action,
  cancelHref,
  labels,
  readOnly = false,
  children,
}: {
  left: readonly DriverMainSection[]
  right: readonly DriverMainSection[]
  values: Readonly<Record<string, string>>
  action: (
    previous: RecordFormState,
    formData: FormData,
  ) => Promise<RecordFormState>
  cancelHref: string
  labels: { save: string; cancel: string }
  /**
   * A role without `driver:update` reads the record and cannot post it. The
   * form was rendered with Save for every role and the action refused with a
   * ForbiddenError `toFormState` rethrows, so a dispatcher's Save landed on
   * the error page (clickable audit, 2026-11-17). Read-only disables every
   * field and shows no Save.
   */
  readOnly?: boolean
  /** Rendered under the form — the authority actions. */
  children?: ReactNode
}) {
  const [state, formAction, pending] = useActionState(
    action,
    RECORD_FORM_INITIAL,
  )

  const errorFor = (name: string) =>
    state.field === name && state.error ? state.error : undefined

  const renderField = (field: DriverMainField) => {
    const error = errorFor(field.name)
    if (field.kind === 'select') {
      return (
        <Select
          key={field.name}
          name={field.name}
          label={field.label}
          options={field.options ?? []}
          defaultValue={values[field.name] ?? ''}
          required={field.required}
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
        // A STABLE ID PER FIELD, so a link can land on it — the DQF's hire-
        // date row links to `#field-hireDate` (§6.4 part 2 v11.30).
        id={`field-${field.name}`}
        name={field.name}
        label={field.label}
        type={field.kind}
        defaultValue={values[field.name] ?? ''}
        required={field.required}
        hint={field.hint}
        error={error}
        className={field.mono ? 'font-mono' : undefined}
      />
    )
  }

  const renderSection = (section: DriverMainSection) => (
    <section
      key={section.title}
      className="flex flex-col gap-z4 rounded-card border border-border bg-surface p-z4"
    >
      <h2 className="text-md font-medium text-ink">{section.title}</h2>
      {section.lead}
      {section.items.map((item, index) => {
        if ('field' in item) return renderField(item.field)
        if ('fact' in item) {
          return (
            <div key={item.fact.label} className="flex flex-col gap-z1">
              <span className="text-sm font-medium text-ink-2">
                {item.fact.label}
              </span>
              <span className="text-base text-ink">{item.fact.value}</span>
              {item.fact.hint ? (
                <span className="text-xs text-ink-3">{item.fact.hint}</span>
              ) : null}
            </div>
          )
        }
        return (
          <p key={`note-${index}`} className="text-sm text-ink-2">
            {item.note}
          </p>
        )
      })}
    </section>
  )

  return (
    <>
      <form action={formAction} className="flex max-w-[1100px] flex-col gap-z4">
        <fieldset disabled={readOnly} className="contents">
          <div className="grid gap-z4 lg:grid-cols-2">
            <div className="flex min-w-0 flex-col gap-z4">
              {left.map(renderSection)}
            </div>
            <div className="flex min-w-0 flex-col gap-z4">
              {right.map(renderSection)}
            </div>
          </div>
        </fieldset>

        {/* A message with no field of its own still has to land somewhere. */}
        {state.error && !state.field ? (
          <p role="alert" className="text-base text-danger">
            {state.error}
          </p>
        ) : null}

        <div className="flex items-center gap-z2">
          {readOnly ? null : (
            <Button type="submit" variant="primary" disabled={pending}>
              {labels.save}
            </Button>
          )}
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
