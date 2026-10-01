import { existsSync, readFileSync } from 'node:fs'
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
import {
  draftNumberFor,
  isPlaceholderNumber,
  statementTitle,
} from '@/lib/settlement-number'
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

describe('the trips grid cannot hand Table more than nine columns', () => {
  // §7.1 caps a table at nine and `Table` THROWS above it — the workbench
  // 500'd on its first render on dev with eleven. These are source checks for
  // the same reason `accounting-surface.test.ts` is: the claim is about what
  // the page hands a component, and the alternative is a browser.
  it('declares the cap as a number rather than a habit', () => {
    expect(page).toMatch(/\nconst MAX_VISIBLE_COLUMNS = 9\n/)
  })

  it('hides exactly Load ID and Unit by default', () => {
    expect(page).toMatch(/key !== 'load' && key !== 'unit'/)
  })

  it('slices, so a stale preference holding ten cannot reach Table', () => {
    // A preference row outlives every deploy (§7.1.4), so one written before
    // the cap existed can still arrive holding eleven.
    expect(page).toMatch(/\.slice\(0, MAX_VISIBLE_COLUMNS\)/)
  })

  it('passes the kept set to the table and not the whole list', () => {
    // Tolerant of prettier's wrap and no looser: the `columns=` prop must
    // be a `keepColumns` call over `tripColumns`, on one line or three.
    expect(page).toMatch(/columns=\{keepColumns\(\s*tripColumns,/)
  })

  it('offers the hidden two back through the chooser', () => {
    expect(page).toMatch(/<ColumnsChooser\b/)
    expect(page).toMatch(/grid="settlements\.trips"/)
  })
})

describe('the frozen tariff label carries its own direction', () => {
  it('is wrapped in dir="ltr"', () => {
    // §12. `payTariffLabel` is stored as the statement printed it — "3% from
    // gross" — and the bidi algorithm renders that as "from gross 3%" on the
    // Farsi screen. Caught in the RTL screenshot, not by a test, which is why
    // there is now a test.
    expect(page).toMatch(
      /<span dir="ltr">\{settlement\.payTariffLabel\}<\/span>/,
    )
  })
})

describe('a heading is a name, not a row id', () => {
  const period = {
    periodStart: new Date('2026-08-30T00:00:00.000Z'),
    periodEnd: new Date('2026-09-05T00:00:00.000Z'),
  }
  const draftTemplate = 'Draft — {driver} · {period}'

  it('is the settlement number once one has been issued', () => {
    expect(
      statementTitle({
        settlementNumber: 'ST-005562',
        driverName: 'Shuhrat Sharipov',
        draftTemplate,
        ...period,
      }),
    ).toBe('ST-005562')
  })

  it('describes the draft when the number is a placeholder', () => {
    expect(
      statementTitle({
        settlementNumber: 'DRAFT-g8hsz3mk-jcyy2u78',
        driverName: 'Chapan Odiljon',
        draftTemplate,
        ...period,
      }),
    ).toBe('Draft — Chapan Odiljon · 2026-08-30 – 2026-09-05')
  })

  it('never lets the id through', () => {
    const title = statementTitle({
      settlementNumber: 'DRAFT-g8hsz3mk-jcyy2u78',
      driverName: 'Chapan Odiljon',
      draftTemplate,
      ...period,
    })
    expect(title).not.toContain('DRAFT-')
    expect(title).not.toContain('g8hsz3mk')
  })

  it('leaves the older STL- series alone', () => {
    // The per-driver path predates batches and issues `STL-4`. It is a real
    // number and must not be mistaken for a placeholder.
    expect(
      statementTitle({
        settlementNumber: 'STL-4',
        driverName: 'X',
        draftTemplate,
        ...period,
      }),
    ).toBe('STL-4')
  })

  it('the page titles itself with the helper, not the raw column', () => {
    expect(page).toMatch(/title=\{title\}/)
    expect(page).toMatch(/\bstatementTitle\(\{/)
    expect(page).not.toMatch(/title=\{settlement\.settlementNumber\}/)
  })
})

describe('a placeholder is told apart by its prefix, in one place', () => {
  it('accepts only the two prefixes a statement is issued under', () => {
    expect(isPlaceholderNumber('ST-005562')).toBe(false)
    expect(isPlaceholderNumber('STL-4')).toBe(false)
    expect(isPlaceholderNumber(null)).toBe(false)
    expect(isPlaceholderNumber(undefined)).toBe(false)
  })

  it('treats every other shape as an id, including ones nobody predicted', () => {
    expect(isPlaceholderNumber('DRAFT-abc-def')).toBe(true)
    // FOUND BY AUDITING DEV, not by knowing: four drafts carry an epoch
    // timestamp and nothing in this repository or its history writes that
    // prefix. It is the reason the predicate is an allowlist.
    expect(isPlaceholderNumber('TMP-1788982650101')).toBe(true)
    expect(isPlaceholderNumber('cmuk2et0s0007qkvs')).toBe(true)
    // A BATCH number is not a statement number. `SB-000449` naming a
    // settlement would itself be the bug.
    expect(isPlaceholderNumber('SB-000449')).toBe(true)
  })

  it('builds one the predicate agrees with', () => {
    const built = draftNumberFor(
      'cmuga82ji0000qkvslwyibodv',
      'cmuk2et0s0007qkvs',
    )
    expect(isPlaceholderNumber(built)).toBe(true)
  })
})

describe('every path out of DRAFT mints a number', () => {
  // AN INVARIANT ENFORCED AT TWO OF THREE DOORS IS A HABIT. These are source
  // checks over the three functions that change a settlement's status, which
  // is the claim being made — that none of them can leave a non-draft holding
  // a placeholder.
  const settlementsLib = readFileSync(
    join(process.cwd(), 'src', 'lib', 'settlements.ts'),
    'utf8',
  )
  const batchLib = readFileSync(
    join(process.cwd(), 'src', 'lib', 'settlement-batch.ts'),
    'utf8',
  )

  it('approveSettlement mints', () => {
    const body = settlementsLib.slice(
      settlementsLib.indexOf('export async function approveSettlement'),
      settlementsLib.indexOf('export interface MarkPaidInput'),
    )
    expect(body).toMatch(/await ensureStatementNumber\(tx, settlement\)/)
  })

  it('markSettlementPaid mints, as a backstop for rows approved before', () => {
    const body = settlementsLib.slice(
      settlementsLib.indexOf('export async function markSettlementPaid'),
    )
    expect(body.slice(0, 2500)).toMatch(
      /await ensureStatementNumber\(tx, settlement\)/,
    )
  })

  it('markBatchPaid mints', () => {
    const body = batchLib.slice(
      batchLib.indexOf('export async function markBatchPaid'),
    )
    expect(body).toMatch(/await ensureStatementNumber\(tx, settlement\)/)
  })

  it('finaliseBatch already did, and still does', () => {
    expect(batchLib).toMatch(/const statementNumber = statementNumberOf\(/)
  })
})

describe('Export PDF points at the statement, not the retired stub', () => {
  it('links the Datatruck-layout route', () => {
    // Owner, 2026-09-30: "the statement PDF is a stub". It was — this button
    // linked a SECOND, older renderer while the batch detail page had been
    // linking the full one all along. One settlement, two documents.
    expect(page).toMatch(
      /href=\{`\/api\/settlements\/statement\/\$\{settlement\.id\}`\}/,
    )
  })

  it('never links the retired route again', () => {
    // ON THE href, NOT ON THE STRING. The first version of this guard matched
    // `/pdf\`` and failed against the COMMENT above the link, which quotes
    // the retired path in backticks to explain why it is retired. A negative
    // guard that fires on prose is a guard that gets deleted.
    expect(page).not.toMatch(/href=\{`\/api\/settlements\/\$\{[^}]+\}\/pdf`\}/)
  })

  it('is offered on every statement, with no condition on it', () => {
    // Owner's ruling, 2026-09-30, reversing the same day's "absent on a
    // draft". The route renders everything now, so the page states nothing
    // about when it can.
    //
    // THE TWO PREVIOUS VERSIONS OF THIS GUARD BOTH RESTATED A SERVER RULE IN
    // THE PAGE, and the second restated it WRONG — it tested the settlement's
    // status where the route tested the batch's, so a PAID statement in a
    // draft batch showed a button that answered 409, and this test passed
    // over it. The absence of a condition is the thing being asserted.
    expect(page).not.toMatch(/settlement\.batch\.status !== 'DRAFT'/)
    expect(page).not.toMatch(/settlement\.status !== 'DRAFT' \? \(\s*<a/)
  })

  it('and the route it used is gone from the tree', () => {
    expect(
      existsSync(
        join(
          process.cwd(),
          'src',
          'app',
          'api',
          'settlements',
          '[id]',
          'pdf',
          'route.ts',
        ),
      ),
    ).toBe(false)
  })
})

describe('the statement route refuses nothing', () => {
  const route = readFileSync(
    join(
      process.cwd(),
      'src',
      'app',
      'api',
      'settlements',
      'statement',
      '[id]',
      'route.ts',
    ),
    'utf8',
  )

  it('has no 409 left in it', () => {
    // Owner's ruling, 2026-09-30. The refusal is what the watermark replaced.
    //
    // ON THE CALL, NOT ON THE NUMBER. The first version matched `\b409\b` and
    // failed against the comments explaining why the refusal is gone — one of
    // which literally says "there is no 409 left in this file". Second time
    // this session a negative guard has fired on its own prose.
    expect(route).not.toMatch(/apiError\(\s*409/)
    expect(route).not.toMatch(/'draft' as const/)
  })

  it('stamps on the settlement own status, not the batch one', () => {
    // Owner's ruling, 2026-09-30, correcting the first version of this.
    //
    // The watermark is a claim about THIS DOCUMENT — "these figures may still
    // move". A settlement that has been approved or paid is finished whatever
    // its batch is still doing around it, and dev holds exactly that row:
    // ST-000001, PAID, inside SB-000004 which is still a draft. Keying on the
    // batch stamped DRAFT on a sheet for a cheque already paid.
    expect(route).toMatch(/const isDraft = settlement\.status === 'DRAFT'/)
    expect(route).not.toMatch(/settlement\.batch\.status === 'DRAFT'/)
    expect(route).toMatch(/draft: isDraft,/)
  })

  it('prints the broker reference in the Load number column, FROZEN', () => {
    // ST-005562 lists Amazon's references. This guard used to assert the LIVE
    // read and a comment that called it a flagged compromise; migration 61
    // froze the column, so the frozen value comes FIRST.
    //
    // THE RELATION IS STILL READ, and the guard still says so: every line
    // written before 2026-10-01 has a null `referenceNumber` and no frozen
    // value to recover, so those fall through to the load. Dropping the
    // fallback would blank the Load number column on every statement in the
    // archive.
    expect(route).toMatch(/load: \{ select: \{ referenceNumber: true \} \}/)
    expect(route).toMatch(
      /referenceNumber:\s*line\.referenceNumber \?\? line\.load\?\.referenceNumber \?\? null/,
    )
  })

  it('blanks a placeholder number instead of printing it', () => {
    // §8 on paper: the placeholder is two row ids, and the heading rule keeps
    // that string off the screen.
    expect(route).toMatch(
      /isPlaceholderNumber\(settlement\.settlementNumber\)\s*\?\s*''/,
    )
  })

  it('survives a settlement with no batch at all', () => {
    // Six on dev. Every batch-derived field needs a fallback or the route
    // throws instead of rendering.
    expect(route).toMatch(/settlement\.batch\?\.batchNumber \?\? ''/)
    expect(route).toMatch(/settlement\.batch\?\.statementDate \?\?/)
    expect(route).toMatch(/settlement\.batch\?\.checkDate \?\?/)
  })
})

describe('the Trip column follows the paper', () => {
  it('leads with the broker reference, falling back to Zebra number', () => {
    // §6.2.2 v10.6. The statement PDF leads with the reference because the
    // artefact does; a grid leading with DT-016018 beside a sheet leading
    // with 116RX75DK would make the two look like different weeks.
    //
    // `||` AND NOT `??`, so an empty-string reference falls back too rather
    // than rendering an empty first cell — which is the row's accessible
    // name (§7.1).
    //
    // THREE TERMS SINCE MIGRATION 61: the frozen column, then the live
    // relation for rows written before it existed, then Zebra's own number.
    // The order is the whole point — frozen first, or an issued statement
    // still drifts.
    expect(page).toMatch(
      /\{row\.referenceNumber \|\| row\.load\?\.referenceNumber \|\| row\.loadNumber\}/,
    )
  })

  it('keeps Zebra own number as a column behind the chooser', () => {
    expect(page).toMatch(/key: 'load',/)
    expect(page).toMatch(/key !== 'load' && key !== 'unit'/)
  })
})

describe('Add trips is present whenever the statement can be edited', () => {
  it('is not gated on there being trips to add', () => {
    // It used to read `mayAdd && addable.length > 0`, so a week with nothing
    // outstanding looked like a week where trips could not be added at all —
    // a control restating a condition instead of answering it.
    expect(page).not.toMatch(/mayAdd && addable\.length > 0/)
  })

  it('answers the empty case with an empty state, not an absence', () => {
    expect(page).toMatch(/addable\.length === 0 \? \(/)
    expect(page).toMatch(/workbench\.noAddableTrips/)
    expect(page).toMatch(/workbench\.noAddableTripsHint/)
  })
})
