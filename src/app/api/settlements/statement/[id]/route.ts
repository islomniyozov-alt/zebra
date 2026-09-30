import { withCurrentOrg } from '@/lib/auth-context'
import { renderStatementPdf } from '@/lib/statement-pdf'
import { isPlaceholderNumber } from '@/lib/settlement-number'
import { checkDateFor } from '@/lib/settlement-week'
import { apiError, authFailureResponse } from '../../../_lib/respond'

// GET /api/settlements/statement/{settlementId}
//
// The driver pay statement, in Datatruck's layout. Rendered on demand from the
// FROZEN rows — the load lines and deduction lines written at FINAL — and not
// recomputed, which is the difference between a document and a view.
//
// EVERY SETTLEMENT RENDERS, DRAFTS INCLUDED. Owner's ruling, 2026-09-30,
// reversing this route's own earlier one.
//
// It used to answer 409 for a draft: no number, lines thrown away and rebuilt
// on every refresh, so a PDF of one is a figure that will be different
// tomorrow. Every clause of that is still true — and it is an argument for
// SAYING SO ON THE SHEET rather than withholding it, because the people who
// print a draft are the ones checking it before it is posted.
//
// So a draft renders with DRAFT across the page and an empty Settlement line,
// and a settlement with no batch renders too, on its own frozen dates. There
// is no 409 left in this file.

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
          referralWith: true,
          payToName: true,
          payToAddress: true,
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

      // ── EVERY SETTLEMENT RENDERS (owner's ruling, 2026-09-30) ──────────
      //
      // This used to answer 409 for a draft, and for a settlement with no
      // batch, on the reasoning that a draft's lines are rebuilt on every
      // refresh so a PDF of one is a figure that changes tomorrow. The
      // reasoning was right and the conclusion was not: it is an argument for
      // saying so ON THE DOCUMENT, and the people who want a draft on paper
      // are the ones checking it before it is posted.
      //
      // `draft` DRIVES THE WATERMARK AND THE BLANK NUMBER, and it is the
      // BATCH's state, not the settlement's — a settlement can be PAID inside
      // a batch still being assembled, which dev holds.
      const isDraft =
        settlement.batch === null || settlement.batch.status === 'DRAFT'

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
        // NO NUMBER UNTIL ONE IS ISSUED (§8). A draft carries a placeholder
        // built from two row ids; printing it here would put on paper the
        // exact string the heading rule keeps off the screen. The watermark
        // is what explains the blank.
        statementNumber: isPlaceholderNumber(settlement.settlementNumber)
          ? ''
          : settlement.settlementNumber,
        batchNumber: settlement.batch?.batchNumber ?? '',
        company: { name: settlement.company.name, address },
        driverName:
          `${settlement.driver.firstName} ${settlement.driver.lastName}`.trim(),
        unitNumber: settlement.unitNumber,
        teamWith: settlement.teamWith,
        referralWith: settlement.referralWith,
        payToName: settlement.payToName,
        payToAddress: settlement.payToAddress,
        payTariffLabel: settlement.payTariffLabel,
        // THE BATCH'S DATE WHERE THERE IS ONE. With no batch the settlement's
        // own frozen period end stands in — deterministic, so the same draft
        // renders the same bytes twice, which `new Date()` here would not.
        statementDate: settlement.batch?.statementDate ?? settlement.periodEnd,
        periodStart: settlement.periodStart,
        periodEnd: settlement.periodEnd,
        // THE DRIVER'S OWN PAYOUT DATE, not the batch's check date. Two drivers
        // in one batch can be paid on different days.
        checkDate:
          settlement.payoutDate ??
          settlement.batch?.checkDate ??
          checkDateFor({
            start: settlement.periodStart,
            end: settlement.periodEnd,
          }),
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
        draft: isDraft,
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
