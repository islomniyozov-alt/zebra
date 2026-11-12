import {
  byQueueOrder,
  QUEUE_EVENT,
  type QueuedWrite,
  type QueueStore,
} from './offline-queue'

// ---------------------------------------------------------------------------
// WHERE THE PHONE KEEPS THE QUEUE (Phase 7 step 6; §9).
//
// IndexedDB, one object store keyed by id, because it is the one browser
// store that survives the app being killed and holds a Blob: a kept POD is
// the compressed bytes, under a megabyte, not a file handle the OS may
// revoke. Where IndexedDB is missing or refuses (a private window on some
// phones), the queue lives in memory for the session — the strip still says
// pending and nothing is lost SILENTLY, which is the rule; it is only lost
// with the app, and the strip says so by staying up.
//
// NO SERVICE WORKER. The portal shares the office's origin, and a worker at
// the root would intercept the office's requests too; Background Sync, which
// is what a worker would add — replay with the app closed — is Chromium-only.
// Flagged in the brief for a ruling (flag 10). The shell replays from the
// open page instead.
// ---------------------------------------------------------------------------

const DB_NAME = 'zebra-portal'
const STORE = 'queue'
const VERSION = 1

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, VERSION)
    request.onupgradeneeded = () => {
      const db = request.result
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: 'id' })
      }
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () =>
      reject(request.error ?? new Error('IndexedDB refused to open.'))
    request.onblocked = () =>
      reject(new Error('IndexedDB is blocked by another tab.'))
  })
}

function run<T>(
  db: IDBDatabase,
  mode: IDBTransactionMode,
  op: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  return new Promise((resolve, reject) => {
    const request = op(db.transaction(STORE, mode).objectStore(STORE))
    request.onsuccess = () => resolve(request.result)
    request.onerror = () =>
      reject(request.error ?? new Error('IndexedDB request failed.'))
  })
}

/** The session-only fallback, and the store every node test uses. */
export function memoryStore(): QueueStore {
  const rows = new Map<string, QueuedWrite>()
  return {
    all: async () => [...rows.values()].sort(byQueueOrder),
    put: async (entry) => {
      rows.set(entry.id, entry)
    },
    remove: async (id) => {
      rows.delete(id)
    },
  }
}

function indexedDbStore(): QueueStore {
  let opened: Promise<IDBDatabase> | null = null
  const db = () =>
    (opened ??= openDatabase().catch((error: unknown) => {
      opened = null
      throw error
    }))
  return {
    all: async () =>
      (
        (await run(await db(), 'readonly', (store) =>
          store.getAll(),
        )) as QueuedWrite[]
      ).sort(byQueueOrder),
    put: async (entry) => {
      await run(await db(), 'readwrite', (store) => store.put(entry))
    },
    remove: async (id) => {
      await run(await db(), 'readwrite', (store) => store.delete(id))
    },
  }
}

let shared: QueueStore | null = null

/**
 * The phone's queue. IndexedDB where the browser has it; memory where it does
 * not, or once it has refused — and then for the rest of the session, so the
 * queue is one list and not two.
 */
export function queueStore(): QueueStore {
  if (shared) return shared
  shared = typeof indexedDB === 'undefined' ? memoryStore() : indexedDbStore()
  return shared
}

async function withFallback<T>(
  op: (store: QueueStore) => Promise<T>,
): Promise<T> {
  try {
    return await op(queueStore())
  } catch {
    shared = memoryStore()
    return op(shared)
  }
}

/** Tell every mounted piece of the portal the queue changed. */
export function announce(): void {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new Event(QUEUE_EVENT))
  }
}

/** Keep a write on the phone. The shell picks it up from the event. */
export async function enqueue(entry: QueuedWrite): Promise<void> {
  await withFallback((store) => store.put(entry))
  announce()
}

/** Everything kept, oldest first. */
export function queued(): Promise<QueuedWrite[]> {
  return withFallback((store) => store.all())
}

/** The driver has read the refusal; take it off the strip. */
export async function dismiss(id: string): Promise<void> {
  await withFallback((store) => store.remove(id))
  announce()
}
