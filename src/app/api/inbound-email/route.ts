import { NextResponse } from 'next/server'
import { askForExtraction } from '@/lib/rate-confirmation'
import {
  baseAddress,
  emailByMessageId,
  organizationClaims,
  recordDeferred,
  recordEmail,
  recordOriginal,
  recordReading,
} from '@/lib/inbound-email'
import { takeExtractionSlot } from '@/lib/extraction-budget'
import { keepUnrouted } from '@/lib/unrouted-email'
import { liveUnroutedStore } from '@/lib/unrouted-email-store'
import { putObject, r2ConfigFromEnv } from '@/lib/r2'
import {
  documentToRead,
  type InboundEmailPayload,
} from '@/lib/inbound-email-payload'
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
    //
    // BUT THE 202 IS EARNED, NOT ASSUMED. It tells the sending server to stop
    // trying, so it may only be said once the message is somewhere. This
    // block used to be a `console.warn` and a 202, which made "delivered" and
    // "exists nowhere" true at the same time.
    let kept
    try {
      kept = await keepUnrouted(payload, liveUnroutedStore())
    } catch (error) {
      // 503, so the worker throws and the sender keeps the message. Losing it
      // here would be the exact bug this path was rewritten to close.
      console.error(
        `[zebra.inbound] could not keep unrouted mail for ${recipient}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      )
      return apiError(503, 'not_kept', 'Could not record the message.')
    }

    console.warn(
      `[zebra.inbound] no tenant claims ${recipient}; kept as ${kept.id}`,
    )
    return NextResponse.json(
      { accepted: false, reason: 'no_tenant', id: kept.id },
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

  // --- 1b. KEEP THE ORIGINAL (spec §12) ------------------------------------
  //
  // Stored before the reading, because the reading is the part that can fail
  // and the original is the part that cannot be reconstructed. A message whose
  // extraction died is still a message somebody can open.
  //
  // FAILURE HERE DOES NOT LOSE THE MAIL. R2 being unreachable must not turn a
  // booking into a 500 that Cloudflare retries forever; the row keeps
  // `rawR2Key` null, which is exactly what "no original stored" looks like.
  await storeOriginal(organizationId, created.id, payload)

  // --- 1c. IS THERE BUDGET TO READ IT? -------------------------------------
  //
  // AFTER THE DEDUPE LOOKUP, so a redelivery never takes a slot: a second copy
  // left at the duplicate branch above, before reaching here. Gmail knocked
  // four times with one message on 2026-08-15 and a limiter placed any earlier
  // would have read our own first real booking as abuse.
  //
  // AFTER THE PERSIST, TOO. The message is already a row with its original in
  // R2 — refusing the SPEND must never refuse the MESSAGE, which is the same
  // rule the 202 above follows for a different reason.
  const slot = takeExtractionSlot(organizationId)

  if (!slot.allowed) {
    // 200 AND `accepted`, because it WAS accepted: kept, openable, and on the
    // queue. What it did not get is a reading, and the row says so in the one
    // place a dispatcher will look — its state.
    const deferred = await recordDeferred(organizationId, created.id)
    console.warn(
      `[zebra.inbound] extraction budget spent for ${organizationId}; ` +
        `${created.id} kept and deferred, retry in ${slot.retryAfterSeconds}s`,
    )
    return NextResponse.json({
      accepted: true,
      id: created.id,
      state: deferred.state,
      concerns: deferred.concerns,
      deferred: true,
    })
  }

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
  // THE DISCRIMINATOR, from the module the worker imports too.
  //
  // This used to be "the first attachment whose type looks readable", which is
  // how a 37KB Gmail signature logo was handed to the reader instead of a
  // Relay booking — four times, returning our own carrier name read off our
  // own logo with every other field null. An inline part the HTML points at is
  // presentation; a PDF is a document; an image that is neither is a
  // photographed rate confirmation.
  const readable = documentToRead(payload.attachments ?? [])

  if ((payload.attachmentsDropped ?? 0) > 0) {
    // The caps had to choose. Said out loud, because a non-zero count on real
    // freight means they are wrong.
    console.warn(
      `[zebra.inbound] ${created.id}: ${payload.attachmentsDropped} attachment(s) left behind by the forwarding caps`,
    )
  }

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

  // --- 2b. SAY WHAT HAPPENED, WHETHER OR NOT IT WORKED ---------------------
  //
  // A FAILED READ AND A GOOD READ USED TO LOOK IDENTICAL ON THE TAIL.
  // `askForExtraction` returns `{ok:false}` rather than throwing, and
  // `recordReading` writes FAILED and the reason into the ROW — so the
  // database knew and nobody watching did. Every other failure on this path
  // announces itself; this one did not.
  if (!asked.ok) {
    console.error(
      `[zebra.inbound] could not read ${created.id}: ${asked.reason} — ${asked.detail}`,
    )
  } else {
    // AND THE TOKENS ON SUCCESS, WHICH IS NOT BOOKKEEPING. A real Relay
    // booking was read four times across two days and returned every field
    // null; the cause was that a 37KB signature logo was being sent to the
    // model INSTEAD OF the body, and the only place it was visible was here:
    // 4294 input tokens on a 2052-character booking and 4294 on a
    // 211-character "Hello Test 2". Identical cost for wildly different
    // documents is a fact no reading of the extraction can show you, and a
    // week of tails would have made it obvious.
    console.log(
      `[zebra.inbound] read ${created.id} with ${asked.answer.model}: ` +
        `${asked.answer.usage.inputTokens} in / ${asked.answer.usage.outputTokens} out`,
    )
  }

  // --- 3. WRITE WHAT CAME BACK, AND WHAT THE OFFICE SHOULD BE TOLD ---------
  const result = await recordReading(organizationId, created.id, asked)

  return NextResponse.json({
    accepted: true,
    id: created.id,
    state: result.state,
    concerns: result.concerns,
  })
}

/**
 * The `.eml` and its attachments, in R2 under the email's own prefix.
 *
 * ATTACHMENTS ARE NOT `Document` ROWS YET, and cannot be: `Document.companyId`
 * is required and an inbound email has no authority — which one it belongs to
 * is decided on the create form, where authority is field 1. So the bytes are
 * kept where the load can claim them at confirm, and until then the original
 * is openable as the message it arrived as.
 */
async function storeOriginal(
  organizationId: string,
  emailId: string,
  payload: InboundEmailPayload,
): Promise<void> {
  const prefix = `${organizationId}/inbound/${emailId}`

  try {
    const config = r2ConfigFromEnv()
    let rawKey: string | null = null

    if (payload.raw) {
      rawKey = `${prefix}/message.eml`
      await putObject(
        config,
        rawKey,
        bytesOfBase64(payload.raw),
        'message/rfc822',
      )
    }

    for (const [index, attachment] of (payload.attachments ?? []).entries()) {
      await putObject(
        config,
        `${prefix}/attachments/${index}-${safeName(attachment.filename)}`,
        bytesOfBase64(attachment.base64),
        attachment.mimeType,
      )
    }

    await recordOriginal(organizationId, emailId, {
      rawR2Key: rawKey,
      rawBytes: payload.rawBytes ?? null,
    })
  } catch (error) {
    // Named, not swallowed silently. The mail is already on the board; what is
    // missing is its original, and that is worth a line in `wrangler tail`
    // rather than a failed delivery.
    console.error(
      `[zebra.inbound] could not keep the original for ${emailId}: ${
        error instanceof Error ? error.message : String(error)
      }`,
    )
  }
}

/** Base64 to bytes, without Buffer. */
function bytesOfBase64(base64: string): Uint8Array {
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index++) {
    bytes[index] = binary.charCodeAt(index)
  }
  return bytes
}

/** A filename that cannot climb out of its prefix or carry a query string. */
function safeName(filename: string): string {
  return (
    filename
      .replace(/[^A-Za-z0-9._-]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 120) || 'attachment'
  )
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
