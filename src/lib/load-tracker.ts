import type {
  LoadBillingStatus,
  LoadOperationalStatus,
} from '@/generated/prisma/client'

// ---------------------------------------------------------------------------
// THE EIGHT-STEP TRACKER ON AN AMAZON LOAD (§7.13).
//
// Datatruck's words and order: Offer, Booked, Assigned, Dispatched, In transit,
// Delivered, Invoiced, Paid. Zebra's statuses are on two axes, so this is the
// ONE place they are folded into one step — the page renders a number and a
// list of words, and judges nothing.
//
// THE OPERATIONAL AXIS SETS THE STEP; THE BILLING AXIS CAN ONLY RAISE IT. A
// load invoiced before anybody marked it delivered is still invoiced, and a
// closed history row (`CLOSED_IN_DATATRUCK`) says nothing about money this
// system saw, so it raises nothing.
//
// CANCELLED IS NOT A STEP. The page draws the steps as they stood and says
// Cancelled over them, as the five-stage strip already does.
// ---------------------------------------------------------------------------

export const TRACKER_STEPS = [
  'offer',
  'booked',
  'assigned',
  'dispatched',
  'inTransit',
  'delivered',
  'invoiced',
  'paid',
] as const

export type TrackerStep = (typeof TRACKER_STEPS)[number]

const BY_OPERATIONAL: Readonly<Record<LoadOperationalStatus, TrackerStep>> = {
  AVAILABLE: 'offer',
  BOOKED: 'booked',
  DISPATCHED: 'dispatched',
  // AT THE SHIPPER, NOT YET ROLLING WITH THE FREIGHT. Datatruck's In transit
  // starts when the load is on the truck.
  AT_PICKUP: 'dispatched',
  LOADED: 'inTransit',
  IN_TRANSIT: 'inTransit',
  AT_DELIVERY: 'inTransit',
  DELIVERED: 'delivered',
  POD_RECEIVED: 'delivered',
}

const BY_BILLING: Readonly<Partial<Record<LoadBillingStatus, TrackerStep>>> = {
  INVOICED: 'invoiced',
  // PART-PAID IS NOT PAID. The step says the invoice is out and the money is
  // not all in.
  PARTIALLY_PAID: 'invoiced',
  FILED_WITH_FACTOR: 'invoiced',
  DISPUTED: 'invoiced',
  WRITTEN_OFF: 'invoiced',
  PAID: 'paid',
}

/**
 * The step a load is on, 1 to 8.
 *
 * `assigned` is `isAssigned(load)` from `load-readiness.ts` — a driver or a
 * truck on it — so "Assigned" here and "assigned" on the five-stage strip are
 * one fact.
 */
export function trackerStep(load: {
  operationalStatus: LoadOperationalStatus
  billingStatus: LoadBillingStatus
  assigned: boolean
}): number {
  let step = BY_OPERATIONAL[load.operationalStatus]
  if (step === 'booked' && load.assigned) step = 'assigned'
  const operational = TRACKER_STEPS.indexOf(step) + 1
  const billing = BY_BILLING[load.billingStatus]
  const raised = billing === undefined ? 0 : TRACKER_STEPS.indexOf(billing) + 1
  return Math.max(operational, raised)
}
