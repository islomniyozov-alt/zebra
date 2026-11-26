'use server'

import { revalidatePath } from 'next/cache'
import { currentUserCan, withCurrentOrg } from '@/lib/auth-context'
import { getLocaleContext } from '@/lib/locale'
import { LOAD_WRITE_TIMEOUT_MS } from '@/lib/loads'
import { saveLoadEdit } from '@/lib/load-edit'
import { cents, readStops } from '@/lib/load-form'
import { DispatchConflictError } from '@/lib/dispatch'
import {
  REFERENCE_ERROR_KEYS,
  ReferenceError,
  optionalText,
} from '@/lib/reference'
import type { CreateLoadState } from '../../new/actions'

/**
 * Save Edit load (TMS §7.14 part 7). Reads Add load's form, calls
 * `saveLoadEdit`, revalidates. Returns the load's id, which is the form's
 * signal to open the load (§0 rule 15).
 */
export async function saveLoadEditAction(
  loadId: string,
  _previous: CreateLoadState,
  formData: FormData,
): Promise<CreateLoadState> {
  const { t } = await getLocaleContext()
  // §1.3, as on Add load: a role that may not set a rate has no rate field,
  // and a rate posted anyway is ignored rather than written.
  const maySetRate = await currentUserCan('update', 'load.financials')

  try {
    await withCurrentOrg(
      'update',
      'load',
      (tx, session) =>
        saveLoadEdit(
          tx,
          session.organizationId,
          loadId,
          {
            broker: String(formData.get('broker') ?? ''),
            truckId: optionalText(formData.get('truckId')),
            driverId: optionalText(formData.get('driverId')),
            stops: readStops(formData),
            bolNumber: optionalText(formData.get('bol')),
            poNumber: optionalText(formData.get('po')),
            referenceNumber: optionalText(formData.get('reference')),
            miles: optionalText(formData.get('miles')),
            ...(maySetRate
              ? { linehaulCents: cents(formData.get('rate')) }
              : {}),
          },
          { byUserId: session.userId },
        ),
      { timeoutMs: LOAD_WRITE_TIMEOUT_MS },
    )
  } catch (error) {
    if (error instanceof DispatchConflictError) {
      const first = error.conflicts[0]
      const sentences = error.conflicts.map((conflict) =>
        Object.entries(conflict.values).reduce(
          (message, [key, value]) => message.replaceAll(`{${key}}`, value),
          t(conflict.messageKey),
        ),
      )
      return {
        error: sentences.join(' '),
        field: first?.asset === 'driver' ? 'driverId' : 'truckId',
        loadId: null,
      }
    }
    if (error instanceof ReferenceError) {
      return {
        error: t(REFERENCE_ERROR_KEYS[error.code]),
        field: error.field ?? null,
        loadId: null,
      }
    }
    throw error
  }

  revalidatePath(`/loads/${loadId}`)
  revalidatePath('/loads')
  return { error: null, field: null, loadId }
}
