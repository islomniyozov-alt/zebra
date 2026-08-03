'use client'

import { useActionState, useState } from 'react'
import Link from 'next/link'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { Select } from '@/components/ui/Select'
import { composeCredentialMessage } from '@/lib/share-message'
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
  /**
   * The origin to tell the new person to visit.
   *
   * From APP_ORIGIN on the server, so the address in the hand-over message is
   * the same one the reset links use. Falls back to the host the admin is
   * actually on, which is never wrong and occasionally less canonical.
   */
  signInOrigin: string | null
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
    shareTelegram: string
    shareCopy: string
    shareCopied: string
    shareCopyFailed: string
    shareIntro: string
    shareEmail: string
    sharePassword: string
    shareInstruction: string
  }
  translate: Record<string, string>
}

export function NewUserForm({
  roles,
  companies,
  signInOrigin,
  labels,
  translate,
}: Props) {
  const [state, action, pending] = useActionState<CreateUserState, FormData>(
    createUserAction,
    CREATE_USER_INITIAL,
  )

  if (state.created) {
    return (
      <CreatedPanel
        created={state.created}
        signInOrigin={signInOrigin}
        labels={labels}
      />
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

/**
 * The one screen in the application that shows a credential — and now the one
 * that hands it over.
 *
 * The message is composed from the values that were just created, never from
 * anything retyped. A 32-character base64url password with one transposed
 * character is invisible to the eye and produces "it doesn't work" an hour
 * later, from somebody who cannot tell you which character.
 */
function CreatedPanel({
  created,
  signInOrigin,
  labels,
}: {
  created: NonNullable<CreateUserState['created']>
  signInOrigin: string | null
  labels: Props['labels']
}) {
  const [copied, setCopied] = useState(false)
  const [copyFailed, setCopyFailed] = useState(false)

  // `window.location.origin` only when APP_ORIGIN is unset. Reading it during
  // render would differ between the server pass and the client one, so it is
  // resolved on demand, inside the handlers, where there is always a window.
  const originOf = () =>
    signInOrigin ??
    (typeof window === 'undefined' ? '' : window.location.origin)

  const message = () =>
    composeCredentialMessage(
      originOf(),
      created.email,
      created.temporaryPassword,
      {
        intro: labels.shareIntro,
        email: labels.shareEmail,
        password: labels.sharePassword,
        instruction: labels.shareInstruction,
      },
    )

  const copy = async () => {
    setCopyFailed(false)
    try {
      await navigator.clipboard.writeText(message().full)
      setCopied(true)
    } catch {
      // Clipboard access can be refused by policy or by an insecure context.
      // Saying so beats a button that appears to work and copies nothing.
      setCopyFailed(true)
    }
  }

  return (
    <div className="rounded-card border border-success bg-success-soft p-z4">
      <h2 className="text-md font-medium text-ink">{labels.created}</h2>
      <p className="mt-z1 text-base text-ink">
        {created.name}{' '}
        <span className="font-mono text-ink-2">{created.email}</span>
      </p>

      <p className="mt-z4 text-xs font-semibold uppercase tracking-[0.04em] text-ink-2">
        {labels.tempPassword}
      </p>
      {/* Mono, large, selectable: it will be read aloud or copied, and §4
       * puts identifiers in mono for exactly that reason. */}
      <p className="mt-z1 select-all break-all font-mono text-md text-ink">
        {created.temporaryPassword}
      </p>
      <p className="mt-z2 max-w-[60ch] text-sm text-ink-2">
        {labels.tempPasswordHint}
      </p>

      {/* Delivery. Telegram first because that is what this operation uses;
       * copy second because desktop Telegram handles t.me links unevenly and a
       * share button that opens nothing is worse than no share button.
       *
       * A plain <a>, not a Button-with-onClick: it is a link to another
       * application, and middle-click and "open in new tab" should work the way
       * every other link does. */}
      <div className="mt-z4 flex flex-wrap items-center gap-z2">
        <a
          href={message().telegramHref}
          target="_blank"
          rel="noopener noreferrer"
          className="h-control rounded-control bg-accent px-z3 text-base font-medium leading-[32px] text-surface hover:bg-accent-hover"
        >
          {labels.shareTelegram}
        </a>
        <Button type="button" variant="secondary" onClick={copy}>
          {copied ? labels.shareCopied : labels.shareCopy}
        </Button>
      </div>

      {copyFailed ? (
        <p role="alert" className="mt-z2 text-sm text-danger">
          {labels.shareCopyFailed}
        </p>
      ) : null}

      {/* Separate, and after. "I have sent it" is the admin's own record that
       * the hand-over happened; it is not a consequence of clicking share. */}
      <div className="mt-z5 border-t border-border pt-z3">
        <Link href="/users">
          <Button variant="primary">{labels.done}</Button>
        </Link>
      </div>
    </div>
  )
}
