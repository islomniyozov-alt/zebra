import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  chargeTotalCents,
  chargeSnapshot,
  isValidQuantity,
  readCharge,
  MAX_QUANTITY,
} from '@/lib/settlement-charge'
import { readSnapshot } from '@/lib/driver-pay'
import { parseFuelCsv, REQUIRED_COLUMNS } from '@/lib/fuel-import'
import { statementMessage, sendStatementToDriver } from '@/lib/statement-send'

// ---------------------------------------------------------------------------
// THE SETTLEMENT WORKBENCH (TMS-DESIGN-SYSTEM §6.2.2 and §6.2.3).
//
// Three kinds of case here, and they are different instruments:
//
//   1. PURE FUNCTIONS, tested by calling them. The arithmetic behind the
//      add-row, the two snapshot readers, the importer's refusal.
//   2. THE SEND GUARD, tested by calling it with an injected environment —
//      the one action on the page that leaves the building.
//   3. SOURCE CHECKS, for the promises that are about what a screen OFFERS
//      rather than what a function returns. Same instrument as
//      `accounting-surface.test.ts` and the same reason.
//
// Every source check is anchored — `\n` and word boundaries — because this
// project has three times been caught by a substring guard that a longer name
// satisfied (`xtotals={{` passing a check for `totals={{`).
// ---------------------------------------------------------------------------

const WORKBENCH = join(
  process.cwd(),
  'src',
  'app',
  '(app)',
  'settlements',
  '[id]',
)
const page = readFileSync(join(WORKBENCH, 'page.tsx'), 'utf8')
const chargeGrid = readFileSync(join(WORKBENCH, 'ChargeGrid.tsx'), 'utf8')
const design = readFileSync(join(process.cwd(), 'TMS-DESIGN-SYSTEM.md'), 'utf8')

describe('the add-row total is arithmetic, not a field', () => {
  it('multiplies the rate by the quantity', () => {
    expect(chargeTotalCents(5000, 1)).toBe(5000)
    expect(chargeTotalCents(5000, 3)).toBe(15_000)
    expect(chargeTotalCents(1, 10_000)).toBe(10_000)
  })

  it('is never offered as an input on the screen', () => {
    // §6.2.2: "the total is computed and never typed". A disabled input still
    // looks like somewhere to type, so neither spelling is allowed.
    expect(chargeGrid).not.toMatch(/name="total"/)
    expect(chargeGrid).not.toMatch(/name="totalCents"/)
  })

  it('previews with the same function the server writes with', () => {
    // A preview that multiplied separately would eventually disagree with the
    // write, and the one place it would show is a statement.
    expect(chargeGrid).toMatch(/\bchargeTotalCents\(/)
    expect(chargeGrid).toMatch(/from '@\/lib\/settlement-charge'/)
  })
})

describe('quantity is a whole number of things', () => {
  it('takes 1 through the cap', () => {
    expect(isValidQuantity(1)).toBe(true)
    expect(isValidQuantity(MAX_QUANTITY)).toBe(true)
  })

  it('refuses zero, negatives, fractions and the cap plus one', () => {
    // FRACTIONS ARE REFUSED RATHER THAN ROUNDED: the real mistake is a rate
    // typed into the quantity box (`$1 × 49.27` for a fuel line), which
    // produces a plausible total from two wrong factors.
    for (const bad of [0, -1, 2.5, 49.27, MAX_QUANTITY + 1, NaN, Infinity]) {
      expect(isValidQuantity(bad)).toBe(false)
    }
  })
})

describe('the two snapshot readers cannot read each other', () => {
  const charge = chargeSnapshot(5000, 3)
  const payRule = {
    ruleId: 'rule_1',
    type: 'PERCENT_GROSS',
    basis: 100_000,
    amountCents: 30_000,
    percentBps: 3000,
  }

  it('readCharge returns null for a pay-rule snapshot', () => {
    expect(readCharge(payRule)).toBeNull()
  })

  it('requires the kind, not merely the right-shaped fields', () => {
    // WITHOUT THIS THE `kind` CHECK IS UNTESTED. Watched failing on
    // 2026-09-29: deleting the kind comparison left every case above still
    // passing, because the pay-rule fixture has no rateCents to be confused
    // by. A third Json shape carrying a rate and a quantity is exactly what
    // `kind` is there to keep out, so the case has to supply one.
    expect(readCharge({ rateCents: 5000, quantity: 3 })).toBeNull()
    expect(
      readCharge({ kind: 'somethingElse', rateCents: 5000, quantity: 3 }),
    ).toBeNull()
  })

  it('readSnapshot returns null for a charge snapshot', () => {
    // The disjointness §6.2.2 claims is by CONSTRUCTION, not by agreement —
    // this is the assertion that keeps it that way.
    expect(readSnapshot(charge)).toBeNull()
  })

  it('reads its own back', () => {
    expect(readCharge(charge)).toEqual({
      kind: 'manualCharge',
      rateCents: 5000,
      quantity: 3,
    })
  })

  it('rejects a snapshot carrying an impossible quantity', () => {
    expect(
      readCharge({ kind: 'manualCharge', rateCents: 5000, quantity: 0 }),
    ).toBeNull()
    expect(readCharge({ kind: 'manualCharge', rateCents: 5000 })).toBeNull()
    expect(readCharge(null)).toBeNull()
    expect(readCharge([1, 2])).toBeNull()
  })
})

describe('the fuel importer refuses rather than guesses', () => {
  it('names every required column it could not map', () => {
    const result = parseFuelCsv(
      'Date,Card,Gallons,Amount\n2026-09-26,1234,49.27,339.92\n',
    )
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.missing).toEqual([...REQUIRED_COLUMNS])
  })

  it('says the mapping was never configured, not that the file is wrong', () => {
    // Two different sentences for two different problems. Telling somebody to
    // fix their export when no spelling has ever been recorded sends them
    // looking in the one place the problem is not.
    const result = parseFuelCsv('Date,Card\n2026-09-26,1234\n')
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.reason).toBe('no_mapping_configured')
    expect(result.headers).toEqual(['Date', 'Card'])
  })

  it('reports an empty file as empty', () => {
    const result = parseFuelCsv('   \n\n')
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.reason).toBe('empty_file')
  })
})

