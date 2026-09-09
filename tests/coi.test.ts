import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  COI_COVERAGE_FIELDS,
  COI_FIELDS,
  COI_FORBIDDEN_FIELDS,
  COI_SCHEMA,
  COI_VEHICLE_FIELDS,
} from '@/lib/extraction/coi-shape'
import { COI_EXTRACTION_SYSTEM_WITH_SCHEMA } from '@/lib/extraction/coi-prompt'
import { parseCoiResponse } from '@/lib/extraction/coi-parse'
import { proposeCoverage } from '@/lib/extraction/coi-coverages'
import { checkVin } from '@/lib/extraction/vin'
import {
  checkCarrier,
  judgeCoverageRow,
  refuseCoi,
} from '@/lib/extraction/coi-refusal'
import { coiProposal, decideCoiSubject, planVinFill } from '@/lib/coi'
import { parseUsDate } from '@/lib/extraction/us-dates'

// ---------------------------------------------------------------------------
// THE ACORD CERTIFICATE CONTRACT, MEASURED AGAINST A REAL CERTIFICATE.
//
// ── THE FIXTURE IS THE ARTEFACT, NOT WHAT THE CODE BELIEVED ──────────────
//
// The first version of this file said it was "written against the form rather
// than against a model's output, which is the whole point of doing it in this
// order". That was the right instinct and the wrong source: the blank ACORD 25
// prints boxes for auto liability and cargo, so a contract drafted from it
// assumed both. `corpus/coi/acord25-01.pdf` carries NEITHER — non-trucking
// liability and physical damage, insured to an owner-operator's own entity,
// naming two tractors by VIN.
//
// So `CHAPAN` below is transcribed from that certificate's text layer, cell
// for cell. It is the standing rule turned on this contract: build the
// instrument from the artefact, not from what the code believes about it.
//
// THE EXCLUSIONS ARE ASSERTED THREE WAYS — absent from the TypeScript shape,
// absent from the JSON Schema, and refused by name in the prompt — with
// `additionalProperties: false` as the fourth.
// ---------------------------------------------------------------------------

const field = (value: string | null, confidence = 'high') =>
  value === null ? null : { value, confidence }

const cell = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
  type: null,
  insurer: null,
  policyNumber: null,
  effectiveAt: null,
  expiresAt: null,
  limit: null,
  ...over,
})

/**
 * `corpus/coi/acord25-01.pdf`, as its text layer prints it.
 *
 * ONE POLICY NUMBER AND ONE DATE PAIR ACROSS TWO NAMED COVERAGES. Whether the
 * physical damage row shares them is a reading of the layout rather than of
 * any text — which is exactly why the second row's shared cells carry `low`
 * here, and why the contract puts confidence on cells rather than on rows.
 */
const CHAPAN = () => ({
  insuredName: field('CHAPAN INC'),
  insuredMc: null,
  insuredDot: null,
  coverages: [
    cell({
      type: field('Non-Trucking Liability'),
      insurer: field('PROGRESSIVE EXPRESS INSURANCE COMPANY'),
      policyNumber: field('878508616'),
      effectiveAt: field('08/14/2026'),
      expiresAt: field('08/14/2027'),
      limit: field('750,000'),
    }),
    cell({
      type: field('Physical Damage'),
      insurer: field('PROGRESSIVE EXPRESS INSURANCE COMPANY', 'low'),
      policyNumber: field('878508616', 'low'),
      effectiveAt: field('08/14/2026', 'low'),
      expiresAt: field('08/14/2027', 'medium'),
      limit: field('Deductibles - Comp: $2,500, Coll: $2,500'),
    }),
  ],
  vehicles: [
    {
      vin: field('3AKJHHDV6MSMM0761'),
      description: field('2021, FREIGHTLINER, Cascadia'),
    },
    {
      vin: field('3AKJHHDR7LSLR0633'),
      description: field('2020, FREIGHTLINER, Cascadia'),
    },
  ],
})

const parsed = (over: Record<string, unknown> = {}) =>
  parseCoiResponse(JSON.stringify({ ...CHAPAN(), ...over }))

