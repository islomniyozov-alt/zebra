import type { TxClient } from './tenancy'
import { withOrg } from './tenancy'
import { unattributed } from './audit'
import type { AskedExtraction } from './rate-confirmation'
import type { Extracted } from './extraction-shape'
import {
  isEmptyReading,
  withoutMoney,
  type ExtractedWithoutMoney,
} from './extraction'
import { loadWarnings, type LoadWarning } from './load-warnings'
import { resolveBroker } from './correction-memory'
import { parseMoneyToCents } from './money'
import { recomputeTotals } from './loads'

// ---------------------------------------------------------------------------
// A BOOKING EMAIL, AS A DRAFT (Phase 6 §4 step 4, spec §1 / §2 / §10).
//
// THE INBOX IS A QUEUE OF UNFINISHED FORMS, which is §1.1's ruling and the
// reason this file writes no `Load`. Mail arrives with no dispatcher present,
// so a draft state is legitimate — but opening one lands on `/loads/new`
// prefilled from `extractedJson`, with the same validations and the same Save
// as a pasted email or an uploaded PDF. There is no second way to create a
// load and this is not it.
//
// THE STATE IS COMPUTED FROM REAL VALIDATION, not from a feeling. The brief
// says "ready / review / conflict states from real validation results, not
// vibes", so the three come from exactly the checks the create form runs —
// `loadWarnings`, the same function, against the same tenant's freight.
// ---------------------------------------------------------------------------

export type InboundState =
  | 'READY'
  | 'REVIEW'
  | 'CONFLICT'
  | 'UNREAD'
  | 'CONFIRMED'
  | 'DISMISSED'

/**
 * Which of the four an email lands in.
 *
 *   UNREAD   — NO USABLE READING EXISTS. `ocrStatus` says which kind of
 *              nothing: NOT_QUEUED for a reading nobody asked for, FAILED for
 *              one that could not be produced, COMPLETED for one that came
 *              back with every field null.
 *   CONFLICT — what it says contradicts freight already booked. A duplicate
 *              BOL, PO or broker reference means this booking may already BE a
 *              load, and creating a second is the mistake §11 exists to
 *              prevent.
 *   REVIEW   — read, but something wants a person: no pickup date, no rate,
 *              anything a dispatcher would have been warned about on the form.
 *   READY    — read cleanly and nothing to say.
 *
 * WHY UNREAD EXISTS, AND WHY IT IS ONE STATE. Three different absences used to
 * be indistinguishable here: nobody asked, the asking failed, and the answer
 * was empty. All three produced a row that looked like a document which simply
 * had nothing in it — which is exactly how a real Relay booking read as
 * all-nulls sat in REVIEW looking ordinary (brief flag 76), and it is what a
 * message deferred by the rate limiter would otherwise look like too. Deferred
 * work with no visible state is the invisible pile inside the routed path.
 *
 * A FAILED READ MOVED OUT OF CONFLICT TO GET HERE. CONFLICT means "this may
 * already be a load" — a claim about freight. "We could not read it" is a
 * claim about us, and putting the two under one word is what made an
 * unreadable document and a duplicate booking sort the same.
 *
 * NOT A CONFIDENCE SCORE. Spec §10 shows percentages beside each row; those
 * come from the extraction's per-field confidence and are a separate display
 * concern. This is about whether the office has a REASON to stop, and a
 * reason is a sentence, not a number.
 */
export function stateFor(input: {
  read: boolean
  /** The reader answered and had nothing to say. An abstention. */
  empty?: boolean
  warnings: readonly LoadWarning[]
}): InboundState {
  if (!input.read || input.empty === true) return 'UNREAD'

  // The duplicate family is the conflict family: each one means "this may
  // already be a load". Everything else is worth reading before you book.
  const conflicting = input.warnings.some(
    (warning) =>
      warning.kind === 'duplicate_bol' ||
      warning.kind === 'duplicate_po' ||
      warning.kind === 'duplicate_reference' ||
      warning.kind === 'duplicate_load',
  )
  if (conflicting) return 'CONFLICT'

  return input.warnings.length > 0 ? 'REVIEW' : 'READY'
}

