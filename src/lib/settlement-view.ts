import type { Prisma, SettlementLineType } from '@/generated/prisma/client'
import { formatCents } from './money'
import { readSnapshot, type PaySnapshot } from './driver-pay'
import type { SettlementPdfLine } from './settlement-pdf'

// ---------------------------------------------------------------------------
// TURNING A SNAPSHOT BACK INTO A SENTENCE.
//
// A settlement line stores the rule, the basis and the result. This renders
// that as the working — "30% of $2,450.00", "1,240 mi at $0.58" — and it lives
// in one module because the PDF and the screen must say the SAME thing. Two
// renderings of one snapshot is how the paper and the screen end up
// disagreeing in front of a driver.
//
// English figures on the PDF (base-14 fonts are WinAnsi); the screen passes
// its own locale.
// ---------------------------------------------------------------------------

export function basisSentence(
  snapshot: PaySnapshot | null,
  locale?: string,
): string {
  if (!snapshot) return ''

  switch (snapshot.type) {
    case 'PERCENT_GROSS':
    case 'PERCENT_LINEHAUL': {
      const percent = percentLabel(snapshot.percentBps ?? 0)
      // The BASIS IS NAMED, not just the number: "30% of $2,450.00 (linehaul)"
      // and "30% of $2,830.00 (gross)" are different agreements, and a driver
      // checking the figure needs to know which one they are on.
      const of = snapshot.type === 'PERCENT_GROSS' ? 'gross' : 'linehaul'
      return `${percent} of ${formatCents(snapshot.basis, locale)} ${of}`
    }
    case 'PER_MILE': {
      const rate = formatCents(snapshot.perMileCents ?? 0, locale)
      const source =
        snapshot.basisLabel === 'dispatchedMiles' ? ' dispatched' : ''
      return `${snapshot.basis.toLocaleString(locale)}${source} mi at ${rate}`
    }
    case 'FLAT_PER_LOAD':
      return `flat ${formatCents(snapshot.flatCents ?? 0, locale)} per load`
  }
}

/** Basis points as a percentage. 3000 -> "30%", 2750 -> "27.5%". */
function percentLabel(bps: number): string {
  const whole = Math.trunc(bps / 100)
  const fraction = bps % 100
  if (fraction === 0) return `${whole}%`
  return `${whole}.${String(fraction).padStart(2, '0').replace(/0$/, '')}%`
}

interface StoredLine {
  type: SettlementLineType
  description: string
  amountCents: number
  payRuleSnapshot: Prisma.JsonValue | null
  load: { loadNumber: string } | null
}

/** Settlement lines as the PDF wants them, working included. */
export function settlementPdfLines(
  lines: readonly StoredLine[],
): SettlementPdfLine[] {
  return lines.map((line) => ({
    loadNumber: line.load?.loadNumber ?? null,
    description: line.description,
    basis: basisSentence(readSnapshot(line.payRuleSnapshot)),
    amountCents: line.amountCents,
  }))
}
