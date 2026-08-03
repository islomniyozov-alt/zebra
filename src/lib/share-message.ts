// ---------------------------------------------------------------------------
// THE HAND-OVER MESSAGE.
//
// A temporary password is delivered out of band — over Telegram, in practice,
// because that is what this operation already uses. Retyping it is where the
// mistakes are: a transposed character in a 32-character base64url string is
// invisible, and the person on the other end just reports "it doesn't work".
//
// So the message is composed once, from the real values, and the two delivery
// paths share it exactly. `body` and `url` are separate ONLY because Telegram's
// share endpoint takes them as separate parameters and joins them itself —
// `full` is what that join produces, and what the clipboard gets, so the two
// paths cannot drift into saying different things.
//
// WHAT IS TRANSLATED AND WHAT IS NOT. The labels and the instruction follow the
// ADMIN's locale, because the admin is the one reading the draft before they
// send it. The URL, the address and the password are never touched: §12's rule
// about identifiers, and here also plain safety — a "helpfully" localised
// password is a password that does not work.
// ---------------------------------------------------------------------------

export interface CredentialMessageLabels {
  /** e.g. "Your Zebra sign-in" */
  intro: string
  email: string
  password: string
  /** Verbatim: "Log in, open Account, change your password immediately." */
  instruction: string
}

export interface CredentialMessage {
  /** Everything but the URL. Telegram's `text` parameter. */
  body: string
  /** Telegram's `url` parameter, appended by Telegram after the text. */
  url: string
  /** What Telegram will end up showing, and what the clipboard copies. */
  full: string
  /** Ready to open. Opens the share picker; no recipient is ever preselected. */
  telegramHref: string
}

export function composeCredentialMessage(
  signInUrl: string,
  email: string,
  temporaryPassword: string,
  labels: CredentialMessageLabels,
): CredentialMessage {
  const body = [
    labels.intro,
    '',
    `${labels.email}: ${email}`,
    `${labels.password}: ${temporaryPassword}`,
    '',
    labels.instruction,
  ].join('\n')

  // Telegram renders the draft as text then url, so `full` is built the same
  // way rather than guessed at.
  const full = `${body}\n${signInUrl}`

  // t.me/share/url opens Telegram's own recipient picker. There is deliberately
  // no way to name a chat from here: the admin chooses who receives a working
  // credential, and a preselected recipient is how it goes to the wrong one.
  const telegramHref =
    'https://t.me/share/url' +
    `?url=${encodeURIComponent(signInUrl)}` +
    `&text=${encodeURIComponent(body)}`

  return { body, url: signInUrl, full, telegramHref }
}
