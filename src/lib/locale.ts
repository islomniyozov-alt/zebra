import 'server-only'
import { cookies } from 'next/headers'
import {
  DEFAULT_LOCALE,
  directionOf,
  isLocale,
  translator,
  type Locale,
  type Translate,
} from './i18n'

export const LOCALE_COOKIE = 'zebra_locale'

/**
 * The request's locale, from a cookie.
 *
 * Deliberately not from the session: the login screen has no session and still
 * has to be readable, and a database round trip to decide which language a
 * button is in would be a strange thing to pay for on every render. Login
 * writes the cookie from `User.locale` on success, so the two agree from then
 * on.
 *
 * Not from Accept-Language either. A Farsi-speaking dispatcher on a
 * company laptop in a Russian-language office should get what they chose, not
 * what the machine was set up with.
 */
export async function getLocale(): Promise<Locale> {
  const store = await cookies()
  const value = store.get(LOCALE_COOKIE)?.value
  return isLocale(value) ? value : DEFAULT_LOCALE
}

export interface LocaleContext {
  locale: Locale
  dir: 'ltr' | 'rtl'
  t: Translate
}

export async function getLocaleContext(): Promise<LocaleContext> {
  const locale = await getLocale()
  return { locale, dir: directionOf(locale), t: translator(locale) }
}
