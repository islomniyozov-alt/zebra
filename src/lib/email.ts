// ---------------------------------------------------------------------------
// EMAIL, over the Resend REST API.
//
// One transport, one function, and it is `fetch`. The `resend` npm package
// works on workerd, but it is a dependency for one POST to one URL, and
// Phase 1 already spent a long afternoon proving that "it runs in Node" and
// "it runs on workerd" are different claims. Nothing here needs proving.
//
// TWO PROPERTIES THIS FILE OWES THE REST OF THE APPLICATION:
//
//   1. A FAILURE IS NEVER SILENT AND NEVER FATAL. A password-reset request
//      answers the same sentence whether or not the address exists (§11.6),
//      so it must also answer the same sentence when Resend is down —
//      otherwise the error message becomes the account-enumeration oracle the
//      rest of the flow carefully is not. `send` therefore returns a result
//      instead of throwing, and logs loudly on the way past.
//
//   2. NOTHING SENSITIVE REACHES A LOG. The token is in the URL and the URL is
//      in the body; neither is logged, ever. What is logged is the recipient
//      domain, the Resend error, and nothing else.
// ---------------------------------------------------------------------------

const ENDPOINT = 'https://api.resend.com/emails'

/**
 * The default sender.
 *
 * `onboarding@resend.dev` is Resend's own shared address: it works the moment
 * an API key exists, with NO domain verification, and it will only deliver to
 * the address that owns the Resend account. That is exactly right for a
 * development worker and exactly wrong for production, which is why
 * `RESEND_FROM` overrides it and the deployment notes say to set it.
 */
export const DEFAULT_FROM = 'Zebra <onboarding@resend.dev>'

export interface EmailMessage {
  to: string
  subject: string
  /** Plain text. Always sent — some clients never render the HTML part. */
  text: string
  html: string
  /** Where a reply goes, when it should not go to the sender. */
  replyTo?: string | null
  /** Files, sent as Base64 inside the JSON body (Resend's only form). */
  attachments?: readonly EmailAttachment[]
}

export interface EmailAttachment {
  filename: string
  content: Uint8Array
}

/**
 * Resend's limit on one email, attachments included AFTER Base64 encoding.
 * A body over it is refused here, by name, before the network — Resend's own
 * refusal of a 45 MB upload would cost the isolate the upload first.
 */
export const RESEND_MAX_REQUEST_BYTES = 40 * 1024 * 1024

export type SendResult =
  | { ok: true; id: string }
  | {
      ok: false
      reason:
        | 'not_configured'
        | 'rejected'
        | 'unreachable'
        | 'misconfigured'
        | 'too_large'
    }

const BASE64 =
  'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'

/** Base64 written straight into bytes — never a string the size of the file. */
export function base64Bytes(bytes: Uint8Array): Uint8Array {
  const out = new Uint8Array(Math.ceil(bytes.length / 3) * 4)
  let o = 0
  let i = 0
  for (; i + 2 < bytes.length; i += 3) {
    const n = (bytes[i]! << 16) | (bytes[i + 1]! << 8) | bytes[i + 2]!
    out[o++] = BASE64.charCodeAt(n >> 18)
    out[o++] = BASE64.charCodeAt((n >> 12) & 63)
    out[o++] = BASE64.charCodeAt((n >> 6) & 63)
    out[o++] = BASE64.charCodeAt(n & 63)
  }
  const rest = bytes.length - i
  if (rest > 0) {
    const n = (bytes[i]! << 16) | (rest === 2 ? bytes[i + 1]! << 8 : 0)
    out[o++] = BASE64.charCodeAt(n >> 18)
    out[o++] = BASE64.charCodeAt((n >> 12) & 63)
    out[o++] = rest === 2 ? BASE64.charCodeAt((n >> 6) & 63) : 61
    out[o++] = 61
  }
  return out
}

/**
 * The request body Resend reads, AS BYTES.
 *
 * A 20 MB packet is 27 MB of Base64. Built as a string inside
 * `JSON.stringify` it would be a 27 MB string and then a second 27 MB buffer
 * when `fetch` encodes it — inside a 128 MB isolate that already holds the
 * packet. So the JSON is written with a marker where each attachment's
 * content goes, encoded once, and the Base64 written into the one buffer
 * between the halves. Markers are checked to occur exactly once.
 */
export function emailRequestBody(
  config: Pick<EmailConfig, 'from'>,
  message: EmailMessage,
): Uint8Array {
  const attachments = message.attachments ?? []
  const marker = (index: number) => `zebra-attachment-${index}-content`
  const json = JSON.stringify({
    from: config.from,
    to: [message.to],
    subject: message.subject,
    text: message.text,
    html: message.html,
    ...(message.replyTo ? { reply_to: message.replyTo } : {}),
    ...(attachments.length > 0
      ? {
          attachments: attachments.map((attachment, index) => ({
            filename: attachment.filename,
            content: marker(index),
          })),
        }
      : {}),
  })
  const encoder = new TextEncoder()
  const pieces: Uint8Array[] = []
  let rest = json
  attachments.forEach((attachment, index) => {
    const quoted = `"${marker(index)}"`
    const parts = rest.split(quoted)
    if (parts.length !== 2) {
      throw new Error(`email body: attachment marker ${index} is not unique`)
    }
    pieces.push(encoder.encode(`${parts[0]}"`))
    pieces.push(base64Bytes(attachment.content))
    pieces.push(encoder.encode('"'))
    rest = parts[1]!
  })
  pieces.push(encoder.encode(rest))
  const body = new Uint8Array(
    pieces.reduce((sum, piece) => sum + piece.byteLength, 0),
  )
  let at = 0
  for (const piece of pieces) {
    body.set(piece, at)
    at += piece.byteLength
  }
  return body
}