/**
 * What the inbox should say about this email, from the freight already booked.
 *
 * RUNS THE CREATE FORM'S OWN CHECKS. `loadWarnings` is the function the Save
 * button calls, so a duplicate the inbox flags is exactly the duplicate the
 * form would have flagged — and when the dispatcher opens the draft, they see
 * the same sentence a second time rather than a new one.
 *
 * MONEY IS PASSED AS NULL. §1.3 keeps money off a dispatcher's wire, and this
 * runs with no user at all — mail has no session. `missing_rate` would be a
 * money label on a queue anybody can read, so the check is not asked for.
 */
export async function concernsForEmail(
  tx: TxClient,
  extracted: Extracted | null,
): Promise<LoadWarning[]> {
  if (!extracted) return []

  const text = (value: unknown): string | null =>
    typeof value === 'string' && value.trim() !== '' ? value.trim() : null

  const printed = text(extracted.brokerName?.value)
  // The alias table decides which customer a printed name means — the same
  // memory the upload path reads, so the inbox and the form agree about who
  // this broker is before anybody opens either.
  const broker = printed ? await resolveBroker(tx, printed) : null

  const stops = extracted.stops ?? []
  const first = stops[0]
  const last = stops[stops.length - 1]

  // THE READER NAMED ONE OF OUR OWN AUTHORITIES AS THE BROKER.
  //
  // A real Relay booking came back with brokerName "RAM HAULAGE" at high
  // confidence and every other field null. The reader had been handed our
  // signature logo instead of the booking and read our name off it. The
  // logo is fixed; this is the check that catches the CLASS — a greeting, a
  // footer, a signature block, or a model having a bad day all produce the
  // same wrong answer, and we are the one party whose names we know for
  // certain.
  //
  // COMPARED AGAINST Company, WHICH IS THE AUTHORITY TABLE. Matching is on
  // the normalised name rather than the id: the reader returns printed
  // words, not a foreign key, and "RAM HAULAGE LLC" and "Ram Haulage" are
  // the same carrier to everyone except a string comparison.
  const ourNames = printed
    ? await tx.company.findMany({ select: { name: true } })
    : []
  const collides = ourNames.some(
    (company) => squash(company.name) === squash(printed ?? ''),
  )
  const warnings = await loadWarnings(tx, {
    // No customer resolved means no customer-scoped check can fire, which is
    // correct rather than convenient: the probable-duplicate check is about
    // one broker's freight and an unknown broker has none.
    customerId: broker?.customerId ?? '',
    customerName: printed ?? '',
    bolNumber: text(extracted.bolNumber?.value),
    poNumber: text(extracted.poNumber?.value),
    referenceNumber: text(extracted.brokerReference?.value),
    // Dates arrive as ISO strings from the extraction; a stop with no date is
    // one of the things worth warning about, so a bad parse is not smoothed.
    pickupAt: dateFrom(first?.scheduledAt?.value),
    deliveryAt: dateFrom(last?.scheduledAt?.value),
    pickup: {
      city: text(first?.city?.value),
      state: text(first?.state?.value),
    },
    delivery: {
      city: text(last?.city?.value),
      state: text(last?.state?.value),
    },
    linehaulCents: null,
  })

  return collides
    ? [
        ...warnings,
        {
          kind: 'broker_is_own_authority' as const,
          messageKey: 'loads.warn.brokerIsOwnAuthority' as const,
          values: { broker: printed ?? '' },
        },
      ]
    : warnings
}

/** An extracted `YYYY-MM-DD` or ISO instant, as a Date, or null. */
function dateFrom(value: unknown): Date | null {
  if (typeof value !== 'string' || value.trim() === '') return null
  const at = new Date(value.length === 10 ? `${value}T00:00:00Z` : value)
  return Number.isNaN(at.getTime()) ? null : at
}

/**
 * The tenant an address belongs to.
 *
 * THE RECIPIENT IS THE ROUTING KEY and it is resolved HERE, in the
 * application, against `Organization.inboundAddress`. The mail worker knows
 * nothing about tenants — a worker that did would be a second place tenancy is
 * decided, and the first rule of this schema is that there is one.
 *
 * Case-folded, because mail addresses are and somebody will type
 * `Loads@zebratms.com` into a forwarding rule. Runs OUTSIDE the org scope by
 * necessity: this is the query that FINDS the scope.
 */
