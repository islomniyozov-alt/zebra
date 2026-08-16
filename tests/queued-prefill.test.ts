import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'

// ---------------------------------------------------------------------------
// A DRAFT OPENED FROM THE QUEUE FILLS THE SAME FIELDS AN UPLOAD FILLS.
//
// It did not. `?from=` set `prefill` and stopped there, so the UNCONTROLLED
// inputs — broker, the place fields — filled from it while everything held in
// React state stayed blank: both stop dates, both windows, and the rate. The
// form's own comment said the queued prefill was "shaped exactly like an
// upload's prefill so the form cannot tell the two apart", which was true of
// the object and false of the path that consumed it.
//
// WHAT THAT COST: load #1174 was booked from a READY draft with no pickup date
// and no rate, and `verify-inbound-email.mjs` reported 15/15 — because it
// asserted `broker`, the `.place` inputs and a hidden id, which are exactly
// the three fields on the working side of the fault. It then typed `miles`
// in itself before saving, and read the resulting "no pickup date" warning as
// the expected consequence of Relay's date format. The alarm rang and a
// comment explained why it was fine.
//
// SO THIS ASSERTS THE DOOR, NOT THE DATA. That the reading contains dates and
// money is a fact about extraction and is tested elsewhere. What was missing
// is that the form USES them, and the only way that stays true is if both
// callers go through one mapping.
// ---------------------------------------------------------------------------

const form = readFileSync('src/app/(app)/loads/new/CreateLoadForm.tsx', 'utf8')

/** The initialiser block: from the queued prefill down to the rate state. */
const initialisers = form.slice(
  form.indexOf('const queued: Prefill | null'),
  form.indexOf('// PHASE 5 §3 STEP 2'),
)

describe('the queued draft is applied, not merely carried', () => {
  it('builds the prefill before the state that needs it', () => {
    expect(form.indexOf('const queued: Prefill | null')).toBeLessThan(
      form.indexOf('const [stops, setStops]'),
    )
  })

  it('initialises the stop rows THROUGH the shared mapping', () => {
    // Not a second copy of the rules — the same function the upload handler
    // calls. A reimplementation here is how the two paths drifted.
    expect(initialisers).toContain('stopRowsFrom(queued')
  })

  it('initialises the rate THROUGH the shared mapping', () => {
    expect(initialisers).toContain('extractedRate(queued)')
  })

  it('still refuses the rate to a role that may not enter one', () => {
    // §1.3 survives the fix: the gate moved, it did not disappear.
    expect(initialisers).toMatch(/queued && mayEnterRate/)
  })

  it('does not leave the stop rows blank when a draft was opened', () => {
    // The exact shape of the bug: a literal array of empty rows returned
    // unconditionally, ignoring the prefill entirely.
    const stopsBlock = initialisers.slice(
      initialisers.indexOf('const [stops, setStops]'),
      initialisers.indexOf('const nextKey'),
    )
    expect(stopsBlock).toContain('if (!queued) return blank')
    expect(stopsBlock).toMatch(/return stopRowsFrom\(/)
  })

  it('mints keys for however many stops the reading had', () => {
    // Two blank rows were hardcoded; a four-stop Amazon run needs four keys,
    // and `nextKey` must start past the last one it minted.
    expect(initialisers).toContain('useRef(stops.length)')
  })
})

describe('the walkthrough asserts the fields that were empty', () => {
  const script = readFileSync('scripts/verify-inbound-email.mjs', 'utf8')

  it('reads the stop dates back off the rendered form', () => {
    expect(script).toMatch(/name\$?=.*\.date|stops\[0\]\.date|dates:/)
  })

  it('reads the rate back off the rendered form', () => {
    expect(script).toMatch(/value\('rate'\)|name="rate"/)
  })

  // IT TYPED THE EVIDENCE IN ITSELF. `rate` and the stop dates are what the
  // prefill is supposed to supply, so a script that types them in cannot tell
  // a working prefill from a broken one — which is how 15/15 was reported for
  // a form that filled half of itself.
  //
  // `miles` IS ALLOWED, and the distinction is the point: no reading carries
  // mileage, so nothing is being covered up when the script provides it. The
  // first version of this test forbade every fill, which would have been a
  // rule the script could not follow and would have been loosened rather than
  // obeyed. It also scanned to the FIRST submit button — the login form — so
  // it passed while inspecting nothing.
  it('never types the fields the prefill is meant to supply', () => {
    const beforeSave = script.slice(
      0,
      script.lastIndexOf('button[type="submit"]'),
    )
    const fills = [...beforeSave.matchAll(/page\.fill\('([^']+)'/g)]
      .map((match) => match[1])
      .filter((selector): selector is string => selector !== undefined)
    const supplied = fills.filter(
      (selector) =>
        /name="rate"/.test(selector) ||
        /scheduledAt|\.date/.test(selector) ||
        /name="broker"/.test(selector),
    )
    expect(
      supplied,
      `the prefill fills these; the script must not: ${supplied.join(', ')}`,
    ).toEqual([])
  })
})
