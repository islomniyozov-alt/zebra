import { describe, expect, it } from 'vitest'
import {
  FmcsaError,
  carrierNumber,
  concernsFor,
  lookupCarrier,
  parseCarrier,
} from '@/lib/fmcsa'

// ---------------------------------------------------------------------------
// WRITTEN FROM THE DOCUMENTATION, NOT FROM A RECORDED RESPONSE.
//
// `FMCSA_WEBKEY` is a secret on the workers and deliberately not on this
// machine, so no call has been made against the live API. The payloads below
// are the QCMobile response shape as documented — which makes these tests a
// proof that the READER is right about that shape, and not a proof that the
// shape is right. The first real lookup is the second half of the evidence and
// it is flagged as owed.
//
// That is also why `parseCarrier` is tested so hard on absence: everything it
// cannot find must come back null, because null lands as a blank field on a
// form somebody is about to check, and a wrong guess lands as a legal name on
// an invoice.
// ---------------------------------------------------------------------------

/** The documented DOT-lookup shape: `content` is one object. */
const dotPayload = (carrier: Record<string, unknown>) => ({
  content: { carrier },
  retrievalDate: '2026-08-12',
})

/** The documented docket-lookup shape: `content` is an array. */
const docketPayload = (carrier: Record<string, unknown>) => ({
  content: [{ carrier }],
  retrievalDate: '2026-08-12',
})

const HEALTHY = {
  dotNumber: 1234567,
  legalName: 'MERIDIAN FREIGHT LLC',
  dbaName: 'MERIDIAN',
  phyStreet: '4400 ELDER CREEK RD',
  phyCity: 'SACRAMENTO',
  phyState: 'CA',
  phyZipcode: '95824',
  telephone: '9165551234',
  allowedToOperate: 'Y',
  statusCode: 'A',
  oosDate: null,
  commonAuthorityStatus: 'A',
  contractAuthorityStatus: 'N',
  brokerAuthorityStatus: 'N',
  safetyRating: 'S',
  censusTypeId: { censusType: 'C', censusTypeDesc: 'CARRIER', censusTypeId: 1 },
  carrierOperation: {
    carrierOperationCode: 'A',
    carrierOperationDesc: 'Interstate',
  },
}

describe('a typed register number', () => {
  it.each([
    ['1234567', '1234567'],
    ['MC-123456', '123456'],
    ['mc 123456', '123456'],
    ['MC#123456', '123456'],
    ['USDOT 1234567', '1234567'],
    ['  1234567  ', '1234567'],
    // Leading zeros are the same authority, and the API wants the number.
    ['0001234', '1234'],
  ])('reads %s as %s', (typed, expected) => {
    expect(carrierNumber(typed)).toBe(expected)
  })

  it.each(['', '   ', 'MC-', 'abc', '12-34', '1234567890'])(
    'refuses %s rather than putting it in a URL',
    (typed) => {
      expect(carrierNumber(typed)).toBeNull()
    },
  )
})

