'use server'

import { revalidatePath } from 'next/cache'
import { withCurrentOrg } from '@/lib/auth-context'
import { getLocaleContext } from '@/lib/locale'
import { confirmUpload } from '@/lib/documents'
import { createLoad, LOAD_WRITE_TIMEOUT_MS } from '@/lib/loads'
import { resolveBroker, resolveLocation } from '@/lib/locations'
import { DispatchConflictError } from '@/lib/dispatch'
import {
  REFERENCE_ERROR_KEYS,
  ReferenceError,
  optionalText,
} from '@/lib/reference'
import { normalizeTypedDate } from '@/lib/typed-date'
import { resolveZone, zoneMidnight } from '@/lib/stop-time'
import { rememberAuthority } from '../../_reference/shared'

export interface CreateLoadState {
  /** Pre-translated sentence, or null. */
  error: string | null
  field: string | null
  /**
   * Set once the load exists, which is the signal for the form to start
   * attaching the rate confirmation. §9: the save is never blocked by an
   * in-flight document, so the document waits for the save rather than the
   * other way round.
   */
  loadId: string | null
}

/**
 * A typed date, at midnight **in the stop's own zone**.
 *
 * NOT UTC midnight, and the difference is a whole day. A pickup typed as
 * September 15th, stored at UTC midnight and then rendered in the stop's zone
 * per design rule 3, displays as "Sep 14, 19:00 CDT" — the rule's own failure
 * mode, committed by the code meant to honour it. Caught in a screenshot of
 * the Step 5 detail screen.
 *
 * Parsed here as well as in the browser, and not because the browser is
 * untrusted about dates — because the form works without JavaScript, and the
 * blur handler that normalises "810" into "2026-08-10" is JavaScript.
 */
function stopDate(
  value: unknown,
  place: { state: string | null; timezone: string | null },
): Date | null {
  const text = optionalText(value)
  if (text === null) return null
  const iso = normalizeTypedDate(text)
  if (iso === null) return null
  // The facility's recorded zone wins over the state's — that is the whole
  // point of Location.timezone.
  const { zone } = resolveZone(
    place.timezone,
    place.state,
    COMPANY_FALLBACK_ZONE,
  )
  return zoneMidnight(iso, zone)
}

/**
 * Where a stop with no state is assumed to be.
 *
 * The company's own zone would be better and is one query away; it is not read
 * here because this is the create path and the stop's state is almost always
 * present. Flagged in the Step 5 report.
 */
const COMPANY_FALLBACK_ZONE = 'America/Chicago'

/** "$2,450.00" → 245000. Money is an integer of cents the moment it is read. */
function cents(value: unknown): number {
  const text = optionalText(value)
  if (text === null) return 0
  const amount = Number(text.replace(/[,$\s]/g, ''))
  return Number.isFinite(amount) ? Math.round(amount * 100) : 0
}

export async function createLoadAction(
  _previous: CreateLoadState,
  formData: FormData,
): Promise<CreateLoadState> {
  const { t } = await getLocaleContext()

  const companyId = String(formData.get('companyId') ?? '')
  const pickup = String(formData.get('pickup') ?? '').trim()
  const delivery = String(formData.get('delivery') ?? '').trim()

  if (!pickup || !delivery) {
    return {
      error: t('ref.error.required'),
      field: pickup ? 'delivery' : 'pickup',
      loadId: null,
    }
  }

  try {
    const load = await withCurrentOrg(
      'create',
      'load',
      async (tx, session) => {
        // Create-on-miss, inside the same transaction as the load. A broker
        // created for a load that then fails to save would be a broker nobody
        // asked for; the rollback takes it with it.
        const customerId = await resolveBroker(
          tx,
          session.organizationId,
          formData.get('broker'),
        )
        const from = await resolveLocation(tx, session.organizationId, pickup)
        const to = await resolveLocation(tx, session.organizationId, delivery)

        return createLoad(
          tx,
          session.organizationId,
          {
            companyId,
            customerId,
            truckId: optionalText(formData.get('truckId')),
            driverId: optionalText(formData.get('driverId')),
            dispatchedMiles: formData.get('miles'),
            linehaulCents: cents(formData.get('rate')),
            stops: [
              {
                type: 'PICKUP',
                locationId: from.locationId,
                name: pickup,
                city: from.city,
                state: from.state,
                scheduledAt: stopDate(formData.get('pickupAt'), from),
              },
              {
                type: 'DELIVERY',
                locationId: to.locationId,
                name: delivery,
                city: to.city,
                state: to.state,
                scheduledAt: stopDate(formData.get('deliveryAt'), to),
              },
            ],
          },
          { byUserId: session.userId },
        )
      },
      // See LOAD_WRITE_TIMEOUT_MS: a create sends ~31 statements, and Prisma's
      // 5s default is not enough when the round trip is long.
      { timeoutMs: LOAD_WRITE_TIMEOUT_MS },
    )

    await rememberAuthority(companyId)
    revalidatePath('/loads')

    // PHASE 5 §1.5 — the mint attaches HERE, at save, to the load that now
    // exists. The document was uploaded and read before there was anything to
    // hang it on; this is the moment there is. Failing to attach must not lose
    // the load, so it is caught: a booked load with an unattached rate
    // confirmation is recoverable, and a refused save is not.
    const pendingUploadId = String(formData.get('pendingUploadId') ?? '')
    if (pendingUploadId) {
      try {
        await withCurrentOrg('create', 'document', (tx, session) =>
          confirmUpload(tx, session.organizationId, pendingUploadId, {
            uploadedByUserId: session.userId,
            target: { entity: 'load', id: load.id },
          }),
        )
      } catch {
        // Swallowed on purpose and visible in the pending row, which
        // reconciliation sweeps. The alternative — failing the save — throws
        // away a load somebody just typed because a file did not attach.
      }
    }

    // NOT a redirect. The form has a rate confirmation to attach and needs to
    // stay mounted to do it — §9's "the load save is never blocked by a
    // still-uploading document" cuts both ways.
    return { error: null, field: null, loadId: load.id }
  } catch (error) {
    if (error instanceof DispatchConflictError) {
      // Every refusal at once, not the first (§8). Joined into one sentence
      // because a form has one error slot and a dispatcher fixing one problem
      // to be told about the next is what §10 exists to prevent.
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
}
