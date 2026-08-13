import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { retryingClient } from '../retrying-client'
import { withOrg } from '@/lib/tenancy'
import {
  askForExtraction,
  beginExtraction,
  recordExtraction,
  storedExtraction,
} from '@/lib/rate-confirmation'
import type { PrismaClient } from '@/generated/prisma/client'

// ---------------------------------------------------------------------------
// THE OCR COLUMNS, FINALLY WRITTEN (Phase 5 §3 step 1).
//
// `ocrStatus`, `ocrText`, `extractedJson` and `ocrError` have been in the
// schema since the init migration, with a comment saying they were there "so
// that enabling AI extraction is a background job, not a migration". Nothing
// has ever written one. This is the test that they are written, and written
// correctly on the failure paths too — a document that could not be read must
// not look like a document nobody tried.
//
// No network: `fetchImpl` is injected. What is real here is Postgres.
// ---------------------------------------------------------------------------

let owner: PrismaClient
let organizationId = ''
let companyId = ''
let userId = ''
const nonce = Math.random().toString(36).slice(2, 8)

const inOrg = <T>(fn: Parameters<typeof withOrg<T>>[1]): Promise<T> =>
  withOrg(organizationId, fn, {
    attribution: { userId, ip: null, userAgent: 'extraction.test' },
    maxWaitMs: 20_000,
  })

/** A well-formed model answer, as text. */
const answer = (over: Record<string, unknown> = {}) =>
  JSON.stringify({
    brokerName: { value: 'Midwest Logistics', confidence: 'high' },
    brokerReference: { value: 'ML-99120', confidence: 'high' },
    bolNumber: { value: '4471902', confidence: 'medium' },
    poNumber: null,
    commodity: { value: 'Frozen peas', confidence: 'high' },
    weightLbs: { value: 42_000, confidence: 'high' },
    pieces: null,
    pallets: { value: 24, confidence: 'medium' },
    equipmentType: { value: 'REEFER', confidence: 'high' },
    tempF: { value: -10, confidence: 'high' },
    isHazmat: { value: false, confidence: 'high' },
    isTeam: null,
    sealNumber: null,
    instructions: null,
    stops: [
      {
        type: { value: 'PICKUP', confidence: 'high' },
        name: { value: 'Green Valley Cold', confidence: 'high' },
        addressLine1: { value: '4400 W 51st St', confidence: 'high' },
        addressLine2: null,
        city: { value: 'Chicago', confidence: 'high' },
        state: { value: 'IL', confidence: 'high' },
        postalCode: { value: '60632', confidence: 'high' },
        scheduledAt: { value: '2026-08-12T08:00', confidence: 'medium' },
        windowStart: null,
        windowEnd: null,
        referenceNumber: { value: 'PU-88123', confidence: 'high' },
        contactName: null,
        contactPhone: null,
        instructions: null,
      },
    ],
    money: {
      linehaul: { value: '$1,850.00', confidence: 'high' },
      fuelSurcharge: { value: '$412.50', confidence: 'high' },
      total: { value: '$2,262.50', confidence: 'high' },
      accessorials: [],
    },
    ...over,
  })

/** A fetch that returns one canned Claude response. */
/**
 * A stubbed answer in the SHIPPED ENGINE'S SHAPE.
 *
 * It used to be Anthropic's — `content[].text`, `usage.input_tokens` — and it
 * stayed that way when `EXTRACTION_MODEL` became `gemini-3.6-flash`. Since
 * `askModel` routes on the resolved model, every one of these tests was really
 * asking Gemini to read an Anthropic response, getting "returned no text", and
 * failing. Four of them had been red since the engine switch and nobody saw it,
 * because the integration project runs under `npm test` and not under
 * `npm run check`.
 *
 * Which is the lesson worth keeping: a suite that is not in the gate is a
 * suite that reports on nothing.
 */
