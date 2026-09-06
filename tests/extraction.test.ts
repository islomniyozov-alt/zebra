import { describe, expect, it } from 'vitest'
import {
  ExtractionParseError,
  field,
  lowConfidenceFields,
  moneyToCents,
  parseExtraction,
  parseResponseText,
  withoutMoney,
} from '@/lib/extraction/parse'
import {
  EXTRACTED_FIELDS,
  EXTRACTION_SCHEMA,
  STOP_FIELDS,
} from '@/lib/extraction-shape'
import type { Extracted } from '@/lib/extraction-shape'
import { centsToInput } from '@/lib/money'

// ---------------------------------------------------------------------------
// THE PARSER (Phase 5 §3 step 1).
//
// §1.2: "a response that doesn't parse is a failed extraction, never a
// half-filled form." Every refusal below is a shape a language model really
// produces, and the reason each one matters is that the alternative — accepting
// it — puts a value on a form that the dispatcher will not check, because it
// appeared rather than being typed.
//
// The money tests are the ones rule 9-money is about: a rate that silently
// becomes 0, or 185000 where 1850.00 was meant, is a load invoiced wrong.
// ---------------------------------------------------------------------------

/** A minimal well-formed response. Fields are added per test. */
const bare = (over: Record<string, unknown> = {}) =>
  JSON.stringify({
    brokerName: { value: 'Midwest Logistics', confidence: 'high' },
    brokerReference: null,
    bolNumber: null,
    poNumber: null,
    commodity: null,
    weightLbs: null,
    miles: null,
    pieces: null,
    pallets: null,
    equipmentType: null,
    tempF: null,
    isHazmat: null,
    isTeam: null,
    sealNumber: null,
    instructions: null,
    stops: [],
    money: {
      linehaul: null,
      fuelSurcharge: null,
      total: null,
      accessorials: [],
    },
    ...over,
  })

describe('the shape the model is held to', () => {
  it('asks for every field the type declares', () => {
    // The schema is written out rather than derived, because it is the
    // CONTRACT with an outside system. This is the check a derivation would
    // have made unnecessary — without it, a field added to the TypeScript type
    // is a field the model is never asked for and that silently stays null.
    const required = EXTRACTION_SCHEMA.required as readonly string[]
    expect([...EXTRACTED_FIELDS].sort()).toEqual([...required].sort())
  })

  it('and every stop field', () => {
    const required = EXTRACTION_SCHEMA.properties.stops.items
      .required as readonly string[]
    expect([...STOP_FIELDS].sort()).toEqual([...required].sort())
  })

  it('offers only the equipment types the database has', () => {
    // An enum member the model invents is refused by `asEnum` at parse time —
    // but asking for one the database cannot store would waste the call.
    expect(
      EXTRACTION_SCHEMA.properties.equipmentType.properties.value.enum,
    ).toEqual([
      'DRY_VAN',
      'REEFER',
      'FLATBED',
      'STEP_DECK',
      'POWER_ONLY',
      'TANKER',
      'CONTAINER',
      'OTHER',
    ])
  })

  it('asks for money as strings', () => {
    // Rule 9-money, at the contract boundary. A model that returns 1850.5 as a
    // NUMBER has already decided what the third decimal means.
    for (const key of ['linehaul', 'fuelSurcharge', 'total'] as const) {
      expect(
        EXTRACTION_SCHEMA.properties.money.properties[key].properties.value
          .type,
        key,
      ).toBe('string')
    }
  })
})

