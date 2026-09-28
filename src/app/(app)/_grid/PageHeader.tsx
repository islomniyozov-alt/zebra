import type { ReactNode } from 'react'

interface Props {
  title: string
  /** One primary per screen region (§7.7). Optional — three of the five read only. */
  action?: ReactNode
  /** What the status stripe means on THIS screen (§2 requires it be stated). */
  stripeMeans?: string
  /**
   * §6.2.1 — the trail, group first: `["Payroll", "Batches"]`.
   *
   * IT EARNS ITS PLACE HERE AND NOWHERE ELSE IN THE SHELL. Two groups, six
   * destinations and eleven tabs is the point at which "where am I" stops being
   * obvious; every other screen in Zebra is one level deep and needs none, and
   * adding one everywhere is a different ruling.
   *
   * NOT LINKS. A group is not a page — there is no `/payroll` to open — and a
   * breadcrumb whose first element does nothing is a control that teaches people
   * the controls are decorative. It orients; it does not navigate.
   */
  breadcrumb?: readonly string[]
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
export function PageHeader({ title, action, stripeMeans, breadcrumb }: Props) {
  return (
    <div className="flex items-baseline justify-between gap-z4 border-b border-border bg-surface px-gutter py-z3">
      <div className="flex flex-col gap-z1">
        {breadcrumb && breadcrumb.length > 0 ? (
          <p className="text-xs text-ink-3">
            {breadcrumb.map((crumb, index) => (
              <span key={crumb}>
                {index > 0 ? (
                  // A SEPARATOR THE BIDI ALGORITHM CANNOT TURN AROUND. `/`
                  // between two RTL words reorders; `›` is directional and
                  // mirrors with the text, which is what §12 wants.
                  <span aria-hidden className="mx-z1">
                    ›
                  </span>
                ) : null}
                {crumb}
              </span>
            ))}
          </p>
        ) : null}
        <div className="flex items-baseline gap-z3">
          <h1 className="text-lg font-medium text-ink">{title}</h1>
          {stripeMeans ? (
            <p className="text-xs text-ink-3">{stripeMeans}</p>
          ) : null}
        </div>
      </div>
      {action}
    </div>
  )
}
