'use server'

import { revalidatePath } from 'next/cache'
import {
  currentUserCan,
  requireSession,
  withCurrentOrg,
} from '@/lib/auth-context'
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
import { normalizeTypedDate, normalizeTypedTime } from '@/lib/typed-date'
import { resolveZone, zoneMidnight } from '@/lib/stop-time'
import { rememberAuthority } from '../../_reference/shared'
import { confirmEmail } from '@/lib/inbound-email'

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
 * When a stop is due, as an instant **in the stop's own zone**.
 *
 * NOT UTC. A pickup typed as September 15th, stored at UTC midnight and then
 * rendered in the stop's zone per design rule 3, displays as "Sep 14, 19:00
 * CDT" — the rule's own failure mode, committed by the code meant to honour
 * it. Caught in a screenshot of the Step 5 detail screen.
 *
 * Parsed here as well as in the browser, and not because the browser is
 * untrusted about dates — because the form works without JavaScript, and the
 * blur handler that normalises "810" into "2026-08-10" is JavaScript.
 *
 * THE CLOCK BELONGS TO THE APPOINTMENT, and until 2026-08-17 it had nowhere to
 * go. This returned midnight and nothing else, so a document printing "Pickup
 * 08/14 03:45" produced a load whose stop time was 00:00 — the appointment
 * discarded on the way through a form that had no field for it. It survived
 * being flagged once because the visible symptom was two empty clock boxes,
 * and a fix that filled them in would have entrenched the real fault.
 *
 * ONE TIME MEANS AN APPOINTMENT; TWO MEAN A WINDOW. A dispatcher typing a
 * single clock is saying when the stop is due, and that is `scheduledAt`. When
 * they type both ends, `windowStart`/`windowEnd` carry the window and this
 * still records the start as the moment the stop is due — the same instant a
 * board sorts by, rather than a midnight that sorts before every load booked
 * that day.
 *
 * MIDNIGHT REMAINS THE ANSWER FOR A DATE WITH NO CLOCK, which is the ordinary
 * typed load: a date alone is a date alone, and inventing 09:00 for it would
 * be a number about freight that nobody wrote down.
 */
