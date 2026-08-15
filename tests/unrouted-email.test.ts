import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import {
  keepUnrouted,
  type UnroutedInput,
  type UnroutedRow,
  type UnroutedStore,
} from '@/lib/unrouted-email'

// ---------------------------------------------------------------------------
// "DELIVERED" AND "EXISTS NOWHERE" MUST NEVER BOTH BE TRUE.
//
// `/api/inbound-email` answers 202 to mail no organization claims. That is
// deliberate and stays: a 4xx makes Cloudflare retry a message that can never
// route, and a bounce tells a stranger which addresses exist. But a 202 tells
// the SENDING SERVER to stop trying — and it used to be returned after a
// `console.warn` and nothing else, so a message could be acknowledged and
// simultaneously not exist. On 2026-08-15 the delivery hop went live on
// zebratms.com, which turned that from a design flaw into a way to lose
// freight.
//
// EVERY BRANCH IS FORCED HERE, because the failure is silent by nature. A
// store that cannot be made to fail on demand is a store whose failure
// behaviour nobody knows — the lesson from the production-branch guard that
// said nothing for an entire run (brief flag 50).
// ---------------------------------------------------------------------------

const MESSAGE: UnroutedInput = {
  messageId:
    '<CAHryuVcfHUuG9ZyA2wYK2P0JL0iH8pMbPGGUZSLvAnmOpVF_TQ@mail.gmail.com>',
  from: 'ramdispatch25@gmail.com',
  to: 'loads@zebratms.com',
  subject: 'zebra inbound test',
  text: 'Booking below, please book it.',
  raw: 'aGVsbG8=',
  rawBytes: 59591,
}

/** A store that records what was asked of it and can be made to fail. */
function fakeStore(
  options: {
    existing?: UnroutedRow | null
    createThrows?: boolean
    putThrows?: boolean
  } = {},
) {
  const calls: string[] = []
  let rows = 0
  const store: UnroutedStore = {
    async find(messageId) {
      calls.push(`find:${messageId}`)
      return options.existing ?? null
    },
    async create(input) {
      calls.push('create')
      if (options.createThrows) throw new Error('database is on fire')
      rows++
      return { id: 'unr_1', messageId: input.messageId, rawR2Key: null }
    },
    async putOriginal(id) {
      calls.push('putOriginal')
      if (options.putThrows) throw new Error('Invalid URL string.')
      return `unrouted/${id}/message.eml`
    },
    async attachOriginal(id, rawR2Key) {
      calls.push('attachOriginal')
      return { id, messageId: MESSAGE.messageId, rawR2Key }
    },
  }
  return { store, calls, rowsCreated: () => rows }
}

const quiet = () => {}

describe('a message nobody claims is still recorded', () => {
  it('writes the row and stores the original', async () => {
    const { store, calls } = fakeStore()
    const row = await keepUnrouted(MESSAGE, store, quiet)

    expect(calls).toEqual([
      `find:${MESSAGE.messageId}`,
      'create',
      'putOriginal',
      'attachOriginal',
    ])
    expect(row.rawR2Key).toBe('unrouted/unr_1/message.eml')
  })

  // THE WHOLE POINT, AS ONE ASSERTION. If the row cannot be written, the
  // caller must NOT be able to answer 202 — so this rejects rather than
  // returning, and route.ts turns that into a 503 the mail worker throws on.
  it('THROWS when the row cannot be written, so no 202 can be sent', async () => {
    const { store, rowsCreated } = fakeStore({ createThrows: true })
    await expect(keepUnrouted(MESSAGE, store, quiet)).rejects.toThrow(
      'database is on fire',
    )
    expect(rowsCreated()).toBe(0)
  })

  // R2 IS DIFFERENT FROM THE ROW. By the time the object write is attempted
  // the message already exists, so the invariant holds; asking a stranger's
  // mail server to redeliver something we have kept would be worse than a
  // null key.
  it('does NOT throw when only the original fails to store', async () => {
    const { store, calls } = fakeStore({ putThrows: true })
    const row = await keepUnrouted(MESSAGE, store, quiet)

    expect(row.id).toBe('unr_1')
    expect(row.rawR2Key).toBeNull()
    expect(calls).toContain('create')
    expect(calls).not.toContain('attachOriginal')
  })

  it('says so in the log rather than swallowing it', async () => {
    const said: string[] = []
    const { store } = fakeStore({ putThrows: true })
    await keepUnrouted(MESSAGE, store, (m) => said.push(m))
    expect(said.join(' ')).toMatch(/could not store its original/)
  })
})

describe('redelivery, on the key that was measured to be stable', () => {
  // Brief flag 58: the same message grew a byte between attempts, so a content
  // hash would have recorded it twice. The Message-ID did not move.
  it('creates nothing the second time', async () => {
    const { store, calls, rowsCreated } = fakeStore({
      existing: {
        id: 'unr_1',
        messageId: MESSAGE.messageId,
        rawR2Key: 'unrouted/unr_1/message.eml',
      },
    })
    const row = await keepUnrouted(
      { ...MESSAGE, rawBytes: 59592 },
      store,
      quiet,
    )

    expect(calls).toEqual([`find:${MESSAGE.messageId}`])
    expect(rowsCreated()).toBe(0)
    expect(row.id).toBe('unr_1')
  })

  // A retry is the only chance to fix a message whose original was lost to an
  // R2 outage, so it is used.
  it('retries the original when the first attempt did not store one', async () => {
    const { store, calls } = fakeStore({
      existing: { id: 'unr_1', messageId: MESSAGE.messageId, rawR2Key: null },
    })
    const row = await keepUnrouted(MESSAGE, store, quiet)

    expect(calls).toEqual([
      `find:${MESSAGE.messageId}`,
      'putOriginal',
      'attachOriginal',
    ])
    expect(row.rawR2Key).toBe('unrouted/unr_1/message.eml')
  })

  it('does not try to store an original the worker never sent', async () => {
    const { store, calls } = fakeStore()
    const row = await keepUnrouted({ ...MESSAGE, raw: null }, store, quiet)

    expect(calls).not.toContain('putOriginal')
    expect(row.rawR2Key).toBeNull()
  })
})

describe('the route cannot answer 202 without going through it', () => {
  const route = readFileSync('src/app/api/inbound-email/route.ts', 'utf8')

  it('keeps the message before returning no_tenant', () => {
    const kept = route.indexOf('keepUnrouted(')
    const answered = route.indexOf("reason: 'no_tenant'")
    expect(kept).toBeGreaterThan(-1)
    expect(answered).toBeGreaterThan(kept)
  })

  it('answers 503 rather than 202 when keeping fails', () => {
    // The catch must not fall through to the 202 below it.
    const block = route.slice(
      route.indexOf('keepUnrouted('),
      route.indexOf("reason: 'no_tenant'"),
    )
    expect(block).toContain("apiError(503, 'not_kept'")
    expect(block).toContain('return')
  })

  it('still answers 202 rather than a 4xx on the happy path', () => {
    // The ruling that survives this change: retry storms and address
    // enumeration are still the reasons, and they still hold.
    expect(route).toMatch(/status: 202/)
    expect(route).toContain('bounce would tell a stranger')
  })
})