export function normalizeAddress(address: string): string {
  const trimmed = address.trim().toLowerCase()
  // `Name <loads@zebratms.com>` — take what is inside the angle brackets when
  // there are any, because a From header is frequently the whole display form.
  const angled = /<([^>]+)>/.exec(trimmed)
  return (angled ? angled[1]! : trimmed).trim()
}

/**
 * Plus-addressing folded away: `loads+amazon@zebratms.com` is `loads@…`.
 *
 * Amazon and every other sender will happily preserve a tag, and a tenant
 * whose address stopped matching because somebody forwarded through a rule
 * that added one would be freight silently landing nowhere.
 */
export function baseAddress(address: string): string {
  const normalized = normalizeAddress(address)
  const at = normalized.lastIndexOf('@')
  if (at < 0) return normalized
  const local = normalized.slice(0, at)
  const domain = normalized.slice(at)
  const plus = local.indexOf('+')
  return (plus < 0 ? local : local.slice(0, plus)) + domain
}

// ---------------------------------------------------------------------------
// THE TENANCY CALLS FOR MAIL, IN ONE PLACE.
//
// `withOrg` is lint-banned inside `src/app` because a route reaching past
// `withCurrentOrg` gets neither the permission check nor the attribution.
// Inbound mail is the case that cannot use it: there is no session, because a
// stranger sent a message and a mail server delivered it — the same reason
// `auth-db.ts` exists for sign-in.
//
// So the exception lives HERE, in one file with one comment, and the lint rule
// stays absolute. A disable comment in a route is indistinguishable from a
// disable comment somebody added because they were in a hurry.
//
// Every write below is `unattributed('…')` — typed out, reason carried into
// the audit log, greppable. Nobody did this, and that is the truth about it.
// ---------------------------------------------------------------------------

/**
 * A company name with the noise taken out, for comparison only.
 *
 * Case, punctuation and the trailing entity word are all things two humans
 * write differently for the same carrier. "RAM HAULAGE LLC" off a logo and
 * "Ram Haulage" in the authority table are the same party.
 */
function squash(name: string): string {
  return name
    .toLowerCase()
    .replace(/(llc|inc|corp|co|ltd|limited|incorporated)/g, ' ')
    .replace(/[^a-z0-9]+/g, '')
    .trim()
}

/** Nobody did this: a mail server delivered it. */
const FROM_A_MAIL_SERVER = {
  attribution: unattributed('inbound email: delivered by a mail server'),
} as const

/** Does this organization actually claim the address the mail arrived at? */
export async function organizationClaims(
  organizationId: string,
  address: string,
): Promise<boolean> {
  const found = await withOrg(
    organizationId,
    (tx) =>
      tx.organization.findFirst({
        where: { inboundAddress: baseAddress(address), isActive: true },
        select: { id: true },
      }),
    FROM_A_MAIL_SERVER,
  )
  return found !== null
}

/** An email already recorded under this Message-ID, if there is one. */
export async function emailByMessageId(
  organizationId: string,
  messageId: string,
): Promise<{ id: string } | null> {
  return withOrg(
    organizationId,
    (tx) =>
      tx.inboundEmail.findFirst({
        where: { messageId },
        select: { id: true },
      }),
    FROM_A_MAIL_SERVER,
  )
}

export interface RecordEmailInput {
  messageId: string
  from: string
  to: string
  subject: string | null
  text: string | null
}

/**
 * Put the mail on the board before it is read.
 *
 * A message that kills the reader is still a message that arrived, and the
 * office should see it with a reason rather than never see it at all.
 */
export async function recordEmail(
  organizationId: string,
  input: RecordEmailInput,
): Promise<{ id: string }> {
  return withOrg(
    organizationId,
    (tx) =>
      tx.inboundEmail.create({
        data: {
          organizationId,
          messageId: input.messageId,
          fromAddress: normalizeAddress(input.from),
          toAddress: baseAddress(input.to),
          subject: input.subject?.slice(0, 500) ?? null,
          bodyText: input.text?.slice(0, 100_000) ?? null,
          ocrStatus: 'PROCESSING',
          state: 'REVIEW',
        },
        select: { id: true },
      }),
    FROM_A_MAIL_SERVER,
  )
}

