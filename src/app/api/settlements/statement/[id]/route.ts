import { withCurrentOrg } from '@/lib/auth-context'
import { renderStatementPdf } from '@/lib/statement-pdf'
import { apiError, authFailureResponse } from '../../../_lib/respond'

// GET /api/settlements/statement/{settlementId}
//
// The driver pay statement, in Datatruck's layout. Rendered on demand from the
// FROZEN rows — the load lines and deduction lines written at FINAL — and not
// recomputed, which is the difference between a document and a view.
//
// A DRAFT HAS NO STATEMENT. It has no number, its lines are thrown away and
// rebuilt on every refresh, and handing somebody a PDF of one is handing them a
// figure that will be different tomorrow. The 409 says that in a sentence.

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await context.params

  try {
    const bytes = await withCurrentOrg('read', 'settlement', async (tx) => {
      const settlement = await tx.settlement.findFirst({
        where: { id, deletedAt: null },
        select: {
          settlementNumber: true,
          unitNumber: true,
          teamWith: true,
          payTariffLabel: true,
          payoutDate: true,
          periodStart: true,
          periodEnd: true,
          grossCents: true,
          milesHundredths: true,
          earningsCents: true,
          advancesCents: true,
          reimbursementsCents: true,
          deductionsCents: true,
          otherPayCents: true,
          netCents: true,
          driver: { select: { id: true, firstName: true, lastName: true } },
          company: {
            select: {
              name: true,
              addressLine1: true,
              city: true,
              state: true,
              postalCode: true,
            },
          },
          batch: {
            select: {
              batchNumber: true,
              status: true,
              statementDate: true,
              checkDate: true,
            },
          },
          loadLines: { orderBy: { sortOrder: 'asc' } },
          deductionLines: { orderBy: { sortOrder: 'asc' } },
        },
      })
      if (!settlement) return null
      if (!settlement.batch || settlement.batch.status === 'DRAFT') {
        return 'draft' as const
      }

      // YTD — COMPUTED, NEVER STORED. Opening balance for the year plus every
      // FINAL settlement in it, this one included.
      const year = settlement.periodStart.getUTCFullYear()
      const [opening, settled] = await Promise.all([
        tx.driverOpeningBalance.findMany({
          where: { driverId: settlement.driver.id, year },
        }),
        tx.settlement.findMany({
          where: {
            driverId: settlement.driver.id,
            batch: { status: { in: ['FINAL', 'PAID'] } },
            periodStart: { gte: new Date(Date.UTC(year, 0, 1)) },
            periodEnd: { lte: settlement.periodEnd },
          },
          select: {
            periodStart: true,
            earningsCents: true,
            advancesCents: true,
            reimbursementsCents: true,
            deductionsCents: true,
            otherPayCents: true,
            netCents: true,
          },
        }),
      ])

      const openingOf = (category: string) =>
        opening.find((row) => row.category === category)?.amountCents ?? 0
      const sum = (pick: (row: (typeof settled)[number]) => number) =>
        settled.reduce((total, row) => total + pick(row), 0)

      const address = [
        settlement.company.addressLine1,
        settlement.company.city,
        [settlement.company.state, settlement.company.postalCode]
          .filter(Boolean)
          .join(' '),
      ]
        .filter((part) => (part ?? '').trim() !== '')
        .join(', ')

      return renderStatementPdf({
        statementNumber: settlement.settlementNumber,
        batchNumber: settlement.batch.batchNumber ?? '',
        company: { name: settlement.company.name, address },
        driverName:
          `${settlement.driver.firstName} ${settlement.driver.lastName}`.trim(),
        unitNumber: settlement.unitNumber,
        teamWith: settlement.teamWith,
        payTariffLabel: settlement.payTariffLabel,
        statementDate: settlement.batch.statementDate,
        periodStart: settlement.periodStart,
        periodEnd: settlement.periodEnd,
        // THE DRIVER'S OWN PAYOUT DATE, not the batch's check date. Two drivers
        // in one batch can be paid on different days.
        checkDate: settlement.payoutDate ?? settlement.batch.checkDate,
        loads: settlement.loadLines,
        totals: {
          grossCents: settlement.grossCents,
          milesHundredths: settlement.milesHundredths,
          amountCents: settlement.earningsCents,
        },
        deductions: settlement.deductionLines.filter(
          (line) => line.totalCents < 0,
        ),
        otherPay: settlement.deductionLines.filter(
          (line) => line.totalCents > 0,
        ),
        summary: {
          earningsCents: settlement.earningsCents,
          advancesCents: settlement.advancesCents,
          reimbursementsCents: settlement.reimbursementsCents,
          deductionsCents: settlement.deductionsCents,
          otherPayCents: settlement.otherPayCents,
          netCents: settlement.netCents,
        },
        ytd: {
          earningsCents: openingOf('EARNINGS') + sum((r) => r.earningsCents),
          advancesCents: openingOf('ADVANCES') + sum((r) => r.advancesCents),
          reimbursementsCents:
            openingOf('REIMBURSEMENTS') + sum((r) => r.reimbursementsCents),
          deductionsCents:
            openingOf('DEDUCTIONS') + sum((r) => r.deductionsCents),
          otherPayCents: openingOf('OTHER_PAY') + sum((r) => r.otherPayCents),
          netCents: openingOf('NET_PAY') + sum((r) => r.netCents),
        },
        // NO OPENING ROW MEANS THIS IS NOT A YEAR. The label then says which
        // period it counts from rather than printing YTD over a partial figure.
        ytdFromPeriodStart:
          opening.length > 0
            ? null
            : settled.reduce<Date | null>(
                (earliest, row) =>
                  earliest === null || row.periodStart < earliest
                    ? row.periodStart
                    : earliest,
                null,
              ),
      })
    })

    if (bytes === null) return apiError(404, 'not_found', 'No such settlement.')
    if (bytes === 'draft') {
      return apiError(
        409,
        'draft',
        'This settlement is still a draft. Its figures are recomputed on every refresh and it has no number yet — finalise the batch to issue it.',
      )
    }

    return new Response(bytes as BodyInit, {
      headers: {
        'content-type': 'application/pdf',
        'content-disposition': 'inline',
        'cache-control': 'private, no-store',
      },
    })
  } catch (error) {
    const authFailure = authFailureResponse(error)
    if (authFailure) return authFailure
    throw error
  }
}
