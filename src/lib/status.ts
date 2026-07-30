import type {
  LoadBillingStatus,
  LoadOperationalStatus,
} from '@/generated/prisma/client'
import type { MessageKey } from './i18n'

// ---------------------------------------------------------------------------
// STATUS → TOKEN, bound once, here, and nowhere else (§3.4).
//
// "No screen decides its own mapping" is the whole point. The moment two
// screens each decide, one of them shows a delivered load in green and a
// dispatcher stops chasing the POD.
// ---------------------------------------------------------------------------

export const STATUS_TONES = [
  'neutral',
  'progress',
  'success',
  'warning',
  'danger',
  'muted',
] as const

export type StatusTone = (typeof STATUS_TONES)[number]

/**
 * §3.4, operational axis.
 *
 * DELIVERED maps to warning on purpose and it is worth restating every time
 * someone reads this file: in this business a delivered load is unfinished
 * work until the POD lands, and a green badge tells a dispatcher to stop
 * looking at it.
 */
const OPERATIONAL: Record<LoadOperationalStatus, StatusTone> = {
  AVAILABLE: 'neutral',
  BOOKED: 'neutral',
  DISPATCHED: 'progress',
  AT_PICKUP: 'progress',
  LOADED: 'progress',
  IN_TRANSIT: 'progress',
  AT_DELIVERY: 'progress',
  DELIVERED: 'warning',
  POD_RECEIVED: 'success',
}

/** §3.4, billing axis. Two axes that move independently (schema convention 4). */
const BILLING: Record<LoadBillingStatus, StatusTone> = {
  UNINVOICED: 'neutral',
  READY_TO_INVOICE: 'neutral',
  INVOICED: 'progress',
  PARTIALLY_PAID: 'warning',
  PAID: 'success',
  DISPUTED: 'danger',
  WRITTEN_OFF: 'muted',
}

export function operationalTone(status: LoadOperationalStatus): StatusTone {
  return OPERATIONAL[status]
}

export function billingTone(status: LoadBillingStatus): StatusTone {
  return BILLING[status]
}

/** §3.4, fleet and compliance urgency, by days until expiry. */
export function complianceTone(daysUntilExpiry: number): StatusTone {
  if (daysUntilExpiry <= 7) return 'danger'
  if (daysUntilExpiry <= 30) return 'warning'
  return 'neutral'
}

export const operationalLabelKey = (
  status: LoadOperationalStatus,
): MessageKey => `status.${status}` as MessageKey

export const billingLabelKey = (status: LoadBillingStatus): MessageKey =>
  `billing.${status}` as MessageKey

/**
 * The Tailwind classes for each tone, in both constructions §7.2 requires.
 *
 * Written out rather than interpolated because Tailwind only sees class names
 * it can find as complete strings — `bg-${tone}-soft` compiles to nothing.
 */
export const TONE_FILLED: Record<StatusTone, string> = {
  neutral: 'bg-neutral-soft text-neutral border-neutral',
  progress: 'bg-progress-soft text-progress border-progress',
  success: 'bg-success-soft text-success border-success',
  warning: 'bg-warning-soft text-warning border-warning',
  danger: 'bg-danger-soft text-danger border-danger',
  muted: 'bg-muted-soft text-muted border-muted',
}

export const TONE_OUTLINED: Record<StatusTone, string> = {
  neutral: 'bg-transparent text-neutral border-neutral',
  progress: 'bg-transparent text-progress border-progress',
  success: 'bg-transparent text-success border-success',
  warning: 'bg-transparent text-warning border-warning',
  danger: 'bg-transparent text-danger border-danger',
  muted: 'bg-transparent text-muted border-muted',
}

/** §2 — the 3px stripe on the leading edge of every row, card and header. */
export const TONE_STRIPE: Record<StatusTone, string> = {
  neutral: 'bg-neutral',
  progress: 'bg-progress',
  success: 'bg-success',
  warning: 'bg-warning',
  danger: 'bg-danger',
  muted: 'bg-muted',
}