describe('what the parser refuses', () => {
  it('prose instead of JSON', () => {
    expect(() => parseExtraction('I could not read this document.')).toThrow(
      ExtractionParseError,
    )
  })

  it('but not a fenced block, which is packaging rather than a wrong answer', () => {
    const fenced = '```json\n' + bare() + '\n```'
    expect(parseExtraction(fenced).brokerName?.value).toBe('Midwest Logistics')
  })

  it('an array where an object belongs', () => {
    expect(() => parseExtraction('[]')).toThrow(/not_an_object/)
  })

  it('a field that is simply absent', () => {
    // Not defaulted to null. A response missing `bolNumber` is a response to a
    // different question, and treating it as "no BOL" is a guess.
    const missing = JSON.parse(bare()) as Record<string, unknown>
    delete missing['bolNumber']
    expect(() => parseExtraction(JSON.stringify(missing))).toThrow(
      /missing_field.*bolNumber/,
    )
  })

  it('a bare value where {value, confidence} belongs', () => {
    // Accepting it would mean inventing a confidence, and an invented
    // confidence is indistinguishable from a measured one on the screen.
    expect(() => parseExtraction(bare({ commodity: 'Frozen peas' }))).toThrow(
      /bad_field_shape.*commodity/,
    )
  })

  it('a numeric confidence', () => {
    expect(() =>
      parseExtraction(
        bare({ commodity: { value: 'Frozen peas', confidence: 0.82 } }),
      ),
    ).toThrow(/bad_confidence/)
  })

  it('a confidence word that is not one of the three', () => {
    expect(() =>
      parseExtraction(
        bare({ commodity: { value: 'Peas', confidence: 'certain' } }),
      ),
    ).toThrow(/bad_confidence/)
  })

  it('a number delivered as a string', () => {
    // "42,000" is a formatting decision the model was not asked to make, and
    // Number("42,000") is NaN — which would land as a blank nobody can explain.
    expect(() =>
      parseExtraction(
        bare({ weightLbs: { value: '42,000', confidence: 'high' } }),
      ),
    ).toThrow(/bad_value_type.*weightLbs/)
  })

  it('an equipment type the enum does not have', () => {
    expect(() =>
      parseExtraction(
        bare({ equipmentType: { value: 'CONESTOGA', confidence: 'high' } }),
      ),
    ).toThrow(/bad_enum/)
  })

  it('an empty string, which is not a value', () => {
    expect(() =>
      parseExtraction(
        bare({ commodity: { value: '   ', confidence: 'high' } }),
      ),
    ).toThrow(/bad_value_type/)
  })

  it('stops that are not an array', () => {
    expect(() => parseExtraction(bare({ stops: {} }))).toThrow(
      /stops_not_an_array/,
    )
  })

  it('a missing money block', () => {
    const missing = JSON.parse(bare()) as Record<string, unknown>
    delete missing['money']
    expect(() => parseExtraction(JSON.stringify(missing))).toThrow(
      /money_missing/,
    )
  })

  it('and names WHERE it refused, not just that it did', () => {
    // The path is the difference between "extraction failed" and a bug report
    // somebody can act on six weeks later.
    try {
      parseExtraction(
        bare({
          stops: [
            {
              type: { value: 'PICKUP', confidence: 'high' },
              name: null,
              addressLine1: null,
              addressLine2: null,
              city: { value: 'Chicago', confidence: 'nope' },
              state: null,
              postalCode: null,
              scheduledAt: null,
              windowStart: null,
              windowEnd: null,
              referenceNumber: null,
              contactName: null,
              contactPhone: null,
              instructions: null,
            },
          ],
        }),
      )
      expect.unreachable('should have refused')
    } catch (error) {
      expect((error as ExtractionParseError).path).toBe('$.stops[0].city')
      expect((error as ExtractionParseError).reason).toBe('bad_confidence')
    }
  })
})

describe('what the parser accepts', () => {
  it('a null field as "the document did not carry this"', () => {
    const parsed = parseExtraction(bare())
    expect(parsed.bolNumber).toBeNull()
    expect(parsed.stops).toEqual([])
  })

  it('trims a value without accepting a blank one', () => {
    const parsed = parseExtraction(
      bare({ commodity: { value: '  Frozen peas  ', confidence: 'medium' } }),
    )
    expect(parsed.commodity).toEqual({
      value: 'Frozen peas',
      confidence: 'medium',
    })
  })

  it('keeps a note when the model says where it read something', () => {
    const parsed = parseExtraction(
      bare({
        bolNumber: {
          value: '4471902',
          confidence: 'medium',
          note: 'handwritten in the margin',
        },
      }),
    )
    expect(parsed.bolNumber?.note).toBe('handwritten in the margin')
  })

  it('and drops an empty note rather than carrying one', () => {
    const parsed = parseExtraction(
      bare({ bolNumber: { value: '447', confidence: 'high', note: '' } }),
    )
    expect(parsed.bolNumber && 'note' in parsed.bolNumber).toBe(false)
  })
})

