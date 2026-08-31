import type { Prisma, SettlementLineType } from '@/generated/prisma/client'
import { formatCents } from './money'
import { readSnapshot, type PaySnapshot } from './driver-pay'
import type { SettlementPdfLine } from './settlement-pdf'

// ---------------------------------------------------------------------------
// TURNING A SNAPSHOT BACK INTO A SENTENCE.
//
// A settlement line stores the rule, the basis and the result. This renders
// that as the working — "30% of $2,450.00 gross", "1,240 mi at $0.58" — and it
// lives in one module because the PDF and the screen must say the SAME thing.
// Two renderings of one snapshot is how the paper and the screen end up
// disagreeing in front of a driver.
//
// TEMPLATES, NOT CONCATENATION. The first version glued English words between
// the figures, and the Farsi settlement screen rendered "of $۲٬۴۵۰٫۰۰ gross
// 30%" — the numbers mirrored, the English words did not, and the result was
// unreadable in the one place a driver checks their pay. A template per rule
// type lets each language put the words where they belong.
//
// The PDF keeps the English templates on purpose: base-14 fonts are WinAnsi
// and cannot draw Cyrillic or Farsi at all. The screen carries the locales.
// ---------------------------------------------------------------------------

export interface BasisTemplates {
  /** "{percent} of {amount} gross" */
  percentGross: string
  /** "{percent} of {amount} linehaul" */
  percentLinehaul: string
  /** "{miles} mi at {rate}" */
  perMile: string
  /** "{miles} dispatched mi at {rate}" — the planned distance, said so. */
  perMileDispatched: string
  /** "flat {amount} per load" */
  flatPerLoad: string
}

/** What the PDF uses, and the fallback everywhere else. */
export const ENGLISH_BASIS: BasisTemplates = {
  percentGross: '{percent} of {amount} gross',
  percentLinehaul: '{percent} of {amount} linehaul',
  perMile: '{miles} mi at {rate}',
  perMileDispatched: '{miles} dispatched mi at {rate}',
  flatPerLoad: 'flat {amount} per load',
}

const fill = (template: string, values: Record<string, string>): string =>
  template.replace(/\{(\w+)\}/g, (whole, key: string) => values[key] ?? whole)

export function basisSentence(
  snapshot: PaySnapshot | null,
  locale?: string,
  templates: BasisTemplates = ENGLISH_BASIS,
): string {
  if (!snapshot) return ''

  switch (snapshot.type) {
    case 'PERCENT_GROSS':
    case 'PERCENT_LINEHAUL': {
      // The BASIS IS NAMED, not just the number: 30% of gross and 30% of
      // linehaul are different agreements, and a driver checking the figure
      // needs to know which one they are on.
      const template =
        snapshot.type === 'PERCENT_GROSS'
          ? templates.percentGross
          : templates.percentLinehaul
      return fill(template, {
        percent: percentLabel(snapshot.percentBps ?? 0),
        amount: formatCents(snapshot.basis, locale),
      })
    }
    case 'PER_MILE':
      return fill(
        snapshot.basisLabel === 'dispatchedMiles'
          ? templates.perMileDispatched
          : templates.perMile,
        {
          miles: snapshot.basis.toLocaleString(locale),
          rate: formatCents(snapshot.perMileCents ?? 0, locale),
        },
      )
    case 'FLAT_PER_LOAD':
      return fill(templates.flatPerLoad, {
        amount: formatCents(snapshot.flatCents ?? 0, locale),
      })
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
  /** Frozen at generation. See SettlementLine in the schema. */
  puAt?: Date | null
  delAt?: Date | null
  puActual?: boolean
  delActual?: boolean
}

/**
 * A sheet date as the document prints it: `MM/DD`, or blank.
 *
 * UTC, DELIBERATELY, and the same choice the rest of this document makes about
 * dates it was handed. Re-reading a frozen instant in a zone chosen at print
 * time would let the same settlement print two different dates on two
 * machines, which is the one thing a driver's sheet may not do.
 */
function sheetDate(at: Date | null | undefined): string {
  if (!at) return ''
  const month = String(at.getUTCMonth() + 1).padStart(2, '0')
  const day = String(at.getUTCDate()).padStart(2, '0')
  return `${month}/${day}`
}

/** Settlement lines as the PDF wants them, working included, in English. */
export function settlementPdfLines(
  lines: readonly StoredLine[],
): SettlementPdfLine[] {
  return lines.map((line) => ({
    loadNumber: line.load?.loadNumber ?? null,
    description: line.description,
    basis: basisSentence(readSnapshot(line.payRuleSnapshot), 'en-US'),
    amountCents: line.amountCents,
    puDate: sheetDate(line.puAt),
    puActual: line.puActual ?? false,
    delDate: sheetDate(line.delAt),
    delActual: line.delActual ?? false,
  }))
}
