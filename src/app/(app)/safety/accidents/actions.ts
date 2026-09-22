'use server'

import { revalidatePath } from 'next/cache'
import { withCurrentOrg } from '@/lib/auth-context'
import { getLocaleContext } from '@/lib/locale'
import { recordAccident, voidAccident } from '@/lib/accidents'
import { toFormState } from '../../_reference/shared'
import type { RecordFormState } from '@/components/forms/RecordForm'

// ITEM 14 — TWO ACTIONS, EACH ONE LINE OF DOMAIN.
//
// AGENTS.md: a `'use server'` action reads the form, calls one function and
// revalidates. Everything §390.5 and §390.15 have to say lives in
// `src/lib/accidents.ts`, where it can be tested without standing up an auth
// context — which is the whole reason that rule exists.

function read(formData: FormData) {
  return {
    companyId: String(formData.get('companyId') ?? ''),
    occurredAt: formData.get('occurredAt'),
    city: formData.get('city'),
    state: formData.get('state'),
    driverId: formData.get('driverId'),
    truckId: formData.get('truckId'),
    injuries: formData.get('injuries'),
    fatalities: formData.get('fatalities'),
    hazmatReleased: formData.get('hazmatReleased'),
    towedAway: formData.get('towedAway'),
    claimId: formData.get('claimId'),
    notes: formData.get('notes'),
    // NOT READ: anything resembling "recordable". The form does not offer it
    // and this would be the place a well-meaning edit reintroduced it.
  }
}

export async function recordAccidentAction(
  _previous: RecordFormState,
  formData: FormData,
): Promise<RecordFormState> {
  const { t } = await getLocaleContext()
  const input = read(formData)

  try {
    await withCurrentOrg('create', 'accident', (tx, session) =>
      recordAccident(tx, session.organizationId, input, {
        byUserId: session.userId,
      }),
    )
  } catch (error) {
    return toFormState(error, t)
  }

  revalidatePath('/safety/accidents')
  return { error: null, field: null }
}

export async function voidAccidentAction(
  id: string,
  _previous: RecordFormState,
  formData: FormData,
): Promise<RecordFormState> {
  const { t } = await getLocaleContext()

  try {
    // VOID, NOT DELETE. There is no delete action in this file and there is no
    // `deletedAt` on the table — a register entry that vanished is the shape
    // of falsification, whatever the intent behind it.
    await withCurrentOrg('update', 'accident', (tx) =>
      voidAccident(tx, id, formData.get('voidReason')),
    )
  } catch (error) {
    return toFormState(error, t)
  }

  revalidatePath('/safety/accidents')
  return { error: null, field: null }
}
