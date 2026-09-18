import { readFileSync, readdirSync } from 'node:fs'
import { join, sep } from 'node:path'
import { describe, expect, it } from 'vitest'

// ---------------------------------------------------------------------------
// ONLY A SCREEN MAY SKIP THE NET-PAY READS. NEVER A BATCH.
//
// ── WHAT `netPay: false` DOES ────────────────────────────────────────────
//
// It tells `batchInputForOrg` not to read recurring deductions, the escrow
// balance, the opening balance or the year's prior settlements. Those four are
// what turn gross into NET, and skipping them saves four round trips on a page
// that reads `netCents` nowhere.
//
// ── AND WHY IT MUST NEVER REACH A BATCH ──────────────────────────────────
//
// A batch produces a STATEMENT SOMEBODY IS PAID ON. A settlement computed
// without its deductions overpays every driver who has any — the escrow, the
// advances, the truck payment, all silently zero — and `FINAL` freezes it. It
// would not throw, it would not look wrong in a test that checks gross, and
// the first person to notice would be a driver reading a cheque.
//
// The default is therefore the safe one, and this is the fence around the
// exception: the flag may appear in exactly one file.
//
// ── A SOURCE CHECK, FOR THE SAME REASON `this-week-shape` IS ─────────────
//
// The failure it guards is not a behaviour anybody can observe in a test — a
// batch built with `netPay: false` computes a WRONG number, not an error, and
// a fixture whose drivers have no deductions would pass either way. What can
// be checked is that nothing but the money screen ever asks for it.
// ---------------------------------------------------------------------------

/** The one file allowed to skip the net-pay reads, and why. */
const PERMITTED = 'this-week.ts'

function sourceFiles(dir: string): { name: string; text: string }[] {
  const found: { name: string; text: string }[] = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) {
      if (entry.name === 'generated' || entry.name === 'node_modules') continue
      found.push(...sourceFiles(path))
    } else if (/\.tsx?$/.test(entry.name)) {
      // `split(sep).join('/')` rather than a regex, so no escape has to
      // survive being typed — this line has been mangled in transit twice.
      found.push({
        name: path.split(sep).join('/'),
        text: readFileSync(path, 'utf8'),
      })
    }
  }
  return found
}

describe('skipping the net-pay reads', () => {
  it('reads its own source, so the check cannot pass by finding nothing', () => {
    const files = sourceFiles('src')
    expect(files.length).toBeGreaterThan(50)
    expect(files.some((file) => file.name.endsWith(PERMITTED))).toBe(true)
  })

  it('happens in exactly one file, and it is the money screen', () => {
    const askers = sourceFiles('src')
      .filter((file) => /netPay:\s*false/.test(file.text))
      .map((file) => file.name)

    expect(
      askers,
      'only the Tuesday screen may skip the net-pay reads',
    ).toEqual([`src/lib/${PERMITTED}`])
  })

  it('and the default stays TRUE where it is declared', () => {
    // THE DEFAULT IS THE WHOLE SAFETY PROPERTY. A caller that says nothing
    // must get the full input; flipping this would silently strip deductions
    // from every batch in the system and the fence above would still pass.
    const source = readFileSync('src/lib/settlement-batch.ts', 'utf8')
    expect(source).toMatch(/const netPay = options\.netPay !== false/)
  })
})
