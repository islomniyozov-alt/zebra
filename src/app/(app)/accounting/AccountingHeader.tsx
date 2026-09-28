import type { ReactNode } from 'react'

interface Props {
  title: string
  /** One primary per screen region (§7.7). Optional — three of the five read only. */
  action?: ReactNode
  /** What the status stripe means on THIS screen (§2 requires it be stated). */
  stripeMeans?: string
}

/**
 * The page head every Accounting screen shares.
 *
 * ── WHY IT SAYS WHAT THE STRIPE MEANS ─────────────────────────────────────
 *
 * §2: "The stripe reflects operational status on load surfaces, BILLING status
 * on invoice and AR surfaces, and compliance urgency on fleet and driver
 * surfaces. One meaning per screen, STATED IN THE SCREEN'S HEADER."
 *
 * Five screens in one section, and the stripe means something different on three
 * of them — billing on Invoices, the payment's own state on Payments, the
 * batch's on Payroll. A reader who learns the vocabulary on one page and carries
 * it to the next is reading the wrong fact, and the rule has required the
 * sentence since Phase 1 while no screen in the old Money group carried one.
 */
export function AccountingHeader({ title, action, stripeMeans }: Props) {
  return (
    <div className="flex items-baseline justify-between gap-z4 border-b border-border bg-surface px-gutter py-z3">
      <div className="flex items-baseline gap-z3">
        <h1 className="text-lg font-medium text-ink">{title}</h1>
        {stripeMeans ? (
          <p className="text-xs text-ink-3">{stripeMeans}</p>
        ) : null}
      </div>
      {action}
    </div>
  )
}
