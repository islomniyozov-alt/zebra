import type { EmailMessage } from './email'
import type { Locale, Translate } from './i18n'

// ---------------------------------------------------------------------------
// The one email this application sends.
//
// Written as a function of (link, translate) so that it can be asserted on
// without a network, and so the Russian and Farsi versions are the same code
// path rather than a second template somebody forgets to change. `dir` comes
// from the locale, exactly as it does in the application shell — an RTL email
// read left-to-right is the same bug in a different window.
//
// Plain text is not an afterthought. Corporate mail filters strip HTML, and a
// reset link that only exists inside an <a> is a reset link that sometimes
// does not exist.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// THE ONE PLACE HEX IS ALLOWED OUTSIDE THE TOKEN BLOCK, and scripts/check-hex
// exempts this file by name for exactly this reason.
//
// An email does not load globals.css. `var(--color-ink)` in a mail client
// resolves to nothing, and a message whose text colour is nothing is a message
// nobody can read on a dark background. So the four colours are copied here as
// literals — the SAME four values, named after the tokens they came from, so
// that a review can diff them against §3 by eye.
//
// If a token changes, change it here too. That is a real maintenance cost and
// it is smaller than the alternative, which is an email that ignores the brand
// entirely.
// ---------------------------------------------------------------------------
const INK = '#171a20' /* --color-ink */
const INK_2 = '#5c6370' /* --color-ink-2 */
const INK_3 = '#8a919e' /* --color-ink-3 */
const SURFACE = '#ffffff' /* --color-surface */
const ACCENT = '#3e6ae1' /* --color-accent */

/** Inline styles only: every mail client strips <style> and half strip <head>. */
export function resetEmail(
  to: string,
  link: string,
  t: Translate,
  locale: Locale,
  dir: 'ltr' | 'rtl',
): EmailMessage {
  const text = [
    t('email.reset.intro'),
    '',
    link,
    '',
    t('email.reset.expiry'),
    t('email.reset.ignore'),
  ].join('\n')

  const html = `<div lang="${locale}" dir="${dir}" style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;font-size:15px;line-height:1.5;color:${INK};max-width:520px">
<p>${escapeHtml(t('email.reset.intro'))}</p>
<p><a href="${escapeHtml(link)}" style="display:inline-block;padding:10px 16px;background:${ACCENT};color:${SURFACE};text-decoration:none;border-radius:4px">${escapeHtml(t('email.reset.action'))}</a></p>
<p style="font-size:13px;color:${INK_2}">${escapeHtml(t('email.reset.expiry'))}<br>${escapeHtml(t('email.reset.ignore'))}</p>
<p style="font-size:12px;color:${INK_3};word-break:break-all">${escapeHtml(link)}</p>
</div>`

  return { to, subject: t('email.reset.subject'), text, html }
}

/**
 * The link is a URL this application built, and the strings are ours — but
 * escaping is not conditional on the author being trusted. A translation is a
 * string somebody edits, and a stray `<` in Farsi should not silently become
 * markup.
 */
function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
}

/**
 * Where the reset link points.
 *
 * `APP_ORIGIN` first, because that is a deployment fact and the request's own
 * Host header is not: a worker reached through a preview URL would mint links
 * back to the preview. The header is the fallback so that a forgotten variable
 * degrades to something that works rather than to a broken link.
 */
export function resetLink(
  token: string,
  options: { origin?: string | undefined; host?: string | null } = {},
): string {
  const origin =
    options.origin ||
    (options.host ? `https://${options.host}` : 'http://127.0.0.1:3000')
  return `${origin.replace(/\/+$/, '')}/reset-password/${token}`
}
