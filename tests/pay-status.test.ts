import { describe, expect, it } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import {
  SettlementBatchStatus,
  SettlementStatus,
} from '@/generated/prisma/enums'
import {
  BATCH_WORDS,
  STATEMENT_WORDS,
  batchWord,
  statementWord,
} from '@/lib/pay-status'
import { deriveBatchStatus, type StatementVote } from '@/lib/batch-status'
import { deletableBatch } from '@/lib/settlement-batch'
import { batchesFrom, batchRowsSql } from '@/lib/accounting-grids'
import { BATCH_COLUMN_KEYS, BATCH_COLUMNS_HIDDEN } from '@/lib/list-columns'
import { translator } from '@/lib/i18n'
import {
  PAYROLL_STRIP,
  payrollStrip,
  payrollStripHref,
} from '@/app/(app)/payroll/payroll-tabs'

// §6.2.10 part 7, step 1 (owner's brief and rulings 2026-11-17,
// DRIVER-PAY-BRIEF.md): the office's words from one function, Delete while
// Unposted, the Batches list's nine, Created by from the audit row, and one
// Payroll strip.

const en = translator('en')
const ru = translator('ru')
const read = (path: string) => readFileSync(path, 'utf8')

describe('the office words, from one function', () => {
  it('maps every statement status the schema has, as ruled', () => {
    const words = Object.values(SettlementStatus).map((status) =>
      en(STATEMENT_WORDS[status].label),
    )
    expect(Object.keys(STATEMENT_WORDS).sort()).toEqual(
      Object.values(SettlementStatus).sort(),
    )
    expect(Object.values(SettlementStatus)).toEqual([
      'DRAFT',
      'APPROVED',
      'PAID',
      'VOID',
    ])
    expect(words).toEqual(['Unposted', 'Posted', 'Paid', 'Void'])
  })

  it('maps every batch status the schema has, as ruled', () => {
    expect(Object.keys(BATCH_WORDS).sort()).toEqual(
      Object.values(SettlementBatchStatus).sort(),
    )
    expect(
      Object.values(SettlementBatchStatus).map((status) => [
        status,
        en(BATCH_WORDS[status].label),
      ]),
    ).toEqual([
      ['DRAFT', 'Unposted'],
      ['PARTIAL', 'Partial posted'],
      ['FINAL', 'Posted'],
      ['PAID', 'Paid'],
    ])
  })

  it('agrees with the derivation: the batch word is what its statements say', () => {
    // A batch's word follows from Islom's statement mapping through
    // `deriveBatchStatus`, unchanged: none posted → Unposted, some → Partial
    // posted, all → Posted, all paid → Paid.
    const cases: [StatementVote[], string][] = [
      [['DRAFT', 'DRAFT'], 'Unposted'],
      [['DRAFT', 'APPROVED'], 'Partial posted'],
      [['APPROVED', 'PAID'], 'Posted'],
      [['PAID', 'PAID', 'VOID'], 'Paid'],
      [['VOID'], 'Unposted'],
    ]
    for (const [votes, word] of cases) {
      expect(
        en(BATCH_WORDS[deriveBatchStatus(votes)].label),
        votes.join(),
      ).toBe(word)
    }
  })

  it('says each word in both locales, not English twice', () => {
    const labels = new Set([
      ...Object.values(STATEMENT_WORDS).map((word) => word.label),
      ...Object.values(BATCH_WORDS).map((word) => word.label),
    ])
    for (const label of labels) {
      expect(en(label), label).not.toBe(label)
      expect(ru(label), label).not.toBe(en(label))
    }
  })

  it('answers null for a value it does not know, rather than a wrong word', () => {
    expect(statementWord('FINAL')).toBeNull()
    expect(batchWord('APPROVED')).toBeNull()
    expect(statementWord('constructor')).toBeNull()
    expect(statementWord('APPROVED')?.label).toBe('payStatus.posted')
    expect(batchWord('PARTIAL')?.tone).toBe('warning')
  })

  it('leaves no screen on the old per-page label keys', () => {
    // Every payroll screen reads `pay-status.ts`; the two old key families
    // are gone from the dictionary, so a page still on them fails to compile —
    // and this says where, by name, before the compiler does.
    const files: string[] = []
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const path = join(dir, name)
        if (statSync(path).isDirectory()) walk(path)
        else if (/\.(ts|tsx)$/.test(name)) files.push(path)
      }
    }
    walk('src/app')
    walk('src/lib')
    const offenders = files.filter((file) =>
      /['`](batchStatus|settlementStatus)\./.test(read(file)),
    )
    expect(offenders).toEqual([])
  })

  it('the verbs follow: Post all unposted, and Post', () => {
    expect(en('batch.finalise')).toBe('Post all unposted')
    expect(en('batches.finaliseSelected')).toBe('Post all unposted')
    expect(en('workbench.post')).toBe('Post')
  })
})

