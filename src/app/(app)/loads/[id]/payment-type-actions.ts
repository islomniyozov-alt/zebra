'use server'

import { revalidatePath } from 'next/cache'
import { withCurrentOrg } from '@/lib/auth-context'
import { getLocaleContext } from '@/lib/locale'
import { LOAD_WRITE_TIMEOUT_MS, updateLoad } from '@/lib/loads'
import {
  REFERENCE_ERROR_KEYS,
  ReferenceError as ReferenceFailure,
} from '@/lib/reference'
import type { PaymentTypeState } from './PaymentTypePanel'

// ---------------------------------------------------------------------------
// ONE FIELD, ONE ACTION.
//
// `setRateAction` was the tempting home and it is the wrong one: `setLoadRate`
// parses money and returns money failures. Threading a code list through it
// would make one function answer two unrelated questions, and the first money
// bug would arrive wearing a payment-type error message.
//
// A MAPPER, NOT A DECISION — the same shape as the other actions here.
// `updateLoad` validates the code against `payment-types.ts` and refuses it on
// closed history; this turns the outcome into a sentence.
// ---------------------------------------------------------------------------

export async function setPaymentTypeAction(
  loadId: string,
  _previous: PaymentTypeState,
  formData: FormData,
): Promise<PaymentTypeState> {
  const { t } = await getLocaleContext()
  const raw = String(formData.get('paymentType') ?? '')

  try {
    await withCurrentOrg(
      'update',
      'load.financials',
      (tx, session) =>
        updateLoad(
          tx,
          loadId,
          // BLANK IS A REAL CHOICE: it clears the arrangement back to "nobody
          // has said", which is the state every load booked before this
          // existed is in.
          { paymentType: raw === '' ? null : raw },
          { byUserId: session.userId },
        ),
      { timeoutMs: LOAD_WRITE_TIMEOUT_MS },
    )
  } catch (error) {
    if (error instanceof ReferenceFailure) {
      return { error: t(REFERENCE_ERROR_KEYS[error.code]), saved: false }
    }
    // A code that is not one of the four throws a TypeError from
    // `readPaymentType`. It should not be reachable from this select, so it is
    // reported rather than swallowed.
    if (error instanceof TypeError) {
      return { error: error.message, saved: false }
    }
    throw error
  }

  revalidatePath(`/loads/${loadId}`)
  revalidatePath('/loads')
  return { error: null, saved: true }
}
