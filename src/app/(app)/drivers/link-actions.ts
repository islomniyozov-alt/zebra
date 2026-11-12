'use server'

import { revalidatePath } from 'next/cache'
import { withCurrentOrg } from '@/lib/auth-context'
import {
  linkDriverSignIn,
  unlinkDriverSignIn,
  type LinkFailure,
  type UnlinkFailure,
} from '@/lib/driver-link'
import { getLocaleContext } from '@/lib/locale'
import { toFormState } from '../_reference/shared'
import type { SignInLinkState } from './link-state'
import type { MessageKey } from '@/lib/i18n'

// THE LINK IS A `user:update` WRITE (PHASE-7-BRIEF.md §4.6, ruled 2026-11-12):
// OWNER and ADMIN hold it alone; a MANAGER edits the driver and never this.
// permissions.ts decides that; this asks. The rule itself lives in
// src/lib/driver-link.ts, where a test can reach it — an action reads the
// form, calls one function, and revalidates (AGENTS.md).

const LINK_ERRORS: Record<LinkFailure, MessageKey> = {
  driver_not_found: 'drivers.signIn.error.driverNotFound',
  driver_removed: 'drivers.signIn.error.driverRemoved',
  driver_terminated: 'drivers.signIn.error.driverTerminated',
  driver_already_linked: 'drivers.signIn.error.driverAlreadyLinked',
  not_a_member: 'drivers.signIn.error.notAMember',
  not_a_driver_role: 'drivers.signIn.error.notADriverRole',
  user_already_linked: 'drivers.signIn.error.userAlreadyLinked',
}

const UNLINK_ERRORS: Record<UnlinkFailure, MessageKey> = {
  driver_not_found: 'drivers.signIn.error.driverNotFound',
  not_linked: 'drivers.signIn.error.notLinked',
}

export async function linkSignInAction(
  driverId: string,
  _previous: SignInLinkState,
  formData: FormData,
): Promise<SignInLinkState> {
  const { t } = await getLocaleContext()
  const userId = String(formData.get('userId') ?? '').trim()
  // An empty pick is "not a member": the predicate's first refusal, and the
  // words are right — nobody by that id is here.
  if (userId === '') {
    return { error: t('drivers.signIn.error.notAMember'), saved: false }
  }

  let outcome
  try {
    outcome = await withCurrentOrg('update', 'user', (tx, session) =>
      linkDriverSignIn(tx, session.organizationId, driverId, userId),
    )
  } catch (error) {
    return { error: toFormState(error, t).error, saved: false }
  }
  if (!outcome.ok)
    return { error: t(LINK_ERRORS[outcome.reason]), saved: false }

  revalidatePath(`/drivers/${driverId}`)
  revalidatePath('/users')
  return { error: null, saved: true }
}

export async function unlinkSignInAction(
  driverId: string,
  _previous: SignInLinkState,
): Promise<SignInLinkState> {
  const { t } = await getLocaleContext()

  let outcome
  try {
    outcome = await withCurrentOrg('update', 'user', (tx) =>
      unlinkDriverSignIn(tx, driverId),
    )
  } catch (error) {
    return { error: toFormState(error, t).error, saved: false }
  }
  if (!outcome.ok) {
    return { error: t(UNLINK_ERRORS[outcome.reason]), saved: false }
  }

  revalidatePath(`/drivers/${driverId}`)
  revalidatePath('/users')
  return { error: null, saved: true }
}
