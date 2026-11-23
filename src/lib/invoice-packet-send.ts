import type { EmailMessage, SendResult } from './email'
import type { MessageKey } from './i18n'
import { markInvoiceSent } from './invoices'
import {
  invoicePacketForLoad,
  type InvoicePacketIo,
  type InvoicePacketPlanRefusal,
} from './invoice-packet-store'
import { loadDetailView } from './load-detail-view'
import type { TxClient } from './tenancy'

// ---------------------------------------------------------------------------
// MERGE & SEND (TMS §7.14 item 6; BROKER-LOAD-BRIEF step 5, R4, R5, R6).
//
// ── R5: ONE RECIPIENT, DECIDED BY THE LOAD'S PAYMENT TYPE ────────────────
//
// `Factored` → the load's factoring company's email; `Quickpay`, `ACH` or
// none → the customer's `billingEmail`; `Direct`, direct-settled and Amazon
// freight → no send at all. No address is a refusal that NAMES the empty
// field and where to fill it, never a send to nobody.
//
// ── R4: THE SLOT IS CLAIMED BEFORE RESEND IS CALLED ──────────────────────
//
// The same packet to the same address inside 24 hours is refused with the
// first send's time. The check is a WRITE, not a read: one conditional
// `updateMany` sets `packetSentAt`/`packetSentTo` only when the row does not
// already say "this address, inside the window" — so two clicks cannot both
// pass, because Postgres re-checks the condition on the locked row. The
// audited extension writes that update as the row naming who sent which
// packet to whom. A send Resend refuses RELEASES the slot (the previous
// values put back) so a failure never blocks the retry for a day.
//
// ── THE NETWORK IS NEVER INSIDE A TRANSACTION ────────────────────────────
//
// Read, then the packet (its own read / R2 / write phases), then the claim,
// then Resend, then the invoice — each transaction short, Resend between
// them, never inside one (`claim → call → write`).
// ---------------------------------------------------------------------------

/** R4's window for refusing the same packet to the same address. */
export const PACKET_RESEND_WINDOW_MS = 24 * 60 * 60 * 1000

export interface PacketRecipientFacts {
  id: string
  directSettled: boolean
  paymentType: string | null
  customer: { id: string; name: string; billingEmail: string | null }
  factoringCompany: { name: string; email: string | null } | null
}

export type PacketRecipientRefusal =
  | { kind: 'not_offered' }
  | {
      kind: 'no_address'
      field: 'factoring_company' | 'factor_email' | 'billing_email'
      href: string
    }

export type PacketRecipient =
  | { ok: true; to: string; party: 'factor' | 'customer'; name: string }
  | ({ ok: false } & PacketRecipientRefusal)

/** R5 — who the packet goes to, or why it goes to nobody. Pure. */
export function packetRecipientFor(
  load: PacketRecipientFacts,
): PacketRecipient {
  if (!loadDetailView(load).brokerShape || load.paymentType === 'Direct') {
    return { ok: false, kind: 'not_offered' }
  }
  if (load.paymentType === 'Factored') {
    if (!load.factoringCompany) {
      return {
        ok: false,
        kind: 'no_address',
        field: 'factoring_company',
        href: `/loads/${load.id}?tab=financials`,
      }
    }
    const to = load.factoringCompany.email?.trim()
    if (!to) {
      return {
        ok: false,
        kind: 'no_address',
        field: 'factor_email',
        href: '/receivables/factoring',
      }
    }
    return { ok: true, to, party: 'factor', name: load.factoringCompany.name }
  }
  const to = load.customer.billingEmail?.trim()
  if (!to) {
    return {
      ok: false,
      kind: 'no_address',
      field: 'billing_email',
      href: `/brokers/${load.customer.id}`,
    }
  }
  return { ok: true, to, party: 'customer', name: load.customer.name }
}

export interface PacketSendFacts {
  load: PacketRecipientFacts
  loadNumber: string
  company: { name: string; email: string | null; timezone: string }
}