const replying = (text: string, usage = { input: 4_210, output: 880 }) =>
  (async () =>
    new Response(
      JSON.stringify({
        candidates: [{ content: { parts: [{ text }] }, finishReason: 'STOP' }],
        usageMetadata: {
          promptTokenCount: usage.input,
          candidatesTokenCount: usage.output,
        },
      }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    )) as unknown as typeof fetch

async function makeDocument(label: string): Promise<string> {
  const created = await owner.document.create({
    data: {
      organizationId,
      companyId,
      type: 'RATE_CONFIRMATION',
      filename: `${label}-${nonce}.pdf`,
      r2Key: `${organizationId}/pending/${label}-${nonce}.pdf`,
      mimeType: 'application/pdf',
      sizeBytes: 24_000,
    },
    select: { id: true, ocrStatus: true },
  })
  // The column starts where the enum says it does, which is worth asserting
  // once: every claim below is about a transition away from it.
  expect(created.ocrStatus).toBe('NOT_QUEUED')
  return created.id
}

beforeAll(async () => {
  owner = retryingClient(process.env.DIRECT_DATABASE_URL!)

  const organization = await owner.organization.create({
    data: {
      name: `Extraction ${nonce}`,
      slug: `extraction-${nonce}`,
      maxCompanies: 5,
      companies: { create: [{ name: `Alpha ${nonce}` }] },
    },
    include: { companies: true },
  })
  organizationId = organization.id
  companyId = organization.companies[0]!.id

  const user = await owner.user.create({
    data: {
      email: `extraction-${nonce}@example.test`,
      name: 'Extraction Tester',
    },
  })
  userId = user.id
  await owner.membership.create({
    data: { userId, organizationId, role: 'OWNER' },
  })
}, 300_000)

afterAll(async () => {
  await owner.organization
    .delete({ where: { id: organizationId } })
    .catch(() => {})
  await owner.user.delete({ where: { id: userId } }).catch(() => {})
  await owner.$disconnect()
})

/**
 * The three phases the route walks, in one call, for the tests.
 *
 * NOT a production shortcut and deliberately not exported from the library:
 * the whole point of the split is that `askForExtraction` runs with NO
 * transaction open, and a wrapper that re-joined them would be a trap for the
 * next caller. Here the fetch is a stub with no latency, so holding `tx` across
 * it costs nothing and keeps each test one statement.
 */
async function extractInOneGo(
  input: Parameters<typeof askForExtraction>[0] & { documentId: string },
) {
  const begun = await inOrg((tx) =>
    beginExtraction(tx, 'document', input.documentId),
  )
  if (!begun.ok) return begun
  const asked = await askForExtraction(input)
  return inOrg((tx) =>
    recordExtraction(tx, 'document', input.documentId, asked),
  )
}

describe('a document that reads', () => {
  let documentId = ''

  it('lands COMPLETED with the model’s own words and the parsed shape', async () => {
    documentId = await makeDocument('good')

    const outcome = await extractInOneGo({
      documentId,
      base64: 'JVBERi0xLjQK',
      mimeType: 'application/pdf',
      fetchImpl: replying(answer()),
      apiKey: 'test-key',
    })

    expect(outcome.ok).toBe(true)
    if (!outcome.ok) return

    expect(outcome.extracted.brokerName?.value).toBe('Midwest Logistics')
    expect(outcome.extracted.stops).toHaveLength(1)
    // Money to cents through money.ts: 1850.00 + 412.50 = 2262.50.
    expect(outcome.money.linehaulCents).toBe(185_000)
    expect(outcome.money.fuelSurchargeCents).toBe(41_250)
    expect(outcome.money.totalCents).toBe(226_250)
    expect(outcome.money.totalAgrees).toBe(true)
    // Gemini 3.6 Flash at 150/750 per Mtok. Each side is rounded before they
    // are summed — 4210 x 150 = 631,500 -> 632 and 880 x 750 = 660,000 -> 660
    // — which is 1,292 rather than the 1,291 a single division would give.
    expect(outcome.costMilliCents).toBe(1_292)

    const stored = await owner.document.findUniqueOrThrow({
      where: { id: documentId },
      select: {
        ocrStatus: true,
        ocrText: true,
        ocrError: true,
        extractedJson: true,
      },
    })
    expect(stored.ocrStatus).toBe('COMPLETED')
    expect(stored.ocrError).toBeNull()
    // THE MODEL'S OWN WORDS. An accuracy argument six months from now is
    // settled by what it said, not by what we stored after reshaping it.
    expect(stored.ocrText).toContain('Midwest Logistics')
    const json = stored.extractedJson as Record<string, unknown>
    expect(json['model']).toBe('gemini-3.6-flash')
    expect(json['costMilliCents']).toBe(1_292)
  }, 300_000)

  it('and reads back without calling anything', async () => {
    // Step 2's form needs what was stored, not another call. A screen that
    // re-extracts on every render is a screen that bills per keystroke.
    const read = await inOrg((tx) => storedExtraction(tx, documentId))
    expect(read?.status).toBe('COMPLETED')
    expect(read?.extracted?.commodity?.value).toBe('Frozen peas')
    expect(read?.money?.linehaulCents).toBe(185_000)
    expect(read?.error).toBeNull()
  }, 300_000)
})

describe('a document that does not read', () => {
  it('lands FAILED with the reason, not NOT_QUEUED', async () => {
    // §1.2: a response that does not parse is a failed extraction, never a
    // half-filled form. And a failed one must not look untried, or the screen
    // offers the button again forever.
    const documentId = await makeDocument('prose')

    const outcome = await extractInOneGo({
      documentId,
      base64: 'JVBERi0xLjQK',
      mimeType: 'application/pdf',
      fetchImpl: replying('I could not read this document.'),
      apiKey: 'test-key',
    })

    expect(outcome).toMatchObject({ ok: false, reason: 'unparsable' })

    const stored = await owner.document.findUniqueOrThrow({
      where: { id: documentId },
      select: {
        ocrStatus: true,
        ocrError: true,
        ocrText: true,
        extractedJson: true,
      },
    })
    expect(stored.ocrStatus).toBe('FAILED')
    expect(stored.ocrError).toContain('not_json')
    // The raw text is kept even on a refusal, so the failure can be read.
    expect(stored.ocrText).toBe('I could not read this document.')
    // AND NOTHING PARTIAL WAS STORED. This is the whole rule.
    expect(stored.extractedJson).toBeNull()
  }, 300_000)

  it('names WHERE the answer went wrong, for a half-good response', async () => {
    const documentId = await makeDocument('halfgood')

    const outcome = await extractInOneGo({
      documentId,
      base64: 'JVBERi0xLjQK',
      mimeType: 'application/pdf',
      // Everything right except one confidence, deep in a stop.
      fetchImpl: replying(
        answer({
          stops: [
            {
              type: { value: 'PICKUP', confidence: 'high' },
              name: null,
              addressLine1: null,
              addressLine2: null,
              city: { value: 'Chicago', confidence: 0.9 },
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
      ),
      apiKey: 'test-key',
    })

    expect(outcome).toMatchObject({ ok: false, reason: 'unparsable' })
    if (outcome.ok) return
    expect(outcome.detail).toBe('bad_confidence at $.stops[0].city')

    const stored = await owner.document.findUniqueOrThrow({
      where: { id: documentId },
      select: { ocrStatus: true, extractedJson: true },
    })
    // NOT half-filled. Nine of the eleven top-level fields in that answer were
    // perfectly good; storing them would put nine values on a form nobody
    // would check and leave two silently missing.
    expect(stored.ocrStatus).toBe('FAILED')
    expect(stored.extractedJson).toBeNull()
  }, 300_000)

  it('tells a document that is too big from a call that broke', async () => {
    // A screen says different things about them: "this file cannot be read"
    // versus "try again".
    const documentId = await makeDocument('huge')

    const outcome = await extractInOneGo({
      documentId,
      base64: 'A'.repeat(11 * 1024 * 1024),
      mimeType: 'application/pdf',
      fetchImpl: replying(answer()),
      apiKey: 'test-key',
    })

    expect(outcome).toMatchObject({ ok: false, reason: 'not_readable' })

    const stored = await owner.document.findUniqueOrThrow({
      where: { id: documentId },
      select: { ocrStatus: true, ocrError: true },
    })
    expect(stored.ocrStatus).toBe('FAILED')
    expect(stored.ocrError).toContain('cap is 10MB')
  }, 300_000)

  it('and an HTTP failure is "try again", not "unreadable"', async () => {
    const documentId = await makeDocument('http')

    const outcome = await extractInOneGo({
      documentId,
      base64: 'JVBERi0xLjQK',
      mimeType: 'application/pdf',
      fetchImpl: (async () =>
        new Response('overloaded', {
          status: 529,
        })) as unknown as typeof fetch,
      apiKey: 'test-key',
    })

    expect(outcome).toMatchObject({ ok: false, reason: 'call_failed' })
    const stored = await owner.document.findUniqueOrThrow({
      where: { id: documentId },
      select: { ocrStatus: true, ocrError: true },
    })
    expect(stored.ocrStatus).toBe('FAILED')
    expect(stored.ocrError).toContain('529')
  }, 300_000)
})

describe('a document in another tenant', () => {
  it('is simply not there', async () => {
    // RLS removed it; the service reports the same thing it reports for an id
    // that never existed, because the caller is not entitled to tell them
    // apart.
    const outcome = await extractInOneGo({
      documentId: 'ckdoesnotexist000000000',
      base64: 'JVBERi0xLjQK',
      mimeType: 'application/pdf',
      fetchImpl: replying(answer()),
      apiKey: 'test-key',
    })
    expect(outcome).toMatchObject({ ok: false, reason: 'no_document' })
  }, 300_000)
})
