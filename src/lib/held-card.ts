// ---------------------------------------------------------------------------
// A CAB CARD ALREADY READ, HANDED FROM THE SAFETY INTAKE TO ADD TRUCK ON THIS
// DEVICE (TMS §7.8, v11.57).
//
// "No truck with this VIN — add it" opens /trucks/new with the card pre-read:
// the reading is not bought twice and the file is not dropped twice. A file
// cannot ride in a URL, and sessionStorage holds strings of a few megabytes
// where a card may be eight, so the handoff is IndexedDB, which stores the
// `File` itself. One slot, taken once: Add truck reads it and deletes it.
//
// A HELP, NEVER A DEPENDENCY. Another device, a private window, cleared
// storage, or a slot older than half an hour all answer null, and Add truck
// opens empty with its own drop zone — exactly as it does without the intake.
// Browser-only: nothing here runs on the Worker.
// ---------------------------------------------------------------------------

/** The query an Add form is opened with: `/trucks/new?card=held`. */
export const heldCardHref = (kind: 'truck' | 'trailer') =>
  `/${kind}s/new?card=held`
export const HELD_CARD_PARAM = 'card'
export const HELD_CARD_VALUE = 'held'

/** A handoff older than this is a leftover, not the card just dropped. */
export const HELD_CARD_MAX_AGE_MS = 30 * 60 * 1000

const DB = 'zebra-held-card'
const STORE = 'card'
const KEY = 'one'

export interface HeldCard<R> {
  file: File
  reading: R
  heldAt: number
}

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB, 1)
    request.onupgradeneeded = () => request.result.createObjectStore(STORE)
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

function run<T>(
  mode: IDBTransactionMode,
  act: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  return open().then((db) =>
    new Promise<T>((resolve, reject) => {
      const request = act(db.transaction(STORE, mode).objectStore(STORE))
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    }).finally(() => db.close()),
  )
}

/** Put the card in the slot. False when this browser cannot hold it. */
export async function holdCard<R>(file: File, reading: R): Promise<boolean> {
  try {
    const held: HeldCard<R> = { file, reading, heldAt: Date.now() }
    await run('readwrite', (store) => store.put(held, KEY))
    return true
  } catch {
    return false
  }
}

/** Take the card out of the slot, once. Null when there is none to take. */
export async function takeHeldCard<R>(
  now: number = Date.now(),
): Promise<HeldCard<R> | null> {
  try {
    const held = await run<HeldCard<R> | undefined>('readonly', (store) =>
      store.get(KEY),
    )
    await run('readwrite', (store) => store.delete(KEY))
    if (!held || !(held.file instanceof Blob)) return null
    return now - held.heldAt <= HELD_CARD_MAX_AGE_MS ? held : null
  } catch {
    return null
  }
}