describe('reading the register’s answer', () => {
  it('reads a DOT lookup', () => {
    const carrier = parseCarrier(dotPayload(HEALTHY))
    expect(carrier).not.toBeNull()
    expect(carrier!.dotNumber).toBe('1234567')
    expect(carrier!.legalName).toBe('MERIDIAN FREIGHT LLC')
    expect(carrier!.dbaName).toBe('MERIDIAN')
    expect(carrier!.addressLine1).toBe('4400 ELDER CREEK RD')
    expect(carrier!.city).toBe('SACRAMENTO')
    expect(carrier!.state).toBe('CA')
    expect(carrier!.postalCode).toBe('95824')
    expect(carrier!.entityType).toBe('CARRIER')
    expect(carrier!.operation).toBe('Interstate')
    expect(carrier!.allowedToOperate).toBe(true)
  })

  // THE TWO ENDPOINTS ANSWER IN DIFFERENT SHAPES. A docket number can exist as
  // MC, FF and MX, so that endpoint returns a list; the DOT endpoint returns
  // one object. A reader that handled only the shape it was written against
  // would work for one of the two buttons on the form.
  it('reads a docket lookup, whose content is a list', () => {
    const carrier = parseCarrier(docketPayload(HEALTHY))
    expect(carrier?.legalName).toBe('MERIDIAN FREIGHT LLC')
  })

  it('keeps the phone exactly as the register holds it', () => {
    // Not reformatted into (916) 555-1234. A number somebody can compare
    // against the register beats a prettier one they cannot.
    expect(parseCarrier(dotPayload(HEALTHY))?.phone).toBe('9165551234')
  })

  it('returns null when there is no carrier in the payload', () => {
    expect(parseCarrier(null)).toBeNull()
    expect(parseCarrier({})).toBeNull()
    // How the docket endpoint says "no such number" — a 200 with nothing in it.
    expect(parseCarrier({ content: [] })).toBeNull()
    expect(parseCarrier({ content: { carrier: null } })).toBeNull()
  })

  // A THIRD PARTY CAN CHANGE A FIELD'S TYPE WITHOUT TELLING ANYBODY. Every
  // reader has to survive that as a blank, because the alternative lands
  // "[object Object]" in a legal name on an invoice.
  it('blanks a field whose type is not what it should be', () => {
    const carrier = parseCarrier(
      dotPayload({
        ...HEALTHY,
        legalName: { value: 'MERIDIAN' },
        phyCity: ['SACRAMENTO'],
        censusTypeId: 'CARRIER',
        carrierOperation: null,
      }),
    )
    expect(carrier!.legalName).toBeNull()
    expect(carrier!.city).toBeNull()
    expect(carrier!.entityType).toBeNull()
    expect(carrier!.operation).toBeNull()
    // And the fields that were fine are still fine.
    expect(carrier!.state).toBe('CA')
  })

  it('treats an empty string as absent', () => {
    const carrier = parseCarrier(
      dotPayload({ ...HEALTHY, dbaName: '', oosDate: '   ' }),
    )
    expect(carrier!.dbaName).toBeNull()
    expect(carrier!.outOfServiceDate).toBeNull()
  })
})

describe('what is worth saying out loud', () => {
  it('says nothing about a carrier in good standing', () => {
    expect(concernsFor(parseCarrier(dotPayload(HEALTHY))!)).toEqual([])
  })

  it('leads with "not allowed to operate"', () => {
    const carrier = parseCarrier(
      dotPayload({ ...HEALTHY, allowedToOperate: 'N', statusCode: 'I' }),
    )!
    expect(concernsFor(carrier)[0]).toBe('not_allowed_to_operate')
    expect(concernsFor(carrier)).toContain('inactive')
  })

  it('names an out-of-service order', () => {
    const carrier = parseCarrier(
      dotPayload({ ...HEALTHY, oosDate: '2026-03-14' }),
    )!
    expect(concernsFor(carrier)).toContain('out_of_service')
    expect(carrier.outOfServiceDate).toBe('2026-03-14')
  })

  it('notices that none of the three authorities is active', () => {
    const carrier = parseCarrier(
      dotPayload({
        ...HEALTHY,
        commonAuthorityStatus: 'I',
        contractAuthorityStatus: 'N',
        brokerAuthorityStatus: 'N',
      }),
    )!
    expect(concernsFor(carrier)).toContain('no_active_authority')
  })

  // A RECORD THAT SAYS NOTHING MUST NOT BE READ AS BAD NEWS. All three
  // authority fields absent is a gap in the answer, not a carrier without
  // authority, and warning on it would train somebody to click past the
  // warning that matters.
  it('stays quiet when the register said nothing about authority at all', () => {
    const carrier = parseCarrier(
      dotPayload({
        ...HEALTHY,
        commonAuthorityStatus: null,
        contractAuthorityStatus: null,
        brokerAuthorityStatus: null,
      }),
    )!
    expect(concernsFor(carrier)).toEqual([])
  })

  // "Conditional" is a real rating that real carriers haul under. Warning
  // about it would be this screen taking a position the FMCSA did not.
  it('warns on Unsatisfactory and not on Conditional', () => {
    const rating = (safetyRating: string) =>
      concernsFor(parseCarrier(dotPayload({ ...HEALTHY, safetyRating }))!)
    expect(rating('U')).toContain('unsatisfactory_rating')
    expect(rating('C')).toEqual([])
    expect(rating('S')).toEqual([])
  })
})

