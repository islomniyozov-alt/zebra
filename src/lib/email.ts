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
}

export type SendResult =
  | { ok: true; id: string }
  | { ok: false; reason: 'not_configured' | 'rejected' | 'unreachable' }

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
  const apiKey = env.RESEND_API_KEY
  if (!apiKey) return null
  return { apiKey, from: env.RESEND_FROM || DEFAULT_FROM }
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

  let response: Response
  try {
    response = await fetchImpl(ENDPOINT, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${config.apiKey}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        from: config.from,
        to: [message.to],
        subject: message.subject,
        text: message.text,
        html: message.html,
      }),
    })
  } catch (error) {
    // A network failure, not a rejection. Worth separating: one is Resend
    // saying no and the other is never having reached them.
    console.error('[zebra.email] could not reach Resend', {
      to: domainOf(message.to),
      error: error instanceof Error ? error.message : String(error),
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
  return { ok: true, id: payload.id ?? '' }
}