describe('what the contract carries', () => {
  it('has exactly the five fields, and the schema agrees', () => {
    expect([...COI_FIELDS].sort()).toEqual(
      Object.keys(COI_SCHEMA.properties).sort(),
    )
    expect([...COI_SCHEMA.required].sort()).toEqual([...COI_FIELDS].sort())
  })

  // THE LISTS ARE WHERE THE ASSUMPTION USED TO LIVE, so their cells are held to
  // the same agreement the top level is.
  it('keeps the coverage and vehicle cells in step with the schema', () => {
    const coverages = COI_SCHEMA.properties.coverages.items.properties
    expect([...COI_COVERAGE_FIELDS].sort()).toEqual(
      Object.keys(coverages).sort(),
    )
    const vehicles = COI_SCHEMA.properties.vehicles.items.properties
    expect([...COI_VEHICLE_FIELDS].sort()).toEqual(Object.keys(vehicles).sort())
  })

  // PER-CELL CONFIDENCE IS THE POINT OF THE LIST SHAPE. A row wrapped in one
  // envelope would report its best cell — see `cdl-shape.ts` for the ten runs.
  it('puts an envelope on every cell rather than around a row', () => {
    const coverages = COI_SCHEMA.properties.coverages.items
      .properties as Record<string, { required?: readonly string[] }>
    for (const key of COI_COVERAGE_FIELDS) {
      expect(coverages[key]?.required).toEqual(['value', 'confidence'])
    }
  })

  it('forbids anything the schema does not name, at both levels', () => {
    expect(COI_SCHEMA.additionalProperties).toBe(false)
    expect(COI_SCHEMA.properties.coverages.items.additionalProperties).toBe(
      false,
    )
    expect(COI_SCHEMA.properties.vehicles.items.additionalProperties).toBe(
      false,
    )
  })
})

describe('what the contract must never carry', () => {
  const source = readFileSync(
    join(process.cwd(), 'src', 'lib', 'extraction', 'coi-shape.ts'),
    'utf8',
  )

  for (const forbidden of COI_FORBIDDEN_FIELDS) {
    it(`has no ${forbidden} in the schema`, () => {
      expect(Object.keys(COI_SCHEMA.properties)).not.toContain(forbidden)
    })

    it(`has no ${forbidden} declared in the TypeScript shape`, () => {
      const declaration = new RegExp(String.raw`^\s+${forbidden}\??:`, 'm')
      expect(declaration.test(source)).toBe(false)
    })
  }

  it('refuses them by name in the prompt', () => {
    const prompt = COI_EXTRACTION_SYSTEM_WITH_SCHEMA.toLowerCase()
    for (const phrase of [
      'certificate holder',
      'producer',
      'description of operations',
      'premium',
    ]) {
      expect(prompt).toContain(phrase)
    }
    expect(prompt).toContain('do not return, ever')
  })
})

describe('the prompt asks for transcription, not interpretation', () => {
  const body = COI_EXTRACTION_SYSTEM_WITH_SCHEMA.slice(
    0,
    COI_EXTRACTION_SYSTEM_WITH_SCHEMA.indexOf('JSON Schema:'),
  )

  it('asks for dates exactly as printed and never for ISO', () => {
    expect(body).toContain('EXACTLY AS PRINTED')
    expect(body).toContain('Do not convert them')
    expect(body).not.toContain('yyyy-mm-dd')
  })

  it('offers no list of permitted values anywhere', () => {
    expect(body).not.toMatch(/one of:|must be one of|permitted values/i)
  })

  // THE REGRESSION THIS CONTRACT WAS REBUILT FOR. The first prompt said "the
  // policy number for the AUTO LIABILITY coverage" and "the cargo limit,
  // usually on an inland marine line" — an enum written in prose, on a
  // certificate that carries neither coverage.
  it('names no coverage it expects to find', () => {
    expect(body).not.toMatch(/auto liability|cargo limit|inland marine/i)
  })

  // THE CASE THE FIRST CERTIFICATE CREATES: one date pair, two coverage rows.
  it('tells the model to say so when it is inferring which row a value is on', () => {
    expect(body).toContain('do NOT copy a value down from another row')
    expect(body).toContain('LOW confidence')
  })
})

