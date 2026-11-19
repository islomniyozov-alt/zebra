import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  ADD_AUTHORITY_VALUE,
  addAuthorityHref,
  opensTransfer,
  safeReturnPath,
  transferReturnHref,
} from '@/lib/return-path'

// "+ ADD AUTHORITY" AND THE WAY BACK (TMS v11.35 §6.4, owner 2026-11-19).

describe('the way back from Add authority', () => {
  it('returns only to a driver, truck or trailer record', () => {
    for (const path of [
      '/drivers/cmtrdchoc005o74vschjdbfkg',
      '/trucks/abc_1',
      '/trailers/t-9',
    ])
      expect(safeReturnPath(path)).toBe(path)
    for (const path of [
      'https://evil.example/drivers/x',
      '//evil.example/drivers/x',
      '/drivers/x?tab=main',
      '/drivers/x/../../settings',
      '/companies',
      '/drivers/',
      '',
      undefined,
      ['/drivers/x'],
    ])
      expect(safeReturnPath(path)).toBeNull()
  })

  it('goes to Admin → Authorities → new carrying the record, and comes back with the dialog open', () => {
    expect(addAuthorityHref('/trucks/abc')).toBe(
      '/companies/new?return=%2Ftrucks%2Fabc',
    )
    expect(addAuthorityHref('//evil.example')).toBe('/companies/new')
    expect(transferReturnHref('/trucks/abc')).toBe('/trucks/abc?transfer=1')
    expect(opensTransfer({ transfer: '1' })).toBe(true)
    expect(opensTransfer({ transfer: '0' })).toBe(false)
    expect(opensTransfer({})).toBe(false)
  })
})

describe('the dialog and its three pages', () => {
  const dialog = readFileSync(
    'src/app/(app)/_reference/AssetActions.tsx',
    'utf8',
  )

  it('ends the Move-to list with + Add authority, and leaves it there only for the role that may add one', () => {
    expect(dialog).toMatch(
      /value: ADD_AUTHORITY_VALUE, label: addAuthority\.label/,
    )
    expect(dialog).toMatch(/router\.push\(addAuthority\.href\)/)
    expect(ADD_AUTHORITY_VALUE).not.toMatch(/^c[a-z0-9]{20,}$/)
  })

  it('every record page offers it behind company:create and excludes the current authority', () => {
    for (const [file, kind] of [
      ['src/app/(app)/drivers/[id]/page.tsx', 'drivers'],
      ['src/app/(app)/trucks/[id]/page.tsx', 'trucks'],
      ['src/app/(app)/trailers/[id]/page.tsx', 'trailers'],
    ] as const) {
      const page = readFileSync(file, 'utf8')
      expect(page).toContain("currentUserCan('create', 'company')")
      expect(page).toContain(`addAuthorityHref(\`/${kind}/\${id}\`)`)
      expect(page).toMatch(/openTransfer=\{openTransfer\}/)
      expect(page).toMatch(
        /authorities\.filter\(\s*\(a\) => a\.value !== \w+\.companyId,?\s*\)/,
      )
    }
  })
})