/**
 * Write what the reader made of it, and what the office should be told.
 *
 * The warnings are computed in the SAME transaction as the update, because
 * they are read from freight that could otherwise change underneath them — a
 * duplicate that appears between the check and the write is a duplicate the
 * inbox would never mention.
 */
/**
 * The message was kept and deliberately not read.
 *
 * DEFERRED IS NOT FAILED, and the row must not claim it was. `ocrStatus`
 * stays NOT_QUEUED — nothing was ever asked — and `ocrError` stays null,
 * because there is no error to report: a budget was spent, which is a fact
 * about us and not about the document.
 *
 * THE STATE IS UNREAD, WHICH IS THE WHOLE POINT. Deferred work with no
 * visible state is the invisible pile inside the routed path, and this is the
 * consumer that state was built for first.
 */
export async function recordDeferred(
  organizationId: string,
  emailId: string,
): Promise<{ state: InboundState; concerns: number }> {
  await withOrg(
    organizationId,
    (tx) =>
      tx.inboundEmail.update({
        where: { id: emailId },
        data: { state: 'UNREAD', ocrStatus: 'NOT_QUEUED', concerns: [] },
      }),
    FROM_A_MAIL_SERVER,
  )
  return { state: 'UNREAD', concerns: 0 }
}

export async function recordReading(
  organizationId: string,
  emailId: string,
  asked: AskedExtraction,
): Promise<{ state: InboundState; concerns: number }> {
  return withOrg(
    organizationId,
    async (tx) => {
      const extracted = asked.ok ? asked.extracted : null
      const warnings = await concernsForEmail(tx, extracted)
      // An answer with nothing in it is not a document with nothing in it.
      const empty = extracted !== null && isEmptyReading(extracted)
      const state = stateFor({ read: asked.ok, empty, warnings })

      await tx.inboundEmail.update({
        where: { id: emailId },
        data: {
          ocrStatus: asked.ok ? 'COMPLETED' : 'FAILED',
          ocrError: asked.ok ? null : asked.detail.slice(0, 500),
          ...(asked.ok
            ? { ocrText: asked.answer.text.slice(0, 20_000) }
            : asked.rawText
              ? { ocrText: asked.rawText.slice(0, 20_000) }
              : {}),
          ...(asked.ok
            ? {
                extractedJson: {
                  extracted: asked.extracted,
                  money: asked.money,
                  usage: asked.answer.usage,
                  model: asked.answer.model,
                } as never,
              }
            : {}),
          state,
          // The KINDS and their values, not sentences: the screen renders them
          // in the reader's own language, the way the create form does.
          concerns: warnings as never,
        },
      })

      return { state, concerns: warnings.length }
    },
    FROM_A_MAIL_SERVER,
  )
}

/** Where the original ended up, once it is safely in the bucket. */
export async function recordOriginal(
  organizationId: string,
  emailId: string,
  keys: { rawR2Key: string | null; rawBytes: number | null },
): Promise<void> {
  await withOrg(
    organizationId,
    (tx) =>
      tx.inboundEmail.update({
        where: { id: emailId },
        data: { rawR2Key: keys.rawR2Key, rawBytes: keys.rawBytes },
      }),
    FROM_A_MAIL_SERVER,
  )
}

/**
 * One queued email's extraction, for the create form to prefill from.
 *
 * THE SAME SHAPE AN UPLOAD PRODUCES, deliberately: §1.1 says opening a draft
 * lands on the ordinary form, and the cheapest way to guarantee that is for
 * the form to be unable to tell the two apart. It receives `extracted`,
 * `lowConfidence` and nothing else it would not have had from a PDF.
 *
 * MONEY IS STRIPPED HERE, BY ROLE. The stored extraction carries the rate —
 * it was read out of the email and it belongs in the row. §1.3 keeps it off a
 * DISPATCHER's wire, and the endpoint that does this for uploads is
 * `/api/documents/[id]/extract`; this is the same rule on the other path, and
 * it is the SERVER doing it, so a dispatcher's page never holds the number.
 */
