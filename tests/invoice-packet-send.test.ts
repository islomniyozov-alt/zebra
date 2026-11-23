import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { translator } from '@/lib/i18n'
import {
  PACKET_EMAIL_MAX_BYTES,
  packetEmail,
  packetRecipientFor,
  packetRefusalOf,
  packetSendMessage,
  type PacketRecipientFacts,
  type PacketSendOutcome,
} from '@/lib/invoice-packet-send'

// ---------------------------------------------------------------------------
// MERGE & SEND, the parts that need no database (TMS §7.14 item 6; R5, R6).
// The claim, the 24-hour refusal and the invoice are proven against Postgres
// in tests/integration/invoice-packet-send.test.ts.
// ---------------------------------------------------------------------------

const broker = (
  over: Partial<PacketRecipientFacts> = {},
): PacketRecipientFacts => ({
  id: 'load-1',
  directSettled: false,
  paymentType: null,
  customer: { id: 'cust-1', name: 'Werner', billingEmail: 'ap@werner.example' },
  factoringCompany: { name: 'RTS', email: 'funding@rts.example' },
  ...over,
})

describe('R5 — the recipient', () => {
  it('Quickpay, ACH and none go to the customer’s billing email', () => {
    for (const paymentType of ['Quickpay', 'ACH', null]) {
      expect(packetRecipientFor(broker({ paymentType }))).toMatchObject({
        ok: true,
        to: 'ap@werner.example',
        party: 'customer',
      })
    }
  })

  it('Factored goes to the factor', () => {
    expect(
      packetRecipientFor(broker({ paymentType: 'Factored' })),
    ).toMatchObject({ ok: true, to: 'funding@rts.example', party: 'factor' })
  })

  it('Direct, direct-settled and Amazon freight are never offered', () => {
    expect(packetRecipientFor(broker({ paymentType: 'Direct' }))).toEqual({
      ok: false,
      kind: 'not_offered',
    })
    expect(packetRecipientFor(broker({ directSettled: true }))).toEqual({
      ok: false,
      kind: 'not_offered',
    })
    expect(
      packetRecipientFor(
        broker({
          customer: {
            id: 'c',
            name: 'Amazon Relay',
            billingEmail: 'x@amazon.example',
          },
        }),
      ),
    ).toEqual({ ok: false, kind: 'not_offered' })
  })

  it('no address names the field and where it is filled', () => {
    expect(
      packetRecipientFor(
        broker({
          customer: { id: 'cust-1', name: 'Werner', billingEmail: ' ' },
        }),
      ),
    ).toEqual({
      ok: false,
      kind: 'no_address',
      field: 'billing_email',
      href: '/brokers/cust-1',
    })
    expect(
      packetRecipientFor(
        broker({ paymentType: 'Factored', factoringCompany: null }),
      ),
    ).toMatchObject({
      field: 'factoring_company',
      href: '/loads/load-1?tab=financials',
    })
    expect(
      packetRecipientFor(
        broker({
          paymentType: 'Factored',
          factoringCompany: { name: 'RTS', email: null },
        }),
      ),
    ).toMatchObject({ field: 'factor_email', href: '/receivables/factoring' })
  })
})

describe('the mail', () => {
  it('attaches the packet and replies to the authority', () => {
    const pdf = new Uint8Array([1, 2, 3])
    const mail = packetEmail({
      to: 'ap@werner.example',
      loadNumber: '1177',
      company: {
        name: 'RAM Haulage',
        email: 'office@ram.example',
      },
      filename: 'packet-1177.pdf',
      pdf,
    })
    expect(mail).toMatchObject({
      to: 'ap@werner.example',
      replyTo: 'office@ram.example',
      attachments: [{ filename: 'packet-1177.pdf', content: pdf }],
    })
    expect(mail.subject).toContain('1177')
  })
})

