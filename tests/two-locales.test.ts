import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { LOCALES, isLocale, translator } from '@/lib/i18n'

// ---------------------------------------------------------------------------
// TWO LOCALES, EN AND RU (TMS-DESIGN-SYSTEM.md §12 v11.29). Farsi removed
// 2026-11-17 by the owner; Afghan drivers use Russian.
//
// What went: the `fa` dictionary, the `fa` locale, the right-to-left layout
// (`<html dir>`, the `rtl:` variants, the reset email's `dir`). This holds all
// of it from the source, so a locale or a mirrored variant cannot come back by
// a paste. What stays, by the amendment: logical properties (rule 6) and
// identifiers' `dir="ltr"`, so neither is asserted against here.
// ---------------------------------------------------------------------------

/** Every .ts / .tsx / .css under `dir`, generated clients excluded. */
function sources(dir: string): string[] {
  const out: string[] = []
  for (const name of readdirSync(dir)) {
    const path = join(dir, name)
    if (path.replace(/\\/g, '/').startsWith('src/generated')) continue
    if (statSync(path).isDirectory()) out.push(...sources(path))
    else if (/\.(tsx?|css)$/.test(name)) out.push(path)
  }
  return out
}

// Arabic script and its presentation forms. U+FEFF (the byte-order mark, which
// CSV writers use on purpose) sits at the end of that block and is left out.
const ARABIC_SCRIPT = /[\u0600-\u06FF\uFB50-\uFDFF\uFE70-\uFEFC]/

describe('the application has two locales', () => {
  it('EN and RU, and fa is not a locale', () => {
    expect([...LOCALES]).toEqual(['en', 'ru'])
    expect(isLocale('fa')).toBe(false)
  })

  it('Russian is a real dictionary, not English twice', () => {
    expect(translator('ru')('nav.group.loads')).not.toBe(
      translator('en')('nav.group.loads'),
    )
  })

  const files = sources('src')

  it('reads the source it claims to', () => {
    // An empty walk would pass every assertion below.
    expect(files.length).toBeGreaterThan(200)
    expect(files.map((f) => f.replace(/\\/g, '/'))).toContain('src/lib/i18n.ts')
  })

  it('no source carries Farsi text', () => {
    const carrying = files.filter((file) =>
      ARABIC_SCRIPT.test(readFileSync(file, 'utf8')),
    )
    expect(carrying).toEqual([])
  })

  it('no right-to-left variant or direction plumbing', () => {
    const found = files.flatMap((file) => {
      const text = readFileSync(file, 'utf8')
      return [
        /\brtl:/.test(text) ? `${file}: rtl: variant` : null,
        /directionOf/.test(text) ? `${file}: directionOf` : null,
        /dir=\{dir\}/.test(text) ? `${file}: dir={dir}` : null,
        /'rtl'/.test(text) ? `${file}: 'rtl'` : null,
      ].filter((line): line is string => line !== null)
    })
    expect(found).toEqual([])
  })

  it('the error page carries no third language', () => {
    const page = readFileSync('src/app/error.tsx', 'utf8')
    expect(page).not.toMatch(/^\s*fa: \{/m)
    expect(page).not.toMatch(/value === 'fa'/)
  })
})