describe('the statement email says the same thing in both parts', () => {
  const message = statementMessage({
    to: 'driver@example.com',
    settlementNumber: 'ST-005562',
    periodStart: new Date('2026-09-20T00:00:00.000Z'),
    periodEnd: new Date('2026-09-26T00:00:00.000Z'),
    netCents: 376_637,
    url: 'https://zebra.example/settlements/abc',
    locale: 'en-US',
    labels: {
      subject: 'Settlement {number}',
      greeting: 'Hello,',
      body: 'Your settlement {number} for {from} to {to} is ready. Net pay: {net}.',
      link: 'View the statement',
    },
  })

  it('fills the placeholders', () => {
    expect(message.subject).toBe('Settlement ST-005562')
    expect(message.text).toContain('2026-09-20')
    expect(message.text).toContain('2026-09-26')
  })

  it('carries the same net in the text part and the HTML part', () => {
    // A client that renders only one of the two must not show a different
    // number from the one that renders the other.
    const net = '$3,766.37'
    expect(message.text).toContain(net)
    expect(message.html).toContain(net)
  })

  it('escapes the link rather than interpolating it raw', () => {
    const attack = statementMessage({
      to: 'd@example.com',
      settlementNumber: 'ST-1',
      periodStart: new Date('2026-09-20T00:00:00.000Z'),
      periodEnd: new Date('2026-09-26T00:00:00.000Z'),
      netCents: 0,
      url: 'https://x/"><script>',
      locale: 'en-US',
      labels: { subject: 's', greeting: 'g', body: 'b', link: 'l' },
    })
    expect(attack.html).not.toContain('<script>')
  })
})

describe('the header box carries every field §6.2.2 lists', () => {
  // COUNTED AGAINST THE DOCUMENT, not against a list retyped here — the same
  // instrument the tab lists use. A field added to the section and not to the
  // page fails by name.
  const FIELDS: [string, RegExp][] = [
    ['settlement number', /workbench\.settlement/],
    ['driver', /settlements\.driver/],
    ['period', /settlements\.period/],
    ['driver type', /workbench\.driverType/],
    ['payment tariff', /settlements\.tariff/],
    ['total pay', /workbench\.totalPay/],
    ['earnings', /workbench\.earnings/],
    ['other pay / reimbursements', /workbench\.otherPayReimbursements/],
    ['deductions / advances', /workbench\.deductionsAdvances/],
    ['trips count', /workbench\.tripsCount/],
    ['net pay', /settlements\.net/],
    ['balances', /workbench\.balances/],
    ['fuel & toll expenses', /workbench\.fuelTolls/],
    ['attachments', /workbench\.attachments/],
  ]

  for (const [name, pattern] of FIELDS) {
    it(`renders ${name}`, () => {
      expect(page).toMatch(pattern)
    })
  }

  it('offers all six actions from the action row', () => {
    for (const action of [
      /\bAddTrips\b/,
      /\bChargeGrid\b/,
      /\bRecalculate\b/,
      /\bSendToDriver\b/,
      /workbench\.post/,
      /workbench\.exportPdf/,
    ]) {
      expect(page).toMatch(action)
    }
  })

  it('steps the settlement and the period separately', () => {
    // Two journeys: one walks the batch, the other walks the driver. A single
    // pair of chevrons would silently be one of them.
    expect(page).toMatch(/prevInBatch/)
    expect(page).toMatch(/nextInBatch/)
    expect(page).toMatch(/prevPeriod/)
    expect(page).toMatch(/nextPeriod/)
  })
})