describe('the call itself', () => {
  const ok = (payload: unknown) =>
    ({
      ok: true,
      status: 200,
      json: async () => payload,
    }) as unknown as Response

  it('refuses without a web key, by name, before any fetch', async () => {
    let called = false
    await expect(
      lookupCarrier(
        { kind: 'dot', number: '1234567' },
        {
          webKey: undefined,
          fetchImpl: (async () => {
            called = true
            return ok({})
          }) as unknown as typeof fetch,
        },
      ),
    ).rejects.toMatchObject({ reason: 'no_web_key' })
    expect(called).toBe(false)
  })

  // THE KEY IS A QUERY PARAMETER BECAUSE THE API TAKES IT THAT WAY, which is
  // exactly why it must never be reachable from a browser. Asserted here so
  // the URL shape is a decision on the record rather than an accident.
  it('sends the key and hits the DOT endpoint', async () => {
    let url = ''
    await lookupCarrier(
      { kind: 'dot', number: '1234567' },
      {
        webKey: 'SECRET',
        fetchImpl: (async (target: string) => {
          url = target
          return ok(dotPayload(HEALTHY))
        }) as unknown as typeof fetch,
      },
    )
    expect(url).toBe(
      'https://mobile.fmcsa.dot.gov/qc/services/carriers/1234567?webKey=SECRET',
    )
  })

  it('hits the docket endpoint for an MC number', async () => {
    let url = ''
    await lookupCarrier(
      { kind: 'mc', number: '123456' },
      {
        webKey: 'SECRET',
        fetchImpl: (async (target: string) => {
          url = target
          return ok(docketPayload(HEALTHY))
        }) as unknown as typeof fetch,
      },
    )
    expect(url).toContain('/carriers/docket-number/123456?webKey=SECRET')
  })

  it('refuses a number that is not a number, before any fetch', async () => {
    await expect(
      lookupCarrier(
        { kind: 'dot', number: '12; DROP' },
        {
          webKey: 'SECRET',
          fetchImpl: (() => {
            throw new Error('should not be called')
          }) as unknown as typeof fetch,
        },
      ),
    ).rejects.toMatchObject({ reason: 'bad_number' })
  })

  it('turns a 404 into "no carrier", not into a fault', async () => {
    await expect(
      lookupCarrier(
        { kind: 'dot', number: '1' },
        {
          webKey: 'SECRET',
          fetchImpl: (async () =>
            ({
              ok: false,
              status: 404,
              text: async () => '',
            }) as Response) as unknown as typeof fetch,
        },
      ),
    ).rejects.toMatchObject({ reason: 'not_found' })
  })

  // The docket endpoint answers an unknown number with 200 and an empty list.
  it('turns an empty 200 into "no carrier" too', async () => {
    await expect(
      lookupCarrier(
        { kind: 'mc', number: '1' },
        {
          webKey: 'SECRET',
          fetchImpl: (async () =>
            ok({ content: [] })) as unknown as typeof fetch,
        },
      ),
    ).rejects.toMatchObject({ reason: 'not_found' })
  })

  it('names a server fault separately from a missing carrier', async () => {
    await expect(
      lookupCarrier(
        { kind: 'dot', number: '1234567' },
        {
          webKey: 'SECRET',
          fetchImpl: (async () =>
            ({
              ok: false,
              status: 503,
              text: async () => 'down',
            }) as Response) as unknown as typeof fetch,
        },
      ),
    ).rejects.toMatchObject({ reason: 'http_error', status: 503 })
  })

  // A thrown fetch is a network failure, and the form must survive it.
  it('names an unreachable register', async () => {
    await expect(
      lookupCarrier(
        { kind: 'dot', number: '1234567' },
        {
          webKey: 'SECRET',
          fetchImpl: (async () => {
            throw new TypeError('network error')
          }) as unknown as typeof fetch,
        },
      ),
    ).rejects.toBeInstanceOf(FmcsaError)
  })

  it('names a 200 that is not JSON', async () => {
    await expect(
      lookupCarrier(
        { kind: 'dot', number: '1234567' },
        {
          webKey: 'SECRET',
          fetchImpl: (async () =>
            ({
              ok: true,
              status: 200,
              json: async () => {
                throw new Error('not json')
              },
            }) as unknown as Response) as unknown as typeof fetch,
        },
      ),
    ).rejects.toMatchObject({ reason: 'unreadable' })
  })
})

