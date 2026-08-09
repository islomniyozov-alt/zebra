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
import { matchFacility, saveFacility } from '@/lib/facility-memory'
import { DispatchConflictError } from '@/lib/dispatch'
import {
  LoadWarningsError,
  loadWarnings,
  warningSignature,
} from '@/lib/load-warnings'
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
  /**
   * §3 step 5 — sentences, already translated, each naming the record it
   * conflicts with. Present means the save DID NOT happen and is waiting for a
   * confirm; `acknowledge` is what the form posts back to get past them.
   */
  warnings?: string[]
  acknowledge?: string
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
  // Read once, up here: the facilities need it BEFORE the load is written and
  // the attach needs it after.
  const pendingUploadId = String(formData.get('pendingUploadId') ?? '')
  const pickup = String(formData.get('pickup') ?? '').trim()
  const delivery = String(formData.get('delivery') ?? '').trim()
  // The shipper's numbers. Kept because §3 step 5 asks to warn about repeats of
  // them, and a warning about a number nothing stores cannot be written.
  const bolNumber = optionalText(formData.get('bol'))
  const poNumber = optionalText(formData.get('po'))
  // What the dispatcher was shown last time, if they were shown anything.
  const acknowledged = String(formData.get('acknowledge') ?? '')

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
        // §3 step 4. A known dock, or one the dispatcher asked to save; either
        // way it wins over create-on-miss, which would otherwise make a second
        // Location named after the town.
        const facilities = pendingUploadId
          ? await facilitiesForStops(
              tx,
              session.organizationId,
              pendingUploadId,
              { 0: pickup, 1: delivery },
              {
                0: formData.get('saveFacility0') === '1',
                1: formData.get('saveFacility1') === '1',
              },
            )
          : {}

        const from =
          facilities[0] ??
          (await resolveLocation(tx, session.organizationId, pickup))
        const to =
          facilities[1] ??
          (await resolveLocation(tx, session.organizationId, delivery))

        const pickupAt = stopDate(formData.get('pickupAt'), from)
        const deliveryAt = stopDate(formData.get('deliveryAt'), to)
        const linehaulCents = maySetRate ? cents(formData.get('rate')) : 0

        // §3 STEP 5 — WARN, DO NOT BLOCK, AND ONLY ONCE.
        //
        // Thrown rather than returned, so the transaction rolls back and takes
        // the broker and the two locations create-on-miss just made with it.
        // A load nobody booked must not leave a customer behind.
        const warnings = await loadWarnings(tx, {
          customerId,
          customerName: broker,
          bolNumber,
          poNumber,
          pickupAt,
          deliveryAt,
          pickup: { city: from.city, state: from.state },
          delivery: { city: to.city, state: to.state },
          // NULL, not zero, for a role with no rate field: §1.3 keeps money
          // out of a dispatcher's screen entirely, and "no rate" is a money
          // label — it would tell them the load has one and that it is empty.
          linehaulCents: maySetRate ? linehaulCents : null,
        })
        if (
          warnings.length > 0 &&
          warningSignature(warnings) !== acknowledged
        ) {
          throw new LoadWarningsError(warnings)
        }

        return createLoad(
          tx,
          session.organizationId,
          {
            companyId,
            customerId,
            bolNumber,
            poNumber,
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
            linehaulCents,
            stops: [
              {
                type: 'PICKUP',
                locationId: from.locationId,
                name: facilities[0]?.name ?? pickup,
                city: from.city,
                state: from.state,
                scheduledAt: pickupAt,
              },
              {
                type: 'DELIVERY',
                locationId: to.locationId,
                name: facilities[1]?.name ?? delivery,
                city: to.city,
                state: to.state,
                scheduledAt: deliveryAt,
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
    if (error instanceof LoadWarningsError) {
      // NOT an error slot. Each warning is its own sentence naming its own
      // record, and the form renders them above a button that books it anyway
      // — carrying the signature of exactly these warnings, so a dispatcher who
      // then changes the BOL is warned again rather than waved through by a
      // tick from a moment ago.
      return {
        error: null,
        field: null,
        loadId: null,
        warnings: error.warnings.map((warning) =>
          Object.entries(warning.values).reduce(
            (message, [key, value]) => message.replaceAll(`{${key}}`, value),
            t(warning.messageKey),
          ),
        ),
        acknowledge: warningSignature(error.warnings),
      }
    }
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

/**
 * The Location each stop should point at, when the document knew a facility.
 *
 * §3 STEP 4, THE WRITING HALF. Two things happen here and both read the
 * SERVER'S copy of the extraction rather than the form:
 *
 *   * a dock the office already knows is linked to directly, so the second
 *     load down a lane points at the facility and not at a second row named
 *     after the town;
 *   * a dock nobody has saved is created only if somebody ticked the box —
 *     §3 says unknown facilities are OFFERED, and a form that posted the
 *     address could post any address.
 *
 * AND ONLY IF THE STOP STILL AGREES WITH THE DOCUMENT. The offer was rendered
 * against `Salem, OR`; a dispatcher who typed `Portland, OR` over it has
 * changed where the freight goes, and attaching a Salem dock to it — with a
 * Salem gate code — would be the extraction overruling the person.
 */
async function facilitiesForStops(
  tx: Parameters<typeof resolveLocation>[0],
  organizationId: string,
  pendingUploadId: string,
  typed: Record<number, string>,
  save: Record<number, boolean>,
): Promise<Record<number, ResolvedStop>> {
  const mint = await tx.pendingUpload.findFirst({
    where: { id: pendingUploadId },
    select: { extractedJson: true },
  })
  const stored = (mint?.extractedJson ?? null) as {
    extracted?: { stops?: Record<string, { value?: unknown } | null>[] }
  } | null
  const stops = stored?.extracted?.stops
  if (!stops) return {}

  const resolved: Record<number, ResolvedStop> = {}

  for (const [index, place] of Object.entries(typed)) {
    const stop = stops[Number(index)]
    if (!stop) continue

    const read = (key: string) => {
      const value = stop[key]?.value
      return typeof value === 'string' ? value : null
    }

    const parts = {
      addressLine1: read('addressLine1'),
      city: read('city'),
      state: read('state'),
      postalCode: read('postalCode'),
    }

    // The agreement check. `stops[n].place` is assembled the way the form
    // assembles it — the same comparison the correction log makes, and for the
    // same reason: what the person saw is the form's field, not the
    // extraction's parts.
    const printed = parts.state
      ? `${parts.city ?? ''}, ${parts.state}`
      : (parts.city ?? '')
    if (place.trim().toLowerCase() !== printed.trim().toLowerCase()) continue

    const known = await matchFacility(tx, parts)
    const facility =
      known ??
      (save[Number(index)]
        ? await saveFacility(tx, organizationId, {
            ...parts,
            name: read('name'),
            addressLine2: read('addressLine2'),
            contactName: read('contactName'),
            contactPhone: read('contactPhone'),
            instructions: read('instructions'),
          })
        : null)
    if (!facility) continue

    resolved[Number(index)] = {
      locationId: facility.locationId,
      name: facility.name,
      city: facility.city,
      state: facility.state,
      timezone: facility.timezone,
    }
  }

  return resolved
}

interface ResolvedStop {
  locationId: string
  name: string
  city: string | null
  state: string | null
  timezone: string | null
}
