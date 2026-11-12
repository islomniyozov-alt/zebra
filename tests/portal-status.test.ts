import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { DRIVER_STEPS, nextStatusFor } from '@/lib/portal-status'

// ---------------------------------------------------------------------------
// THE DRIVER'S LADDER (Phase 7 step 4; §9 "The write rules"; §4.4 ruled
// 2026-11-12: one forward step at a time, the engine's own rule).
// ---------------------------------------------------------------------------

describe('the driver walks six rungs, one at a time', () => {
  it('is the six operational steps between the office’s two', () => {
    expect([...DRIVER_STEPS]).toEqual([
      'DISPATCHED',
      'AT_PICKUP',
      'LOADED',
      'IN_TRANSIT',
      'AT_DELIVERY',
      'DELIVERED',
    ])
  })

  it('offers exactly the next rung', () => {
    expect(nextStatusFor('DISPATCHED')).toBe('AT_PICKUP')
    expect(nextStatusFor('AT_PICKUP')).toBe('LOADED')
    expect(nextStatusFor('LOADED')).toBe('IN_TRANSIT')
    expect(nextStatusFor('IN_TRANSIT')).toBe('AT_DELIVERY')
    expect(nextStatusFor('AT_DELIVERY')).toBe('DELIVERED')
  })

  it('offers nothing before dispatch, at delivered, or at the office’s POD', () => {
    // BOOKED is dispatch's; the driver cannot dispatch themselves.
    expect(nextStatusFor('AVAILABLE')).toBeNull()
    expect(nextStatusFor('BOOKED')).toBeNull()
    // DELIVERED is the end of the driver's ladder; POD_RECEIVED is never a
    // click (§7), and least of all the driver's.
    expect(nextStatusFor('DELIVERED')).toBeNull()
    expect(nextStatusFor('POD_RECEIVED')).toBeNull()
  })
})

describe('the button is the driver of record’s, and the write is the engine’s', () => {
  const home = readFileSync(
    join(process.cwd(), 'src', 'app', '(portal)', 'portal', 'page.tsx'),
    'utf8',
  )
  const lib = readFileSync(
    join(process.cwd(), 'src', 'lib', 'portal-status.ts'),
    'utf8',
  )
  const action = readFileSync(
    join(
      process.cwd(),
      'src',
      'app',
      '(portal)',
      'portal',
      'status-actions.ts',
    ),
    'utf8',
  )

  it('Home renders the step only when the driver holds the first seat', () => {
    // §4.5: a co-driver sees the load and never sets its status — and the
    // button not being there is a courtesy; the write's refusal is the rule.
    expect(home).toMatch(/load\.driverId === driver\.id/)
    expect(home).toMatch(/<StatusStep/)
  })

  it('the write goes through transitionOperational with the portal source', () => {
    expect(lib).toMatch(/transitionOperational\(tx, loadId, next, \{/)
    expect(lib).toMatch(/source: 'DRIVER_PORTAL'/)
    expect(lib).not.toMatch(/loadStatusEvent\.create/)
  })

  it('the action asks portal.load:update and calls the one function', () => {
    expect(action).toMatch(/withCurrentOrg\('update', 'portal\.load'/)
    expect(action).toMatch(
      /recordPortalStatus\(tx, session, loadId, to, \{ tappedAt \}\)/,
    )
  })
})

describe('nothing under the portal writes the roster (§6: `Driver.userId` is the office’s)', () => {
  const walk = (dir: string): string[] =>
    readdirSync(dir).flatMap((name) => {
      const path = join(dir, name)
      if (statSync(path).isDirectory()) return walk(path)
      return /\.tsx?$/.test(name) ? [path] : []
    })
  const portal = [
    ...walk(join(process.cwd(), 'src', 'app', '(portal)')),
    ...walk(join(process.cwd(), 'src', 'app', 'api', 'portal')),
    ...readdirSync(join(process.cwd(), 'src', 'lib'))
      .filter((name) => /^portal.*\.ts$/.test(name))
      .map((name) => join(process.cwd(), 'src', 'lib', name)),
  ]

  it('reads the driver row and never creates, updates or links one', () => {
    expect(portal.length).toBeGreaterThan(5)
    const writers = portal.filter((path) =>
      /driver\.(create|update|upsert|delete)\(|linkDriverSignIn|unlinkDriverSignIn/.test(
        readFileSync(path, 'utf8'),
      ),
    )
    expect(writers).toEqual([])
  })
})
