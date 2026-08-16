import { beforeEach, describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import {
  EXTRACTION_WINDOW_MS,
  EXTRACTIONS_PER_ORG,
  resetExtractionBudget,
  takeExtractionSlot,
} from '@/lib/extraction-budget'

// ---------------------------------------------------------------------------
// THE TEST THIS LIMITER HAD TO PASS BEFORE IT WAS ALLOWED TO EXIST.
//
// "Gmail knocking four times with the same message must never be treated as
// abuse." That is not hypothetical — it is measured. On 2026-08-15 the first
// real booking was delivered four times over 54 minutes, at 6m28s, 20m48s and
// 27m02s apart, because the endpoint kept refusing while it was
// misconfigured. A limiter counting DELIVERIES would have read our own first
// real freight as an attack.
//
// IT PASSES THAT TEST BY PLACEMENT, NOT BY CLEVERNESS. The slot is taken
// after the dedupe lookup, and a redelivery exits at the duplicate branch
// before reaching it. There is no retry-detection logic here to get wrong,
// which is the point: the limiter never learns what a retry is.
// ---------------------------------------------------------------------------

const ORG = 'cmsbsc82y0000nsvsa6yffuyh'
const OTHER = 'cms5d2kst0007ncvs7hhkypm7'

beforeEach(() => resetExtractionBudget())

describe('the budget itself', () => {
  it('allows a normal day without noticing', () => {
    // A busy day is a handful of bookings. The ceiling is an accident stop.
    for (let index = 0; index < 8; index++) {
      expect(takeExtractionSlot(ORG, 1_000 + index).allowed).toBe(true)
    }
  })

  it('allows exactly the ceiling and refuses the next', () => {
    for (let index = 0; index < EXTRACTIONS_PER_ORG; index++) {
      expect(takeExtractionSlot(ORG, 1_000 + index).allowed).toBe(true)
    }
    expect(takeExtractionSlot(ORG, 2_000).allowed).toBe(false)
  })

  it('says how long until a slot frees up, in whole seconds', () => {
    for (let index = 0; index < EXTRACTIONS_PER_ORG; index++) {
      takeExtractionSlot(ORG, 0)
    }
    const refused = takeExtractionSlot(ORG, 1_000)
    expect(refused.allowed).toBe(false)
    expect(refused.retryAfterSeconds).toBe(EXTRACTION_WINDOW_MS / 1000 - 1)
  })

  it('never reports a zero wait when it refuses', () => {
    // Zero would invite an immediate retry that is certain to fail.
    for (let index = 0; index < EXTRACTIONS_PER_ORG; index++) {
      takeExtractionSlot(ORG, 0)
    }
    expect(
      takeExtractionSlot(ORG, EXTRACTION_WINDOW_MS - 1).retryAfterSeconds,
    ).toBeGreaterThanOrEqual(1)
  })
})

describe('the window slides rather than resetting', () => {
  it('lets the oldest fall out and admits one more', () => {
    for (let index = 0; index < EXTRACTIONS_PER_ORG; index++) {
      takeExtractionSlot(ORG, index)
    }
    // The first one has just aged out; exactly one slot is free.
    const at = EXTRACTION_WINDOW_MS
    expect(takeExtractionSlot(ORG, at).allowed).toBe(true)
    expect(takeExtractionSlot(ORG, at).allowed).toBe(false)
  })

  // A FIXED window would let a sender spend the whole budget at the end of one
  // hour and the whole of the next at the start of the following one.
  it('does not hand back the whole budget on the hour', () => {
    for (let index = 0; index < EXTRACTIONS_PER_ORG; index++) {
      takeExtractionSlot(ORG, EXTRACTION_WINDOW_MS - 1_000 + index)
    }
    expect(takeExtractionSlot(ORG, EXTRACTION_WINDOW_MS + 1).allowed).toBe(
      false,
    )
  })

  it('does not punish a refused attempt by extending the ban', () => {
    // Recording before refusing would push the oldest allowed one out of the
    // window, so a sender in a loop would never recover.
    for (let index = 0; index < EXTRACTIONS_PER_ORG; index++) {
      takeExtractionSlot(ORG, 0)
    }
    for (let index = 0; index < 50; index++) {
      takeExtractionSlot(ORG, 1_000 + index)
    }
    // The original window still expires on time despite the hammering.
    expect(takeExtractionSlot(ORG, EXTRACTION_WINDOW_MS).allowed).toBe(true)
  })
})

describe('whose budget it is', () => {
  it('is the organization, so one tenant cannot spend another', () => {
    for (let index = 0; index < EXTRACTIONS_PER_ORG; index++) {
      takeExtractionSlot(ORG, index)
    }
    expect(takeExtractionSlot(ORG, 500).allowed).toBe(false)
    expect(takeExtractionSlot(OTHER, 500).allowed).toBe(true)
  })

  it('is not keyed on anything a stranger controls', () => {
    // The envelope sender is trivially forged and a broker legitimately sends
    // many bookings. Neither belongs in a key.
    const source = readFileSync('src/lib/extraction-budget.ts', 'utf8')
    expect(source).not.toMatch(/\bfrom(Address)?\b\s*[,)]/)
    expect(takeExtractionSlot.length).toBeLessThanOrEqual(2)
  })
})

describe('where the route takes the slot, which is the whole safety property', () => {
  const route = readFileSync('src/app/api/inbound-email/route.ts', 'utf8')

  it('takes it AFTER the duplicate branch, so a redelivery never spends one', () => {
    const duplicate = route.indexOf('duplicate: true')
    const slot = route.indexOf('takeExtractionSlot(')
    expect(duplicate).toBeGreaterThan(-1)
    expect(slot).toBeGreaterThan(duplicate)
  })

  it('takes it BEFORE the model is asked', () => {
    expect(route.indexOf('takeExtractionSlot(')).toBeLessThan(
      route.indexOf('askForExtraction('),
    )
  })

  it('takes it AFTER the message is kept and its original stored', () => {
    // Refusing the spend must never refuse the message.
    expect(route.indexOf('recordEmail(')).toBeLessThan(
      route.indexOf('takeExtractionSlot('),
    )
    expect(route.indexOf('storeOriginal(')).toBeLessThan(
      route.indexOf('takeExtractionSlot('),
    )
  })

  it('answers 200 accepted rather than an error, so nobody retries into it', () => {
    const block = route.slice(
      route.indexOf('if (!slot.allowed)'),
      route.indexOf('--- 2. READ IT'),
    )
    expect(block).toContain('accepted: true')
    expect(block).toContain('deferred: true')
    // A 4xx or 5xx would make the sending server redeliver, which is a retry
    // storm aimed at a budget that is already spent.
    expect(block).not.toMatch(/apiError\(|status: [45]\d\d/)
  })

  it('marks the row UNREAD rather than leaving it looking read', () => {
    const block = route.slice(
      route.indexOf('if (!slot.allowed)'),
      route.indexOf('--- 2. READ IT'),
    )
    expect(block).toContain('recordDeferred(')
    const lib = readFileSync('src/lib/inbound-email.ts', 'utf8')
    const deferred = lib.slice(
      lib.indexOf('export async function recordDeferred'),
      lib.indexOf('export async function recordReading'),
    )
    expect(deferred).toContain(`state: 'UNREAD'`)
    // NOT_QUEUED is the truthful why: nothing was ever asked.
    expect(deferred).toContain(`ocrStatus: 'NOT_QUEUED'`)
    expect(deferred).not.toContain('FAILED')
  })
})
