import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

// ---------------------------------------------------------------------------
// THE OPERATIONAL LOOK (TMS-DESIGN-SYSTEM.md v10.74, owner's brief
// 2026-11-06), pinned from the artefact — the token block's own bytes and the
// components that use them — not from what this file believes they say.
//
//   * §3.6: the sidebar is on the navy set, and every nav-* class it uses
//     resolves to a token in the block (standing rule 9, as a guard).
//   * §3.3: each soft fill clears 4.5:1 against its text hue, RECOMPUTED from
//     the hex values in globals.css. The doc states the ratios; this is what
//     makes the statement checkable. Muted is below by design and is asserted
//     to be, so a change there is a decision and not a drift.
//   * §5.1: Standard's vertical cell padding is 6px, and 22px of badge plus
//     twice that padding fits under the 36px minimum — the arithmetic that
//     makes the 36px Standard row real.
//   * §6.1.3: the sign-in card carries the band on the same navy.
// ---------------------------------------------------------------------------

const css = readFileSync('src/app/globals.css', 'utf8')
const sidebar = readFileSync('src/components/shell/Sidebar.tsx', 'utf8')
const login = readFileSync('src/app/(auth)/login/page.tsx', 'utf8')

/** `--color-<name>: #rrggbb` inside the token block. */
function tokens(): Map<string, string> {
  const block = /@theme \{([\s\S]*?)\n\}/.exec(css)?.[1] ?? ''
  const out = new Map<string, string>()
  for (const m of block.matchAll(/--color-([a-z0-9-]+):\s*(#[0-9a-fA-F]{6})/g))
    out.set(m[1] ?? '', (m[2] ?? '').toLowerCase())
  return out
}

/** WCAG 2.x relative luminance and contrast ratio. */
function luminance(hex: string): number {
  const channel = (v: number) =>
    v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4)
  const at = (i: number) => channel(parseInt(hex.slice(i, i + 2), 16) / 255)
  return 0.2126 * at(1) + 0.7152 * at(3) + 0.0722 * at(5)
}
function contrast(a: string, b: string): number {
  const [x, y] = [luminance(a), luminance(b)]
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05)
}

describe('§3.6 — the sidebar is on the navy set', () => {
  const t = tokens()

  it('declares the six nav tokens in the token block', () => {
    for (const name of [
      'nav-bg',
      'nav-surface',
      'nav-active',
      'nav-border',
      'nav-ink',
      'nav-ink-2',
    ])
      expect(t.has(name), `--color-${name}`).toBe(true)
  })

  it('every nav-* class the Sidebar uses resolves to a token', () => {
    const used = new Set(
      [...sidebar.matchAll(/\b(?:bg|text|border)-(nav-[a-z0-9-]+)/g)].map(
        (m) => m[1] ?? '',
      ),
    )
    expect(used.size).toBeGreaterThan(0)
    for (const name of used) expect(t.has(name), `--color-${name}`).toBe(true)
  })

  it('paints the column nav-bg and carries no light surface or ink', () => {
    expect(sidebar).toMatch(/\bbg-nav-bg\b/)
    expect(sidebar).not.toMatch(/\bbg-surface(?:-\d)?\b/)
    expect(sidebar).not.toMatch(/\btext-ink(?:-\d)?\b/)
    // Accent secondary: the bar, and nothing else, is accent.
    expect(sidebar).not.toMatch(/\bbg-accent-soft\b|\btext-accent\b/)
    expect(sidebar).toMatch(/\bbg-accent\b/)
  })

  it('reads on the navy: wordmark 7:1, resting text 4.5:1, active text 7:1', () => {
    expect(
      contrast(t.get('nav-ink')!, t.get('nav-bg')!),
    ).toBeGreaterThanOrEqual(7)
    expect(
      contrast(t.get('nav-ink-2')!, t.get('nav-bg')!),
    ).toBeGreaterThanOrEqual(4.5)
    expect(
      contrast(t.get('nav-ink')!, t.get('nav-active')!),
    ).toBeGreaterThanOrEqual(7)
  })

  it('and the sign-in card carries the same band (§6.1.3)', () => {
    expect(login).toMatch(/\bbg-nav-bg\b/)
    expect(login).toMatch(/\btext-nav-ink\b/)
  })
})

describe('§3.3 — each soft fill clears 4.5:1 against its text, from the bytes', () => {
  const t = tokens()

  for (const tone of ['neutral', 'progress', 'success', 'warning', 'danger'])
    it(`${tone} on ${tone}-soft`, () => {
      const ratio = contrast(t.get(tone)!, t.get(`${tone}-soft`)!)
      expect(
        ratio,
        `${t.get(tone)} on ${t.get(`${tone}-soft`)}`,
      ).toBeGreaterThanOrEqual(4.5)
    })

  it('muted is below 4.5 BY DESIGN (cancelled rows also carry 60% opacity)', () => {
    // If somebody raises it, that is a §3.3 decision to write down, not a
    // drift to let through — so the test fails in both directions.
    const ratio = contrast(t.get('muted')!, t.get('muted-soft')!)
    expect(ratio).toBeLessThan(4.5)
    expect(ratio).toBeGreaterThan(2)
  })
})

describe('§5.1 — Standard density is 6px of padding, and the 36px row is real', () => {
  const standard = /\[data-density='standard'\]\s*\{([\s\S]*?)\}/.exec(css)?.[1]
  const compact = /\[data-density='compact'\]\s*\{([\s\S]*?)\}/.exec(css)?.[1]

  it('Standard pads 6px on a 36px minimum', () => {
    expect(standard).toBeDefined()
    expect(standard).toMatch(/--z-cell-pad-y:\s*6px/)
    expect(standard).toMatch(/--z-row-height:\s*36px/)
  })

  it('a 22px badge plus the padding fits under the minimum', () => {
    const pad = Number(/--z-cell-pad-y:\s*(\d+)px/.exec(standard!)?.[1])
    const min = Number(/--z-row-height:\s*(\d+)px/.exec(standard!)?.[1])
    // 16px line + 2 × 2px padding + 2 × 1px border — the StatusBadge.
    const badge = 16 + 2 * 2 + 2 * 1
    expect(badge + 2 * pad).toBeLessThanOrEqual(min)
  })

  it('Compact stays shorter than Standard', () => {
    expect(compact).toMatch(/--z-cell-pad-y:\s*4px/)
    expect(compact).toMatch(/--z-row-height:\s*32px/)
  })
})
