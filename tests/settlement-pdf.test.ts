import { describe, expect, it } from 'vitest'
import {
  renderSettlementPdf,
  MAX_SETTLEMENT_LINES,
  type SettlementPdfInput,
} from '@/lib/settlement-pdf'
import { lastFullWeek } from '@/lib/settlements'

// The document a driver is handed on Friday and brings back in three weeks
// when they think the fuel deduction was wrong. So the assertions are about
// whether it is a real file AND whether a person can check the arithmetic on it.

const input: SettlementPdfInput = {
  settlementNumber: 'STL-1007',
  periodStart: '2026-07-27',
  periodEnd: '2026-08-02',
  carrier: {
    name: 'RAM Haulage LLC',
    dotNumber: '3162967',
    mcNumber: '112499',
  },
  driver: { name: 'Ahmad Karimov', phone: '+1 312 555 0142' },
  lines: [
    {
      loadNumber: 'L-1042',
      description: 'Load pay L-1042',
      basis: '30% of $2,990.00 gross',
      amountCents: 89700,
    },
    {
      loadNumber: 'L-1044',
      description: 'Load pay L-1044',
      basis: '30% of $1,900.00 gross',
      amountCents: 57000,
    },
    {
      loadNumber: null,
      description: 'Fuel advance 28 Jul',
      basis: '',
      amountCents: -25000,
    },
    {
      loadNumber: null,
      description: 'Lumper reimbursed',
      basis: '',
      amountCents: 12000,
    },
  ],
  grossCents: 146700,
  deductionsCents: 25000,
  reimbursementsCents: 12000,
  netCents: 133700,
  status: 'APPROVED',
  paidOn: null,
  paymentReference: null,
}

const decode = (bytes: Uint8Array) => new TextDecoder().decode(bytes)

describe('the settlement PDF', () => {
  const bytes = renderSettlementPdf(input)
  const text = decode(bytes)

  it('is a PDF a reader will open', () => {
    expect(text.startsWith('%PDF-1.4')).toBe(true)
    expect(text.trimEnd().endsWith('%%EOF')).toBe(true)
    expect(text).toContain('/Type /Catalog')
    expect(text).toContain('/Type /Page ')
    expect(text).toContain('/BaseFont /Helvetica')
  })

  it('has correct byte offsets in its cross-reference table', () => {
    // The part that breaks. Every offset is the byte position of an object's
    // header, and a reader that finds one wrong reports a corrupt file with no
    // clue which. Measured against the bytes rather than trusted.
    // `lastIndexOf('xref')` finds the "xref" inside "startxref" — a trap this
    // test fell into on its first run. The table is the one preceded by a
    // newline and followed by the subsection header.
    const xrefAt = text.search(/\nxref\n/) + 1
    const startxref = Number(
      /startxref\n(\d+)/.exec(text.slice(text.lastIndexOf('startxref')))![1],
    )
    expect(startxref).toBe(
      new TextEncoder().encode(text.slice(0, xrefAt)).length,
    )

    const rows = text
      .slice(xrefAt)
      .split('\n')
      .filter((line) => /^\d{10} \d{5} n $/.test(line))
    expect(rows).toHaveLength(6)

    rows.forEach((row, index) => {
      const offset = Number(row.slice(0, 10))
      const at = decode(bytes.slice(offset, offset + 20))
      expect(at.startsWith(`${index + 1} 0 obj`), `object ${index + 1}`).toBe(
        true,
      )
    })
  })

  it('SHOWS THE WORKING beside every figure', () => {
    // The reason the document is worth printing. A driver who can see
    // "30% of $2,990.00 gross" can check $897.00 with a phone calculator; one
    // who sees only $897.00 has to ask.
    expect(text).toContain('30% of $2,990.00 gross')
    expect(text).toContain('L-1042')
    expect(text).toContain('$897.00')
  })

  it('prints the deduction as a negative, next to the net it produced', () => {
    // A deductions figure printed positive above a smaller net is the single
    // most common thing a driver queries.
    expect(text).toContain('-$250.00')
    expect(text).toContain('$1,337.00')
    // 146700 + 12000 - 25000 = 133700, and the three parts are all on the page
    // so the arithmetic can be done by hand.
    expect(
      input.grossCents + input.reimbursementsCents - input.deductionsCents,
    ).toBe(input.netCents)
  })

  it('names the driver and the period', () => {
    expect(text).toContain('Ahmad Karimov')
    expect(text).toContain('2026-07-27 - 2026-08-02')
    expect(text).toContain('APPROVED')
  })

  it('is deterministic', () => {
    // Byte-identical on a second render, which is what makes "regenerate it"
    // safe to say about a document somebody has already been handed.
    expect(decode(renderSettlementPdf(input))).toBe(text)
  })

  it('says so rather than silently dropping lines that do not fit', () => {
    const many = {
      ...input,
      lines: Array.from({ length: MAX_SETTLEMENT_LINES + 4 }, (_, index) => ({
        loadNumber: `L-${2000 + index}`,
        description: `Load pay ${index}`,
        basis: '30% of $1,000.00 gross',
        amountCents: 30000,
      })),
    }
    const overflow = decode(renderSettlementPdf(many))
    expect(overflow).toContain('4 further lines not shown')
    // And the last one that DID fit is on the page, so the cut is where it says.
    expect(overflow).toContain(`L-${2000 + MAX_SETTLEMENT_LINES - 1}`)
  })

  it('replaces a glyph the base font cannot draw rather than dropping it', () => {
    const cyrillic = renderSettlementPdf({
      ...input,
      driver: { name: 'Ахмад Каримов', phone: null },
    })
    // "?" is a visible bug somebody reports; a missing glyph is one nobody
    // notices. Base-14 fonts are WinAnsi — the parked English-only flag.
    expect(decode(cyrillic)).toContain('?????')
  })
})

describe('the week the screen offers by default', () => {
  it('is the last full Monday-to-Sunday week', () => {
    // Thursday 6 August 2026. The last full week ran Mon 27 Jul - Sun 2 Aug.
    expect(lastFullWeek(new Date('2026-08-06T12:00:00Z'))).toEqual({
      start: '2026-07-27',
      end: '2026-08-02',
    })
  })

  it('does not offer the week that is still running, on a Sunday', () => {
    // Sunday 2 August 2026 IS the last day of that week, so the week ending
    // today is not finished and the answer is the one before it.
    expect(lastFullWeek(new Date('2026-08-02T23:00:00Z'))).toEqual({
      start: '2026-07-20',
      end: '2026-07-26',
    })
  })

  it('gives a Monday the week that ended yesterday', () => {
    // Monday 3 August 2026 — the week that ended on Sunday the 2nd.
    expect(lastFullWeek(new Date('2026-08-03T06:00:00Z'))).toEqual({
      start: '2026-07-27',
      end: '2026-08-02',
    })
  })

  it('always spans exactly seven days, on every day of a year', () => {
    const day = new Date('2026-01-01T00:00:00Z')
    for (let index = 0; index < 365; index++) {
      const { start, end } = lastFullWeek(day)
      const span =
        (Date.parse(`${end}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`)) /
        86_400_000
      expect(span, `${day.toISOString()}`).toBe(6)
      // And it always ENDS on a Sunday, whatever day it was asked on.
      expect(new Date(`${end}T00:00:00Z`).getUTCDay()).toBe(0)
      day.setUTCDate(day.getUTCDate() + 1)
    }
  })
})
