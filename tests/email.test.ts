import { describe, expect, it, vi } from 'vitest'
import { DEFAULT_FROM, emailConfigFromEnv, sendEmail } from '@/lib/email'
import { resetEmail, resetLink } from '@/lib/reset-email'
import { translator, type MessageKey } from '@/lib/i18n'

// The reset email is the only mail this application sends, and it carries a
// bearer capability. These tests are about the two things that would matter at
// three in the morning: that a failure cannot change what the user is told,
// and that the link in the message is the link that works.

const t = translator('en')

describe('configuration', () => {
  it('is absent rather than broken when the key is unset', () => {
    expect(emailConfigFromEnv({})).toBeNull()
  })

  it('falls back to the shared sender that needs no verified domain', () => {
    expect(emailConfigFromEnv({ RESEND_API_KEY: 're_x' })?.from).toBe(
      DEFAULT_FROM,
    )
  })

  it('prefers an explicit sender', () => {
    expect(
      emailConfigFromEnv({
        RESEND_API_KEY: 're_x',
        RESEND_FROM: 'Zebra <no-reply@example.com>',
      })?.from,
    ).toBe('Zebra <no-reply@example.com>')
  })
})

describe('sending', () => {
  const message = {
    to: 'someone@example.com',
    subject: 'Subject',
    text: 'text',
    html: '<p>html</p>',
  }

  it('posts what Resend expects', async () => {
    const fetchImpl = vi.fn(
      async () =>
        new Response(JSON.stringify({ id: 'msg_1' }), { status: 200 }),
    )
    const result = await sendEmail(
      message,
      { apiKey: 're_secret', from: 'Zebra <a@b.c>' },
      fetchImpl as unknown as typeof fetch,
    )

    expect(result).toEqual({ ok: true, id: 'msg_1' })
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [
      string,
      RequestInit,
    ]
    expect(url).toBe('https://api.resend.com/emails')
    expect((init.headers as Record<string, string>)['authorization']).toBe(
      'Bearer re_secret',
    )
    expect(JSON.parse(String(init.body))).toMatchObject({
      from: 'Zebra <a@b.c>',
      to: ['someone@example.com'],
      // BOTH parts. Corporate filters strip HTML, and a reset link that only
      // exists inside an <a> is a reset link that sometimes does not exist.
      text: 'text',
      html: '<p>html</p>',
    })
  })

  it('returns a reason instead of throwing when Resend refuses', async () => {
    const result = await sendEmail(
      message,
      { apiKey: 're_secret', from: 'Zebra <a@b.c>' },
      (async () =>
        new Response('{"message":"domain not verified"}', {
          status: 403,
        })) as unknown as typeof fetch,
    )
    expect(result).toEqual({ ok: false, reason: 'rejected' })
  })

  it('returns a reason instead of throwing when Resend is unreachable', async () => {
    const result = await sendEmail(
      message,
      { apiKey: 're_secret', from: 'Zebra <a@b.c>' },
      (async () => {
        throw new TypeError('network')
      }) as unknown as typeof fetch,
    )
    expect(result).toEqual({ ok: false, reason: 'unreachable' })
  })

  it('sends nothing, loudly, when there is no key', async () => {
    const fetchImpl = vi.fn()
    expect(
      await sendEmail(message, null, fetchImpl as unknown as typeof fetch),
    ).toEqual({ ok: false, reason: 'not_configured' })
    expect(fetchImpl).not.toHaveBeenCalled()
  })
})

describe('the link', () => {
  it('points at the route that redeems it', () => {
    expect(resetLink('tok', { origin: 'https://zebra.example' })).toBe(
      'https://zebra.example/reset-password/tok',
    )
  })

  it('does not double the slash on a trailing one', () => {
    expect(resetLink('tok', { origin: 'https://zebra.example/' })).toBe(
      'https://zebra.example/reset-password/tok',
    )
  })

  it('falls back to the host the request arrived on', () => {
    expect(resetLink('tok', { host: 'zebra-dev.example.workers.dev' })).toBe(
      'https://zebra-dev.example.workers.dev/reset-password/tok',
    )
  })
})

describe('the message', () => {
  const built = resetEmail(
    'someone@example.com',
    'https://zebra.example/reset-password/tok',
    t,
    'en',
    'ltr',
  )

  it('carries the link in the plain text part as well as the HTML', () => {
    expect(built.text).toContain('https://zebra.example/reset-password/tok')
    expect(built.html).toContain(
      'href="https://zebra.example/reset-password/tok"',
    )
  })

  it('says the link expires, because it does', () => {
    expect(built.text).toContain('expires in an hour')
  })

  it('carries the reader’s direction', () => {
    const fa = resetEmail('a@b.c', 'https://x/y', t, 'fa', 'rtl')
    expect(fa.html).toContain('dir="rtl"')
    expect(built.html).toContain('dir="ltr"')
  })

  it('escapes, even though every string here is ours', () => {
    const nasty = (key: MessageKey) =>
      key === 'email.reset.intro' ? '<script>alert(1)</script>' : 'x'
    expect(
      resetEmail('a@b.c', 'https://x', nasty, 'en', 'ltr').html,
    ).not.toContain('<script>')
  })
})
