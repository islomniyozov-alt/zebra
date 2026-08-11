import { describe, expect, it } from 'vitest'
import {
  remitToFor,
  renderInvoicePdf,
  type InvoicePdfInput,
} from '@/lib/invoice-pdf'

// The PDF is what a broker's clerk opens and what a factoring portal ingests.
// It has to be a real file, not a plausible-looking blob.

const input: InvoicePdfInput = {
  invoiceNumber: 'INV-1042',
  issueDate: '2026-08-04',
  dueDate: '2026-09-03',
  termsDays: 30,
  carrier: {
    name: 'RAM Haulage LLC',
    dotNumber: '3162967',
    mcNumber: '112499',
  },
  billTo: { name: 'TQL', address: '4289 Ivy Pointe Blvd, Cincinnati OH' },
  remitTo: {
    name: 'Triumph Financial Services',
    lines: ['payments@triumphpay.com', '(469) 312-7222'],
  },
  lines: [
    { description: 'Linehaul — 1042', amountCents: 245000 },
    { description: 'Fuel surcharge — 1042', amountCents: 38000 },
    { description: 'Detention — 1042', amountCents: 16250 },
  ],
  subtotalCents: 283000,
  accessorialsCents: 16250,
  totalCents: 299250,
  notes: null,
}

const decode = (bytes: Uint8Array) => new TextDecoder().decode(bytes)

describe('the invoice PDF', () => {
  const bytes = renderInvoicePdf(input)
  const text = decode(bytes)

  it('is a PDF a reader will open', () => {
    expect(text.startsWith('%PDF-1.4')).toBe(true)
    expect(text.trimEnd().endsWith('%%EOF')).toBe(true)
    expect(text).toContain('/Type /Catalog')
    expect(text).toContain('/Type /Page ')
  })

  it('has a valid cross-reference table', () => {
    // The xref offsets are what a reader seeks by. Wrong offsets produce a
    // file that opens in one viewer and not another, which is the worst kind.
    const startxref = Number(/startxref\s+(\d+)/.exec(text)?.[1])
    expect(Number.isInteger(startxref)).toBe(true)
    expect(text.slice(startxref, startxref + 4)).toBe('xref')

    const entries = [...text.matchAll(/^(\d{10}) 00000 n $/gm)]
    expect(entries).toHaveLength(6)
    for (const [, offset] of entries) {
      const at = Number(offset)
      expect(text.slice(at)).toMatch(/^\d+ 0 obj/)
    }
  })

  it('carries the numbers a clerk checks', () => {
    expect(text).toContain('INV-1042')
    expect(text).toContain('$2,450.00')
    expect(text).toContain('$380.00')
    expect(text).toContain('$162.50')
    expect(text).toContain('$2,992.50')
  })

  it('names the carrier and its authority', () => {
    expect(text).toContain('RAM Haulage LLC')
    expect(text).toContain('USDOT 3162967')
    expect(text).toContain('MC 112499')
  })

  // --- REMIT TO (owner's ruling, from a real Datatruck invoice) -------------
  //
  // An authority that factors has SOLD its receivables. The broker must pay
  // the FACTOR, and an invoice that does not say so gets paid into the wrong
  // bank account — a real loss, not a formatting complaint.

  it('prints the factor as the remit-to, so the money goes where it was sold', () => {
    expect(text).toContain('REMIT TO')
    expect(text).toContain('Triumph Financial Services')
    expect(text).toContain('payments@triumphpay.com')
  })

  it('and an authority with NO factor remits to its own address instead', () => {
    // THE PAIR. The block is never absent: a reader always knows where to send
    // the cheque, and "no factor" must not mean "no instruction".
    const unfactored = decode(
      renderInvoicePdf({
        ...input,
        remitTo: {
          name: 'RAM Haulage LLC',
          lines: ['1200 W Main St', 'Bolingbrook, IL, 60490', '(630) 716-3311'],
        },
      }),
    )
    expect(unfactored).toContain('REMIT TO')
    expect(unfactored).toContain('1200 W Main St')
    expect(unfactored).toContain('Bolingbrook, IL, 60490')
    // And it is NOT the factor's, which is the half that would go unnoticed.
    expect(unfactored).not.toContain('Triumph Financial Services')
  })

  it('keeps the remit-to distinct from the bill-to', () => {
    // Two addresses on one page, and confusing them sends an invoice to the
    // factor and a payment to the broker.
    expect(text).toContain('BILL TO')
    expect(text).toContain('TQL')
    expect(text.indexOf('BILL TO')).toBeLessThan(text.indexOf('REMIT TO'))
  })

  it('is byte-identical on a second render', () => {
    // "Regenerate it" has to be a safe thing to say — a factoring portal that
    // receives two different files for one invoice number asks why.
    expect(Array.from(renderInvoicePdf(input))).toEqual(Array.from(bytes))
  })

  it('escapes the characters that would break the file', () => {
    const risky = renderInvoicePdf({
      ...input,
      billTo: {
        name: `Smith (Holdings) ${String.fromCharCode(92)} Co`,
        address: null,
      },
    })
    // Built rather than typed: an unbalanced parenthesis ends a PDF string
    // early and corrupts every byte after it, so this is the one escape that
    // has to be exactly right — and a hand-typed expectation full of
    // backslashes is where a test starts asserting its own typo.
    const backslash = String.fromCharCode(92)
    expect(decode(risky)).toContain(
      `Smith ${backslash}(Holdings${backslash}) ${backslash}${backslash} Co`,
    )
  })

  it('replaces glyphs the base font cannot render, visibly', () => {
    // Helvetica is WinAnsi: no Cyrillic, no Farsi. A "?" is a bug somebody
    // reports; a silently dropped glyph is one nobody notices until the
    // payment is short. The screen carries the three locales, not this.
    const cyrillic = renderInvoicePdf({
      ...input,
      billTo: { name: 'Грузы', address: null },
    })
    expect(decode(cyrillic)).toContain('?????')
  })
})

