// ---------------------------------------------------------------------------
// THE OFFLINE QUEUE — the rule, with no browser in it (Phase 7 step 6; §9
// "Status updates and uploads queue when offline and sync on reconnect, with
// an explicit pending indicator. Truck stops have bad signal; a silent
// failure loses a POD.").
//
// WHAT IS KEPT. A tap or a capture the office never answered: the phone says
// it is offline, or the request died before a response — `fetch` throwing,
// which is a TypeError in every browser, or an abort. What is NOT kept is a
// refusal the office answered in words (a 4xx, a form state with an error):
// that is a fact about the load, shown to the driver, never retried into a
// different fact.
//
// THE ORDER IS THE ORDER IT HAPPENED. "At pickup" then "Loaded" replay as
// two taps in that order, and each is checked by the server against the
// load's status at the moment of the write (step 4's rule), so a tap the
// office overtook is refused in words and stays on the strip with them —
// never applied as a jump, never dropped silently.
//
// A REPLAY STOPS AT THE FIRST THING THE OFFICE DID NOT ANSWER and keeps the
// rest for the next attempt, which the shell makes when the phone comes back
// online, when the portal is opened or foregrounded, and on a timer while
// anything waits. Nothing here touches IndexedDB, the window or the network:
// the store and the senders are handed in, which is what lets a node test
// walk every branch with a map and a counter.
// ---------------------------------------------------------------------------

export interface QueuedStatus {
  kind: 'status'
  id: string
  loadId: string
  /** The enum value the tap asked for. */
  to: string
  /** The rung's word in the reader's language, for the pending strip. */
  label: string
  /** When the driver tapped, ISO — the stop's clock on replay (§9). */
  tappedAt: string
  queuedAt: string
  /** Null while it waits; the office's refusal, in words, once it has one. */
  failure: string | null
}

export interface QueuedUpload {
  kind: 'upload'
  id: string
  loadId: string
  documentType: string
  /** The type's word in the reader's language. */
  label: string
  filename: string
  mimeType: string
  /** Already compressed: the phone holds the bytes it will send, not 8 MB. */
  bytes: Blob
  queuedAt: string
  failure: string | null
}

export type QueuedWrite = QueuedStatus | QueuedUpload

/** Where the phone keeps the queue — IndexedDB, or a map in a test. */
export interface QueueStore {
  /** Every entry, oldest first. */
  all(): Promise<QueuedWrite[]>
  put(entry: QueuedWrite): Promise<void>
  remove(id: string): Promise<void>
}

export type SendOutcome = { sent: true } | { sent: false; refused: string }

/**
 * How each kind reaches the office — the SAME route the live tap or upload
 * takes. A sender throws when the office did not answer (the network), and
 * returns `refused` with the words when it did and said no.
 */
export interface Senders {
  status(entry: QueuedStatus): Promise<SendOutcome>
  upload(entry: QueuedUpload): Promise<SendOutcome>
}

/**
 * Did the request die before the office answered? `fetch` rejects with a
 * TypeError on every network failure ("Failed to fetch", "Load failed",
 * "NetworkError when attempting to fetch resource.") and a server action
 * called from the client rides on fetch; an abort or a timeout is the same
 * fact. Anything else — an Error with a status in its words, a form state —
 * is an answer, and an answer is never queued.
 */
export function isNetworkFailure(error: unknown): boolean {
  if (error instanceof TypeError) return true
  if (typeof error === 'object' && error !== null && 'name' in error) {
    const name = (error as { name: unknown }).name
    return (
      name === 'AbortError' ||
      name === 'NetworkError' ||
      name === 'TimeoutError'
    )
  }
  return false
}

export interface ReplayReport {
  sent: number
  refused: number
  /** A network failure stopped the replay; what is left waits. */
  stopped: boolean
  /** Entries still waiting (failure null) after this pass. */
  remaining: number
}

const waiting = (entries: QueuedWrite[]) =>
  entries.filter((entry) => entry.failure === null).length

/**
 * One pass over the queue, oldest first. Sent entries leave; a refusal in
 * words stays with the words (the strip shows it until dismissed); a network
 * failure stops the pass and leaves the rest untouched. Offline, nothing is
 * tried at all.
 */
export async function replay(
  store: QueueStore,
  senders: Senders,
  online: boolean,
): Promise<ReplayReport> {
  const report: ReplayReport = {
    sent: 0,
    refused: 0,
    stopped: false,
    remaining: 0,
  }
  if (!online) {
    report.stopped = true
    report.remaining = waiting(await store.all())
    return report
  }
  for (const entry of await store.all()) {
    // Refused once is refused: the words are on the strip, and the office's
    // answer does not change by asking again.
    if (entry.failure !== null) continue
    let outcome: SendOutcome
    try {
      outcome =
        entry.kind === 'status'
          ? await senders.status(entry)
          : await senders.upload(entry)
    } catch (error) {
      if (isNetworkFailure(error)) {
        report.stopped = true
        break
      }
      outcome = {
        sent: false,
        refused: error instanceof Error ? error.message : String(error),
      }
    }
    if (outcome.sent) {
      await store.remove(entry.id)
      report.sent += 1
    } else {
      await store.put({ ...entry, failure: outcome.refused })
      report.refused += 1
    }
  }
  report.remaining = waiting(await store.all())
  return report
}

/** The DOM event the shell listens for after any change to the queue. */
export const QUEUE_EVENT = 'zebra:portal-queue'

/** Time-prefixed so insertion order survives a sort by id. */
export function newQueueId(now: number = Date.now()): string {
  return `${now.toString(36).padStart(9, '0')}-${Math.random().toString(36).slice(2, 8)}`
}

/** Oldest first: by the moment it was queued, then by id. */
export function byQueueOrder(a: QueuedWrite, b: QueuedWrite): number {
  if (a.queuedAt !== b.queuedAt) return a.queuedAt < b.queuedAt ? -1 : 1
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0
}
