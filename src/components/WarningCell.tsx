import type { MessageKey } from '@/lib/i18n'
import type { Warning, WarningName } from '@/lib/warnings'

interface Props {
  warnings: readonly Warning[]
  labels: {
    /** "{n} to fix" — the count as a person reads it. */
    count: string
    clear: string
    names: Record<WarningName, string>
  }
}

/**
 * A count, and the names when somebody opens it.
 *
 * ── `<details>` RATHER THAN STATE ────────────────────────────────────────
 *
 * Every list on this screen is server-rendered and none of them ship a client
 * bundle for the sake of a row. `<details>` expands without JavaScript, keeps
 * its own open state, is reachable from the keyboard and readable by a screen
 * reader without an aria attribute in sight. A React disclosure would be four
 * hooks and a hydration boundary to do worse.
 *
 * ── THE COUNT IS THE POINT, THE NAMES ARE THE DETAIL ─────────────────────
 *
 * A list of two hundred drivers cannot show seven warnings each and remain a
 * list. What a person scans for is "which rows need me", and that is a number;
 * what they need once they have found one is which documents, and that is
 * behind the disclosure.
 *
 * ── NO WARNING IS AN EMPTY CELL, NOT A ZERO ──────────────────────────────
 *
 * A column of "0" reads as a measurement of something. The clean rows are the
 * ones the reader is skipping past, and they should look like nothing.
 */
export function WarningCell({ warnings, labels }: Props) {
  if (warnings.length === 0) {
    return <span className="sr-only">{labels.clear}</span>
  }

  return (
    <details className="inline-block">
      <summary className="cursor-pointer list-none rounded-control bg-warning-subtle px-z2 py-z1 text-xs font-semibold text-warning">
        {labels.count.replace('{n}', String(warnings.length))}
      </summary>
      <ul className="mt-z2 flex flex-col gap-z1 text-xs text-ink-subtle">
        {warnings.map((warning) => (
          <li key={`${warning.name}-${warning.detail}`}>
            {labels.names[warning.name]}
            {/* THE FACT, NOT A SENTENCE. Which document, which side of the
             * crew, which remittance outcome — the specific thing to go and
             * look at. */}
            {warning.detail ? (
              <span className="ms-z1 text-ink-faint">{warning.detail}</span>
            ) : null}
          </li>
        ))}
      </ul>
    </details>
  )
}

/**
 * Every warning's message key, named ONE BY ONE.
 *
 * A template like `warning.${name}` would be shorter and would let a new
 * warning ship untranslated — the union would accept it, the lookup would
 * miss, and the cell would print nothing where a problem was. Written out,
 * an eighth warning fails to compile here until somebody writes three
 * sentences for it.
 */
export const WARNING_LABEL_KEYS: Record<WarningName, MessageKey> = {
  compliance_expired: 'warning.compliance_expired',
  compliance_expiring: 'warning.compliance_expiring',
  document_missing: 'warning.document_missing',
  pickup_soon_unassigned: 'warning.pickup_soon_unassigned',
  settlement_line_held: 'warning.settlement_line_held',
  settlement_net_negative: 'warning.settlement_net_negative',
  cancelled_but_assigned: 'warning.cancelled_but_assigned',
  dqf_incomplete: 'warning.dqf_incomplete',
}

/** The same, translated for this request. */
export function warningLabels(
  t: (key: MessageKey) => string,
): Record<WarningName, string> {
  return Object.fromEntries(
    Object.entries(WARNING_LABEL_KEYS).map(([name, key]) => [name, t(key)]),
  ) as Record<WarningName, string>
}
