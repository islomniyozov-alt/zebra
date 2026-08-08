// The rate confirmation both Phase 5 walkthroughs use.
//
// One definition, because two scripts asserting against two different
// documents would make "it read the broker" mean different things in each.
// TRUTH is what the PDF says, so every assertion is a comparison rather than
// an impression.

export function rateConFixture(TAG) {
  // --- the document -------------------------------------------------------------
  //
  // Everything on it is a value this script knows, so "did it read the document"
  // is a comparison rather than an impression.
  const TRUTH = {
    broker: 'Cascade Freight Partners',
    brokerReference: `CFP-${TAG}`,
    bol: `BOL-${TAG}-77`,
    commodity: 'Frozen blueberries',
    weightLbs: 41200,
    pallets: 22,
    tempF: -10,
    pickupCity: 'Salem',
    pickupState: 'OR',
    deliveryCity: 'Sacramento',
    deliveryState: 'CA',
    linehaul: '$2,450.00',
    fuel: '$387.50',
    detention: '$120.00',
    total: '$2,957.50',
  }

  const LINES = [
    ['F2', 16, `${TRUTH.broker}`],
    ['F1', 10, 'RATE CONFIRMATION'],
    ['F1', 10, `Load / Reference: ${TRUTH.brokerReference}`],
    ['F1', 10, `BOL: ${TRUTH.bol}`],
    ['F1', 10, ''],
    ['F2', 11, 'PICKUP'],
    ['F1', 10, 'Willamette Cold Storage'],
    ['F1', 10, '3120 Turner Road SE'],
    ['F1', 10, `${TRUTH.pickupCity}, ${TRUTH.pickupState} 97302`],
    ['F1', 10, 'Date: 08/14/2026   Time: 07:00'],
    ['F1', 10, 'PU Number: PU-99341'],
    ['F1', 10, ''],
    ['F2', 11, 'DELIVERY'],
    ['F1', 10, 'Golden State Distribution'],
    ['F1', 10, '8800 Elder Creek Road'],
    ['F1', 10, `${TRUTH.deliveryCity}, ${TRUTH.deliveryState} 95828`],
    ['F1', 10, 'Date: 08/15/2026   Time: 06:00 - 10:00'],
    ['F1', 10, 'DEL Number: DL-20551'],
    ['F1', 10, ''],
    ['F2', 11, 'FREIGHT'],
    ['F1', 10, `Commodity: ${TRUTH.commodity}`],
    ['F1', 10, `Weight: ${TRUTH.weightLbs} lbs      Pallets: ${TRUTH.pallets}`],
    ['F1', 10, `Equipment: 53' Reefer      Temp: ${TRUTH.tempF} F continuous`],
    ['F1', 10, 'Seal required at pickup. Driver must not break seal.'],
    ['F1', 10, ''],
    ['F2', 11, 'PAY'],
    ['F1', 10, `Line Haul                 ${TRUTH.linehaul}`],
    ['F1', 10, `Fuel Surcharge            ${TRUTH.fuel}`],
    ['F1', 10, `Detention (2 hrs)         ${TRUTH.detention}`],
    ['F2', 11, `TOTAL                     ${TRUTH.total}`],
  ]

  function buildPdf() {
    const escape = (value) => value.replace(/[\\()]/g, (c) => `\\${c}`)
    let content = 'BT\n1 0 0 1 56 736 Tm\n'
    let first = true
    for (const [font, size, text] of LINES) {
      content += `/${font} ${size} Tf\n`
      content += first ? '' : '0 -18 Td\n'
      content += `(${escape(text)}) Tj\n`
      first = false
    }
    content += 'ET'

    const encoder = new TextEncoder()
    const objects = [
      '<< /Type /Catalog /Pages 2 0 R >>',
      '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
      '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] ' +
        '/Resources << /Font << /F1 5 0 R /F2 6 0 R >> >> /Contents 4 0 R >>',
      `<< /Length ${encoder.encode(content).length} >>\nstream\n${content}\nendstream`,
      '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>',
      '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>',
    ]

    let pdf = '%PDF-1.4\n'
    const offsets = []
    for (const [index, object] of objects.entries()) {
      offsets.push(encoder.encode(pdf).length)
      pdf += `${index + 1} 0 obj\n${object}\nendobj\n`
    }
    const xrefOffset = encoder.encode(pdf).length
    pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`
    for (const offset of offsets) {
      pdf += `${String(offset).padStart(10, '0')} 00000 n \n`
    }
    pdf +=
      `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\n` +
      `startxref\n${xrefOffset}\n%%EOF\n`
    return encoder.encode(pdf)
  }

  return { TRUTH, bytes: buildPdf() }
}
