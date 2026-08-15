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
  /** Base64 attachments worth reading. The worker drops signatures and logos. */
  attachments?: {
    filename: string
    mimeType: string
    base64: string
  }[]
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
