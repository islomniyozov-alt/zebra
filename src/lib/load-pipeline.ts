import type {
  LoadBillingStatus,
  LoadOperationalStatus,
} from '@/generated/prisma/client'

// ---------------------------------------------------------------------------
// ONE STORY, IN FIVE WORDS, READ FROM TWO AXES.
//
//     Upcoming → In-Transit → Delivered → Invoiced → Paid
//
// A VIEW, NOT A THIRD AXIS. Nothing here is stored and nothing writes it. The
// operational and billing statuses stay separate columns because they genuinely
// move independently — a load can be delivered and unbilled, or invoiced and
// disputed while sitting at a yard — and collapsing them into a stored stage
// would need one of those truths to be discarded. This reads both and answers
// "roughly where is this" for somebody scanning a screen.
//
// ─────────────────────────────────────────────────────────────────────────────
// "INVOICED" ON DIRECT-SETTLED FREIGHT IS A LABEL, NOT A CLAIM.
//
// Amazon Relay settles by weekly ACH statement. Its loads NEVER become
// invoices: `readyToInvoiceWhere` excludes `directSettled: true` deliberately,
// and it must keep doing so. On that freight this stage means the load reached
// POD_RECEIVED and is waiting to appear on a statement — the milestone
// `directSettledAwaiting` already queries.
//
// THE OWNER CHOSE THE WORD, KNOWING THIS. "Submitted" was offered for
// direct-settled loads, and a four-stage strip with the invoice step absent.
// He took the literal word on every load, identically, so that nobody has to
// learn two vocabularies — to be revisited if it turns out to matter.
//
// SO: DO NOT MAKE THE WORD TRUE BY CREATING AN INVOICE. If you are reading this
// because the label looked wrong, the label is the deliberate simplification
// and the absence of the invoice is the correct behaviour. Changing
// `readyToInvoiceWhere` to include direct-settled freight would put Amazon
// loads into a broker AR queue, invoice freight that pays by statement, and
// double-count revenue that settlements already carry.
// ─────────────────────────────────────────────────────────────────────────────

export type PipelineStage =
  | 'upcoming'
  | 'inTransit'
  | 'delivered'
  | 'invoiced'
  | 'paid'

/** In order, so a strip can render them without restating the sequence. */
export const PIPELINE_STAGES: readonly PipelineStage[] = [
  'upcoming',
  'inTransit',
  'delivered',
  'invoiced',
  'paid',
]

const MOVING = new Set<LoadOperationalStatus>([
  'AT_PICKUP',
  'LOADED',
  'IN_TRANSIT',
  'AT_DELIVERY',
])

const ARRIVED = new Set<LoadOperationalStatus>(['DELIVERED', 'POD_RECEIVED'])

/** Billing states that mean an invoice exists, whatever became of it. */
const BILLED = new Set<LoadBillingStatus>([
  'INVOICED',
  'PARTIALLY_PAID',
  'DISPUTED',
  // Written off means it was invoiced and will not be paid. It belongs at the
  // invoiced stage rather than at paid, because the strip says how far the
  // money got and this is where it stopped.
  'WRITTEN_OFF',
])

export interface PipelineInput {
  operationalStatus: LoadOperationalStatus
  billingStatus: LoadBillingStatus
  directSettled: boolean
  totalRevenueCents: number
}

export function pipelineStage(load: PipelineInput): PipelineStage {
  // PAID IS PAID ON BOTH KINDS OF FREIGHT, and `billingStatusFor` already
  // computes it for direct-settled loads from applied payments rather than
  // from invoices. Nothing special is needed here.
  if (load.billingStatus === 'PAID') return 'paid'

  if (load.directSettled) {
    // The awaiting-statement milestone, wearing the word "Invoiced". A load
    // with no revenue on it has nothing to be paid for and stays at delivered
    // — the same clause `directSettledAwaiting` uses.
    if (load.operationalStatus === 'POD_RECEIVED' && load.totalRevenueCents > 0)
      return 'invoiced'
  } else if (BILLED.has(load.billingStatus)) {
    return 'invoiced'
  }

  if (ARRIVED.has(load.operationalStatus)) return 'delivered'
  if (MOVING.has(load.operationalStatus)) return 'inTransit'
  return 'upcoming'
}

/** How far along, for a strip that fills stages behind the current one. */
export function stageIndex(stage: PipelineStage): number {
  return PIPELINE_STAGES.indexOf(stage)
}