export async function queuedExtraction(
  tx: TxClient,
  emailId: string,
  options: { maySeeMoney: boolean },
): Promise<{
  id: string
  extracted: Extracted | ExtractedWithoutMoney
  subject: string | null
  from: string
} | null> {
  const email = await tx.inboundEmail.findFirst({
    where: {
      id: emailId,
      // A handled email is not a draft any more. Opening the form from one
      // would offer to book freight that is already booked.
      state: { in: ['READY', 'REVIEW', 'CONFLICT'] },
    },
    select: {
      id: true,
      subject: true,
      fromAddress: true,
      extractedJson: true,
    },
  })
  if (!email) return null

  const stored = (email.extractedJson ?? null) as {
    extracted?: Extracted
  } | null
  if (!stored?.extracted) return null

  return {
    id: email.id,
    subject: email.subject,
    from: email.fromAddress,
    extracted: options.maySeeMoney
      ? stored.extracted
      : withoutMoney(stored.extracted),
  }
}

/**
 * The email becomes freight: link the load and leave the queue.
 *
 * CALLED FROM THE ORDINARY SAVE, which is the whole of §1.1. There is no
 * confirm button on a second surface — a dispatcher opens the draft, reads the
 * form, and presses the same Save a typed load uses. This is what that press
 * means for the email it came from.
 *
 * ATTRIBUTED TO THE PERSON, unlike everything else this module writes. The
 * mail arrived unattributed because a mail server delivered it; a human is
 * booking it, and the row should say which one.
 */
export async function confirmEmail(
  tx: TxClient,
  emailId: string,
  loadId: string,
  userId: string,
): Promise<void> {
  await tx.inboundEmail.updateMany({
    // `updateMany` rather than `update`: RLS already scopes this, and a
    // dispatcher pasting somebody else's id should get zero rows changed
    // rather than a thrown not-found that reveals the row exists.
    where: { id: emailId, state: { in: ['READY', 'REVIEW', 'CONFLICT'] } },
    data: {
      state: 'CONFIRMED',
      loadId,
      confirmedAt: new Date(),
      handledByUserId: userId,
    },
  })
}

/** Not freight. Leaves the queue, keeps the record, names who said so. */
export async function dismissEmail(
  tx: TxClient,
  emailId: string,
  userId: string,
  reason: string | null,
): Promise<void> {
  await tx.inboundEmail.updateMany({
    where: { id: emailId, state: { in: ['READY', 'REVIEW', 'CONFLICT'] } },
    data: {
      state: 'DISMISSED',
      dismissedAt: new Date(),
      dismissedReason: reason?.slice(0, 500) ?? null,
      handledByUserId: userId,
    },
  })
}

// ---------------------------------------------------------------------------
// THE EMAIL–TRIP JOIN: the two Amazon sources are complementary on one key.
//
// The Trips CSV carries the stop chain, the legs, the mileage and the actual
// check-ins, and NEVER the trip payout. The booking email carries the payout
// and the same Trip ID. Neither is complete; together they are.
//
// AN EMAIL WHOSE REFERENCE IS A PREFIXED TRIP ID MAY ONLY FILL A RATE. It may
// never create the load, and that is not caution — an email-created load has
// the two stops the email prints, while the real trip has the chain the CSV
// knows. Booking from the email would produce a load whose middle stops have
// to be typed in by hand, on top of freight the import was about to describe
// correctly.
//
// A BARE ID KEEPS TODAY'S BEHAVIOUR. Measured across 1,600 exports: every bare
// Trip ID is its own row's Load ID, so a bare-ID email is a single-load
// booking and the load it would create is the load the trip describes.
//
// EXACT MATCH, NO NORMALISING. This is the JOIN rule, not the search rule:
// `loadSearchWhere` deliberately matches loosely so a dispatcher typing what
// they can see finds the load, and a human reads the answer. Attaching money
// is not a reading — "T-115M68R2H" and "115M68R2H" are different references
// until somebody says otherwise.
// ---------------------------------------------------------------------------

export type TripRateJoin =
  /** Not a prefixed trip reference — the ordinary create flow applies. */
  | { kind: 'not_a_trip' }
  /** No load carries this reference yet. The draft waits; it does not create. */
  | { kind: 'waiting'; reference: string }
  /** A load is here and carries no rate. This is the one case that writes. */
  | { kind: 'fillable'; loadId: string; loadNumber: string; cents: number }
  /** The load already has money. Adds nothing, replaces nothing. */
  | { kind: 'already_rated'; loadId: string; loadNumber: string }
  /** A trip load is here but the email printed no payout to give it. */
  | { kind: 'no_payout'; loadId: string; loadNumber: string }

