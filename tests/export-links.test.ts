import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { routesUnder } from '../scripts/sweep.mjs'

// ---------------------------------------------------------------------------
// EVERY EXPORT PATH THE SOURCE WRITES IS A ROUTE THAT EXISTS (owner's report
// 2026-11-16). `GridToolbar` linked every accounting and payroll grid's Export
// CSV to `/accounting/export` for seven weeks after the handler moved to
// `/exports` (`d9544cb`, 2026-09-28) — a 404 on every click. The sweep now
// follows the rendered links on dev; this is the same question asked of the
// source, so a moved route fails `npm run check` before anything deploys.
// ---------------------------------------------------------------------------

/** Every path literal in `src/app` whose last segment is `export`/`exports`. */
function exportPathsIn(root: string): { file: string; path: string }[] {
  const out: { file: string; path: string }[] = []
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const at = join(dir, entry.name)
      if (entry.isDirectory()) walk(at)
      else if (/\.tsx?$/.test(entry.name))
        for (const match of readFileSync(at, 'utf8').matchAll(
          /[`'"](\/[a-z0-9/_-]*?\/?exports?)(?=[?`'"$])/g,
        ))
          out.push({ file: at.replace(/\\/g, '/'), path: match[1]! })
    }
  }
  walk(root)
  return out
}

describe('export links', () => {
  const routes = new Set(routesUnder('src/app'))
  const paths = exportPathsIn('src/app')

  it('finds the three the grids write — the toolbar, /loads and /trucks', () => {
    // Read from the source, not supplied: an extraction that found nothing
    // would pass the check below vacuously.
    expect(new Set(paths.map((p) => p.path))).toEqual(
      new Set(['/exports', '/loads/export', '/trucks/export']),
    )
  })

  it('and every one of them is a route', () => {
    expect(paths.filter((p) => !routes.has(p.path))).toEqual([])
  })
})