describe('the same record, judged for who is asking', () => {
  // A PURE BROKER RUNS NO TRUCKS. Common and contract authority are `N`
  // because they were never granted, not because anything went wrong, and the
  // general "no active authority" sentence would be an accusation built out of
  // the ordinary case.
  const broker = (brokerAuthorityStatus: string | null) => ({
    ...HEALTHY,
    commonAuthorityStatus: 'N',
    contractAuthorityStatus: 'N',
    brokerAuthorityStatus,
    safetyRating: null,
    censusTypeId: { censusTypeDesc: 'BROKER' },
  })

  it('says nothing about a broker whose broker authority is active', () => {
    const carrier = parseCarrier(dotPayload(broker('A')))!
    expect(concernsFor(carrier, 'broker')).toEqual([])
  })

  // THE NOT-GETTING-PAID GATE. `I` means granted and since revoked or lapsed,
  // which is the fact that decides whether an unpaid invoice has a live surety
  // bond behind it.
  it('warns in words when broker authority is inactive', () => {
    const carrier = parseCarrier(dotPayload(broker('I')))!
    expect(concernsFor(carrier, 'broker')).toContain(
      'broker_authority_inactive',
    )
  })

  it('and says a different thing when there never was any', () => {
    const carrier = parseCarrier(dotPayload(broker('N')))!
    const concerns = concernsFor(carrier, 'broker')
    expect(concerns).toContain('broker_authority_none')
    expect(concerns).not.toContain('broker_authority_inactive')
  })

  // ABSENT DATA STAYS A GAP, NOT AN ACCUSATION. A register that did not answer
  // about broker authority has not said there is none.
  it('stays silent when the register said nothing about broker authority', () => {
    const carrier = parseCarrier(dotPayload(broker(null)))!
    expect(concernsFor(carrier, 'broker')).toEqual([])
  })

  // A SHIPPER HOLDS NO AUTHORITY OF ANY KIND AND IS NOT SUPPOSED TO. A factory
  // handing us freight is the ordinary case, and warning about it would train
  // somebody to click past the warning that matters.
  it('says nothing at all about a shipper with no authority', () => {
    const carrier = parseCarrier(dotPayload(broker('N')))!
    expect(concernsFor(carrier, 'shipper')).toEqual([])
  })

  // The same record read as an authority WE book under: broker authority is
  // not the question, and none of the three being active is.
  it('still reports no active authority for an operating authority', () => {
    const carrier = parseCarrier(dotPayload(broker('N')))!
    const concerns = concernsFor(carrier, 'operating')
    expect(concerns).toContain('no_active_authority')
    expect(concerns).not.toContain('broker_authority_none')
  })

  // Whoever is asking, an out-of-service order and a revoked right to operate
  // are said out loud.
  it('reports being barred from operating to every audience', () => {
    const barred = parseCarrier(
      dotPayload({
        ...broker('A'),
        allowedToOperate: 'N',
        oosDate: '2026-01-09',
      }),
    )!
    for (const audience of ['operating', 'broker', 'shipper'] as const) {
      expect(concernsFor(barred, audience)).toContain('not_allowed_to_operate')
      expect(concernsFor(barred, audience)).toContain('out_of_service')
    }
  })
})