describe('one coverage row at a time', () => {
  const row = (over: Record<string, unknown> = {}) =>
    parsed({ coverages: [cell({ ...CHAPAN().coverages[0], ...over })] })
      .coverages![0]!

  it('reads the certificate row that is fully printed', () => {
    expect(judgeCoverageRow(row())).toEqual({
      ok: true,
      expiresIso: '2027-08-14',
      effectiveIso: '2026-08-14',
    })
  })

  // THE SPINE. A compliance row cannot exist without an expiry — the column is
  // NOT NULL and it is the only field that feeds an alarm.
  it('refuses a row with no expiry', () => {
    expect(judgeCoverageRow(row({ expiresAt: null }))).toEqual({
      ok: false,
      reason: 'no_expiry',
    })
  })

  // AND THIS IS THE CLAUSE THE SECOND ROW DEPENDS ON. A date the model
  // inherited from the row above, reported honestly as `low`, must not become
  // an alarm nobody checked.
  it('refuses an expiry the model said it was guessing at', () => {
    expect(
      judgeCoverageRow(row({ expiresAt: field('08/14/2027', 'low') })),
    ).toEqual({ ok: false, reason: 'low_confidence_expiry' })
  })

  it('refuses an expiry in no stated format', () => {
    expect(
      judgeCoverageRow(row({ expiresAt: field('sometime in August') })),
    ).toEqual({ ok: false, reason: 'unreadable_expiry' })
  })

  // BOTH DATES COME OFF ONE ROW IN ONE HAND. If one will not read, the reading
  // of the other is not to be trusted either.
  it('refuses when the effective date will not read', () => {
    expect(judgeCoverageRow(row({ effectiveAt: field('n/a') }))).toEqual({
      ok: false,
      reason: 'unreadable_effective',
    })
  })

  it('refuses a row that expires before it starts', () => {
    expect(
      judgeCoverageRow(
        row({
          effectiveAt: field('08/14/2027'),
          expiresAt: field('08/14/2026'),
        }),
      ),
    ).toEqual({ ok: false, reason: 'expiry_before_effective' })
  })

  // Catches a transposed decade — 2027 read as 2037 — rather than adjudicating
  // what an underwriter may sell.
  it('refuses an implausible term', () => {
    expect(
      judgeCoverageRow(
        row({
          effectiveAt: field('08/14/2026'),
          expiresAt: field('08/14/2037'),
        }),
      ),
    ).toEqual({ ok: false, reason: 'implausible_term' })
  })

  // A policy number is the obvious spine candidate and is deliberately not it:
  // it identifies the policy but it triggers nothing.
  it('accepts a row with no policy number', () => {
    expect(judgeCoverageRow(row({ policyNumber: null })).ok).toBe(true)
  })
})

describe('when a certificate was not read', () => {
  it('accepts the real one', () => {
    expect(refuseCoi(parsed())).toBeNull()
  })

  // ONE BAD ROW DOES NOT TAKE THE DOCUMENT DOWN. The first version refused the
  // whole certificate on one missing expiry, which only worked while a
  // certificate was assumed to be one policy.
  it('accepts a certificate whose second row is unusable', () => {
    const [first] = CHAPAN().coverages
    expect(
      refuseCoi(
        parsed({
          coverages: [first, cell({ type: field('Physical Damage') })],
        }),
      ),
    ).toBeNull()
  })

  it('refuses when not one row yields an expiry', () => {
    expect(
      refuseCoi(parsed({ coverages: [cell({ type: field('Cargo') })] })),
    ).toBe('no_usable_coverage')
  })

  it('tells an empty coverages table apart from a document it could not read', () => {
    expect(refuseCoi(parsed({ coverages: [] }))).toBe('no_coverage_rows')
    expect(
      refuseCoi(parsed({ coverages: null, insuredName: null, vehicles: null })),
    ).toBe('not_a_certificate')
  })
})

