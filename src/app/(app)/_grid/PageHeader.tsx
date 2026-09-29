import type { ReactNode } from 'react'

interface Props {
  title: string
  /** One primary per screen region (§7.7). Optional — three of the five read only. */
  action?: ReactNode
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
 * ── IT NO LONGER SAYS WHAT THE STRIPE MEANS ──────────────────────────────
 *
 * §2 required that in the screen's header and this component did it:
 * `stripe: the driver's line`, in grey, beside every title. On a deployed page
 * that reads as a note between developers, and it named a fact the row already
 * states — every one of these grids carries the status as a WORD in its own
 * column, because rule 5 has required that since Phase 1.
 *
 * §2 was amended on 2026-09-29 and the prop is gone. Owner's word for it was
 * "leaked".
 */
export function PageHeader({ title, action, breadcrumb }: Props) {
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
        </div>
      </div>
      {action}
    </div>
  )
}
