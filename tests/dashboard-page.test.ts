import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { DASHBOARD_ORDER } from '@/lib/dashboard-page'
import { DASHBOARD_READS } from '@/lib/request-timing'

// ---------------------------------------------------------------------------
// THE DASHBOARD IS ONE TRANSACTION AND ONE STATEMENT PER CARD (§6.1.1 v10.95;
// owner's instruction 2026-11-13). The budget itself is an integration test
// on a real client; these pin the SHAPE by source, so the seven transactions
// cannot come back one `withCurrentOrg` at a time without a test saying so.
// ---------------------------------------------------------------------------

const page = readFileSync('src/app/(app)/dashboard/page.tsx', 'utf8')
const kpis = readFileSync('src/lib/dashboard-kpis.ts', 'utf8')
const compliance = readFileSync('src/lib/compliance.ts', 'utf8')
const dqf = readFileSync('src/lib/dqf.ts', 'utf8')
const counts = readFileSync('src/lib/dashboard-counts.ts', 'utf8')
const pageRead = readFileSync('src/lib/dashboard-page.ts', 'utf8')

describe('the page opens two transactions, money beside the six (v10.96)', () => {
  it('calls withCurrentOrg exactly twice, in parallel, one for readMoney and one for readCards', () => {
    const calls = page.match(/withCurrentOrg\(/g) ?? []
    expect(calls.length, 'withCurrentOrg( occurrences').toBe(2)
    expect(page).toContain(
      "import { readCards, readMoney } from '@/lib/dashboard-page'",
    )
    expect(page).toMatch(/readMoney\(tx, ctx, input\)/)
    expect(page).toMatch(/readCards\(tx, ctx, input\)/)
    expect(page.match(/Promise\.all\(\[/g)?.length).toBe(1)
    // THE OLD SHAPE, BY NAME: no card is read by the page itself any more.
    for (const gone of [
      'dashboardFor(',
      'actionQueue(',
      'panelFigures(',
      'topDriversByGross(',
      'dqfSplit(',
      'complianceHorizons(',
      'listedAuthorities(',
      'readDashboard(',
    ])
      expect(page, gone).not.toContain(gone)
  })

  it('keeps the seven spans under their names, six from the cards read and money from its own', () => {
    expect(page).toContain('...cards.spans,')
    expect(page).toContain('money: moneyRead.ms,')
    expect([...DASHBOARD_ORDER].sort()).toEqual([...DASHBOARD_READS].sort())
    // `readCards` skips the money card ITSELF and nothing else: the six run
    // with the role's real permissions (top drivers and the panels' cash
    // still ask may.money).
    expect(pageRead).toContain('cardsOnly: true,')
    expect(pageRead).toMatch(/may\.money && !input\.cardsOnly/)
    expect(pageRead).not.toContain('may: { ...input.may, money: false }')
  })
})

describe('one statement per card, by source', () => {
  it('the money card is one UNION ALL over one delivered CTE, with the first settled period in it', () => {
    const body = kpis.slice(kpis.indexOf('export async function moneyRows'))
    const statement = body.slice(
      0,
      body.indexOf('const weeks: WeekCompanyRow[]'),
    )
    for (const kind of [
      "'week'::text",
      "'customer'::text",
      "'day'::text",
      "'paystart'::text",
    ])
      expect(statement).toContain(kind)
    expect(statement.match(/UNION ALL/g)?.length).toBe(3)
    expect(statement.match(/WITH delivered AS/g)?.length).toBe(1)
    expect(statement).toContain('MIN(b."periodStart")')
    // `dashboardFor` reads it, and not the four it replaces.
    const assembler = kpis.slice(
      kpis.indexOf('export async function dashboardFor'),
    )
    expect(assembler).toContain('await moneyRows(tx, {')
    expect(assembler).not.toContain('weekCompanyRows(tx')
    expect(assembler).not.toContain('firstSettledPeriodStart(')
  })

  it('the compliance read spells all four actionable alternatives in SQL, with the horizon and the lead days inside the statement', () => {
    const body = compliance.slice(
      compliance.indexOf('export async function complianceOnce'),
    )
    const statement = body.slice(0, body.indexOf('const leadDays ='))
    expect(statement).toContain(`t."status" NOT IN ('OUT_OF_SERVICE', 'SOLD')`)
    expect(statement).toContain(`d."status" <> 'INACTIVE'`)
    expect(statement).toContain('OR ci."trailerId" IS NOT NULL')
    expect(statement).toContain(
      'OR (ci."truckId" IS NULL AND ci."driverId" IS NULL AND ci."trailerId" IS NULL)',
    )
    expect(statement).toContain('GREATEST(lead.days, ${panelDays}) + 1')
    expect(statement).toContain('MAX(o."expiresAt")')
    // One statement: no second read follows it, the empty case included.
    expect(body.slice(0, body.indexOf('return {'))).not.toContain(
      'await leadDaysFor(',
    )
    expect(body.slice(0, body.indexOf('return {'))).not.toContain(
      'complianceQueue(',
    )
    // And the Prisma predicate it mirrors still names the same four.
    expect(compliance).toContain(
      "{ truck: { status: { notIn: ['OUT_OF_SERVICE', 'SOLD'] } } }",
    )
    expect(compliance).toContain("{ driver: { status: { not: 'INACTIVE' } } }")
  })

  it('the DQF ring reads the roster with its facts in one statement, and isQualifiable stays the only rule', () => {
    const roster = dqf.slice(dqf.indexOf('export async function dqfRoster'))
    const statement = roster.slice(0, roster.indexOf('return rows.map'))
    expect(statement.match(/ARRAY\(/g)?.length).toBe(3)
    expect(statement).toContain('FROM "Driver" d')
    expect(statement).not.toMatch(/d\."status"\s*(<>|!=|NOT IN)/)
    expect(statement).not.toContain('"deletedAt" IS NULL\n      FROM "Driver"')
    const split = counts.slice(counts.indexOf('export async function dqfSplit'))
    expect(split).toContain('await dqfRoster(tx, companyIds)')
    expect(split).toContain('roster.filter((driver) => isQualifiable(driver))')
    expect(split).not.toContain('dqfFactsForDrivers(')
    expect(split).not.toContain('tx.driver.findMany(')
  })

  it('the one read runs the cards in sequence, the compliance table once for two cards, and the queue takes that count', () => {
    expect(pageRead).not.toContain('Promise.all')
    expect(pageRead.match(/complianceOnce\(tx/g)?.length).toBe(2)
    expect(pageRead).toContain('{ complianceCount: rowCompliance }')
    const queue = readFileSync('src/lib/dashboard.ts', 'utf8')
    expect(queue).toContain('options.complianceCount !== undefined')
  })
})