describe('what a printed coverage might be', () => {
  // THE REASON THIS TABLE IS ORDERED. Non-trucking liability covers a tractor
  // when it is NOT under dispatch; filed as primary liability it would make an
  // owner-operator look covered for exactly the miles they are not.
  it('does not read non-trucking liability as liability', () => {
    const proposal = proposeCoverage('Non-Trucking Liability')
    expect(proposal.type).toBe('OTHER')
    expect(proposal.caution).toContain('not under dispatch')
  })

  it('reads physical damage and cargo', () => {
    expect(proposeCoverage('Physical Damage').type).toBe(
      'INSURANCE_PHYSICAL_DAMAGE',
    )
    expect(proposeCoverage('Motor Truck Cargo').type).toBe('INSURANCE_CARGO')
  })

  it('reads plain automobile liability as liability', () => {
    expect(proposeCoverage('AUTOMOBILE LIABILITY').type).toBe(
      'INSURANCE_LIABILITY',
    )
  })

  // UNRECOGNISED IS NOT INVALID — the `cdl-codes.ts` wording, for the same
  // reason. The person picks; nothing is guessed.
  it('says nothing about a coverage it does not know', () => {
    expect(proposeCoverage('Garagekeepers Legal Liability Form B').type).toBe(
      null,
    )
    expect(proposeCoverage(null).type).toBe(null)
  })
})

describe('a VIN, checked and never corrected', () => {
  // BOTH BRANCHES OBSERVED, which is the standing rule for a guard: break it on
  // purpose and watch it fire. These two VINs are off the certificate.
  it('accepts the two the certificate prints', () => {
    expect(checkVin('3AKJHHDV6MSMM0761')).toEqual({
      ok: true,
      vin: '3AKJHHDV6MSMM0761',
    })
    expect(checkVin('3AKJHHDR7LSLR0633')).toEqual({
      ok: true,
      vin: '3AKJHHDR7LSLR0633',
    })
  })

  it('catches the classic misread — an O where a 0 is printed', () => {
    expect(checkVin('3AKJHHDV6MSMMO761')).toEqual({
      ok: false,
      vin: '3AKJHHDV6MSMMO761',
      reason: 'illegal_character',
    })
  })

  it('catches a transposition the alphabet cannot', () => {
    // Two characters swapped. Every character is legal; the sum is not.
    const check = checkVin('3AKJHHDV6MSMM0716')
    expect(check?.ok === false && check.reason).toBe('check_digit')
  })

  it('catches a VIN that is not seventeen characters', () => {
    const check = checkVin('3AKJHHDV6MSMM076')
    expect(check?.ok === false && check.reason).toBe('wrong_length')
  })

  it('reads through the label and the spacing a certificate prints', () => {
    expect(checkVin('VIN: 3AKJ HHDV6 MSMM0761')).toEqual({
      ok: true,
      vin: '3AKJHHDV6MSMM0761',
    })
  })

  // IT NEVER CORRECTS. The value comes back exactly as it was read.
  it('carries a failed VIN through unchanged', () => {
    const check = checkVin('3akjhhdv6msmmo761')
    expect(check?.ok).toBe(false)
    expect(check && !check.ok && check.vin).toBe('3AKJHHDV6MSMMO761')
  })
})

