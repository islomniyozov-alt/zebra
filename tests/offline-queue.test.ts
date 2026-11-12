import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  byQueueOrder,
  isNetworkFailure,
  newQueueId,
  replay,
  type QueuedStatus,
  type QueuedUpload,
  type QueuedWrite,
  type Senders,
} from '@/lib/offline-queue'
import { memoryStore } from '@/lib/offline-queue-store'
import { clockTimeFor, TAP_WINDOW_MS, tappedAtFrom } from '@/lib/portal-status'

// ---------------------------------------------------------------------------
// THE OFFLINE QUEUE (Phase 7 step 6; §9: queue when offline, sync on
// reconnect, an explicit pending indicator; "a silent failure loses a POD").
// The rule with a map for a store and a counter for the office.
// ---------------------------------------------------------------------------

const status = (id: string, loadId = 'L1', to = 'AT_PICKUP'): QueuedStatus => ({
  kind: 'status',
  id,
  loadId,
  to,
  label: to,
  tappedAt: '2026-11-12T14:02:00.000Z',
  queuedAt: `2026-11-12T14:0${id.slice(-1)}:00.000Z`,
  failure: null,
})

const upload = (id: string): QueuedUpload => ({
  kind: 'upload',
  id,
  loadId: 'L1',
  documentType: 'POD',
  label: 'POD',
  filename: 'pod.jpg',
  mimeType: 'image/jpeg',
  bytes: new Blob(['x']),
  queuedAt: `2026-11-12T14:0${id.slice(-1)}:00.000Z`,
  failure: null,
})

async function seeded(...entries: QueuedWrite[]) {
  const store = memoryStore()
  for (const entry of entries) await store.put(entry)
  return store
}

/** An office that answers each entry by a script, and remembers the order. */
function office(
  script: Record<string, 'sent' | 'refused' | 'network' | 'crash'>,
): Senders & { asked: string[] } {
  const asked: string[] = []
  const answer = async (entry: QueuedWrite) => {
    asked.push(entry.id)
    const verdict = script[entry.id] ?? 'sent'
    if (verdict === 'network') throw new TypeError('Failed to fetch')
    if (verdict === 'crash')
      throw new Error('Could not start the upload (404).')
    if (verdict === 'refused') {
      return { sent: false as const, refused: 'The load has moved.' }
    }
    return { sent: true as const }
  }
  return { asked, status: answer, upload: answer }
}

describe('what counts as "the office did not answer"', () => {
  it('is a TypeError (every browser’s fetch failure), an abort or a timeout', () => {
    expect(isNetworkFailure(new TypeError('Failed to fetch'))).toBe(true)
    expect(isNetworkFailure(new TypeError('Load failed'))).toBe(true)
    expect(isNetworkFailure({ name: 'AbortError' })).toBe(true)
    expect(isNetworkFailure({ name: 'TimeoutError' })).toBe(true)
  })

  it('is never an answer: an Error with a status in its words, a string, nothing', () => {
    expect(
      isNetworkFailure(new Error('Could not start the upload (404).')),
    ).toBe(false)
    expect(isNetworkFailure('offline')).toBe(false)
    expect(isNetworkFailure(undefined)).toBe(false)
  })
})

describe('the replay', () => {
  it('tries nothing offline, and everything still waits', async () => {
    const store = await seeded(status('s1'), upload('u2'))
    const sender = office({})
    const report = await replay(store, sender, false)
    expect(report).toEqual({ sent: 0, refused: 0, stopped: true, remaining: 2 })
    expect(sender.asked).toEqual([])
    expect((await store.all()).map((entry) => entry.id)).toEqual(['s1', 'u2'])
  })

  it('sends oldest first, each through its own kind, and sent entries leave', async () => {
    const store = await seeded(
      upload('u3'),
      status('s1'),
      status('s2', 'L1', 'LOADED'),
    )
    const sender = office({})
    const report = await replay(store, sender, true)
    expect(sender.asked).toEqual(['s1', 's2', 'u3'])
    expect(report).toEqual({
      sent: 3,
      refused: 0,
      stopped: false,
      remaining: 0,
    })
    expect(await store.all()).toEqual([])
  })

  it('a refusal in words stays, with the words, and the pass goes on', async () => {
    const store = await seeded(
      status('s1'),
      status('s2', 'L1', 'LOADED'),
      upload('u3'),
    )
    const sender = office({ s1: 'refused' })
    const report = await replay(store, sender, true)
    expect(sender.asked).toEqual(['s1', 's2', 'u3'])
    expect(report).toEqual({
      sent: 2,
      refused: 1,
      stopped: false,
      remaining: 0,
    })
    const left = await store.all()
    expect(left.map((entry) => [entry.id, entry.failure])).toEqual([
      ['s1', 'The load has moved.'],
    ])
  })

  it('an unexpected throw that is not the network is an answer too — kept with its words', async () => {
    const store = await seeded(upload('u1'))
    const report = await replay(store, office({ u1: 'crash' }), true)
    expect(report.refused).toBe(1)
    expect((await store.all())[0]?.failure).toBe(
      'Could not start the upload (404).',
    )
  })

  it('a network failure stops the pass; that entry and the rest are untouched', async () => {
    const store = await seeded(
      status('s1'),
      status('s2', 'L1', 'LOADED'),
      upload('u3'),
    )
    const sender = office({ s2: 'network' })
    const report = await replay(store, sender, true)
    expect(sender.asked).toEqual(['s1', 's2'])
    expect(report).toEqual({ sent: 1, refused: 0, stopped: true, remaining: 2 })
    expect(
      (await store.all()).map((entry) => [entry.id, entry.failure]),
    ).toEqual([
      ['s2', null],
      ['u3', null],
    ])
  })

  it('refused once is refused: a later pass skips it until it is dismissed', async () => {
    const store = await seeded(
      { ...status('s1'), failure: 'The load has moved.' },
      status('s2'),
    )
    const sender = office({})
    const report = await replay(store, sender, true)
    expect(sender.asked).toEqual(['s2'])
    expect(report).toEqual({
      sent: 1,
      refused: 0,
      stopped: false,
      remaining: 0,
    })
    expect((await store.all()).map((entry) => entry.id)).toEqual(['s1'])
  })

  it('order is the moment it was queued, then the id', () => {
    const a = status('a9')
    const b = { ...status('b1'), queuedAt: a.queuedAt }
    expect([b, a].sort(byQueueOrder).map((entry) => entry.id)).toEqual([
      'a9',
      'b1',
    ])
    expect(newQueueId(1) < newQueueId(2)).toBe(true)
  })
})

