import { describe, expect, it } from 'vitest'
import {
  base64Bytes,
  emailRequestBody,
  RESEND_MAX_REQUEST_BYTES,
  sendEmail,
} from '@/lib/email'

// ---------------------------------------------------------------------------
// ATTACHMENTS IN sendEmail (BROKER-LOAD-BRIEF step 5). Resend takes an
// attachment as Base64 inside the JSON body. A 20 MB packet is 27 MB of
// Base64, so the body is built as BYTES — the JSON around it encoded once and
// the Base64 written straight into one buffer — never as a 27 MB string that
// is then encoded again into a second buffer. These hold that the bytes are
// exactly the JSON a reader would expect.
// ---------------------------------------------------------------------------

const config = { apiKey: 're_test', from: 'Zebra <billing@zebratms.com>' }
const message = {
  to: 'ap@broker.example',
  subject: 'Invoice packet — load 1001',
  text: 'Attached.',
  html: '<p>Attached.</p>',
}

describe('the Base64 writer', () => {
  it('agrees with the platform on every length class', () => {
    for (const length of [0, 1, 2, 3, 4, 5, 255, 1024, 4097]) {
      const bytes = new Uint8Array(length).map((_, i) => (i * 37 + 11) & 255)
      expect(new TextDecoder().decode(base64Bytes(bytes))).toBe(
        Buffer.from(bytes).toString('base64'),
      )
    }
  })
})

describe('the request body', () => {
  it('is the JSON Resend reads, the attachment as Base64 and reply_to set', () => {
    const content = new Uint8Array([37, 80, 68, 70, 0, 255, 128])
    const body = emailRequestBody(config, {
      ...message,
      replyTo: 'office@carrier.example',
      attachments: [{ filename: 'packet-1001.pdf', content }],
    })
    expect(JSON.parse(new TextDecoder().decode(body))).toEqual({
      from: config.from,
      to: [message.to],
      subject: message.subject,
      text: message.text,
      html: message.html,
      reply_to: 'office@carrier.example',
      attachments: [
        {
          filename: 'packet-1001.pdf',
          content: Buffer.from(content).toString('base64'),
        },
      ],
    })
  })

  it('without attachments is the body it always was', () => {
    expect(
      JSON.parse(new TextDecoder().decode(emailRequestBody(config, message))),
    ).toEqual({
      from: config.from,
      to: [message.to],
      subject: message.subject,
      text: message.text,
      html: message.html,
    })
  })

  it('a message over Resend’s limit is refused before the network', async () => {
    let called = false
    const result = await sendEmail(
      {
        ...message,
        attachments: [
          {
            filename: 'big.pdf',
            content: new Uint8Array(Math.ceil(RESEND_MAX_REQUEST_BYTES * 0.76)),
          },
        ],
      },
      config,
      (async () => {
        called = true
        return new Response('{}')
      }) as typeof fetch,
    )
    expect(result).toEqual({ ok: false, reason: 'too_large' })
    expect(called).toBe(false)
  })
})