describe('whose address the remit-to carries', () => {
  const company = {
    name: 'RAM Haulage LLC',
    addressLine1: '1200 W Main St',
    city: 'Bolingbrook',
    state: 'IL',
    postalCode: '60490',
    phone: '(630) 716-3311',
  }
  const triumph = {
    name: 'Triumph Financial Services',
    email: 'payments@triumphpay.com',
  }
  const otherFactor = { name: 'RTS Financial', email: 'ap@rtsfinancial.com' }

  it('an authority that factors remits to its factor, on EVERY invoice', () => {
    // Configured once, never entered per invoice — which is the whole ruling.
    const remit = remitToFor({ company, authorityFactor: triumph })
    expect(remit.name).toBe('Triumph Financial Services')
    expect(remit.lines).toContain('payments@triumphpay.com')
  })

  it('an authority with NO factor remits to its own address', () => {
    const remit = remitToFor({ company })
    expect(remit.name).toBe('RAM Haulage LLC')
    expect(remit.lines).toEqual([
      '1200 W Main St',
      'Bolingbrook, IL, 60490',
      '(630) 716-3311',
    ])
  })

  it('and the invoice’s OWN factor beats the authority default', () => {
    // An invoice already sold to one factor must never print another: the
    // broker pays whoever the block names, and the wrong name is a payment to
    // a company with no claim on it.
    const remit = remitToFor({
      company,
      invoiceFactor: otherFactor,
      authorityFactor: triumph,
    })
    expect(remit.name).toBe('RTS Financial')
    expect(remit.lines).not.toContain('payments@triumphpay.com')
  })

  it('never returns an empty block, even for a company with no address', () => {
    // "No factor" must not become "no instruction". A name alone is thin, and
    // it is still an answer to "who do I pay".
    const remit = remitToFor({ company: { name: 'Dolphins Transport Inc' } })
    expect(remit.name).toBe('Dolphins Transport Inc')
    expect(remit.lines).toEqual([])
  })
})
