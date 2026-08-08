'use server'

import { revalidatePath } from 'next/cache'
import { currentUserCan, withCurrentOrg } from '@/lib/auth-context'
import { getLocaleContext } from '@/lib/locale'
import { confirmUpload } from '@/lib/documents'
import {
  diffExtraction,
  learnAlias,
  recordCorrections,
} from '@/lib/correction-memory'
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
  // The typed broker name, kept for the correction diff below. `createLoad`
  // resolves it to a Customer; this is what the person actually wrote.
  const broker = String(formData.get('broker') ?? '').trim()
  const pickup = String(formData.get('pickup') ?? '').trim()
  const delivery = String(formData.get('delivery') ?? '').trim()

  if (!pickup || !delivery) {
    return {
      error: t('ref.error.required'),
      field: pickup ? 'delivery' : 'pickup',
      loadId: null,
    }
  }

  const maySetRate = await currentUserCan('update', 'load.financials')

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
            // §1.3 AND PHASE 3's RATE_ENTRY, ENFORCED HERE. `load.financials`
            // update is OWNER/ADMIN/ACCOUNTING; a DISPATCHER books the freight
            // and accounting puts the money on it. Until Phase 5 went looking,
            // this line took whatever was posted — so a dispatcher's form could
            // set a rate, and the wall Phase 3 built had a gap in exactly the
            // screen freight enters through.
            //
            // IGNORED RATHER THAN REFUSED. Refusing would fail the save and
            // strand a load somebody just typed; ignoring books the freight
            // with no rate, which is what a dispatcher's load looks like
            // anyway. See PHASE-5-BRIEF.md §7 flag 6.
            linehaulCents: maySetRate ? cents(formData.get('rate')) : 0,
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
      // §3 STEP 3, AND IT HAPPENS BEFORE THE CONFIRM DELETES THE MINT. The
      // extraction lives on the pending row; once `confirmUpload` moves it to
      // the Document and deletes the mint, there is nothing here to compare
      // against. Read first, write after.
      //
      // THE EXTRACTION IS READ FROM THE SERVER'S OWN COPY, never from the
      // browser. A dispatcher's page was never sent the money fields (§1.3),
      // and a form that posted back "what the model said" would be a form that
      // could say anything.
      try {
        await withCurrentOrg('update', 'load', async (tx, session) => {
          const mint = await tx.pendingUpload.findFirst({
            where: { id: pendingUploadId },
            select: { extractedJson: true },
          })
          const stored = (mint?.extractedJson ?? null) as {
            extracted?: Record<string, unknown>
          } | null
          if (!stored?.extracted) return

          const changes = diffExtraction(stored.extracted, {
            brokerName: broker || null,
            // `.place`, not `.city` — the form has one field per stop and it
            // holds "Salem, OR". Diffing it against the extracted city alone
            // logged a correction on every upload nobody corrected.
            'stops[0].place': pickup || null,
            'stops[1].place': delivery || null,
          })

          await recordCorrections(tx, {
            organizationId: session.organizationId,
            loadId: load.id,
            userId: session.userId,
            changes,
          })

          // AND THE ONE CORRECTION THAT CHANGES ANYTHING. The dispatcher chose
          // a broker; if the document printed a different string, that string
          // now means this customer.
          const printed = (
            stored.extracted['brokerName'] as { value?: string } | null
          )?.value
          if (printed && broker) {
            const saved = await tx.load.findFirst({
              where: { id: load.id },
              select: { customer: { select: { id: true, name: true } } },
            })
            const customer = saved?.customer ?? null
            if (customer) {
              await learnAlias(tx, {
                organizationId: session.organizationId,
                extractedName: printed,
                customerId: customer.id,
                customerName: customer.name,
                userId: session.userId,
              })
            }
          }
        })
      } catch {
        // Memory is a convenience. Failing to learn must never fail a save.
      }

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