describe('whose certificate is this', () => {
  const ram = {
    id: 'ram',
    name: 'RAM Haulage',
    mcNumber: 'MC-112499',
    dotNumber: '3162967',
  }
  const truck = (over: Record<string, unknown> = {}) => ({
    id: 't-0633',
    unitNumber: '0633',
    vin: '3AKJHHDR7LSLR0633',
    companyId: 'ram',
    companyName: 'RAM Haulage',
    ...over,
  })

  // BRANCH ONE. Our own carrier's certificate files at the company.
  it('files at the carrier when the insured is one of ours', () => {
    const { subject } = decideCoiSubject(
      parsed({ insuredName: field('RAM HAULAGE LLC') }),
      { authorities: [ram], trucks: [] },
    )
    expect(subject.kind).toBe('company')
    expect(subject.kind === 'company' && subject.company.id).toBe('ram')
  })

  // AND THE ORDER MATTERS. A fleet policy that happens to schedule a tractor
  // must still land on the carrier, or the other hundred trucks show uninsured.
  it('prefers the carrier even when the VINs also match', () => {
    const { subject } = decideCoiSubject(
      parsed({ insuredName: field('RAM HAULAGE LLC') }),
      { authorities: [ram], trucks: [truck()] },
    )
    expect(subject.kind).toBe('company')
  })

  // BRANCH TWO. The owner-operator: CHAPAN INC is nobody's authority here.
  it('files per truck when the insured is not ours but the VINs are', () => {
    const { subject, vehicles } = decideCoiSubject(parsed(), {
      authorities: [ram],
      trucks: [truck()],
    })
    expect(subject.kind).toBe('trucks')
    expect(subject.kind === 'trucks' && subject.truckIds).toEqual(['t-0633'])
    expect(subject.because).toContain('CHAPAN INC')
    expect(subject.because).toContain('0633')
    // The VIN the fleet does not carry is reported, not silently dropped.
    expect(vehicles.filter((row) => row.kind === 'no_truck')).toHaveLength(1)
  })

  // BRANCH THREE. Neither — and it ASKS rather than picking the only carrier.
  it('asks when neither the insured nor a VIN can be placed', () => {
    const { subject } = decideCoiSubject(parsed(), {
      authorities: [ram],
      trucks: [],
    })
    expect(subject.kind).toBe('ask')
    expect(subject.because).toContain('CHAPAN INC')
  })

  // A USDOT NUMBER CANNOT BE SPELLED TWO WAYS.
  it('matches a carrier by its USDOT even when the name disagrees', () => {
    const { subject } = decideCoiSubject(
      parsed({
        insuredName: field('R.A.M. HAULAGE OF FLORIDA'),
        insuredDot: field('3162967'),
      }),
      { authorities: [ram], trucks: [] },
    )
    expect(subject.kind).toBe('company')
    expect(subject.because).toContain('USDOT')
  })

  it('never uses a VIN that failed its check as a key', () => {
    const { vehicles } = decideCoiSubject(
      parsed({
        vehicles: [{ vin: field('3AKJHHDV6MSMMO761'), description: null }],
      }),
      { authorities: [ram], trucks: [truck()] },
    )
    expect(vehicles).toHaveLength(1)
    expect(vehicles[0]!.kind).toBe('unreadable')
  })
})

describe('a VIN filling a null', () => {
  it('fills a truck that carries none', () => {
    expect(planVinFill({ vin: null }, '3AKJHHDR7LSLR0633')).toBe('fills')
  })

  it('does nothing where the same VIN is already on record', () => {
    expect(planVinFill({ vin: '3AKJHHDR7LSLR0633' }, '3akjhhdr7lslr0633')).toBe(
      'already_matches',
    )
  })

  // ADD-MISSING, NEVER REPLACE. A disagreement is shown, not resolved.
  it('reports a conflict rather than overwriting', () => {
    expect(planVinFill({ vin: '3AKJHHDV6MSMM0761' }, '3AKJHHDR7LSLR0633')).toBe(
      'conflict',
    )
  })
})

