'use client'

// ---------------------------------------------------------------------------
// THE ONE WORDED PAGE FOR ANYTHING THAT STILL THROWS. §7.11.
//
// Next's default error page says "Application error: a client-side exception
// has occurred" or, in production, nothing useful at all. That is the framework
// talking to a developer, on a screen a dispatcher is looking at.
//
// ── IT CARRIES ITS OWN WORDS, AND THAT IS A DELIBERATE EXCEPTION ──────────
//
// An error boundary must be a Client Component, so it cannot call
// `getLocaleContext()` — and importing `i18n.ts` would ship every string in the
// product to the browser in order to render three of them. So the three
// sentences live here, in the three languages, and the locale comes from the
// cookie the application already sets. §12's one-dictionary rule is suspended
// for exactly this file and §7.11 records why.
//
// ── IT MUST NOT BE ABLE TO THROW ──────────────────────────────────────────
//
// No data reads, no `formatCents`, no date arithmetic, no `useEffect` that
// touches anything. A boundary that fails is the one failure with nowhere left
// to go. The cookie read is wrapped because `document` is absent during the
// server render of this component and `document.cookie` can throw in a
// sandboxed frame.
// ---------------------------------------------------------------------------

const WORDS = {
  en: {
    title: 'Something went wrong on our side',
    body: 'Zebra hit an error it did not expect. Nothing you typed was lost unless it was in a form that had not been saved yet.',
    retry: 'Try again',
  },
  ru: {
    title: 'На нашей стороне что-то сломалось',
    body: 'Zebra столкнулась с непредвиденной ошибкой. Всё, что вы ввели, сохранено — кроме незаполненных до конца форм.',
    retry: 'Попробовать снова',
  },
  fa: {
    title: 'مشکلی از سمت ما پیش آمد',
    body: 'Zebra با خطایی غیرمنتظره روبه‌رو شد. چیزی که وارد کرده‌اید از دست نرفته، مگر فرمی که هنوز ذخیره نشده بود.',
    retry: 'دوباره تلاش کنید',
  },
} as const

type Lang = keyof typeof WORDS

/** The locale cookie, or English. Never throws — see the header. */
function language(): Lang {
  try {
    const match = /(?:^|;\s*)zebra_locale=([^;]+)/.exec(document.cookie)
    const value = match?.[1]
    if (value === 'ru' || value === 'fa' || value === 'en') return value
  } catch {
    // No document, no cookie access, no matter.
  }
  return 'en'
}

export default function ErrorPage({ reset }: { reset: () => void }) {
  const words = WORDS[language()]

  return (
    <div className="flex min-h-screen items-center justify-center bg-surface-2 px-gutter">
      <div className="w-[min(480px,100%)] rounded-card border border-border bg-surface p-z7">
        <h1 className="text-lg font-medium text-ink">{words.title}</h1>
        <p className="mt-z3 text-base text-ink-2">{words.body}</p>

        {/* A BUTTON THAT RE-RENDERS THE SEGMENT, which is what `reset` is for:
         * most of these are a dropped socket or a cold compute, and the second
         * attempt works. §7.11 asks for one way out, not for a menu. */}
        <button
          type="button"
          onClick={reset}
          className="mt-z5 h-control rounded-control border border-accent bg-accent px-z4 text-base font-medium text-surface hover:opacity-90"
        >
          {words.retry}
        </button>

        {/* NO DIGEST, NO STACK, NO `error.message`. A stack on a dispatcher's
         * screen is noise they cannot act on, and a message can carry internals
         * — §0's rule about never sending what the reader cannot use. The real
         * error is already in the Worker's logs. */}
      </div>
    </div>
  )
}
