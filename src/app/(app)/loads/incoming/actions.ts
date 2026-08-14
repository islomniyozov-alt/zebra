'use server'

import { revalidatePath } from 'next/cache'
import { withCurrentOrg } from '@/lib/auth-context'
import { dismissEmail } from '@/lib/inbound-email'

// The one write this screen has (Phase 6 §4 step 4).
//
// THERE IS NO CONFIRM ACTION HERE, and that is §1.1 rather than an omission.
// Confirming a draft is booking the load, which happens on the create form
// with the same warnings and the same Save every other load goes through. The
// queue's only verb of its own is the one that says "this was never freight".
//
// `load:update` RATHER THAN `load:delete`. Nothing is destroyed: the row keeps
// its message, its extraction and its original, and the state moves. A role
// that may correct a load may say a booking email was not one.

export async function dismissEmailAction(
  id: string,
  formData: FormData,
): Promise<void> {
  const reason = String(formData.get('reason') ?? '').trim()

  await withCurrentOrg('update', 'load', (tx, session) =>
    // ATTRIBUTED, unlike the arrival. A mail server delivered the message and
    // nobody was responsible for that; a person is deciding it is not freight,
    // and the row should say which one and when.
    dismissEmail(tx, id, session.userId, reason || null),
  )

  revalidatePath('/loads/incoming')
}
