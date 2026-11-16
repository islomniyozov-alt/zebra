import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  SHELL_PAGES,
  SHELL_VIEWPORTS,
  shellFindings,
} from '../scripts/shell-height.mjs'

// ---------------------------------------------------------------------------
// THE SHELL FILLS THE WINDOW (owner's report 2026-11-16, dev /dashboard at
// 1886×961). The cause was a chart's screen-reader table carrying `sr-only`
// itself: a table grows past `height: 1px` and ignores `overflow: hidden`, so
// 1,760 px of rows hung off the page and the document scrolled under the
// shell. `scripts/shell-height.mjs` renders the chart pages and the sweep runs
// it on every deploy; these hold its arithmetic, its page list and the cause.
// ---------------------------------------------------------------------------

/** Every .tsx under `dir`, recursively. */
function tsxUnder(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const at = join(dir, entry.name)
    if (entry.isDirectory()) return tsxUnder(at)
    return entry.name.endsWith('.tsx') ? [at] : []
  })
}

const row = (overrides: Record<string, unknown> = {}) => ({
  path: '/dashboard',
  width: 1886,
  height: 961,
  status: 200,
  shellTop: 0,
  shellHeight: 961,
  documentHeight: 961,
  ...overrides,
})

describe('the shell check', () => {
  it('measures at the report’s window and a laptop’s', () => {
    expect(SHELL_VIEWPORTS).toEqual([
      { width: 1886, height: 961 },
      { width: 1366, height: 768 },
    ])
  })

  it('passes a shell one window tall on a page that does not scroll', () => {
    expect(shellFindings([row()])).toEqual([])
  })

  it('fails the report: the page scrolled and the shell rode up', () => {
    // Read on dev at 0d1ec98: shell 961 px at -1,782, document 2,743 px.
    expect(
      shellFindings([row({ shellTop: -1782, documentHeight: 2743 })]),
    ).toEqual([
      '/dashboard at 1886×961: shell top at -1782px after scrolling the page',
      '/dashboard at 1886×961: document 2743px tall, window 961px',
    ])
  })

  it('fails a short shell, a missing one and a page it could not measure', () => {
    expect(shellFindings([row({ shellHeight: 590 })])).toEqual([
      '/dashboard at 1886×961: shell 590px tall, window 961px',
    ])
    expect(shellFindings([row({ shellHeight: null })])).toHaveLength(1)
    expect(shellFindings([row({ status: 500 })])).toEqual([
      '/dashboard at 1886×961: answered 500, shell not measured',
    ])
  })

  it('fails a sidebar entry the sidebar cannot be scrolled to', () => {
    // Read on dev at 29b0820, 1366×768: eleven entries, Compliance to Audit.
    expect(
      shellFindings([
        row({
          width: 1366,
          height: 768,
          shellHeight: 768,
          documentHeight: 768,
          sidebarEntries: 24,
          sidebarUnreachable: ['/maintenance', '/audit'],
        }),
      ]),
    ).toEqual([
      '/dashboard at 1366×768: sidebar entry /maintenance not reachable by scrolling the sidebar',
      '/dashboard at 1366×768: sidebar entry /audit not reachable by scrolling the sidebar',
    ])
    expect(
      shellFindings([row({ sidebarEntries: 0, sidebarUnreachable: [] })]),
    ).toEqual(['/dashboard at 1886×961: no sidebar entries to reach'])
    expect(
      shellFindings([row({ sidebarEntries: 24, sidebarUnreachable: [] })]),
    ).toEqual([])
  })

  it('renders every page that draws a chart', () => {
    // Read from the source: the pages whose own file imports a chart, plus
    // the dashboard, whose panels do.
    const appDir = join('src', 'app', '(app)')
    const chartPages = tsxUnder(appDir)
      .filter((file) => file.endsWith('page.tsx'))
      .filter((file) =>
        /from '(\.\.\/)+_charts\/|from '\.\/Panels'/.test(
          readFileSync(file, 'utf8'),
        ),
      )
      .map(
        (file) =>
          '/' +
          file
            .slice(appDir.length + 1)
            .replace(/\\/g, '/')
            .replace(/\/?page\.tsx$/, ''),
      )
    expect(chartPages.length).toBeGreaterThan(1)
    expect(new Set(SHELL_PAGES)).toEqual(new Set(chartPages))
  })

  it('runs on every deploy sweep, its problems counted', () => {
    const sweep = readFileSync('scripts/sweep.mjs', 'utf8')
    expect(sweep).toMatch(
      /sums\.problems \+= reportShells\(\s*await measureShells\(shellBrowser, BASE, cookie\)/,
    )
  })
})

describe('the sidebar scrolls on its own', () => {
  it('its list is bounded under the wordmark and scrolls, thin, in nav tokens', () => {
    const sidebar = readFileSync('src/components/shell/Sidebar.tsx', 'utf8')
    const list = /<div className="([^"]*)">\s*\{groups\.map/.exec(sidebar)?.[1]
    expect(list?.split(' ')).toEqual(
      expect.arrayContaining([
        'z-nav-scroll',
        'min-h-0',
        'flex-1',
        'overflow-y-auto',
      ]),
    )
    const css = readFileSync('src/app/globals.css', 'utf8')
    const rule = /\.z-nav-scroll \{([^}]*)\}/.exec(css)?.[1] ?? ''
    expect(rule).toMatch(/scrollbar-width: thin;/)
    expect(rule).toMatch(
      /scrollbar-color: var\(--color-nav-[a-z0-9-]+\) transparent;/,
    )
  })

  it('and the check reaches each entry by the sidebar’s own scroller', () => {
    const check = readFileSync('scripts/shell-height.mjs', 'utf8')
    expect(check).toContain('await page.evaluate(reachSidebar)')
    expect(check).not.toMatch(/scrollIntoView\(/)
  })
})

describe('the cause', () => {
  it('the shell is positioned, so no absolute element is laid out against the page', () => {
    // The wrappers alone left document 1,860 px on dev at cd56789: the
    // sr-only div was absolute with no positioned ancestor.
    const layout = readFileSync('src/app/(app)/layout.tsx', 'utf8')
    const shell = /data-density=\{density\}\s*className="([^"]*)"/.exec(
      layout,
    )?.[1]
    expect(shell?.split(' ')).toEqual(
      expect.arrayContaining(['relative', 'h-screen', 'overflow-hidden']),
    )
  })

  it('no table carries sr-only itself — the div around it does', () => {
    const offenders = tsxUnder('src').filter((file) =>
      /<table[^>]*\bsr-only\b/.test(readFileSync(file, 'utf8')),
    )
    expect(offenders).toEqual([])
  })
})