/** The rows a send reads before anything else. Inside a transaction. */
export async function packetSendFactsFor(
  tx: TxClient,
  loadId: string,
): Promise<PacketSendFacts | null> {
  const load = await tx.load.findFirst({
    where: { id: loadId, deletedAt: null },
    select: {
      id: true,
      loadNumber: true,
      directSettled: true,
      paymentType: true,
      customer: { select: { id: true, name: true, billingEmail: true } },
      factoringCompany: { select: { name: true, email: true } },
      company: { select: { name: true, email: true, timezone: true } },
    },
  })
  if (!load) return null
  const { loadNumber, company, ...facts } = load
  return { load: facts, loadNumber, company }
}

/** The mail itself: plain words, the packet attached, replies to the authority. */
export function packetEmail(input: {
  to: string
  loadNumber: string
  company: { name: string; email: string | null }
  filename: string
  pdf: Uint8Array
}): EmailMessage {
  const subject = `Invoice packet — load ${input.loadNumber} — ${input.company.name}`
  const text = [
    `Attached is the invoice packet for load ${input.loadNumber}:`,
    'proof of delivery, bill of lading, rate confirmation and invoice, as one PDF.',
    '',
    input.company.email
      ? `Reply to this email to reach ${input.company.name}.`
      : input.company.name,
  ].join('\n')
  const html = text
    .split('\n')
    .map((line) => (line === '' ? '<br>' : `<p>${escapeHtml(line)}</p>`))
    .join('')
  return {
    to: input.to,
    subject,
    text,
    html,
    replyTo: input.company.email?.trim() || null,
    attachments: [{ filename: input.filename, content: input.pdf }],
  }
}

const escapeHtml = (value: string) =>
  value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')

export type PacketClaim =
  | {
      ok: true
      previous: { packetSentAt: Date | null; packetSentTo: string | null }
    }
  | { ok: false; at: Date }

/**
 * R4 — take the send slot, or name when it was taken. ONE conditional write:
 * the row is claimed only when it does not already say this address inside
 * the window. Null fields are spelled out, because `NOT (to = x AND at > y)`
 * is NULL — not true — on a packet never sent.
 */
export async function claimPacketSend(
  tx: TxClient,
  documentId: string,
  to: string,
  now: Date,
): Promise<PacketClaim> {
  const previous = await tx.document.findUniqueOrThrow({
    where: { id: documentId },
    select: { packetSentAt: true, packetSentTo: true },
  })
  const since = new Date(now.getTime() - PACKET_RESEND_WINDOW_MS)
  const claimed = await tx.document.updateMany({
    where: {
      id: documentId,
      OR: [
        { packetSentTo: null },
        { packetSentTo: { not: to } },
        { packetSentAt: null },
        { packetSentAt: { lte: since } },
      ],
    },
    data: { packetSentAt: now, packetSentTo: to },
  })
  if (claimed.count === 1) return { ok: true, previous }
  const current = await tx.document.findUniqueOrThrow({
    where: { id: documentId },
    select: { packetSentAt: true },
  })
  return { ok: false, at: current.packetSentAt ?? now }
}

/** A refused send gives the slot back — only if it is still ours. */
export async function releasePacketSend(
  tx: TxClient,
  documentId: string,
  claimedAt: Date,
  previous: { packetSentAt: Date | null; packetSentTo: string | null },
): Promise<void> {
  await tx.document.updateMany({
    where: { id: documentId, packetSentAt: claimedAt },
    data: previous,
  })
}

export interface PacketSendIo extends InvoicePacketIo {
  send: (message: EmailMessage) => Promise<SendResult>
  now: () => Date
}

export type PacketSendRefusal =
  | InvoicePacketPlanRefusal
  | PacketRecipientRefusal
  | { kind: 'sent_recently'; to: string; at: Date; timeZone: string }
  | { kind: 'send_failed'; why: string }

export type PacketSendOutcome =
  | {
      ok: true
      to: string
      sentAt: Date
      timeZone: string
      documentId: string
      emailId: string
      invoiceMarked: boolean
    }
  | { ok: false; reason: PacketSendRefusal }