describe('money, through money.ts and nowhere else', () => {
  const withMoney = (money: Record<string, unknown>): Extracted =>
    parseExtraction(bare({ money }))

  it('a worked example, checked by hand', () => {
    // A Midwest Logistics rate confirmation, as printed:
    //   Line haul      $1,850.00   -> 185000
    //   Fuel surcharge   $412.50   ->  41250
    //   Detention        $150.00   ->  15000
    //   ---------------------------
    //   Total          $2,412.50   -> 241250
    const money = moneyToCents(
      withMoney({
        linehaul: { value: '$1,850.00', confidence: 'high' },
        fuelSurcharge: { value: '$412.50', confidence: 'high' },
        total: { value: '$2,412.50', confidence: 'high' },
        accessorials: [
          {
            description: { value: 'Detention', confidence: 'high' },
            amount: { value: '$150.00', confidence: 'medium' },
          },
        ],
      }),
    )

    expect(money.linehaulCents).toBe(185_000)
    expect(money.fuelSurchargeCents).toBe(41_250)
    expect(money.accessorials[0]?.cents).toBe(15_000)
    expect(money.totalCents).toBe(241_250)

    // 185000 + 41250 + 15000 = 241250. The reader can add the column.
    expect(money.totalAgrees).toBe(true)
    expect(money.differenceCents).toBe(0)
    expect(centsToInput(money.totalCents!)).toBe('2412.50')
  })

  it('says so when the broker total disagrees with the broker line items', () => {
    // Brokers really do print totals that do not match their own lines. It is
    // not an error — it is the single most useful thing to show an accountant,
    // so it is computed once rather than in whichever screen thinks to.
    const money = moneyToCents(
      withMoney({
        linehaul: { value: '1850.00', confidence: 'high' },
        fuelSurcharge: null,
        total: { value: '1900.00', confidence: 'high' },
        accessorials: [],
      }),
    )
    expect(money.totalAgrees).toBe(false)
    expect(money.differenceCents).toBe(5_000)
  })

  it('has no opinion when there is nothing to compare', () => {
    const money = moneyToCents(
      withMoney({
        linehaul: null,
        fuelSurcharge: null,
        total: { value: '$900.00', confidence: 'low' },
        accessorials: [],
      }),
    )
    expect(money.totalAgrees).toBeNull()
    expect(money.differenceCents).toBeNull()
  })

  it('reports a figure it could not read rather than dropping it', () => {
    // "$1,8S0.00" — an O for a zero, out of a scanner. Silently omitting it
    // would look like a document with no rate on it at all.
    const money = moneyToCents(
      withMoney({
        linehaul: { value: '$1,8S0.00', confidence: 'low' },
        fuelSurcharge: null,
        total: null,
        accessorials: [],
      }),
    )
    expect(money.linehaulCents).toBeNull()
    expect(money.unreadable).toEqual([
      { label: 'linehaul', printed: '$1,8S0.00' },
    ])
  })

  it('refuses a negative rate rather than prefilling one', () => {
    // A misread minus, or a credit memo in the wrong pile. Either way it is not
    // a value to put on a form.
    const money = moneyToCents(
      withMoney({
        linehaul: { value: '-1850.00', confidence: 'medium' },
        fuelSurcharge: null,
        total: null,
        accessorials: [],
      }),
    )
    expect(money.linehaulCents).toBeNull()
    expect(money.unreadable[0]?.label).toBe('linehaul')
  })

  it('keeps what was printed beside what it parsed to', () => {
    // So a person checking the parse has both halves without opening the PDF.
    const money = moneyToCents(
      withMoney({
        linehaul: null,
        fuelSurcharge: null,
        total: null,
        accessorials: [
          {
            description: { value: 'Lumper', confidence: 'high' },
            amount: { value: '$85', confidence: 'low' },
          },
        ],
      }),
    )
    expect(money.accessorials[0]).toEqual({
      label: 'Lumper',
      cents: 8_500,
      confidence: 'low',
      printed: '$85',
    })
  })

  it('takes the AMOUNT’s confidence, not the description’s', () => {
    // The number is what gets typed into a rate and what a reviewer checks.
    const money = moneyToCents(
      withMoney({
        linehaul: null,
        fuelSurcharge: null,
        total: null,
        accessorials: [
          {
            description: { value: 'Detention', confidence: 'high' },
            amount: { value: '$150.00', confidence: 'low' },
          },
        ],
      }),
    )
    expect(money.accessorials[0]?.confidence).toBe('low')
  })
})