function stopDate(
  value: unknown,
  place: { state: string | null; timezone: string | null },
  clock?: unknown,
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

  const typed = optionalText(clock)
  if (typed !== null) {
    const moment = stopMoment(iso, typed, place)
    if (moment !== null) return moment
  }

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

/**
 * A date and a clock time, as an instant in the STOP's own zone.
 *
 * The same rule `stopDate` follows and for the same reason: design rule 3 says
 * the stop's zone decides, and a window built at UTC midnight-plus-eight shows
 * a Florida dock opening at three in the morning. Null unless BOTH halves are
 * there — a time with no date is not a moment, and `createLoad` refuses a
 * window that ends before it starts, so half a window is worse than none.
 */
function stopMoment(
  date: string,
  time: string,
  place: { state: string | null; timezone: string | null },
): Date | null {
  const day = normalizeTypedDate(date.trim())
  const clock = normalizeTypedTime(time)
  if (day === null || clock === null) return null

  const { zone } = resolveZone(
    place.timezone,
    place.state,
    COMPANY_FALLBACK_ZONE,
  )
  const midnight = zoneMidnight(day, zone)
  const [hour, minute] = clock.split(':').map(Number)
  return new Date(
    midnight.getTime() + (hour ?? 0) * 3_600_000 + (minute ?? 0) * 60_000,
  )
}

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
  // THE STOPS, AS MANY AS THE FORM SENT (Phase 6 §4 step 1). Indexed names,
  // read until they run out — the form decides how many there are, and the
  // schema has carried a list since Phase 1.
  const stops = readStops(formData)
  // The shipper's numbers. Kept because §3 step 5 asks to warn about repeats of
  // them, and a warning about a number nothing stores cannot be written.
  const bolNumber = optionalText(formData.get('bol'))
  const poNumber = optionalText(formData.get('po'))
  // The BROKER's own load number. For a Relay booking it is the only exact
  // duplicate key there is: no BOL, no PO, no addresses — so without it the
  // duplicate_reference warning can never fire on Amazon freight.
  const referenceNumber = optionalText(formData.get('reference'))
  // What the dispatcher was shown last time, if they were shown anything.
  const acknowledged = String(formData.get('acknowledge') ?? '')

  // Every stop needs a place. The field named is the FIRST empty one, so the
  // error lands on the row a dispatcher has to fix rather than on the last.
  const emptyAt = stops.findIndex((stop) => stop.place === '')
  if (stops.length < 2 || emptyAt !== -1) {
    return {
      error: t('ref.error.required'),
      field: `stops[${emptyAt === -1 ? stops.length : emptyAt}].place`,
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
              Object.fromEntries(stops.map((stop, i) => [i, stop.place])),
              Object.fromEntries(
                stops.map((_, i) => [
                  i,
                  formData.get(`saveFacility${i}`) === '1',
                ]),
              ),
            )
          : {}

        // One resolution per stop, in order. A known facility wins over
        // create-on-miss, which would otherwise make a second Location named
        // after the town.
        const places: ResolvedStop[] = []
        for (const [index, stop] of stops.entries()) {
          places.push(
            facilities[index] ??
              (await resolveLocation(tx, session.organizationId, stop.place)),
          )
        }
        const from = places[0]!
        const to = places[places.length - 1]!

        // THE WEIGHT, FROM THE SERVER'S OWN COPY OF THE EXTRACTION.
        //
        // The create form has no weight field — §9's tab order is the reason —
        // so an extracted weight was read, priced into nothing and dropped.
        // Carried here rather than through the browser for the same reason the
        // corrections are: what the model said is the server's to know.
        //
        // FLOORED, because `wholeNumber` refuses a decimal outright and every
        // gross weight on a drayage ratecon is one. `44,857.46 LBS` is a
        // correct reading of the page and 44857 is what a dispatcher would
        // file; refusing the save over the .46 is the tail wagging the load.
        // Filed in the verification session, fixed here.
        const extractedWeight = pendingUploadId
          ? await weightFromMint(tx, pendingUploadId)
          : null

        // The warnings still ask "when does this load start and end", which
        // is the first stop's date and the last stop's.
        const pickupAt = stopDate(stops[0]!.date, from)
        const deliveryAt = stopDate(stops[stops.length - 1]!.date, to)
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
          referenceNumber,
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
            referenceNumber,
            truckId: optionalText(formData.get('truckId')),
            driverId: optionalText(formData.get('driverId')),
            dispatchedMiles: formData.get('miles'),
            ...(extractedWeight === null ? {} : { weightLbs: extractedWeight }),
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
            // SEQUENCE IS ARRAY ORDER — `writeStops` assigns it from the
            // index — and the TYPE is the one the form sent, never the one
            // the position implies. §6: "types read not assumed". A run of
            // pick, pick, drop, drop is a real Amazon load.
            stops: stops.map((stop, index) => ({
              type: stop.type,
              locationId: places[index]!.locationId,
              name: facilities[index]?.name ?? stop.place,
              city: places[index]!.city,
              state: places[index]!.state,
              scheduledAt: stopDate(stop.date, places[index]!, stop.from),
              // THE WINDOW REACHES ITS COLUMNS. `windowStart`/`windowEnd` have
              // been on LoadStop since Phase 1 and nothing has ever written
              // them from this form.
              windowStart: stopMoment(stop.date, stop.from, places[index]!),
              windowEnd: stopMoment(stop.date, stop.to, places[index]!),
            })),
          },
          { byUserId: session.userId },
        )
      },
      // See LOAD_WRITE_TIMEOUT_MS: a create sends ~31 statements, and Prisma's
      // 5s default is not enough when the round trip is long.
      { timeoutMs: LOAD_WRITE_TIMEOUT_MS },
    )

    // THE DRAFT CLOSES WHEN THE LOAD OPENS (§4 step 4). "Confirm" is this
    // save — §1.1 forbids a second editing surface, so booking the freight IS
    // confirming the email it came from. Linked and attributed to the person
    // who pressed the button, unlike the arrival, which nobody did.
    //
    // Its own transaction, after the load exists: a queue that failed to
    // update must not roll back freight somebody just booked. A draft left in
    // the queue is a visible, fixable annoyance; a load that vanished is not.
    const fromEmail = optionalText(formData.get('fromEmail'))
    if (fromEmail) {
      try {
        await withCurrentOrg('update', 'load', (tx, session) =>
          confirmEmail(tx, fromEmail, load.id, session.userId),
        )
        revalidatePath('/loads/incoming')
      } catch {
        // Swallowed for the reason above, and visible: the row stays in the
        // queue with no load on it, which is what "not closed" looks like.
      }
    }

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
            ...Object.fromEntries(
              stops.map((stop, i) => [`stops[${i}].place`, stop.place || null]),
            ),
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
        // A RUNNER, NOT A TRANSACTION — `confirmUpload` asks R2 whether the
        // object landed, and that round trip must not be held inside one.
        const documentSession = await requireSession()
        await confirmUpload(
          (fn) => withCurrentOrg('create', 'document', fn),
          documentSession.organizationId,
          pendingUploadId,
          {
            uploadedByUserId: documentSession.userId,
            target: { entity: 'load', id: load.id },
          },
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
  /** Present only for a KNOWN facility; a create-on-miss place has none. */
  name?: string
  city: string | null
  state: string | null
  timezone: string | null
}