/** Merge & send: the packet (reused or built), claimed, sent, recorded. */
export async function sendInvoicePacket(
  io: PacketSendIo,
  loadId: string,
): Promise<PacketSendOutcome> {
  const facts = await io.read((tx) => packetSendFactsFor(tx, loadId))
  if (!facts) return { ok: false, reason: { kind: 'load_not_found' } }
  const recipient = packetRecipientFor(facts.load)
  if (!recipient.ok) {
    const { ok: _ok, ...reason } = recipient
    return { ok: false, reason }
  }

  const packet = await invoicePacketForLoad(io, loadId)
  if (!packet.ok) return packet

  const now = io.now()
  const claim = await io.write((tx) =>
    claimPacketSend(tx, packet.documentId, recipient.to, now),
  )
  if (!claim.ok) {
    return {
      ok: false,
      reason: {
        kind: 'sent_recently',
        to: recipient.to,
        at: claim.at,
        timeZone: facts.company.timezone,
      },
    }
  }

  const sent = await io.send(
    packetEmail({
      to: recipient.to,
      loadNumber: facts.loadNumber,
      company: facts.company,
      filename: packet.filename,
      pdf: packet.pdf,
    }),
  )
  if (!sent.ok) {
    await io.write((tx) =>
      releasePacketSend(tx, packet.documentId, now, claim.previous),
    )
    return { ok: false, reason: { kind: 'send_failed', why: sent.reason } }
  }

  // AN EXISTING INVOICE IS MARKED SENT, with where it went. One already
  // marked keeps its first send — `markInvoiceSent` refuses a second.
  const invoiceMarked = packet.invoiceId
    ? (
        await io.write((tx) =>
          markInvoiceSent(tx, packet.invoiceId!, {
            channel: 'email (invoice packet)',
            sentToEmail: recipient.to,
            sentAt: now,
          }),
        )
      ).ok
    : false

  return {
    ok: true,
    to: recipient.to,
    sentAt: now,
    timeZone: facts.company.timezone,
    documentId: packet.documentId,
    emailId: sent.id,
    invoiceMarked,
  }
}

/** A send's time, in the authority's zone, as the sentence shows it. */
export function packetSendTime(at: Date, locale: string, timeZone: string) {
  return new Intl.DateTimeFormat(locale, {
    timeZone,
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(at)
}

/**
 * The outcome as a label key and its values — every send outcome a sentence
 * in both locales. Null for the packet's own refusals, which keep Merge
 * download's sentences (`invoicePacketRefusalDetail`).
 */
export function packetSendMessage(
  outcome: PacketSendOutcome,
  locale: string,
): { key: MessageKey; values: Record<string, string> } | null {
  if (outcome.ok) {
    return {
      key: 'loads.mergeSend.sent',
      values: {
        to: outcome.to,
        at: packetSendTime(outcome.sentAt, locale, outcome.timeZone),
      },
    }
  }
  const reason = outcome.reason
  switch (reason.kind) {
    case 'not_offered':
      return { key: 'loads.mergeSend.notOffered', values: {} }
    case 'no_address':
      return { key: `loads.mergeSend.noAddress.${reason.field}`, values: {} }
    case 'sent_recently':
      return {
        key: 'loads.mergeSend.sentRecently',
        values: {
          to: reason.to,
          at: packetSendTime(reason.at, locale, reason.timeZone),
        },
      }
    case 'send_failed':
      return {
        key:
          reason.why === 'too_large'
            ? 'loads.mergeSend.tooLarge'
            : 'loads.mergeSend.failed',
        values: {},
      }
    default:
      return null
  }
}

/**
 * The packet's own refusal inside a send refusal — the kinds Merge download
 * words (`invoicePacketRefusalDetail`) — or null for "no such load" and for
 * the send's own kinds, which `packetSendMessage` words.
 */
export function packetRefusalOf(
  reason: PacketSendRefusal,
): Exclude<InvoicePacketPlanRefusal, { kind: 'load_not_found' }> | null {
  switch (reason.kind) {
    case 'load_not_found':
    case 'not_offered':
    case 'no_address':
    case 'sent_recently':
    case 'send_failed':
      return null
    default:
      return reason
  }
}