describe('a replayed tap carries its time (§9; the stop’s clock)', () => {
  const now = new Date('2026-11-12T15:00:00.000Z')

  it('inside the window the stop is clocked at the tap, not the write', () => {
    const tapped = new Date('2026-11-12T14:02:00.000Z')
    expect(clockTimeFor(tapped, now)).toBe(tapped)
    expect(TAP_WINDOW_MS).toBe(24 * 60 * 60 * 1000)
  })

  it('older than the window, in the future, missing or invalid: the write', () => {
    expect(clockTimeFor(new Date('2026-11-09T15:00:00.000Z'), now)).toBe(now)
    expect(clockTimeFor(new Date('2026-11-12T15:00:01.000Z'), now)).toBe(now)
    expect(clockTimeFor(undefined, now)).toBe(now)
    expect(clockTimeFor(new Date('garbage'), now)).toBe(now)
  })

  it('the form field is an ISO instant or nothing', () => {
    expect(tappedAtFrom('2026-11-12T14:02:00.000Z')?.toISOString()).toBe(
      '2026-11-12T14:02:00.000Z',
    )
    expect(tappedAtFrom('2026-11-12T14:02:00Z')?.toISOString()).toBe(
      '2026-11-12T14:02:00.000Z',
    )
    expect(tappedAtFrom('2026-11-12')).toBeUndefined()
    expect(tappedAtFrom('yesterday')).toBeUndefined()
    expect(tappedAtFrom(undefined)).toBeUndefined()
    expect(tappedAtFrom(42)).toBeUndefined()
  })
})

describe('the queue is wired where the brief says, and nowhere else', () => {
  const read = (...parts: string[]) =>
    readFileSync(join(process.cwd(), ...parts), 'utf8')
  const layout = read('src', 'app', '(portal)', 'layout.tsx')
  const step = read('src', 'app', '(portal)', 'portal', 'StatusStep.tsx')
  const capture = read(
    'src',
    'app',
    '(portal)',
    'portal',
    'documents',
    'CaptureUpload.tsx',
  )
  const sendersSource = read('src', 'app', '(portal)', 'queue-senders.ts')
  const action = read('src', 'app', '(portal)', 'portal', 'status-actions.ts')
  const lib = read('src', 'lib', 'portal-status.ts')

  it('the shell mounts the strip once, so it is on every portal screen', () => {
    expect(layout).toMatch(/<PendingQueue/)
  })

  it('the tap and the capture keep on the phone only when the office did not answer', () => {
    for (const source of [step, capture]) {
      expect(source).toMatch(/navigator\.onLine/)
      expect(source).toMatch(/isNetworkFailure\((error|failure)\)/)
      expect(source).toMatch(/enqueue\(\{/)
    }
    // The tap carries its own time, and the capture is compressed BEFORE it
    // is kept — the phone holds what it will send.
    expect(step).toMatch(/tappedAt/)
    expect(capture).toMatch(/compressImage\(file\)/)
  })

  it('a kept write replays through the same route the live one takes', () => {
    expect(sendersSource).toMatch(/advanceStatusAction\(/)
    expect(sendersSource).toMatch(/form\.set\('tappedAt', entry\.tappedAt\)/)
    expect(sendersSource).toMatch(/endpoints: PORTAL_ENDPOINTS/)
    expect(sendersSource).not.toMatch(/fetch\(/)
  })

  it('the action hands the tap’s time to the one function, which clocks the stop by it', () => {
    expect(action).toMatch(
      /const tappedAt = tappedAtFrom\(formData\.get\('tappedAt'\)\)/,
    )
    expect(action).toMatch(
      /recordPortalStatus\(tx, session, loadId, to, \{ tappedAt \}\)/,
    )
    expect(lib).toMatch(
      /stampStopForStep\(\s*tx,\s*loadId,\s*next,\s*clockTimeFor\(options\.tappedAt, new Date\(\)\),?\s*\)/,
    )
  })

  it('nothing registers a service worker (flag 10: the portal shares the office’s origin)', () => {
    const walk = (dir: string): string[] =>
      readdirSync(dir).flatMap((name) => {
        const path = join(dir, name)
        if (statSync(path).isDirectory()) return walk(path)
        return /\.(tsx?|mjs|js)$/.test(name) ? [path] : []
      })
    const offenders = [
      ...walk(join(process.cwd(), 'src', 'app')),
      ...walk(join(process.cwd(), 'src', 'lib')),
    ].filter((path) =>
      /serviceWorker\.register/.test(readFileSync(path, 'utf8')),
    )
    expect(offenders).toEqual([])
  })
})
