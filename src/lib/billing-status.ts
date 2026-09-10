import type {
  LoadBillingStatus,
  Prisma,
  StatusSource,
} from '@/generated/prisma/client'
import { isAssigned } from './load-readiness'
import type { TxClient } from './tenancy'

// ---------------------------------------------------------------------------
// THE BILLING AXIS (schema convention 4).
//
// A load has an operational status and a billing status and they move
// independently. The operational one is driven by events — dispatched,
// delivered, POD received. THIS one is not driven by anything a person clicks.
// It is a CACHE of two facts that live elsewhere:
//
//   * is there an invoice covering this load, and what is left on it, or
//   * for direct-settled freight, how much has been applied against the load
//
// Nobody sets it by hand. Every write goes through `refreshBillingStatus`, so
// there is one function to read when the question is "why does this load say
// partially paid", and one function to fix when the answer is wrong.
//
// Because it is a cache, it can drift, so `findBillingStatusDrift` recomputes
// it and `npm run check` fails on any disagreement. Same discipline as
// findAuthorityDrift and findFactoringDrift: a derived column earns a check
// that asks the database whether it still agrees.
//
// EVERY MOVE LEAVES A TRAIL. `StatusAxis.BILLING` existed in the schema from
// the start and nothing wrote it — the billing axis moved silently while the
// operational one kept a timeline. §7 asks the billing timeline to show the
// source per event, so `refreshBillingStatus` writes a `LoadStatusEvent` for
// every change it makes, with the source the caller names. "When did this load
// become paid, and what made it" is a dispute question, and until now the only
// answer was the column's current value.
//
// WHAT IS NOT AUTOMATIC. DISPUTED and WRITTEN_OFF are decisions somebody makes
// about a load, not consequences of arithmetic. They are left alone here — a
// recomputation that quietly cleared a dispute because a partial payment
// arrived would erase the only record that the argument is still open.
// ---------------------------------------------------------------------------

/**
 * The two statuses this module does NOT own.
 *
 * Everything else on the billing axis is arithmetic and is recomputed. These
 * two are decisions somebody made, and the module leaves them exactly alone —
 * both when writing and when checking for drift.
 */
/**
 * The statuses `billingStatusFor` can RETURN.
 *
 * The complement of `DECIDED`, written out rather than derived — a derivation
 * from the Prisma enum would silently absorb a new member into whichever set
 * it was subtracted from, and `tests/billing-status.test.ts` asserts the two
 * sets together cover the enum exactly. A status that is neither computed nor
 * decided fails there by name, which is the point: somebody has to say which
 * it is.
 */
export const COMPUTED_STATUSES: readonly LoadBillingStatus[] = [
  'UNINVOICED',
  'READY_TO_INVOICE',
  'INVOICED',
  'PARTIALLY_PAID',
  'PAID',
]

export const DECIDED_STATUSES: readonly LoadBillingStatus[] = [
  'DISPUTED',
  'WRITTEN_OFF',
  // ADDED 2026-09-09 WITH THE DATATRUCK HISTORY IMPORT. 14,345 loads were
  // delivered, invoiced or paid in another system; none of it happened here,
  // so there is no invoice and no payment for this rule to read and it would
  // compute UNINVOICED for all of them.
  //
  // IT IS THE SAME KIND OF FACT AS THE TWO ABOVE — something somebody knows,
  // not something arithmetic produces — which is why it belongs in this set
  // rather than in the function. And it has to be here rather than merely
  // written once: the planned POD import turns `isReady` true for delivered
  // freight, and without this line the drift check would then reclassify a
  // year of settled loads as READY_TO_INVOICE.
  'CLOSED_IN_DATATRUCK',
  // ADDED 2026-09-10 WITH THE FACTORING PACKET. Filing is somebody pressing a
  // button and handing a packet to a factor; no arithmetic over invoices and
  // payments can produce it, and `billingStatusFor` would compute INVOICED and
  // quietly undo it on the next drift sweep. It ends when a person clicks
  // PAID — factoring money stays out of this system by ruling, so nothing
  // arrives that could move it on its own.
  'FILED_WITH_FACTOR',
]