export interface EmailConfig {
  apiKey: string
  from: string
}

/**
 * Read the transport's configuration, or null when it is not set up.
 *
 * Null rather than a throw: a worker with no `RESEND_API_KEY` is a worker
 * where reset mail does not go out, which is a deployment fact and not a bug
 * in the request being served. Callers log it and carry on.
 */
export function emailConfigFromEnv(
  env: Record<string, string | undefined> = process.env,
): EmailConfig | null {
  const raw = env.RESEND_API_KEY
  if (!raw) return null

  // Trimmed as hygiene, and NOT as the fix for anything.
  //
  // Production's reset mail failed with `TypeError: Invalid header value.` and
  // a trailing newline on this secret was the obvious suspect. It is not the
  // culprit: workerd accepts a trailing newline in a header value, as
  // tests/workers/email-header.test.ts asserts on the real runtime. What
  // throws is an illegal character INSIDE the value — a key pasted across two
  // lines, or a whole shell command landing in the secret, which has happened
  // repeatedly here.
  //
  // So this trim tidies the harmless case and deliberately does not touch the
  // harmful one: a key mangled in the middle stays mangled, keeps failing, and
  // keeps producing the `misconfigured` reason below that names the secret
  // instead of blaming the network.
  const apiKey = raw.trim()
  if (apiKey !== raw) {
    console.warn(
      '[zebra.email] RESEND_API_KEY had surrounding whitespace and was trimmed',
      { trimmed: raw.length - apiKey.length },
    )
  }

  return { apiKey, from: (env.RESEND_FROM || DEFAULT_FROM).trim() }
}

/** The part of an address that is safe to log. */
function domainOf(address: string): string {
  const at = address.lastIndexOf('@')
  return at === -1 ? '(malformed)' : address.slice(at + 1)
}

export async function sendEmail(
  message: EmailMessage,
  config: EmailConfig | null = emailConfigFromEnv(),
  fetchImpl: typeof fetch = fetch,
): Promise<SendResult> {
  if (!config) {
    console.warn('[zebra.email] RESEND_API_KEY is not set; nothing was sent', {
      to: domainOf(message.to),
      subject: message.subject,
    })
    return { ok: false, reason: 'not_configured' }
  }

  const body = emailRequestBody(config, message)
  if (body.byteLength > RESEND_MAX_REQUEST_BYTES) {
    console.error('[zebra.email] the message is over Resend’s limit', {
      to: domainOf(message.to),
      bytes: body.byteLength,
      limit: RESEND_MAX_REQUEST_BYTES,
    })
    return { ok: false, reason: 'too_large' }
  }

  let response: Response
  try {
    response = await fetchImpl(ENDPOINT, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${config.apiKey}`,
        'content-type': 'application/json',
      },
      body: body as unknown as BodyInit,
    })
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error)

    // `fetch` throws before any socket opens when a header value is illegal —
    // a key with a newline in it, most often. That is a CONFIGURATION fault
    // and saying "unreachable" sends whoever reads the log to the wrong place.
    if (/invalid header|header value/i.test(detail)) {
      console.error(
        '[zebra.email] the request could not be built — check RESEND_API_KEY',
        { to: domainOf(message.to), error: detail },
      )
      return { ok: false, reason: 'misconfigured' }
    }

    // A network failure, not a rejection. Worth separating: one is Resend
    // saying no and the other is never having reached them.
    console.error('[zebra.email] could not reach Resend', {
      to: domainOf(message.to),
      error: detail,
    })
    return { ok: false, reason: 'unreachable' }
  }

  if (!response.ok) {
    const body = await response.text().catch(() => '')
    console.error('[zebra.email] Resend refused the message', {
      to: domainOf(message.to),
      status: response.status,
      // Resend's errors name the problem — an unverified domain, a bad key —
      // and carry nothing from the message body.
      body: body.slice(0, 400),
    })
    return { ok: false, reason: 'rejected' }
  }

  const payload = (await response.json().catch(() => ({}))) as { id?: string }

  // SUCCESS SAYS SO. Every failure path above logs, and the success path used
  // to log nothing — which made "the reset mail is working" a claim about the
  // ABSENCE of a line, indistinguishable from a request that never attempted
  // to send at all. Same reasoning as the audit sink: silence is only healthy
  // once you have watched it speak.
  //
  // The id is Resend's, and it is the handle you give their dashboard when
  // somebody says the mail never arrived. No address, no token, no subject.
  console.log('[zebra.email] sent', {
    to: domainOf(message.to),
    id: payload.id ?? '(none returned)',
  })

  return { ok: true, id: payload.id ?? '' }
}
