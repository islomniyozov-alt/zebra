// ---------------------------------------------------------------------------
// THE SHAPE THE MAIL WORKER POSTS, IN ONE PLACE.
//
// THREE COPIES OF IT USED TO EXIST AND NOTHING HELD THEM TOGETHER:
//
//   workers/email/index.ts        builds the body — a bare object literal
//   src/app/api/inbound-email     read it back as its own interface
//   scripts/verify-inbound-email  posts "the payload the worker sends, field
//                                 for field", by hand
//
// That correspondence was maintained by remembering. Renaming a field passed
// `tsc`, passed the verify script (which carried its own copy), and failed
// only on real mail — after Email Routing was live, which is the worst place
// to discover it. The workers are separate deployments and can drift for real:
// `zebra-email` and `zebra` are deployed by two different commands.
//
// SO THE TYPE LIVES HERE AND THE WORKER IMPORTS IT. A type-only import is
// erased at build time, so the worker gains a compile-time contract and no
// runtime weight. `tests/inbound-email-contract.test.ts` covers the third
// copy, which is `.mjs` and cannot be typed — it checks the field names
// against the list below.
//
// THE LIST IS PROVED AGAINST THE INTERFACE, not maintained beside it. Adding a
// field to one without the other is a TYPE ERROR, a few lines down.
// ---------------------------------------------------------------------------

export interface InboundEmailPayload {
  /** RFC 5322 Message-ID. The idempotency key, and measured to be the stable
   * one: flag 58 watched the raw bytes change between redeliveries. */
  messageId: string
  /** The ENVELOPE sender — what actually delivered this, not the header
   * anybody can write. */
  from: string
  to: string
  subject?: string | null
  /** The best text body the parser found — plain preferred, else HTML text. */
  text?: string | null
  /**
   * Every readable-type attachment the message carried, within the caps below.
   *
   * THE WORKER NO LONGER CHOOSES. It used to filter to readable types and take
   * `.slice(0, 1)` — the FIRST match in MIME order — so a signature logo could
   * be forwarded while the rate confirmation behind it was discarded in a
   * process with no database, no log anybody reads, and no way to ask. Now it
   * carries the candidates and the facts about them; the decision is here.
   */
  attachments?: InboundAttachment[]
  /** How many were left behind by the caps. Zero unless something was. */
  attachmentsDropped?: number
  /** The whole `.eml`, base64. Null when it was too large to carry. */
  raw?: string | null
  /** How big it was, whether or not `raw` came with it. */
  rawBytes?: number | null
}

/**
 * Every field of the payload, by name, for the copy that cannot be typed.
 *
 * Order is the order the worker writes them, so a reviewer comparing the two
 * files reads the same sequence twice.
 */
export const INBOUND_EMAIL_PAYLOAD_FIELDS = [
  'messageId',
  'from',
  'to',
  'subject',
  'text',
  'attachments',
  'attachmentsDropped',
  'raw',
  'rawBytes',
] as const

// --- the two directions, as compile errors -------------------------------
//
// Neither of these costs a byte at runtime; both fail `npm run typecheck` the
// moment the list and the interface disagree. A test could only check this
// after someone ran it.

type Listed = (typeof INBOUND_EMAIL_PAYLOAD_FIELDS)[number]

/** A field on the interface that nobody added to the list. */
type Unlisted = Exclude<keyof InboundEmailPayload, Listed>
const _everyFieldIsListed: Unlisted extends never ? true : Unlisted = true

/** A name on the list that is not a field. */
type Phantom = Exclude<Listed, keyof InboundEmailPayload>
const _everyListedNameIsAField: Phantom extends never ? true : Phantom = true

void _everyFieldIsListed
void _everyListedNameIsAField

/**
 * One attachment, and the three facts needed to judge it.
 *
 * FACTS, NOT VERDICTS. The worker reports what the message declared; whether
 * that makes a part decoration is decided by `isDecoration` below, in this
 * file, which both sides import. A worker that shipped conclusions would be a
 * second place the rule lives.
 */
export interface InboundAttachment {
  filename: string
  mimeType: string
  base64: string
  /** As declared: `inline`, `attachment`, or absent. */
  disposition: string | null
  /** `Content-ID` with the angle brackets removed, when the part carried one. */
  contentId: string | null
  /** The HTML body references this part with a `cid:` URL. */
  inlineReferenced: boolean
}

/**
 * What judging an attachment needs, and nothing else.
 *
 * The rules below take FACTS rather than whole attachments, so the worker can
 * sort candidates before it has spent anything turning them into base64 — and
 * so nothing in the rule can come to depend on the bytes.
 */
export type AttachmentFacts = Pick<
  InboundAttachment,
  'mimeType' | 'disposition' | 'inlineReferenced'
>

/** How many candidates the worker will carry. */
export const MAX_FORWARDED_ATTACHMENTS = 6

/** And how much they may weigh in total, before base64 inflates them by a third. */
export const MAX_FORWARDED_TOTAL_BYTES = 10 * 1024 * 1024

/**
 * Is this part of the message's presentation rather than a document sent with
 * it?
 *
 * MEASURED, NOT GUESSED. On 2026-08-16 a real Relay booking was read as every
 * field null four times running. The reader had been handed a Gmail signature
 * logo instead of the booking: `image/png`, `Content-Disposition: inline`,
 * `Content-ID: <ii_1a007c16a55d98c076d1>`, referenced by the HTML as
 * `cid:ii_1a007c16a55d98c076d1`. It returned `brokerName: "RAM HAULAGE"` —
 * our own name, read off our own logo — with everything else null.
 *
 * SIZE IS NOT A SIGNAL, and the same message is why. That logo was 37KB
 * against a 12.7KB HTML body: three times the weight of the thing it
 * decorates. Any floor low enough to admit a photographed rate confirmation
 * would have admitted it, and a floor is a number somebody tunes later
 * without the message that set it.
 */
export function isDecoration(attachment: AttachmentFacts): boolean {
  return attachment.inlineReferenced || attachment.disposition === 'inline'
}

export function isPdf(attachment: AttachmentFacts): boolean {
  return attachment.mimeType === 'application/pdf'
}

/**
 * Which attachment the reader should be given, or null to read the body.
 *
 * PDF ALWAYS WINS: "see attached" means it, and nobody decorates an email with
 * a PDF. An image only wins if it is not decoration — a photographed or
 * scanned rate confirmation arrives as a real attachment, not as something the
 * HTML points at.
 */
export function documentToRead<T extends AttachmentFacts>(
  attachments: readonly T[],
): T | null {
  const pdf = attachments.find(isPdf)
  if (pdf) return pdf

  return (
    attachments.find(
      (attachment) =>
        attachment.mimeType.startsWith('image/') && !isDecoration(attachment),
    ) ?? null
  )
}

/**
 * The order candidates are kept in when the caps force a choice.
 *
 * DOCUMENT-MOST-LIKELY FIRST, so what gets dropped is what matters least. A
 * cap that trimmed in arrival order would reintroduce the same bug at a
 * different threshold: the PDF discarded because a logo reached the limit
 * first.
 */
export function byDocumentLikelihood(
  a: AttachmentFacts,
  b: AttachmentFacts,
): number {
  return rank(a) - rank(b)
}

function rank(attachment: AttachmentFacts): number {
  if (isPdf(attachment)) return 0
  return isDecoration(attachment) ? 2 : 1
}
