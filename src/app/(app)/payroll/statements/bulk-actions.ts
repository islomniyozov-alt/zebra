'use server'

import { revalidatePath } from 'next/cache'
import { withCurrentOrg } from '@/lib/auth-context'
import { approveSettlement, markSettlementPaid } from '@/lib/settlements'
import { isPlaceholderNumber } from '@/lib/settlement-number'
import type { StatementBulkState, StatementRefusal } from './bulk-state'
import type { MessageKey } from '@/lib/i18n'
import type { PaymentMethod } from '@/generated/prisma/client'

// PAYROLL → STATEMENTS: Post and Mark paid on a selection (§6.2.6).
//
// ── PER STATEMENT, THROUGH THE SAME TWO FUNCTIONS, BLOCKERS INTACT ───────
//
// `approveSettlement` refuses a negative net — a settlement whose deductions
// exceed the pay is a debt, not a cheque — and mints the statement number on
// the way out of DRAFT. `markSettlementPaid` refuses an empty reference and
// anything that is not APPROVED. This loops them; it does not reimplement
// them and it has no fast path, because a bulk route that wrote
// `status = 'PAID'` would be a way to pay a negative statement from a
// checkbox.
//
// ── ONE TRANSACTION PER STATEMENT, UNLIKE THE PAYMENT APPLY ──────────────
//
// The apply is all-or-nothing because one person is dividing ONE payment.
// These are independent documents: posting four statements and refusing the
// fifth is four real outcomes, and rolling them back would undo work the
// reader has already been told succeeded. Partial success is the honest
// shape here, which is why the refusals are named.

const REASON: Record<string, MessageKey> = {
  not_found: 'settlements.error.notFound',
  not_draft: 'settlements.error.notDraft',
  not_approved: 'settlements.error.notApproved',
  already_paid: 'settlements.error.alreadyPaid',
  negative_net: 'settlements.error.negativeNet',
  no_reference: 'settlements.error.noReference',
}

export async function statementBulkAction(
  intent: 'post' | 'markPaid',
  _previous: StatementBulkState,
  formData: FormData,
): Promise<StatementBulkState> {
  const ids = formData.getAll('statement').map(String).filter(Boolean)
  if (ids.length === 0) return { changed: 0, refusals: [] }

  const method = String(formData.get('method') ?? '').trim() as PaymentMethod
  const reference = String(formData.get('reference') ?? '').trim()

  let changed = 0
  const refusals: StatementRefusal[] = []

  for (const id of ids) {
    const outcome = await withCurrentOrg(
      'approve',
      'settlement',
      async (tx, session) => {
        // THE NAME FIRST, so a refusal can say which. A draft has no issued
        // number yet, so the driver stands in — an id in an error message is
        // the thing the reader then has to go and look up.
        const settlement = await tx.settlement.findFirst({
          where: { id, deletedAt: null },
          select: {
            settlementNumber: true,
            driver: { select: { firstName: true, lastName: true } },
          },
        })
        const name =
          settlement === null
            ? id.slice(0, 8)
            : isPlaceholderNumber(settlement.settlementNumber)
              ? `${settlement.driver.firstName} ${settlement.driver.lastName}`
              : settlement.settlementNumber

        const result =
          intent === 'post'
            ? await approveSettlement(tx, id, session.userId)
            : await markSettlementPaid(tx, id, { method, reference })

        if (result.ok) return { name, refusal: null }
        return {
          name,
          refusal: {
            statement: name,
            reason: REASON[result.reason] ?? 'settlements.error.notFound',
          } satisfies StatementRefusal,
        }
      },
    )

    if (outcome.refusal === null) changed += 1
    else refusals.push(outcome.refusal)
  }

  revalidatePath('/payroll/statements')
  revalidatePath('/settlements')
  return { changed, refusals }
}