describe('what a dispatcher receives', () => {
  const full = parseExtraction(
    bare({
      money: {
        linehaul: { value: '$1,850.00', confidence: 'high' },
        fuelSurcharge: null,
        total: { value: '$1,850.00', confidence: 'high' },
        accessorials: [],
      },
    }),
  )

  it('has no money KEY at all, not an emptied one', () => {
    // §1.3, and the same rule as every money-on-an-operational-screen field
    // since Phase 3: leaving it OUT is the only version that survives somebody
    // reading the network tab.
    const prefill = withoutMoney(full)
    expect('money' in prefill).toBe(false)
    expect(JSON.stringify(prefill)).not.toContain('1,850')
    expect(JSON.stringify(prefill)).not.toContain('linehaul')
  })

  it('while keeping everything the freight needs', () => {
    // The pair. Stripping the money must not strip the load.
    const prefill = withoutMoney(full)
    expect(prefill.brokerName?.value).toBe('Midwest Logistics')
  })
})

describe('which fields the form must mark', () => {
  it('names the low-confidence ones and nothing else', () => {
    const parsed = parseExtraction(
      bare({
        commodity: { value: 'Peas', confidence: 'low' },
        weightLbs: { value: 42_000, confidence: 'high' },
        miles: null,
        stops: [
          {
            type: { value: 'PICKUP', confidence: 'high' },
            name: null,
            addressLine1: null,
            addressLine2: null,
            city: { value: 'Chicago', confidence: 'low' },
            state: null,
            postalCode: null,
            scheduledAt: null,
            windowStart: null,
            windowEnd: null,
            referenceNumber: null,
            contactName: null,
            contactPhone: null,
            instructions: null,
          },
        ],
        money: {
          linehaul: { value: '$1,850.00', confidence: 'low' },
          fuelSurcharge: null,
          total: null,
          accessorials: [],
        },
      }),
    )

    expect(lowConfidenceFields(parsed).sort()).toEqual([
      'commodity',
      'money.linehaul',
      'stops[0].city',
    ])
  })

  it('and says nothing about a confident extraction', () => {
    expect(lowConfidenceFields(parseExtraction(bare()))).toEqual([])
  })
})

describe('the response-text unwrapper', () => {
  it('takes JSON with no fence', () => {
    expect(parseResponseText('{"a":1}')).toEqual({ a: 1 })
  })

  it('and refuses a fence containing nothing useful', () => {
    expect(() => parseResponseText('```json\nnope\n```')).toThrow(/not_json/)
  })
})

describe('the test helper', () => {
  it('builds a field the parser would accept', () => {
    // `field()` is used by fixtures; if it drifted from the parser's shape the
    // fixtures would test a shape nothing produces.
    expect(field('x')).toEqual({ value: 'x', confidence: 'high' })
    expect(field(4, 'low')).toEqual({ value: 4, confidence: 'low' })
  })
})
