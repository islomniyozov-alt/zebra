import Link from 'next/link'
import { formatCents } from '@/lib/money'

// ---------------------------------------------------------------------------
// THE SUMMARY STRIP. §6.2.8.
//
// Four money figures across the top of a list, each one a LINK to the list it
// summarises. A figure nobody can act on is a notification; the link is what
// makes it a control (§10: an interface says what is possible).
//
// ── IN `_grid` AND NOT `_charts`, BECAUSE IT IS NOT A CHART ───────────────
//
// No axis, no series, no scale. It belongs with the other things that sit above
// a grid — `PageHeader`, `GridToolbar`, `CompanyChips` — and Invoices and
// Payments both use it, which is the only reason it is a component at all.
//
// ── IT FORMATS AND LINKS, AND DECIDES NOTHING ────────────────────────────
//
// Every label, every href and every figure arrives as a prop. A strip that
// computed "overdue" from "open" would be a second expression of a money rule
// living in a component, which is the shape §6.2.7's flag 46 was about.
// ---------------------------------------------------------------------------

export interface SummaryFigure {
  key: string
  label: string
  cents: number
  /** The list this figure summarises, filtered to exactly it. */
  href: string
  /**
   * Said under the figure, in words. Two uses so far: that overdue is a SUBSET
   * of open, and how many payments carry the unapplied money.
   *
   * THREE FIGURES THAT LOOK PARALLEL AND ARE NOT is worse than four (§6.2.8),
   * and the place to say so is under the one that is the exception.
   */
  note?: string
  /**
   * Drawn in the danger tone. Only for a figure that is genuinely bad news —
   * overdue money — and never for a large one. §3.3 fixes these hues to
   * meanings, and "big" is not one of them.
   */
  alarming?: boolean
  /**
   * WHICH QUESTION THIS FIGURE ANSWERS, printed under it. §6.2.8, owner's
   * ruling 2026-10-04.
   *
   * A `balance` is as of today and has no date bound; a `window` figure is a
   * flow the picker moves; `all` is a flow with the picker set to every date.
   *
   * IT IS REQUIRED, not optional, because the whole point of the ruling is that
   * two kinds of figure sit side by side and the only thing making them readable
   * is saying which is which. A figure that forgot its scope would be the exact
   * ambiguity this replaced.
   */
  scope: 'balance' | 'window' | 'all'
}

export function SummaryStrip({
  figures,
  locale,
  scopeLabels,
}: {
  figures: readonly SummaryFigure[]
  locale: string
  /**
   * The three sentences, pre-translated: "as of today", "in this window", "all
   * dates". §6.2.8 requires the scope on screen under each figure rather than
   * once for the strip — one blanket note cannot be true of both kinds.
   */
  scopeLabels: Record<'balance' | 'window' | 'all', string>
}) {
  return (
    <section className="border-b border-border bg-surface-2 px-gutter py-z3">
      <dl className="grid grid-cols-2 gap-z3 md:grid-cols-4">
        {figures.map((figure) => (
          <Link
            key={figure.key}
            href={figure.href}
            className="rounded-card border border-border bg-surface p-z3 hover:bg-surface-3"
          >
            <dt className="text-xs uppercase tracking-[0.04em] text-ink-3">
              {figure.label}
            </dt>
            <dd
              className={
                figure.alarming
                  ? 'mt-z1 font-mono text-lg tabular-nums text-danger'
                  : 'mt-z1 font-mono text-lg tabular-nums text-ink'
              }
            >
              {formatCents(figure.cents, locale)}
            </dd>
            {/* THE SCOPE, UNDER EVERY FIGURE. §6.2.8: a balance and a flow sit
             * side by side, and the label is the only thing that makes two
             * different true numbers readable as different questions.
             *
             * ITALIC AND QUIET, because it is a qualifier rather than a second
             * figure — but always present, never inferred from position. */}
            <p className="mt-z1 text-xs italic text-ink-3">
              {scopeLabels[figure.scope]}
            </p>
            {figure.note === undefined ? null : (
              <p className="text-xs text-ink-3">{figure.note}</p>
            )}
          </Link>
        ))}
      </dl>
    </section>
  )
}
