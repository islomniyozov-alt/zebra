import type { Prisma } from '@/generated/prisma/client'
import { formatCents } from './money'
import { sendEmail, type EmailMessage, type SendResult } from './email'

type TxClient = Prisma.TransactionClient

// ---------------------------------------------------------------------------
// SEND TO DRIVER (§6.2.2's action row, §6.2.1's row on the same).
//
// ── THIS IS THE ONE ACTION ON THE WORKBENCH THAT LEAVES THE BUILDING ──────
//
// Everything else on that page writes a row somebody can look at afterwards.
// This one puts a number in front of a driver, and a wrong one cannot be
// unsent. So it refuses in four situations rather than trying, and every
// refusal has its own name — a button that quietly did nothing would be worse
// than one that failed, because "I sent it" would still be what the office
// believed.
//
// ── WHY IT WILL NOT SEND FROM DEV ─────────────────────────────────────────
//
// Dev holds real drivers with their real addresses: the database is forked
// from production and the replay scripts carry the people across with it. A
// rehearsal that reaches Shuhrat Sharipov is not a rehearsal, and a screenshot
// pass over the workbench would be exactly the session that does it.
//
// `NEON_BRANCH` IS THE DISCRIMINATOR BECAUSE IT NAMES THE DATA. Not
// `NODE_ENV`, which is `production` in every built worker including dev's, and
// not a new variable that would have to be remembered in two wrangler blocks.
// The question this guard is really asking is "whose rows are these", and
// `NEON_BRANCH` is the answer to that question already.
// ---------------------------------------------------------------------------

export type StatementSendFailure =
  | 'not_found'
  /** A DRAFT can still change. A driver reads what he is sent as final. */
  | 'not_final'
  | 'voided'
  | 'no_email'
  | 'not_production'
  // The four the transport itself can return, carried through by name rather
  // than flattened into one "send failed" — `not_configured` is a deployment
  // that was never given a key and `rejected` is an address that bounced, and
  // the person reading the screen does something different about each.
  | 'not_configured'
  | 'rejected'
  | 'unreachable'
  | 'misconfigured'

export type StatementSendResult =
  | { ok: true; to: string }
  | { ok: false; reason: StatementSendFailure }

export interface StatementSendLabels {
  /** `Settlement {number}` — the subject, already translated. */
  subject: string
  greeting: string
  /** Sentence carrying the period and the net. */
  body: string
  link: string
}

const fill = (template: string, values: Record<string, string>) =>
  template.replace(/\{(\w+)\}/g, (whole, key) => values[key] ?? whole)

/**
 * The message, built apart from the sending so it can be read in a test
 * without a transport. Plain text and HTML carry the SAME sentences — a client
 * that renders only one of them must not show a different number.
 */
export function statementMessage(input: {
  to: string
  settlementNumber: string
  periodStart: Date
  periodEnd: Date
  netCents: number
  url: string
  locale: string
  labels: StatementSendLabels
}): EmailMessage {
  const day = (value: Date) => value.toISOString().slice(0, 10)
  const values = {
    number: input.settlementNumber,
    from: day(input.periodStart),
    to: day(input.periodEnd),
    net: formatCents(input.netCents, input.locale),
  }
  const subject = fill(input.labels.subject, values)
  const body = fill(input.labels.body, values)
  const text = `${input.labels.greeting}\n\n${body}\n\n${input.labels.link}: ${input.url}\n`
  const html =
    `<p>${escapeHtml(input.labels.greeting)}</p>` +
    `<p>${escapeHtml(body)}</p>` +
    `<p><a href="${escapeHtml(input.url)}">${escapeHtml(input.labels.link)}</a></p>`
  return { to: input.to, subject, text, html }
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

/**
 * Mail one statement to the driver it belongs to.
 *
 * THE ORDER OF THE CHECKS IS THE ORDER OF THE COST. Existence, then whether
 * the document is finished, then whether this deployment is allowed to send at
 * all, and only then the address — so a dev rehearsal is refused by the
 * environment rather than by accidentally having no address on file, which
 * would pass the day somebody seeds one.
 */
export async function sendStatementToDriver(
  tx: TxClient,
  settlementId: string,
  options: {
    origin: string
    locale: string
    labels: StatementSendLabels
    env?: Record<string, string | undefined>
    send?: (message: EmailMessage) => Promise<SendResult>
  },
): Promise<StatementSendResult> {
  const settlement = await tx.settlement.findFirst({
    where: { id: settlementId, deletedAt: null },
    select: {
      id: true,
      settlementNumber: true,
      status: true,
      periodStart: true,
      periodEnd: true,
      netCents: true,
      driver: { select: { email: true } },
    },
  })
  if (!settlement) return { ok: false, reason: 'not_found' }
  if (settlement.status === 'VOID') return { ok: false, reason: 'voided' }
  if (settlement.status === 'DRAFT') return { ok: false, reason: 'not_final' }

  const env = options.env ?? process.env
  if (env.NEON_BRANCH !== 'production') {
    return { ok: false, reason: 'not_production' }
  }

  const to = settlement.driver.email?.trim()
  if (!to) return { ok: false, reason: 'no_email' }

  const message = statementMessage({
    to,
    settlementNumber: settlement.settlementNumber,
    periodStart: settlement.periodStart,
    periodEnd: settlement.periodEnd,
    netCents: settlement.netCents,
    url: `${options.origin.replace(/\/+$/, '')}/settlements/${settlement.id}`,
    locale: options.locale,
    labels: options.labels,
  })

  const sent = await (options.send ?? ((m: EmailMessage) => sendEmail(m)))(
    message,
  )
  if (!sent.ok) return { ok: false, reason: sent.reason }
  return { ok: true, to }
}
