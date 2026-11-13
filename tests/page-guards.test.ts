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

  // SINCE 2026-11-12 (GAPS 42 item 3, v10.93) BOTH COME FROM THE ONE READ:
  // the name beside the session's columns, the density through the function's
  // own predicate — no `company:read` question, no tenant transaction, so a
  // role without the permission is served the same way as every other.
  it('takes the name and the density from the one shell read, under no permission question', () => {
    expect(layout).toMatch(/const account = shell\.account/)
    expect(layout).toMatch(/const density: Density = shell\.density/)
    expect(layout).not.toMatch(/ownAccountDb/)
    expect(layout).not.toMatch(/currentUserCan\('read', 'company'\)/)
    expect(layout).not.toMatch(/readDensity/)
  })
})
