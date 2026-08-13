import { NextResponse } from 'next/server'
import { askForExtraction } from '@/lib/rate-confirmation'
import {
  baseAddress,
  emailByMessageId,
  organizationClaims,
  recordEmail,
  recordReading,
} from '@/lib/inbound-email'
import { apiError } from '../_lib/respond'

// POST /api/inbound-email — a booking email, delivered (Phase 6 §4 step 4).
//
// THE CALLER IS A WORKER, NOT A BROWSER, and it has no session. Cloudflare
// Email Routing hands a message to an Email Worker; that worker parses the
// MIME and posts the result here. So this is the one route in the application
// authenticated by a SHARED SECRET rather than by a cookie, and it is worth
// being precise about what that buys and what it does not:
//
//   * The secret proves the caller is our mail worker. It proves NOTHING about
//     who sent the email — anybody can send mail to a public address, and this
//     endpoint therefore treats the contents as untrusted input from a
//     stranger, which is exactly what a rate confirmation from a new broker
//     also is.
//   * It is compared in constant time, because a timing oracle on a secret
//     that never rotates is worth somebody's afternoon.
//
// NOTHING HERE CREATES A LOAD. §1.1: the inbox is a queue of unfinished forms.
// The mail becomes an `InboundEmail`, gets read, gets a state computed from
// the create form's own validations, and waits for a dispatcher.

export interface InboundEmailPayload {
  /** RFC 5322 Message-ID. The idempotency key. */
  messageId: string
  from: string
  to: string
  subject?: string | null
  /** The best text body the parser found — plain preferred, else HTML text. */
  text?: string | null
  /** Base64 attachments worth reading. The worker drops signatures and images. */
  attachments?: {
    filename: string
    mimeType: string
    base64: string
  }[]
}

export async function POST(request: Request): Promise<Response> {
  const secret = process.env.INBOUND_EMAIL_SECRET
  if (!secret) {
    // A route that accepted anything because it was misconfigured would be
    // worse than one that is off. Named so `wrangler tail` says which.
    console.error('[zebra.inbound] INBOUND_EMAIL_SECRET is not set.')
    return apiError(503, 'not_configured', 'Inbound email is not configured.')
  }

  const offered = request.headers.get('authorization') ?? ''
  if (!constantTimeEquals(offered, `Bearer ${secret}`)) {
    return apiError(401, 'unauthenticated', 'Bad or missing bearer token.')
  }

  let payload: InboundEmailPayload
  try {
    payload = (await request.json()) as InboundEmailPayload
  } catch {
    return apiError(400, 'invalid_body', 'Expected a JSON object.')
  }

  if (!payload.messageId || !payload.from || !payload.to) {
    return apiError(400, 'invalid_body', 'messageId, from and to are required.')
  }

  // --- WHICH TENANT, AND WHY IT IS CONFIGURATION RATHER THAN A LOOKUP ------
  //
  // `Organization`'s own row-level policy is `id = current_setting(
  // 'app.current_org_id')`. No connection can find a tenant it has not already
  // been told about — which is the boundary working, not a gap in it. So there
  // is no query that could resolve a recipient address to an organization
  // without first weakening the one rule this schema is built on.
  //
  // The tenant therefore comes from configuration and the DATABASE CONFIRMS
  // IT: `INBOUND_EMAIL_ORG_ID` says who the mail is for, and the scoped read
  // below checks that organization actually claims the address it arrived at.
  // Config alone would be a claim; config plus the check is an agreement
  // between two places that have to be changed together.
  //
  // WHEN A SECOND TENANT WANTS AN INBOX this becomes a routing table outside
  // RLS, beside `User` and `Session` — the same escape hatch for the same
  // reason, already documented in `auth-db.ts`. Not built now: there is one
  // tenant, and a router with one route gets its first real exercise on the
  // day it matters. Flagged in the brief.
  const organizationId = process.env.INBOUND_EMAIL_ORG_ID
  if (!organizationId) {
    console.error('[zebra.inbound] INBOUND_EMAIL_ORG_ID is not set.')
    return apiError(503, 'not_configured', 'Inbound email is not configured.')
  }

  const recipient = baseAddress(payload.to)

  if (!(await organizationClaims(organizationId, recipient))) {
    // 202, NOT 4xx. The mail WAS delivered; there is simply nobody here it
    // belongs to. A 4xx makes Cloudflare retry a message that will never
    // route, and a bounce would tell a stranger which addresses exist.
    console.warn(`[zebra.inbound] no tenant claims ${recipient}`)
    return NextResponse.json(
      { accepted: false, reason: 'no_tenant' },
      { status: 202 },
    )
  }

  // --- 1. RECORD IT BEFORE READING IT ---------------------------------------
  //
  // A message that kills the reader is still a message that arrived. The
  // unique `messageId` is what makes a redelivery cheap: Cloudflare can
  // deliver the same message twice and the second is a no-op.
  const existing = await emailByMessageId(organizationId, payload.messageId)
  if (existing) {
    return NextResponse.json({
      accepted: true,
      duplicate: true,
      id: existing.id,
    })
  }

  const created = await recordEmail(organizationId, {
    messageId: payload.messageId,
    from: payload.from,
    to: payload.to,
    subject: payload.subject ?? null,
    text: payload.text ?? null,
  })

  // --- 2. READ IT, WITH NOTHING HELD OPEN -----------------------------------
  //
  // The rule flag 38 bought: a model call does not belong inside a database
  // transaction. The email body IS a document — §1.2, "an Excel sheet, a
  // pasted prompt, and a PDF are all just documents" — so it goes through the
  // same contract as everything else.
  //
  // AN ATTACHMENT WINS OVER THE BODY when there is one worth reading. A Relay
  // booking says the essentials in its body; a broker's rate confirmation says
  // "see attached" and means it.
  const readable = (payload.attachments ?? []).find((attachment) =>
    /^(application\/pdf|image\/)/.test(attachment.mimeType),
  )

  const asked = readable
    ? await askForExtraction({
        base64: readable.base64,
        mimeType: readable.mimeType,
      })
    : payload.text && payload.text.trim().length >= 20
      ? await askForExtraction({
          base64: base64OfText(payload.text),
          mimeType: 'text/plain',
        })
      : ({
          ok: false as const,
          reason: 'no_document' as const,
          detail:
            'The message had no readable body and no readable attachment.',
        } as const)

  // --- 3. WRITE WHAT CAME BACK, AND WHAT THE OFFICE SHOULD BE TOLD ---------
  const result = await recordReading(organizationId, created.id, asked)

  return NextResponse.json({
    accepted: true,
    id: created.id,
    state: result.state,
    concerns: result.concerns,
  })
}

/** UTF-8 text as base64, without Buffer — this runs on workerd. */
function base64OfText(text: string): string {
  const bytes = new TextEncoder().encode(text)
  let binary = ''
  const CHUNK = 0x8000
  for (let index = 0; index < bytes.length; index += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(index, index + CHUNK))
  }
  return btoa(binary)
}

/**
 * Compare without leaking length or position through timing.
 *
 * The secret does not rotate on a schedule and the endpoint is public, which
 * is exactly the shape a timing oracle is worth building against.
 */
function constantTimeEquals(a: string, b: string): boolean {
  const left = new TextEncoder().encode(a)
  const right = new TextEncoder().encode(b)
  // The loop runs over the longer of the two and folds the length difference
  // in rather than short-circuiting on it.
  const length = Math.max(left.length, right.length)
  let difference = left.length ^ right.length
  for (let index = 0; index < length; index++) {
    difference |= (left[index] ?? 0) ^ (right[index] ?? 0)
  }
  return difference === 0
}
