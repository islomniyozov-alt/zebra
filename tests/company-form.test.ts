import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  COMPANY_FORM_FIELDS,
  COMPANY_FORM_SELECT,
  companyFormValues,
  readCompanyForm,
  savedHref,
} from '@/lib/company-form'

// THE AUTHORITY FORM'S FIELDS (TMS §6.3 v11.41; owner's report 2026-11-21).
// After Look up and Save the edit form stayed open and nothing said whether
// it had saved. It had — dev's audit log holds the saves — but nothing held
// the form, the actions and the edit page to one list of fields, and nothing
// took the person back to the list. tests/integration/companies.test.ts saves
// and reloads every field; this file holds the three readers to the list.

const form = readFileSync('src/app/(app)/companies/AddCompanyForm.tsx', 'utf8')
const actions = readFileSync('src/app/(app)/companies/actions.ts', 'utf8')
const edit = readFileSync('src/app/(app)/companies/[id]/page.tsx', 'utf8')

describe('every field the authority form shows', () => {
  it('is in the one list, and the list is every field the form renders', () => {
    const rendered = [...form.matchAll(/\{\.\.\.field\('(\w+)'\)\}/g)].map(
      (match) => match[1],
    )
    expect([...rendered].sort()).toEqual([...COMPANY_FORM_FIELDS].sort())
  })

  it('is read by both actions through readCompanyForm, never by hand', () => {
    expect(actions).toContain(
      'addCompany(tx, session.organizationId, readCompanyForm(formData))',
    )
    expect(actions).toContain(
      'updateCompany(tx, id, readCompanyForm(formData))',
    )
    expect(actions).not.toMatch(/text\('mcNumber'\)/)
  })

  it('is read from what was posted, every one', () => {
    const posted = new FormData()
    for (const name of COMPANY_FORM_FIELDS) posted.set(name, `v-${name}`)
    const input = readCompanyForm(posted)
    expect(Object.keys(input).sort()).toEqual([...COMPANY_FORM_FIELDS].sort())
    for (const name of COMPANY_FORM_FIELDS)
      expect(input[name]).toBe(`v-${name}`)
  })

  it('is loaded back by the edit page from the stored authority', () => {
    expect(edit).toContain('initial={companyFormValues(company)}')
    expect(edit).toContain('...COMPANY_FORM_SELECT')
    expect(Object.keys(COMPANY_FORM_SELECT).sort()).toEqual(
      [...COMPANY_FORM_FIELDS].sort(),
    )
    const stored = Object.fromEntries(
      COMPANY_FORM_FIELDS.map((name) => [name, `s-${name}`]),
    ) as Parameters<typeof companyFormValues>[0]
    expect(companyFormValues({ ...stored, phone: null })).toMatchObject({
      mcNumber: 's-mcNumber',
      dotNumber: 's-dotNumber',
      phone: '',
    })
  })
})

describe('a saved edit', () => {
  it('lands on the authorities list, naming which one was saved', () => {
    expect(savedHref('co_1')).toBe('/companies?saved=co_1')
    // The update action ends in the redirect, not in returned state that
    // leaves the form open.
    const update = actions.slice(
      actions.indexOf('export async function updateCompanyAction'),
    )
    const body = update.slice(0, update.indexOf('\n}\n'))
    expect(body).toMatch(/redirect\(savedHref\(id\)\)\s*$/)
  })

  it('and the list says so for a row it holds', () => {
    const list = readFileSync('src/app/(app)/companies/page.tsx', 'utf8')
    expect(list).toContain('rows.find((row) => row.id === saved)')
    expect(list).toContain("t('companies.saved')")
  })
})
