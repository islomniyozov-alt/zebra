import { describe, expect, it } from 'vitest'
import { composeCredentialMessage } from '@/lib/share-message'
import { translator } from '@/lib/i18n'

// The hand-over message carries a working credential to a person over a chat
// app. Two things must be true of it and neither is obvious from reading the
// component: the real password is in it, and nothing about it is translated
// that would stop the password working.

const PASSWORD = 'A1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6'
const SIGN_IN = 'https://zebra.tajikcargollc.workers.dev'

const labelsFor = (locale: 'en' | 'ru' | 'fa') => {
  const t = translator(locale)
  return {
    intro: t('users.share.intro'),
    email: t('users.share.email'),
    password: t('users.share.password'),
    instruction: t('users.share.instruction'),
  }
}

describe('what the message contains', () => {
  const message = composeCredentialMessage(
    SIGN_IN,
    'dispatcher@example.test',
    PASSWORD,
    labelsFor('en'),
  )

  it('carries the real password, not a placeholder', () => {
    expect(message.full).toContain(PASSWORD)
    // The failure this guards against is a template shipped with its own
    // example still in it, which reads perfectly and works for nobody.
    expect(message.full).not.toMatch(/<[^>]*password[^>]*>|\{\{|\$\{|xxxx/i)
  })

  it('carries the address and the sign-in URL', () => {
    expect(message.full).toContain('dispatcher@example.test')
    expect(message.full).toContain(SIGN_IN)
  })

  it('carries the instruction verbatim', () => {
    expect(message.full).toContain(
      'Log in, open Account, change your password immediately.',
    )
  })

  it('puts the URL where Telegram will put it', () => {
    // Telegram renders `text` then `url`, so `full` has to be built the same
    // way or the clipboard and the share draft say different things.
    expect(message.full).toBe(`${message.body}\n${SIGN_IN}`)
    expect(message.body).not.toContain(SIGN_IN)
  })
})

describe('the Telegram link', () => {
  const message = composeCredentialMessage(
    SIGN_IN,
    'dispatcher@example.test',
    PASSWORD,
    labelsFor('en'),
  )

  it('opens the share picker and names no recipient', () => {
    expect(message.telegramHref.startsWith('https://t.me/share/url?')).toBe(
      true,
    )
    // No chat id, no username, no phone. The admin chooses who receives a
    // working credential; a preselected recipient is how it reaches the wrong
    // one.
    expect(message.telegramHref).not.toMatch(/[?&](to|chat|phone|user)=/)
  })

  it('encodes the password so it survives the URL', () => {
    const text = new URL(message.telegramHref).searchParams.get('text') ?? ''
    expect(text).toContain(PASSWORD)
    expect(new URL(message.telegramHref).searchParams.get('url')).toBe(SIGN_IN)
  })

  it('does not mangle a password containing URL-significant characters', () => {
    // base64url avoids + / = but a future generator might not, and a password
    // that arrives with `&` eaten is a password that silently does not work.
    const awkward = 'a+b/c=d&e?f#g'
    const awkwardMessage = composeCredentialMessage(
      SIGN_IN,
      'x@y.z',
      awkward,
      labelsFor('en'),
    )
    const text =
      new URL(awkwardMessage.telegramHref).searchParams.get('text') ?? ''
    expect(text).toContain(awkward)
  })
})

describe('locale', () => {
  it.each(['en', 'ru', 'fa'] as const)(
    'translates the words and never the credential (%s)',
    (locale) => {
      const message = composeCredentialMessage(
        SIGN_IN,
        'dispatcher@example.test',
        PASSWORD,
        labelsFor(locale),
      )

      // The parts that are identifiers stay identical in every locale.
      expect(message.full).toContain(PASSWORD)
      expect(message.full).toContain('dispatcher@example.test')
      expect(message.full).toContain(SIGN_IN)

      // And the words around them do not.
      expect(message.full).toContain(translator(locale)('users.share.intro'))
    },
  )

  it('actually reads differently in each locale', () => {
    // The pair: without this, the assertions above would pass on a translator
    // that returned English for everything.
    const en = composeCredentialMessage(
      SIGN_IN,
      'a@b.c',
      PASSWORD,
      labelsFor('en'),
    )
    const ru = composeCredentialMessage(
      SIGN_IN,
      'a@b.c',
      PASSWORD,
      labelsFor('ru'),
    )
    expect(ru.body).not.toBe(en.body)
  })
})
