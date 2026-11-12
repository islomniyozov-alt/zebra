'use client'

import { useActionState } from 'react'
import { Button } from '@/components/ui/Button'
import { Select } from '@/components/ui/Select'
import { linkSignInAction, unlinkSignInAction } from '../link-actions'
import { SIGN_IN_LINK_INITIAL, type SignInLinkState } from '../link-state'

// THE SIGN-IN CARD ON MAIN (Phase 7 step 1; TMS-DESIGN-SYSTEM.md §6.4 part 2,
// §9 "The link"). Rendered for OWNER and ADMIN only — the page leaves it out
// of the payload for everyone else, which is the rule, not a hidden panel.
//
// ONE PICK, ONE BUTTON. Linked: the name, the address, a word if the sign-in
// is deactivated, and Unlink. Not linked: a select over the users the
// predicate offers and Link. Terminated: a sentence and no control, because
// the write would refuse and a disabled select says less than the sentence.

interface LinkedUser {
  name: string
  email: string
  isActive: boolean
  /** Formatted by the page in the driver's authority zone; null = never. */
  lastSignIn: string | null
}

interface Candidate {
  userId: string
  name: string
  email: string
  isActive: boolean
}

interface Props {
  driverId: string
  linked: LinkedUser | null
  candidates: Candidate[]
  terminated: boolean
  labels: {
    title: string
    hint: string
    none: string
    linked: string
    deactivated: string
    lastSignIn: string
    never: string
    pick: string
    noCandidates: string
    terminated: string
    link: string
    linking: string
    unlink: string
    saved: string
  }
}

export function SignInLink({
  driverId,
  linked,
  candidates,
  terminated,
  labels,
}: Props) {
  const [linkState, linkAction, linking] = useActionState<
    SignInLinkState,
    FormData
  >(linkSignInAction.bind(null, driverId), SIGN_IN_LINK_INITIAL)
  const [unlinkState, unlinkAction, unlinking] = useActionState<
    SignInLinkState,
    FormData
  >(unlinkSignInAction.bind(null, driverId), SIGN_IN_LINK_INITIAL)

  const state = linked ? unlinkState : linkState
  const options = candidates.map((candidate) => ({
    value: candidate.userId,
    label: candidate.isActive
      ? `${candidate.name} · ${candidate.email}`
      : `${candidate.name} · ${candidate.email} (${labels.deactivated})`,
  }))

  return (
    <section className="mt-z5 max-w-[720px] rounded-control border border-border bg-surface p-z4">
      <h2 className="text-sm font-medium uppercase tracking-[0.04em] text-ink-2">
        {labels.title}
      </h2>
      <p className="mt-z1 text-xs text-ink-3">{labels.hint}</p>

      {linked ? (
        <form action={unlinkAction} className="mt-z3 flex flex-col gap-z3">
          <p className="text-sm text-ink">
            <span className="text-ink-2">{labels.linked}</span> {linked.name} ·{' '}
            <span dir="ltr" className="text-ink-2">
              {linked.email}
            </span>
            {linked.isActive ? null : (
              <span className="ms-z2 text-xs text-warning">
                {labels.deactivated}
              </span>
            )}
          </p>
          <p className="text-xs text-ink-3">
            {labels.lastSignIn}{' '}
            <span className="text-ink-2">
              {linked.lastSignIn ?? labels.never}
            </span>
          </p>
          <div>
            <Button type="submit" variant="secondary" disabled={unlinking}>
              {labels.unlink}
            </Button>
          </div>
        </form>
      ) : terminated ? (
        <p className="mt-z3 text-sm text-ink-2">{labels.terminated}</p>
      ) : options.length === 0 ? (
        <p className="mt-z3 text-sm text-ink-2">{labels.noCandidates}</p>
      ) : (
        <form action={linkAction} className="mt-z3 flex flex-col gap-z3">
          <p className="text-sm text-ink-2">{labels.none}</p>
          <Select
            name="userId"
            label={labels.pick}
            options={options}
            disabled={linking}
            required
          />
          <div>
            <Button type="submit" disabled={linking}>
              {linking ? labels.linking : labels.link}
            </Button>
          </div>
        </form>
      )}

      {state.error ? (
        <p role="alert" className="mt-z2 text-sm text-danger">
          {state.error}
        </p>
      ) : null}
      {state.saved && !state.error ? (
        <p role="status" className="mt-z2 text-sm text-ink-2">
          {labels.saved}
        </p>
      ) : null}
    </section>
  )
}
