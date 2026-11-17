import type { TabSpec } from '@/components/ui/Tabs'
import type { Translate } from '@/lib/i18n'

// ---------------------------------------------------------------------------
// PAYROLL'S ONE TAB STRIP (§6.2.10 part 7, R10; owner's ruling 2026-11-17).
//
//   Batches · Driver statements · Balances · One-time charges
//
// Datatruck's row across the top of Driver Pay, over Zebra's routes AS THEY
// ARE — no route moves. Each page still declares its own `TABS`, the `?tab=`
// values it narrows against (`tests/accounting-surface.test.ts` holds those to
// §6.2's table); this is the strip it draws with them, so the strip cannot
// read one way on Batches and another on Driver statements.
//
// THE THREE AFTER BATCHES ARE `driver.pay`, Batches is `settlement` — the
// navigation's own split (`permissions.ts`). A tab the role cannot read is not
// drawn: a link that lands on a 404 is not a tab.
//
// Scheduled payments stays inside Charges, by the same ruling.
// ---------------------------------------------------------------------------

export const PAYROLL_STRIP = [
  'batches',
  'statements',
  'balances',
  'oneTime',
] as const

export type PayrollStripTab = (typeof PAYROLL_STRIP)[number]

const HREF: Record<PayrollStripTab, string> = {
  batches: '/payroll/batches',
  statements: '/payroll/statements',
  balances: '/payroll/batches?tab=balances',
  oneTime: '/payroll/charges?tab=oneTime',
}

const isStripTab = (key: string): key is PayrollStripTab =>
  (PAYROLL_STRIP as readonly string[]).includes(key)

/** The tabs this role may read, in the strip's order. */
export function payrollStrip(input: {
  /** `settlement:read` — the Batches tab. */
  batches: boolean
  /** `driver.pay:read` — Driver statements, Balances, One-time charges. */
  pay: boolean
  t: Translate
  /** A count shown beside a tab; the page that has one passes it. */
  counts?: Partial<Record<PayrollStripTab, number>>
}): TabSpec[] {
  return PAYROLL_STRIP.filter((key) =>
    key === 'batches' ? input.batches : input.pay,
  ).map((key) => ({
    key,
    label: input.t(`payroll.tab.${key}`),
    ...(input.counts?.[key] === undefined ? {} : { count: input.counts[key] }),
  }))
}

/**
 * Where a strip tab points. A page may keep its own params on its own tabs —
 * the Batches page keeps the week on Batches and Balances — and every other tab
 * is the destination's plain route.
 */
export function payrollStripHref(
  key: string,
  own: Partial<Record<PayrollStripTab, string>> = {},
): string {
  if (!isStripTab(key)) return HREF.batches
  return own[key] ?? HREF[key]
}