describe('the Driver statements grid shows the statement’s own status', () => {
  it('reads the settlement row, not its batch', () => {
    const grids = read('src/lib/accounting-grids.ts')
    expect(grids).toMatch(/^\s*status: row\.status,$/m)
    expect(grids).not.toContain('status: row.batch?.status ?? row.status')
  })
})

describe('Delete, while Unposted (R6)', () => {
  it('allows only a batch whose statements are all draft or void', () => {
    expect(deletableBatch([])).toBe(true)
    expect(deletableBatch(['DRAFT', 'DRAFT'])).toBe(true)
    expect(deletableBatch(['DRAFT', 'VOID'])).toBe(true)
    expect(deletableBatch(['DRAFT', 'APPROVED'])).toBe(false)
    expect(deletableBatch(['PAID'])).toBe(false)
  })

  const source = read('src/lib/settlement-batch.ts')
  const body = source.slice(source.indexOf('export async function deleteBatch'))

  it('refuses by name before it writes anything', () => {
    const refusal = body.indexOf("reason: { kind: 'posted' }")
    expect(refusal).toBeGreaterThan(0)
    for (const write of ['deleteMany', 'settlementBatch.update']) {
      expect(body.indexOf(write), write).toBeGreaterThan(refusal)
    }
  })

  it('deletes only the drafts and soft-deletes the batch, keeping its number', () => {
    expect(body).toContain(
      "tx.settlement.deleteMany({ where: { batchId, status: 'DRAFT' } })",
    )
    expect(body).toContain(
      'tx.settlementBatchExclusion.deleteMany({ where: { batchId } })',
    )
    expect(body).toMatch(/data: \{ deletedAt: new Date\(\) \}/)
    expect(body).not.toMatch(/batchNumber:/)
    expect(body).not.toContain('settlementBatch.delete(')
  })

  it('is reached from the list through deleteBatch, with the delete permission', () => {
    const action = read('src/app/(app)/payroll/batches/bulk-actions.ts')
    expect(action).toContain('await deleteBatch(tx, id)')
    expect(action).toContain("delete: 'delete'")
    expect(action).toContain("posted: 'batch.error.posted'")
    const bar = read('src/app/(app)/payroll/batches/BulkStatus.tsx')
    expect(bar).toContain("batchBulkAction.bind(null, 'delete')")
    expect(bar).toMatch(/\{mayDelete \? \(/)
  })

  it('offers no control that sets a batch status by hand (R7)', () => {
    const action = read('src/app/(app)/payroll/batches/bulk-actions.ts')
    expect(action).not.toMatch(/status:\s*'(DRAFT|PARTIAL|FINAL|PAID)'/)
    expect(action).not.toContain('changeStatusAction')
  })
})

describe('the Batches list (R4, R5)', () => {
  it('shows Datatruck’s nine and hides gross, deductions and notes', () => {
    expect(BATCH_COLUMNS_HIDDEN).toEqual(['gross', 'deductions', 'notes'])
    const shown = BATCH_COLUMN_KEYS.filter(
      (key) => !(BATCH_COLUMNS_HIDDEN as readonly string[]).includes(key),
    )
    expect(shown).toEqual([
      'batchNumber',
      'status',
      'createdBy',
      'created',
      'checkDate',
      'period',
      'statements',
      'amount',
      'payCompany',
    ])
    const page = read('src/app/(app)/payroll/batches/page.tsx')
    expect(page).toContain("key: 'createdBy'")
  })

  it('reads Created by from the batch’s audit CREATE row, and the authority from the batch', () => {
    const sql = batchRowsSql().strings.join('?')
    expect(sql).toContain('FROM "AuditLog" a')
    expect(sql).toContain(`a."entityType" = 'SettlementBatch'`)
    expect(sql).toContain('a."entityId" = b."id"')
    expect(sql).toContain(`a."action" = 'CREATE'`)
    expect(sql).toContain('a."organizationId" = b."organizationId"')
    expect(sql).toMatch(
      /ORDER BY a\."createdAt", a\."id"\s+LIMIT 1\)\s+AS created_by/,
    )
    expect(sql).toContain('c."id" = b."companyId"')
  })

  it('carries both into the row, null staying null', () => {
    const base = {
      id: 'b1',
      batch_number: 'SB-000470',
      status: 'DRAFT',
      created_at: '2026-11-17T00:00:00.000Z',
      check_date: '2026-11-20T00:00:00.000Z',
      statement_date: '2026-11-17T00:00:00.000Z',
      period_start: '2026-11-08T00:00:00.000Z',
      period_end: '2026-11-14T00:00:00.000Z',
      notes: null,
      statements: 2,
      amount: 100,
      gross: 200,
      deductions: -50,
    }
    const [named, orgWide] = batchesFrom(
      [
        { ...base, created_by: 'Uktam Badalov', company_name: 'RAM Haulage' },
        { ...base, id: 'b2', created_by: null, company_name: null },
      ],
      [],
      {},
    )
    expect(named?.createdBy).toBe('Uktam Badalov')
    expect(named?.payCompanyName).toBe('RAM Haulage')
    expect(orgWide?.createdBy).toBeNull()
    expect(orgWide?.payCompanyName).toBeNull()
  })
})

describe('one Payroll strip (R10)', () => {
  const t = en

  it('is Batches · Driver statements · Balances · One-time charges', () => {
    expect(PAYROLL_STRIP).toEqual([
      'batches',
      'statements',
      'balances',
      'oneTime',
    ])
    expect(
      payrollStrip({ batches: true, pay: true, t }).map((tab) => tab.label),
    ).toEqual(['Batches', 'Driver statements', 'Balances', 'One-time charges'])
  })

  it('draws only what the role may read', () => {
    expect(
      payrollStrip({ batches: true, pay: false, t }).map((tab) => tab.key),
    ).toEqual(['batches'])
    expect(
      payrollStrip({ batches: false, pay: true, t }).map((tab) => tab.key),
    ).toEqual(['statements', 'balances', 'oneTime'])
  })

  it('points at the routes as they are, and lets a page keep its own params', () => {
    expect(payrollStripHref('statements')).toBe('/payroll/statements')
    expect(payrollStripHref('balances')).toBe('/payroll/batches?tab=balances')
    expect(payrollStripHref('oneTime')).toBe('/payroll/charges?tab=oneTime')
    expect(
      payrollStripHref('batches', { batches: '/payroll/batches?week=x' }),
    ).toBe('/payroll/batches?week=x')
  })

  it('is the strip both pages draw', () => {
    for (const page of ['batches', 'statements']) {
      expect(read(`src/app/(app)/payroll/${page}/page.tsx`), page).toContain(
        'payrollStrip({',
      )
    }
  })
})
