import type { TxClient } from './tenancy'
import { withOrg } from './tenancy'
import { unattributed } from './audit'
import type { AskedExtraction } from './rate-confirmation'
import type { Extracted } from './extraction-shape'
import { loadWarnings, type LoadWarning } from './load-warnings'
import { resolveBroker } from './correction-memory'

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
  | 'CONFIRMED'
  | 'DISMISSED'

/**
 * Which of the three an email lands in.
 *
 *   CONFLICT — the reader could not read it, or what it says contradicts
 *              freight already booked. A duplicate BOL, PO or broker reference
 *              means this booking may already BE a load, and creating a second
 *              is the mistake §11 of the spec exists to prevent.
 *   REVIEW   — read, but something wants a person: no pickup date, no rate,
 *              anything a dispatcher would have been warned about on the form.
 *   READY    — read cleanly and nothing to say.
 *
 * NOT A CONFIDENCE SCORE. Spec §10 shows percentages beside each row; those
 * come from the extraction's per-field confidence and are a separate display
 * concern. This is about whether the office has a REASON to stop, and a
 * reason is a sentence, not a number.
 */
export function stateFor(input: {
  read: boolean
  warnings: readonly LoadWarning[]
}): InboundState {
  if (!input.read) return 'CONFLICT'

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

  return loadWarnings(tx, {
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
      const state = stateFor({ read: asked.ok, warnings })

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