/**
 * The extracted gross weight, as a whole number of pounds, or null.
 *
 * FLOOR, not round: a weight is a limit as much as a fact, and rounding 44,857.6
 * up to 44,858 is inventing six ounces the document did not print. Rule 5 of
 * EXTRACTION-CONTRACT.md forbids the reader computing values; this is the form
 * doing the one conversion the schema requires, in the direction that cannot
 * overstate.
 *
 * A zero or a negative is dropped: Werner's template prints `Total Wgt: 0 lb`
 * as structural filler on a drop-and-hook, and a zero-pound load is a
 * placeholder rather than a weight.
 */
async function weightFromMint(
  tx: Parameters<typeof resolveLocation>[0],
  pendingUploadId: string,
): Promise<number | null> {
  const mint = await tx.pendingUpload.findFirst({
    where: { id: pendingUploadId },
    select: { extractedJson: true },
  })
  const stored = (mint?.extractedJson ?? null) as {
    extracted?: { weightLbs?: { value?: unknown } | null }
  } | null

  const raw = stored?.extracted?.weightLbs?.value
  const value = typeof raw === 'number' ? raw : Number(raw)
  if (!Number.isFinite(value) || value <= 0) return null
  return Math.floor(value)
}

interface FormStop {
  place: string
  type: 'PICKUP' | 'DELIVERY' | 'INTERMEDIATE'
  date: string
  /** `HH:MM`, the window's ends. Empty on most stops. */
  from: string
  to: string
}

/**
 * The stops the form sent, in order.
 *
 * Read until the indices run out rather than to a fixed count: the form owns
 * how many there are, and a load with four stops posts four. A row with no
 * place at all still counts, so the required check can name which one is
 * empty instead of silently dropping it.
 */
function readStops(formData: FormData): FormStop[] {
  const stops: FormStop[] = []
  for (let index = 0; ; index++) {
    const place = formData.get(`stops[${index}].place`)
    if (place === null) break
    const type = String(formData.get(`stops[${index}].type`) ?? '')
    stops.push({
      place: String(place).trim(),
      // Defaulted by POSITION only when the form did not say — a form that
      // always sends the field never reaches this, and a caller that does not
      // is choosing the ordinary shape rather than having one assumed of it.
      type:
        type === 'PICKUP' || type === 'DELIVERY' || type === 'INTERMEDIATE'
          ? type
          : index === 0
            ? 'PICKUP'
            : 'DELIVERY',
      date: String(formData.get(`stops[${index}].date`) ?? ''),
      from: String(formData.get(`stops[${index}].from`) ?? ''),
      to: String(formData.get(`stops[${index}].to`) ?? ''),
    })
  }
  return stops
}