describe('the proposal the confirm step renders', () => {
  const ram = {
    id: 'ram',
    name: 'RAM Haulage',
    mcNumber: 'MC-112499',
    dotNumber: '3162967',
  }

  it('keeps every printed row, including one it cannot file', () => {
    const proposal = coiProposal(
      parsed({
        coverages: [
          CHAPAN().coverages[0],
          cell({ type: field('Physical Damage') }),
        ],
      }),
      { authorities: [ram], trucks: [] },
    )
    expect(proposal.coverages).toHaveLength(2)
    expect(proposal.coverages[1]!.refusal).toBe('no_expiry')
    expect(proposal.coverages[1]!.expiresAt).toBeNull()
  })

  // THE LOWEST CELL, NOT THE FIRST OR THE AVERAGE. A summary that reports
  // better than its worst cell is the failure per-element confidence ends.
  it('reports a row at the confidence of its worst cell', () => {
    const proposal = coiProposal(parsed(), {
      authorities: [ram],
      trucks: [],
    })
    expect(proposal.coverages[0]!.confidence).toBe('high')
    expect(proposal.coverages[1]!.confidence).toBe('low')
  })

  it('shows the printed type beside the obligation it proposes', () => {
    const proposal = coiProposal(parsed(), {
      authorities: [ram],
      trucks: [],
    })
    expect(proposal.coverages[0]!.printedType).toBe('Non-Trucking Liability')
    expect(proposal.coverages[0]!.proposedType).toBe('OTHER')
    expect(proposal.coverages[1]!.printedType).toBe('Physical Damage')
  })

  // THE LIMIT CELL IS NOT ALWAYS A LIMIT, which is why nothing parses it.
  it('carries a deductible through as printed', () => {
    const proposal = coiProposal(parsed(), {
      authorities: [ram],
      trucks: [],
    })
    expect(proposal.coverages[1]!.limit).toBe(
      'Deductibles - Comp: $2,500, Coll: $2,500',
    )
  })

  // THE CROSS-CHECK WOULD FIRE ON EVERY CORRECT OWNER-OPERATOR CERTIFICATE,
  // so it is absent on that branch rather than shown and ignored.
  it('runs the carrier check only where a carrier was matched', () => {
    expect(
      coiProposal(parsed(), { authorities: [ram], trucks: [] }).carrier,
    ).toBeNull()
    expect(
      coiProposal(parsed({ insuredName: field('RAM HAULAGE LLC') }), {
        authorities: [ram],
        trucks: [],
      })!.carrier?.agrees,
    ).toBe(true)
  })
})

describe('does this certificate name the carrier it is filed against', () => {
  const ram = { name: 'RAM Haulage', mcNumber: '1234567', dotNumber: '3456789' }
  const ours = (over: Record<string, unknown> = {}) =>
    parsed({
      insuredName: field('RAM HAULAGE LLC'),
      insuredMc: field('MC-1234567'),
      insuredDot: field('3456789'),
      ...over,
    })

  it('accepts a legal suffix as agreement', () => {
    const check = checkCarrier(ours(), ram)
    expect(check.agrees).toBe(true)
    expect(check.notes).toEqual([])
  })

  it('says so when the certificate names somebody else', () => {
    const check = checkCarrier(
      ours({ insuredName: field('Dolphins Transport Inc') }),
      ram,
    )
    expect(check.agrees).toBe(false)
    expect(check.notes.join()).toContain('Dolphins Transport Inc')
  })

  // A USDOT NUMBER CANNOT BE SPELLED TWO WAYS, which is why it is the stronger
  // signal wherever both sides have one.
  it('catches a USDOT that disagrees', () => {
    const check = checkCarrier(ours({ insuredDot: field('9999999') }), ram)
    expect(check.agrees).toBe(false)
    expect(check.notes.join()).toContain('9999999')
  })

  it('ignores punctuation in an MC number', () => {
    expect(
      checkCarrier(ours({ insuredMc: field('1234567') }), ram).agrees,
    ).toBe(true)
  })

  // ABSENCE IS NEVER A DISAGREEMENT. Most certificates print neither number.
  it('says nothing when the certificate prints no numbers', () => {
    expect(
      checkCarrier(ours({ insuredMc: null, insuredDot: null }), ram).agrees,
    ).toBe(true)
  })

  it('says nothing when the company row holds no numbers', () => {
    expect(
      checkCarrier(ours(), {
        name: 'RAM Haulage',
        mcNumber: null,
        dotNumber: null,
      }).agrees,
    ).toBe(true)
  })
})

describe('the shared date rule', () => {
  it('reads the three printed shapes as one day', () => {
    expect(parseUsDate('03/04/2027')).toEqual({ ok: true, iso: '2027-03-04' })
    expect(parseUsDate('2027-03-04')).toEqual({ ok: true, iso: '2027-03-04' })
    expect(parseUsDate('Mar 4, 2027')).toEqual({ ok: true, iso: '2027-03-04' })
  })

  it('refuses a format nobody stated', () => {
    expect(parseUsDate('4 March 2027').ok).toBe(false)
  })
})