describe('every outcome is a sentence in both locales', () => {
  const at = new Date(Date.UTC(2026, 10, 23, 15, 0))
  const outcomes: PacketSendOutcome[] = [
    {
      ok: true,
      to: 'ap@werner.example',
      sentAt: at,
      timeZone: 'America/Chicago',
      documentId: 'd',
      emailId: 'e',
      invoiceMarked: false,
    },
    { ok: false, reason: { kind: 'not_offered' } },
    {
      ok: false,
      reason: { kind: 'no_address', field: 'billing_email', href: '/' },
    },
    {
      ok: false,
      reason: { kind: 'no_address', field: 'factor_email', href: '/' },
    },
    {
      ok: false,
      reason: { kind: 'no_address', field: 'factoring_company', href: '/' },
    },
    {
      ok: false,
      reason: {
        kind: 'sent_recently',
        to: 'ap@werner.example',
        at,
        timeZone: 'America/Chicago',
      },
    },
    { ok: false, reason: { kind: 'send_failed', why: 'rejected' } },
    { ok: false, reason: { kind: 'send_failed', why: 'too_large' } },
    {
      ok: false,
      reason: {
        kind: 'too_large_to_email',
        bytes: PACKET_EMAIL_MAX_BYTES + 1,
        limit: PACKET_EMAIL_MAX_BYTES,
      },
    },
  ]

  it('names a label that exists in EN and RU, with its values filled', () => {
    for (const locale of ['en', 'ru'] as const) {
      const t = translator(locale)
      for (const outcome of outcomes) {
        const message = packetSendMessage(outcome, locale)
        expect(message).not.toBeNull()
        const text = t(message!.key)
        expect(text).not.toBe(message!.key)
        for (const name of Object.keys(message!.values)) {
          expect(text).toContain(`{${name}}`)
        }
      }
    }
  })

  it('the time is the first send’s, in the authority’s zone', () => {
    const message = packetSendMessage(outcomes[5]!, 'en')
    expect(message!.values.at).toMatch(/9:00/)
  })

  it('over 18 MB says so by name, in both locales — use Merge download', () => {
    const outcome: PacketSendOutcome = {
      ok: false,
      reason: {
        kind: 'too_large_to_email',
        bytes: 18_000_001,
        limit: 18_000_000,
      },
    }
    const message = packetSendMessage(outcome, 'en')!
    expect(translator('en')(message.key)).toBe(
      'Packet too large to email (over 18 MB) — use Merge download.',
    )
    expect(translator('ru')(message.key)).toContain('18 МБ')
    expect(packetRefusalOf(outcome.reason)).toBeNull()
    // 18 MB of PDF, Base64-encoded, fits a 25 MB inbox.
    expect((PACKET_EMAIL_MAX_BYTES / 3) * 4).toBeLessThanOrEqual(24_000_000)
  })

  it('a packet refusal is left to Merge download’s sentences', () => {
    const refusal = { kind: 'nothing_to_merge' } as const
    expect(packetSendMessage({ ok: false, reason: refusal }, 'en')).toBeNull()
    expect(packetRefusalOf(refusal)).toEqual(refusal)
    expect(packetRefusalOf({ kind: 'load_not_found' })).toBeNull()
  })
})

describe('the wiring', () => {
  const read = (path: string) => readFileSync(path, 'utf8')

  it('reads under load.financials and sends under invoice:update', () => {
    const action = read('src/app/(app)/loads/[id]/packet-send-actions.ts')
    expect(action).toContain(
      "read: (fn) => withCurrentOrg('read', 'load.financials', (tx) => fn(tx)),",
    )
    expect(action).toMatch(
      /withCurrentOrg\('update', 'invoice', \(tx, session\) =>/,
    )
    expect(action).toContain('send: (message) => sendEmail(message),')
  })

  it('the page offers it only to the role that may send, beside Merge download', () => {
    const page = read('src/app/(app)/loads/[id]/page.tsx')
    expect(page).toMatch(
      /const maySend =\s*mayInvoice &&\s*maySeeRate &&\s*mayUpload &&\s*\(await currentUserCan\('update', 'invoice'\)\)/,
    )
    expect(page).toContain(
      'send: maySend ? await packetSendFactsFor(tx, id) : null,',
    )
    expect(page).toContain('action={sendInvoicePacketAction.bind(null, id)}')
  })
})