/** Does this reference name a Relay TRIP rather than a single load? */
export function isTripReference(reference: string | null): boolean {
  return typeof reference === 'string' && /^T-/.test(reference.trim())
}

/**
 * What this email can do for the trip it names.
 *
 * PURE OF WRITES, so the screen and the action reach the same verdict from the
 * same function — the preview-then-confirm shape this codebase uses
 * everywhere, applied to a single button.
 *
 * ESTIMATED PAYOUT ONLY. `money.total` is the payout; `money.linehaul` is the
 * Base Rate beside it, and the two differ by 21% on a real booking
 * (T-113X2YMG9: $1,776.25 against $1,466.53). The lower number is not the
 * rate, and reading the wrong one would under-invoice every Relay load.
 */
export async function tripRateJoin(
  tx: TxClient,
  extracted: Extracted | null,
): Promise<TripRateJoin> {
  const reference =
    typeof extracted?.brokerReference?.value === 'string'
      ? extracted.brokerReference.value.trim()
      : null

  if (!isTripReference(reference)) return { kind: 'not_a_trip' }

  const load = await tx.load.findFirst({
    where: { referenceNumber: reference!, deletedAt: null },
    select: { id: true, loadNumber: true, linehaulCents: true },
  })

  // THE WAITING CASE IS A REAL ANSWER, not a failure. The trip import may not
  // have run yet; the email keeps its payout and says what it is waiting for.
  if (!load) return { kind: 'waiting', reference: reference! }

  if (load.linehaulCents !== 0) {
    return {
      kind: 'already_rated',
      loadId: load.id,
      loadNumber: load.loadNumber,
    }
  }

  const payout =
    typeof extracted?.money?.total?.value === 'string'
      ? extracted.money.total.value
      : null
  if (!payout) {
    return { kind: 'no_payout', loadId: load.id, loadNumber: load.loadNumber }
  }

  try {
    const cents = parseMoneyToCents(payout)
    if (cents <= 0) {
      return { kind: 'no_payout', loadId: load.id, loadNumber: load.loadNumber }
    }
    return {
      kind: 'fillable',
      loadId: load.id,
      loadNumber: load.loadNumber,
      cents,
    }
  } catch {
    return { kind: 'no_payout', loadId: load.id, loadNumber: load.loadNumber }
  }
}

/**
 * Give the trip's load the payout its booking email printed.
 *
 * THE VERDICT IS RE-TAKEN INSIDE THE WRITE. The screen showed one a moment
 * ago; between the render and the click a trips import may have run, or
 * somebody may have typed a rate. Trusting the rendered verdict would be
 * trusting a fact the browser is holding — the same reason the trips import
 * re-plans before it writes.
 *
 * FILLS ONLY A NULL RATE. `linehaulCents` is `@default(0)`, so zero is the
 * only "nobody has said" this schema can express; a load with a figure on it
 * keeps the figure, whoever put it there.
 */
export async function applyTripRate(
  tx: TxClient,
  emailId: string,
  userId: string,
): Promise<TripRateJoin> {
  const email = await tx.inboundEmail.findFirst({
    where: { id: emailId, state: { in: ['READY', 'REVIEW', 'CONFLICT'] } },
    select: { id: true, extractedJson: true },
  })
  if (!email) return { kind: 'not_a_trip' }

  const stored = (email.extractedJson ?? null) as {
    extracted?: Extracted
  } | null
  const verdict = await tripRateJoin(tx, stored?.extracted ?? null)
  if (verdict.kind !== 'fillable') return verdict

  await tx.load.update({
    where: { id: verdict.loadId },
    data: { linehaulCents: verdict.cents },
  })
  // The cached total is what an invoice reads; a linehaul written without it
  // leaves `totalRevenueCents` behind by exactly the rate just applied.
  await recomputeTotals(tx, verdict.loadId)

  // THE EMAIL HAS DONE ITS JOB. Linking it to the load it paid for is the same
  // thing `confirmEmail` means on the create path: this draft is handled, and
  // the record says which load it became part of.
  await confirmEmail(tx, emailId, verdict.loadId, userId)

  return verdict
}
