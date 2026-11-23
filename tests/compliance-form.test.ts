import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { COMPLIANCE_FORM_FIELDS, readRenewalForm } from '@/lib/compliance-form'

// ---------------------------------------------------------------------------
// §0 RULE 14 (v11.45) — THE COMPLIANCE PANEL KEEPS WHAT WAS TYPED.
//
// Reproduced on dev 2026-11-23 with Annual-DOT-Inspection-02.18.26.jpg: on
// truck 4974 an expiry typed `2/18/2027` answered "Enter the expiry date." and
// the save cleared every field. These are the office's own keystrokes from
// that photo.
// ---------------------------------------------------------------------------

const TODAY = new Date(Date.UTC(2026, 10, 23))

function form(values: Record<string, string>) {
  const data = new FormData()
  for (const [key, value] of Object.entries(values)) data.set(key, value)
  return data
}

const FROM_THE_PHOTO = {
  type: 'ANNUAL_INSPECTION',
  expiresAt: '2/18/2027',
  issuedAt: '2/18/2026',
  identifier: '160526036',
  issuer: 'Inspector N',
  notes: 'unit 4974',
}

describe('the office types the inspection from the photo', () => {
  it('saves 2/18/2027 — the entry dev refused', () => {
    const read = readRenewalForm(form(FROM_THE_PHOTO), TODAY)
    expect(read.ok).toBe(true)
    if (!read.ok) return
    expect(read.fields.expiresAt.toISOString()).toBe('2027-02-18T00:00:00.000Z')
    expect(read.fields.issuedAt?.toISOString()).toBe('2026-02-18T00:00:00.000Z')
    expect(read.fields.identifier).toBe('160526036')
    expect(read.fields.issuer).toBe('Inspector N')
    expect(read.fields.notes).toBe('unit 4974')
    expect(read.fields.type).toBe('ANNUAL_INSPECTION')
  })
})

describe('a refusal keeps every typed value and names its field', () => {
  it('a blank expiry says enter it, and hands back the rest', () => {
    const read = readRenewalForm(
      form({ ...FROM_THE_PHOTO, expiresAt: '' }),
      TODAY,
    )
    expect(read).toMatchObject({
      ok: false,
      error: 'compliancePanel.error.noExpiry',
    })
    expect(read.values).toEqual({ ...FROM_THE_PHOTO, expiresAt: '' })
  })

  it('an expiry that is not a date says so — never "enter the expiry date"', () => {
    const read = readRenewalForm(
      form({ ...FROM_THE_PHOTO, expiresAt: 'Feb 18' }),
      TODAY,
    )
    expect(read).toMatchObject({
      ok: false,
      error: 'compliancePanel.error.expiryNotDate',
    })
    expect(read.values.expiresAt).toBe('Feb 18')
    expect(read.values.identifier).toBe('160526036')
  })

  it('an issue date that is not a date names the issue date, not the order of the two', () => {
    // Before: `badDates`, "The issue date cannot be after the expiry."
    const read = readRenewalForm(
      form({ ...FROM_THE_PHOTO, issuedAt: '18.02.2026' }),
      TODAY,
    )
    expect(read).toMatchObject({
      ok: false,
      error: 'compliancePanel.error.issuedNotDate',
    })
    expect(read.values.issuedAt).toBe('18.02.2026')
  })

  it('hands back every field the panel shows', () => {
    const read = readRenewalForm(
      form({ ...FROM_THE_PHOTO, expiresAt: '' }),
      TODAY,
    )
    expect(Object.keys(read.values).sort()).toEqual(
      [...COMPLIANCE_FORM_FIELDS].sort(),
    )
  })
})

describe('the panel renders what it is handed back', () => {
  const panel = readFileSync(
    join('src', 'app', '(app)', '_reference', 'CompliancePanel.tsx'),
    'utf8',
  )
  const view = readFileSync(
    join('src', 'app', '(app)', '_reference', 'compliance-view.ts'),
    'utf8',
  )

  it('every form field takes its default from the typed values', () => {
    for (const field of COMPLIANCE_FORM_FIELDS) {
      expect(panel).toMatch(new RegExp(`defaultValue=\\{typed\\?\\.${field}`))
    }
  })

  it('every refusal the reader can give is translated on the panel', () => {
    const lib = readFileSync(join('src', 'lib', 'compliance-form.ts'), 'utf8')
    const keys = [
      ...lib.matchAll(/'(compliancePanel\.error\.[A-Za-z]+)'/g),
    ].map((m) => m[1]!)
    expect(keys.length).toBeGreaterThanOrEqual(3)
    for (const key of keys) expect(view).toContain(`'${key}'`)
  })
})

describe('a manual save depends on no reader', () => {
  it('the action and the form reader import nothing that reads a document', () => {
    // Rule 14 (a): a reader proposes, never gates. If either file ever reaches
    // for a reader, a failed reading could stop a hand-typed save.
    for (const file of [
      join('src', 'app', '(app)', '_reference', 'compliance-actions.ts'),
      join('src', 'lib', 'compliance-form.ts'),
    ]) {
      const source = readFileSync(file, 'utf8')
      expect(source).not.toMatch(
        /from '@\/lib\/(claude|classify|med-cert|coi|extraction)/,
      )
      expect(source).not.toMatch(/fetch\(/)
    }
  })
})