/**
 * Freight this system is responsible for — which excludes imported history.
 *
 * ── A NEEDS-ATTENTION SURFACE MUST NOT COUNT THE PAST ─────────────────────
 *
 * The Datatruck import put 14,363 finished loads into this database, 14,345 of
 * them DELIVERED. Every one is real freight and none of it needs anybody:
 * it ran, it was billed and it was paid, in another system, before this one
 * existed.
 *
 * The `podMissing` row counted them — "14,346 delivered, waiting on a POD" —
 * which is not a queue anybody can work. A dashboard whose first number is
 * five orders of magnitude too big is a dashboard nobody reads, and the rows
 * beneath it that ARE real lose their only audience.
 *
 * ONE PREDICATE, SPREAD INTO EVERY ROW THAT COUNTS LOADS, rather than a clause
 * added to the one that was visibly wrong. `noRate` and `unassignedFinished`
 * happen to be safe today because they ask for POD_RECEIVED and the import
 * writes DELIVERED — safe by coincidence, not by rule, and a coincidence is
 * not a thing to leave holding a dashboard up.
 *
 * IT IS THE BILLING AXIS THAT SAYS SO, not a date or an `externalId`. A load
 * closed in Datatruck is closed whatever its operational status, and an
 * imported load that somebody legitimately reopens stops being closed and
 * starts counting again — which is the correct behaviour and falls out of
 * asking the status rather than asking where the row came from.
 */
export const NOT_CLOSED_HISTORY: Prisma.LoadWhereInput = {
  billingStatus: { not: 'CLOSED_IN_DATATRUCK' },
}

export interface BillingFacts {
  /** POD in, rate on it, not cancelled — the load could be billed today. */
  isReady: boolean
  directSettled: boolean
  totalRevenueCents: number
  /** Sum of PaymentLoadApplication for this load. Direct-settled only. */
  appliedCents: number
  /** Live invoices this load appears on: what they total and what is unpaid. */
  invoiced: boolean
  invoiceTotalCents: number
  invoiceBalanceCents: number
}

/**
 * What the billing status SHOULD be, from facts alone.
 *
 * Pure, so the drift check and the writer cannot disagree about the rule — the
 * failure mode of a cache is two places computing it slightly differently.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * CHANGING THIS FUNCTION IS A DATA MIGRATION, AND THE DEPLOY HAS NO STEP FOR
 * IT. Read this before you edit, not after.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * `Load.billingStatus` is a STORED COLUMN. This decides what it should be;
 * `refreshBillingStatus` writes it, and it is called from exactly four places
 * — a status transition, an invoice, a payment, a rate change. Nothing else
 * recomputes, ever.
 *
 * So the moment you change a clause here, every row nobody has touched since
 * keeps the answer the OLD rule gave. The screens that read the column show
 * the old answer; anything that derives live shows the new one; and they
 * disagree until something unrelated happens to the load.
 *
 * IT HAPPENED ON 2026-09-06 AND IT REACHED PRODUCTION. `isReady` learned to
 * require an assigned truck and driver. The Load Tracker, which computes at
 * render, moved to Delivered immediately. The badge beside it, which reads
 * this column, went on saying "Ready to invoice" — the exact disagreement the
 * shared predicate had just been introduced to prevent, arriving from the
 * cache instead of from a second rule.
 *
 * AND THE SIZE OF IT WAS ALREADY MEASURED AND MISREAD. A production inspector
 * had reported `would_reclassify: 2` before the change shipped. That number was
 * the migration's size — the rows whose stored value the new rule contradicts
 * — and it was reported to the owner as a preview of what the screens would
 * show, alongside the claim that "nothing in the data changes". The column is
 * data. The count was in hand and read as the wrong kind of number.
 *
 * SO, WHEN YOU CHANGE THIS: count the rows the new rule would classify
 * differently, and plan for them. `findBillingStatusDrift` names them, and
 * `npm run check:drift` now runs it against production so a drift cannot sit
 * unnoticed. Repair goes through `refreshBillingStatus`, never through SQL —
 * it writes the status event that says the status moved, and a silent status
 * change on money-adjacent freight is the failure this codebase keeps
 * flagging.
 */