describe('the mileage column does not claim to be loaded miles', () => {
  it('labels the frozen figure as the total', () => {
    // §6.2.2 as corrected in v10.1: the snapshot freezes ONE mileage, the one
    // the PDF prints. Labelling it "loaded" makes the screen disagree with the
    // paper by the deadhead, which is the argument the freeze exists to
    // settle. The second column is the held migration.
    expect(page).toMatch(/workbench\.totalMiles/)
    expect(page).not.toMatch(/workbench\.loadedMiles/)
  })

  it('and the design system still says so', () => {
    expect(design).toMatch(/must\s*\n?\s*not label the frozen total/)
  })
})

describe('fuel and tolls is a read, not a charge', () => {
  it('the page never writes a fuel or toll row', () => {
    // §6.2.3. The deduct side is the held migration; until it lands, this page
    // reports and stops.
    expect(page).not.toMatch(/fuelTransaction\.(create|update|delete)/)
    expect(page).not.toMatch(/\bisDriverDeduction:\s*true/)
  })

  it('says what the figure means beside it', () => {
    // Without the gloss a reader cannot tell a company-fuel driver from one
    // about to be charged the whole of it.
    expect(page).toMatch(/workbench\.burned/)
  })
})

describe('send to driver refuses before it reaches a real person', () => {
  // A FAKE TRANSACTION, because the decision under test is not a query. The
  // four refusals are about status, environment and address, and standing up
  // a database to assert them would test the seed rather than the rule.
  const settlementRow = {
    id: 'stl_1',
    settlementNumber: 'ST-005562',
    status: 'APPROVED' as const,
    periodStart: new Date('2026-09-20T00:00:00.000Z'),
    periodEnd: new Date('2026-09-26T00:00:00.000Z'),
    netCents: 376_637,
    driver: { email: 'shuhrat@example.com' },
  }
  const txWith = (row: unknown) =>
    ({ settlement: { findFirst: async () => row } }) as never

  const labels = { subject: 's', greeting: 'g', body: 'b', link: 'l' }
  const base = {
    origin: 'https://zebra.example',
    locale: 'en-US',
    labels,
  }

  it('will not send from dev, even with a perfectly good address', () => {
    // THE ONE THIS EXISTS FOR. Dev is forked from production and the replays
    // carry the real people across with their real addresses; a screenshot
    // pass over this page is exactly the session that would reach one.
    let attempts = 0
    const send = async () => {
      attempts++
      return { ok: true as const, id: 'x' }
    }
    return sendStatementToDriver(txWith(settlementRow), 'stl_1', {
      ...base,
      env: { NEON_BRANCH: 'dev' },
      send,
    }).then((result) => {
      expect(result).toEqual({ ok: false, reason: 'not_production' })
      expect(attempts).toBe(0)
    })
  })

  it('will not send with no branch set at all', async () => {
    // FAILS CLOSED. An unset variable is a deployment nobody has told, and
    // the safe reading of "I do not know whose rows these are" is not to mail
    // them to anybody.
    const result = await sendStatementToDriver(txWith(settlementRow), 'stl_1', {
      ...base,
      env: {},
      send: async () => ({ ok: true as const, id: 'x' }),
    })
    expect(result).toEqual({ ok: false, reason: 'not_production' })
  })

  it('refuses a draft before it looks at the environment', async () => {
    const result = await sendStatementToDriver(
      txWith({ ...settlementRow, status: 'DRAFT' }),
      'stl_1',
      {
        ...base,
        env: { NEON_BRANCH: 'production' },
        send: async () => ({ ok: true as const, id: 'x' }),
      },
    )
    expect(result).toEqual({ ok: false, reason: 'not_final' })
  })

  it('refuses a void statement', async () => {
    const result = await sendStatementToDriver(
      txWith({ ...settlementRow, status: 'VOID' }),
      'stl_1',
      {
        ...base,
        env: { NEON_BRANCH: 'production' },
        send: async () => ({ ok: true as const, id: 'x' }),
      },
    )
    expect(result).toEqual({ ok: false, reason: 'voided' })
  })

  it('names a missing address rather than failing vaguely', async () => {
    const result = await sendStatementToDriver(
      txWith({ ...settlementRow, driver: { email: '  ' } }),
      'stl_1',
      {
        ...base,
        env: { NEON_BRANCH: 'production' },
        send: async () => ({ ok: true as const, id: 'x' }),
      },
    )
    expect(result).toEqual({ ok: false, reason: 'no_email' })
  })

  it('sends from production, and says who it reached', async () => {
    const sent: string[] = []
    const result = await sendStatementToDriver(txWith(settlementRow), 'stl_1', {
      ...base,
      env: { NEON_BRANCH: 'production' },
      send: async (message) => {
        sent.push(message.to)
        return { ok: true as const, id: 'msg_1' }
      },
    })
    expect(result).toEqual({ ok: true, to: 'shuhrat@example.com' })
    expect(sent).toEqual(['shuhrat@example.com'])
  })

  it('carries the transport own refusal through by name', async () => {
    const result = await sendStatementToDriver(txWith(settlementRow), 'stl_1', {
      ...base,
      env: { NEON_BRANCH: 'production' },
      send: async () => ({ ok: false as const, reason: 'rejected' as const }),
    })
    expect(result).toEqual({ ok: false, reason: 'rejected' })
  })
})
