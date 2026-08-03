'use client'

import { useActionState } from 'react'
import Link from 'next/link'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { Select } from '@/components/ui/Select'
import { createUserAction } from './actions'
import { CREATE_USER_INITIAL, type CreateUserState } from './user-state'

// The account-creation form, and the one screen in the application that shows
// a credential.
//
// THE PASSWORD IS RENDERED ONCE AND IS NOT RECOVERABLE. The server keeps only
// the argon2id hash, so there is no "show it again" to build. That is why the
// panel below is deliberately hard to miss and says out loud what it is: an
// admin who closes it too soon must deactivate the account and make another,
// which is a minor annoyance and a much better failure than a temporary
// password that lives in a support ticket for a month.
//
// It is NOT emailed. The reset transport reaches only the address that owns
// the Resend account until a sending domain is verified, so an invitation
// email would silently reach nobody at all.

interface Props {
  roles: readonly { value: string; label: string }[]
  companies: readonly { id: string; name: string }[]
  labels: {
    name: string
    email: string
    role: string
    scope: string
    scopeHint: string
    save: string
    cancel: string
    created: string
    tempPassword: string
    tempPasswordHint: string
    done: string
  }
  translate: Record<string, string>
}

export function NewUserForm({ roles, companies, labels, translate }: Props) {
  const [state, action, pending] = useActionState<CreateUserState, FormData>(
    createUserAction,
    CREATE_USER_INITIAL,
  )

  if (state.created) {
    return (
      <div className="rounded-card border border-success bg-success-soft p-z4">
        <h2 className="text-md font-medium text-ink">{labels.created}</h2>
        <p className="mt-z1 text-base text-ink">
          {state.created.name}{' '}
          <span className="font-mono text-ink-2">{state.created.email}</span>
        </p>

        <p className="mt-z4 text-xs font-semibold uppercase tracking-[0.04em] text-ink-2">
          {labels.tempPassword}
        </p>
        {/* Mono, large, selectable: it will be read aloud or copied, and §4
         * puts identifiers in mono for exactly that reason. */}
        <p className="mt-z1 select-all break-all font-mono text-md text-ink">
          {state.created.temporaryPassword}
        </p>
        <p className="mt-z2 max-w-[60ch] text-sm text-ink-2">
          {labels.tempPasswordHint}
        </p>

        <div className="mt-z4">
          <Link href="/users">
            <Button variant="primary">{labels.done}</Button>
          </Link>
        </div>
      </div>
    )
  }

  return (
    <form action={action} className="flex max-w-[520px] flex-col gap-z3">
      <Input name="name" label={labels.name} required autoFocus />
      <Input name="email" type="email" label={labels.email} required />
      <Select name="role" label={labels.role} options={roles} required />

      {companies.length > 1 ? (
        <fieldset className="flex flex-col gap-z1">
          <legend className="text-xs font-medium text-ink-2">
            {labels.scope}
          </legend>
          <p className="text-xs text-ink-3">{labels.scopeHint}</p>
          {companies.map((company) => (
            <label
              key={company.id}
              className="flex items-center gap-z2 text-base text-ink"
            >
              <input type="checkbox" name="companyIds" value={company.id} />
              {company.name}
            </label>
          ))}
        </fieldset>
      ) : null}

      {state.error ? (
        <p role="alert" className="text-base text-danger">
          {translate[state.error] ?? state.error}
        </p>
      ) : null}

      <div className="flex gap-z2">
        <Button type="submit" variant="primary" disabled={pending}>
          {labels.save}
        </Button>
        <Link href="/users">
          <Button type="button" variant="ghost">
            {labels.cancel}
          </Button>
        </Link>
      </div>
    </form>
  )
}