export function billingStatusFor(facts: BillingFacts): LoadBillingStatus {
  if (facts.directSettled) {
    // Direct-settled freight never becomes an invoice, so "invoiced" is not a
    // state it can reach. It goes from uninvoiced straight to paid, through
    // partially paid if the statement covered only part of it.
    if (facts.appliedCents <= 0) {
      return facts.isReady ? 'READY_TO_INVOICE' : 'UNINVOICED'
    }
    return facts.appliedCents >= facts.totalRevenueCents
      ? 'PAID'
      : 'PARTIALLY_PAID'
  }

  if (!facts.invoiced) {
    return facts.isReady ? 'READY_TO_INVOICE' : 'UNINVOICED'
  }

  // On an invoice. The load's state follows the INVOICE's balance against the
  // INVOICE's total — not against the load's own revenue. An invoice covering
  // five loads is paid for all five at once, because a broker pays a document
  // rather than a load, and comparing the balance to one load's share would
  // call a five-load invoice "partially paid" the moment it was issued.
  if (facts.invoiceBalanceCents <= 0) return 'PAID'
  return facts.invoiceBalanceCents < facts.invoiceTotalCents
    ? 'PARTIALLY_PAID'
    : 'INVOICED'
}

/** The facts for a set of loads, in two queries rather than two per load. */
export async function billingFactsFor(
  tx: TxClient,
  loadIds: readonly string[],
): Promise<Map<string, BillingFacts>> {
  if (loadIds.length === 0) return new Map()

  const loads = await tx.load.findMany({
    where: { id: { in: [...loadIds] } },
    select: {
      id: true,
      isCancelled: true,
      operationalStatus: true,
      directSettled: true,
      totalRevenueCents: true,
      // THE 2026-09-06 RULING. Finished freight attached to nobody is not
      // ready for money; see `isAssigned` for which half carries the pay.
      driverId: true,
      truckId: true,
      paymentApplications: { select: { amountCents: true } },
      invoiceLines: {
        select: {
          invoice: {
            select: {
              id: true,
              totalCents: true,
              balanceCents: true,
              status: true,
              deletedAt: true,
            },
          },
        },
      },
    },
  })

  const facts = new Map<string, BillingFacts>()
  for (const load of loads) {
    // A voided invoice is not an invoice. Leaving it in would strand the load
    // at INVOICED forever, out of the ready queue and out of every total.
    const live = load.invoiceLines
      .map((line) => line.invoice)
      .filter(
        (invoice) =>
          invoice.deletedAt === null &&
          invoice.status !== 'VOID' &&
          invoice.status !== 'WRITTEN_OFF',
      )

    // DE-DUPLICATED BY INVOICE ID. A load contributes several lines to one
    // invoice — linehaul, fuel, each accessorial — and summing per line would
    // count the same balance four times and make an unpaid invoice look
    // partially paid the moment it had more than one line on it.
    const invoices = [...new Map(live.map((i) => [i.id, i])).values()]

    const invoiceTotalCents = invoices.reduce(
      (sum, invoice) => sum + invoice.totalCents,
      0,
    )
    const invoiceBalanceCents = invoices.reduce(
      (sum, invoice) => sum + invoice.balanceCents,
      0,
    )

    facts.set(load.id, {
      isReady:
        !load.isCancelled &&
        load.operationalStatus === 'POD_RECEIVED' &&
        load.totalRevenueCents > 0 &&
        isAssigned(load),
      directSettled: load.directSettled,
      totalRevenueCents: load.totalRevenueCents,
      appliedCents: load.paymentApplications.reduce(
        (sum, application) => sum + application.amountCents,
        0,
      ),
      invoiced: invoices.length > 0,
      invoiceTotalCents,
      invoiceBalanceCents,
    })
  }

  return facts
}

/**
 * Recompute and store the billing status for the given loads.
 *
 * Returns the loads it actually changed, so a caller can say what moved rather
 * than claiming everything did.
 */
