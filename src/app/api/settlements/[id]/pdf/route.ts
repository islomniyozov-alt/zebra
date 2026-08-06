import { withCurrentOrg } from '@/lib/auth-context'
import { renderSettlementPdf } from '@/lib/settlement-pdf'
import { settlementPdfLines } from '@/lib/settlement-view'
import { apiError, authFailureResponse } from '../../../_lib/respond'

// GET /api/settlements/{id}/pdf
//
// Rendered on demand rather than stored, same as the invoice: the document is
// a pure function of rows that do not change after approval, because every
// line carries its own frozen snapshot. Nothing to keep in R2 that could drift
// from the settlement it claims to be.
//
// Gated on `settlement`, NOT on `driver.pay`. Reading a settlement is reading
// what one driver was paid, and the roles that hold one hold the other — but
// the resource this route serves is the settlement, and permissions.ts is
// where that is decided rather than here.
//
// A settlement in another organization is a 404, not a 403.

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await context.params

  try {
    const bytes = await withCurrentOrg('read', 'settlement', async (tx) => {
      const settlement = await tx.settlement.findUnique({
        where: { id },
        select: {
          settlementNumber: true,
          periodStart: true,
          periodEnd: true,
          status: true,
          grossCents: true,
          deductionsCents: true,
          reimbursementsCents: true,
          netCents: true,
          paidAt: true,
          paymentReference: true,
          company: { select: { name: true, dotNumber: true, mcNumber: true } },
          driver: {
            select: { firstName: true, lastName: true, phone: true },
          },
          lines: {
            orderBy: { sortOrder: 'asc' },
            select: {
              type: true,
              description: true,
              amountCents: true,
              payRuleSnapshot: true,
              load: { select: { loadNumber: true } },
            },
          },
        },
      })
      if (!settlement) return null

      const day = (value: Date | null) =>
        value ? value.toISOString().slice(0, 10) : '—'

      return renderSettlementPdf({
        settlementNumber: settlement.settlementNumber,
        periodStart: day(settlement.periodStart),
        periodEnd: day(settlement.periodEnd),
        carrier: {
          name: settlement.company.name,
          dotNumber: settlement.company.dotNumber,
          mcNumber: settlement.company.mcNumber,
        },
        driver: {
          name: `${settlement.driver.firstName} ${settlement.driver.lastName}`,
          phone: settlement.driver.phone,
        },
        lines: settlementPdfLines(settlement.lines),
        grossCents: settlement.grossCents,
        deductionsCents: settlement.deductionsCents,
        reimbursementsCents: settlement.reimbursementsCents,
        netCents: settlement.netCents,
        status: settlement.status,
        paidOn: settlement.paidAt ? day(settlement.paidAt) : null,
        paymentReference: settlement.paymentReference,
      })
    })

    if (!bytes) return apiError(404, 'not_found', 'No such settlement.')

    return new Response(bytes as BodyInit, {
      headers: {
        'content-type': 'application/pdf',
        'content-disposition': 'inline',
        // Never cached by a shared cache: this is one person's wages behind a
        // permission check.
        'cache-control': 'private, no-store',
      },
    })
  } catch (error) {
    const authFailure = authFailureResponse(error)
    if (authFailure) return authFailure
    throw error
  }
}
