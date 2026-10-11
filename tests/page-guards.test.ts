import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, sep } from 'node:path'
import { describe, expect, it } from 'vitest'

// ---------------------------------------------------------------------------
// A PAGE REFUSES BEFORE IT READS (TMS-DESIGN-SYSTEM.md §6.8, 2026-10-10).
//
// `withCurrentOrg` throws `ForbiddenError` for a role without the permission,
// and a throw during a render is a 500. The six-role sweep found that shape on
// fourteen pages at once — a settlement batch for a dispatcher, the dispatch
// board and the trailers for accounting, and thirteen pages for a driver —
// every one a page that read before asking. A role must be REFUSED, as a 404,
// and the only way a page can do that is to ask `currentUserCan` and call
// `notFound()` before its first `withCurrentOrg`.
//
// A SOURCE CHECK, AND IT SAYS SO. The sweep is the behavioural proof, and it
// needs a deployed worker and six sessions; this runs in `npm run check` and
// names the page, so the next page written without a guard fails here first.
// ---------------------------------------------------------------------------

function pages(dir: string): string[] {
  const out: string[] = []
  for (const name of readdirSync(dir)) {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) out.push(...pages(path))
    else if (name === 'page.tsx') out.push(path)
  }
  return out
}

const APP = join('src', 'app', '(app)')
const posix = (path: string) => relative('.', path).split(sep).join('/')

const readers = pages(APP).filter((path) =>
  readFileSync(path, 'utf8').includes('withCurrentOrg('),
)

describe('every page refuses before it reads', () => {
  it('finds the pages it is checking', () => {
    // A walk that found nothing would pass every case below.
    expect(readers.length).toBeGreaterThan(40)
  })

  it.each(readers.map(posix))('%s', (path) => {
    const source = readFileSync(path, 'utf8')
    const beforeFirstRead = source.slice(0, source.indexOf('withCurrentOrg('))
    expect(beforeFirstRead).toMatch(
      /currentUserCan\([^)]*\)\)\)\s*notFound\(\)/,
    )
  })
})

describe('the shell loads for a role with no organization read', () => {
  // THE DRIVER'S 500 ON EVERY PAGE: the layout read the density and the name
  // under `company:read`, which a driver does not hold. Both are the person's
  // own, so the name comes through the own-account handle and the density
  // read is asked for first.
  const layout = readFileSync(join(APP, 'layout.tsx'), 'utf8')

  it('reads the name through the own-account handle', () => {
    expect(layout).toMatch(/ownAccountDb\(\)\.user\.findUnique\(/)
  })

  it('asks before the density read, and falls back to the default', () => {
    expect(layout).toMatch(
      /\(await currentUserCan\('read', 'company'\)\)\s*\?\s*await withCurrentOrg\('read', 'company'/,
    )
    expect(layout).toMatch(/:\s*DEFAULT_DENSITY/)
  })
})