export async function refreshBillingStatus(
  tx: TxClient,
  loadIds: readonly string[],
  options: { source?: StatusSource; userId?: string | null } = {},
): Promise<
  { loadId: string; from: LoadBillingStatus; to: LoadBillingStatus }[]
> {
  const unique = [...new Set(loadIds)]
  if (unique.length === 0) return []

  const [facts, current] = await Promise.all([
    billingFactsFor(tx, unique),
    tx.load.findMany({
      where: { id: { in: unique } },
      select: { id: true, organizationId: true, billingStatus: true },
    }),
  ])

  const changed: {
    loadId: string
    from: LoadBillingStatus
    to: LoadBillingStatus
  }[] = []

  for (const load of current) {
    // A dispute or a write-off is a decision, not arithmetic. Recomputing over
    // it would erase the only record that the argument is still open.
    if (DECIDED_STATUSES.includes(load.billingStatus)) continue

    const fact = facts.get(load.id)
    if (!fact) continue

    const next = billingStatusFor(fact)
    if (next === load.billingStatus) continue

    await tx.load.update({
      where: { id: load.id },
      data: { billingStatus: next },
    })

    // The BILLING axis, on the same timeline as the operational one. Source
    // defaults to AUTOMATIC because that is what this almost always is: a POD
    // landing, an invoice generated, a payment applied. A caller that knows
    // better says so.
    await tx.loadStatusEvent.create({
      data: {
        loadId: load.id,
        organizationId: load.organizationId,
        axis: 'BILLING',
        fromStatus: load.billingStatus,
        toStatus: next,
        source: options.source ?? 'AUTOMATIC',
        changedByUserId: options.userId ?? null,
      },
    })

    changed.push({ loadId: load.id, from: load.billingStatus, to: next })
  }

  return changed
}

export interface BillingStatusDrift {
  loadId: string
  loadNumber: string
  stored: LoadBillingStatus
  computed: LoadBillingStatus
}

/**
 * Every load whose stored billing status is not what the facts say.
 *
 * Must return nothing. DISPUTED and WRITTEN_OFF are skipped because this module
 * does not own them; everything else is arithmetic, and arithmetic that
 * disagrees with itself is a load sitting in the wrong queue — invisible in the
 * ready list, or invoiced twice.
 */
export async function findBillingStatusDrift(
  tx: TxClient,
): Promise<BillingStatusDrift[]> {
  // ── FILTERED BY WHAT THE RULE CAN PRODUCE, NOT BY WHAT IT CANNOT ──────
  //
  // This asked for `billingStatus: { notIn: [...DECIDED_STATUSES] }` until 2026-09-10,
  // which sends every DECIDED name to the database. The moment
  // `FILED_WITH_FACTOR` joined that set in code, `check:drift` — which reads
  // PRODUCTION by design — failed on every machine:
  //
  //   invalid input value for enum "LoadBillingStatus": "FILED_WITH_FACTOR"
  //
  // A new enum member is unusable in a query until its migration has reached
  // production, and the window between writing the code and shipping the
  // migration is exactly when `npm run check` runs most.
  //
  // The positive filter has no such window. `COMPUTED_STATUSES` are the values
  // `billingStatusFor` can RETURN, so they exist wherever this rule has ever
  // run; a status the database has not heard of is not among them and cannot
  // be sent. Filtering in TypeScript instead was the other candidate and it
  // cost the 5s transaction budget — 14,451 rows fetched to discard almost all
  // of them.
  const loads = await tx.load.findMany({
    where: {
      deletedAt: null,
      billingStatus: { in: [...COMPUTED_STATUSES] },
    },
    select: { id: true, loadNumber: true, billingStatus: true },
  })
  if (loads.length === 0) return []

  const facts = await billingFactsFor(
    tx,
    loads.map((load) => load.id),
  )

  const drift: BillingStatusDrift[] = []
  for (const load of loads) {
    const fact = facts.get(load.id)
    if (!fact) continue

    const computed = billingStatusFor(fact)
    if (computed !== load.billingStatus) {
      drift.push({
        loadId: load.id,
        loadNumber: load.loadNumber,
        stored: load.billingStatus,
        computed,
      })
    }
  }

  return drift
}
