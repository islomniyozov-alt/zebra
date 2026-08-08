import { describe, expect, it } from 'vitest'
import { diffExtraction, normalizeAlias } from '@/lib/correction-memory'

// ---------------------------------------------------------------------------
// THE TWO DECISIONS IN CORRECTION MEMORY THAT ARE NOT QUERIES (§3 step 3).
//
// How hard a broker name is folded before it is compared, and what counts as a
// correction. Both are cheap to get subtly wrong and expensive to notice:
// folding too hard routes a load to the wrong customer, and a diff that misses
// a case makes §5's accuracy table flatter than the truth.
// ---------------------------------------------------------------------------

describe('folding a broker name', () => {
  it('ignores case and spacing, which is what two documents differ by', () => {
    expect(normalizeAlias('  its logistics   llc ')).toBe('ITS LOGISTICS LLC')
    expect(normalizeAlias('ITS Logistics LLC')).toBe('ITS LOGISTICS LLC')
  })

  it('ignores the punctuation the corpus actually varies', () => {
    // "Big M II, Inc." on one document and "Big M II Inc" on another — the
    // same broker, twice, in this carrier's real paperwork.
    expect(normalizeAlias('Big M II, Inc.')).toBe(
      normalizeAlias('Big M II Inc'),
    )
  })

  it('and STOPS THERE — two of this carrier’s brokers differ by one word', () => {
    // THE TEST THAT MATTERS. `ITS Logistics LLC` and `ITS National LLC` are
    // both in the corpus and are different companies. A normalisation clever
    // enough to strip "LLC" and match on the leading token would fold them
    // together, and a load would be invoiced to the wrong one — silently,
    // because the screen would show a name that looks right.
    expect(normalizeAlias('ITS Logistics LLC')).not.toBe(
      normalizeAlias('ITS National LLC'),
    )
    expect(normalizeAlias('Werner Logistics')).not.toBe(
      normalizeAlias('Werner Enterprises'),
    )
  })

  it('folds an empty name to nothing rather than to a match', () => {
    expect(normalizeAlias('   ')).toBe('')
  })
})

describe('what counts as a correction', () => {
  const extraction = {
    brokerName: { value: 'Mispelled Logistics', confidence: 'medium' },
    stops: [
      {
        city: { value: 'Chicago', confidence: 'high' },
        state: { value: 'IL', confidence: 'high' },
      },
      { city: { value: 'Sacramento', confidence: 'low' } },
    ],
    money: { linehaul: { value: '$1,850.00', confidence: 'high' } },
  }

  it('reports both sides, because the old value is the interesting one', () => {
    // A log of new values answers "what is it now". §5's table asks "what was
    // wrong", which needs the value that was.
    const changes = diffExtraction(extraction, {
      brokerName: 'Midwest Logistics',
    })
    expect(changes).toEqual([
      {
        field: 'brokerName',
        extracted: 'Mispelled Logistics',
        corrected: 'Midwest Logistics',
        confidence: 'medium',
      },
    ])
  })

  it('carries the confidence the model claimed when it was wrong', () => {
    // Which is the number that decides whether the confidence signal is worth
    // anything: a model wrong at "high" is a different problem from one wrong
    // at "low", and only one of them can be marked on a form.
    const [change] = diffExtraction(extraction, {
      'stops[1].city': 'Stockton',
    })
    expect(change?.confidence).toBe('low')
  })

  it('counts a field the model MISSED and a person filled in', () => {
    // The model failing to see something is exactly as interesting as it being
    // wrong, and a diff keyed on "changed from a value" would drop it.
    const changes = diffExtraction(extraction, { poNumber: 'PO-4471' })
    expect(changes).toEqual([
      {
        field: 'poNumber',
        extracted: null,
        corrected: 'PO-4471',
        confidence: null,
      },
    ])
  })

  it('reads money by its own path, not as a literal key', () => {
    // `money.linehaul` is nested. The create form had this exact bug — it
    // looked up a key called "money.linehaul", found nothing, and left the
    // rate field empty on a form that was otherwise right.
    const [change] = diffExtraction(extraction, {
      'money.linehaul': '$1,900.00',
    })
    expect(change?.extracted).toBe('$1,850.00')
  })

  it('reads a stop as the ONE FIELD the form has, not as a city', () => {
    // THE BUG THE WALKTHROUGH FOUND. The create screen shows a single
    // "Salem, OR" input per stop. Comparing what a dispatcher left in it
    // against the extracted city alone made every unedited load look like two
    // corrections — a table of mistakes that was really a table of loads.
    expect(
      diffExtraction(extraction, { 'stops[0].place': 'Chicago, IL' }),
    ).toEqual([])
    const [change] = diffExtraction(extraction, {
      'stops[0].place': 'Joliet, IL',
    })
    expect(change).toMatchObject({
      extracted: 'Chicago, IL',
      confidence: 'high',
    })
  })

  it('and a stop with no state is just the city', () => {
    // A document that never printed a state has not been corrected by somebody
    // who leaves the field reading "Sacramento".
    expect(
      diffExtraction(extraction, { 'stops[1].place': 'Sacramento' }),
    ).toEqual([])
  })

  it('and says nothing when the person kept what was offered', () => {
    // An agreement is not a correction. Logging it would make the table a
    // record of loads rather than of mistakes.
    expect(
      diffExtraction(extraction, { brokerName: 'Mispelled Logistics' }),
    ).toEqual([])
  })

  it('treats a cleared field as a correction, and an absent one as agreement', () => {
    // Somebody deleting a wrong value is correcting it. Somebody leaving a
    // field the model also left empty is not.
    expect(diffExtraction(extraction, { brokerName: null })).toHaveLength(1)
    expect(diffExtraction(extraction, { sealNumber: null })).toEqual([])
  })

  it('has nothing to say about a load that came from typing', () => {
    expect(diffExtraction(null, { brokerName: 'Typed In' })).toEqual([])
  })
})
