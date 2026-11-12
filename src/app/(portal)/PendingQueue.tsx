'use client'

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react'
import { useRouter } from 'next/navigation'
import { QUEUE_EVENT, replay, type QueuedWrite } from '@/lib/offline-queue'
import { dismiss, queued, queueStore } from '@/lib/offline-queue-store'
import { senders } from './queue-senders'

// THE PENDING STRIP AND THE REPLAY (Phase 7 step 6; §9: "an explicit pending
// indicator"). Mounted once, in the portal's shell, so it is on every portal
// screen: under the header, in warning, naming what is kept and why — no
// signal, sending, retrying — and each kept write by name. Nothing renders
// while the phone is online and nothing waits.
//
// WHEN IT REPLAYS. On mount (the portal was opened — after a kill, this is
// the moment the kept queue comes back), when the phone says it is online
// again, when the portal returns to the foreground, whenever something is
// kept, and every thirty seconds while anything waits — because on one bar
// `online` never flips and the failures are timeouts. One pass at a time:
// a second trigger during a pass is ignored, and the pass refreshes the
// page once anything landed, so Load shows the rung the office now has.

const RETRY_EVERY_MS = 30_000

// `navigator.onLine` as an external store: the browser's own word, read on
// the client and assumed true on the server, so the strip hydrates quiet
// and then says "No signal" the moment the phone does.
const subscribeOnline = (notify: () => void) => {
  window.addEventListener('online', notify)
  window.addEventListener('offline', notify)
  return () => {
    window.removeEventListener('online', notify)
    window.removeEventListener('offline', notify)
  }
}
const readOnline = () => navigator.onLine
const serverOnline = () => true

interface Props {
  labels: {
    offline: string
    /** "{n} waiting to send" */
    waiting: string
    sending: string
    retrying: string
    kept: string
    notSent: string
    dismiss: string
    /** "Status: {status}" */
    status: string
  }
}

export function PendingQueue({ labels }: Props) {
  const router = useRouter()
  const [entries, setEntries] = useState<QueuedWrite[]>([])
  const online = useSyncExternalStore(subscribeOnline, readOnline, serverOnline)
  const [sending, setSending] = useState(false)
  const draining = useRef(false)

  const refresh = useCallback(async () => {
    setEntries(await queued())
  }, [])

  const drain = useCallback(async () => {
    if (draining.current) return
    draining.current = true
    setSending(true)
    try {
      const report = await replay(queueStore(), senders, navigator.onLine)
      await refresh()
      if (report.sent > 0) router.refresh()
    } finally {
      draining.current = false
      setSending(false)
    }
  }, [refresh, router])

  // On mount, and every time the phone comes back online.
  useEffect(() => {
    if (online) void drain()
  }, [online, drain])

  useEffect(() => {
    const changed = () => {
      void refresh()
      void drain()
    }
    const visible = () => {
      if (document.visibilityState === 'visible') void drain()
    }
    window.addEventListener(QUEUE_EVENT, changed)
    document.addEventListener('visibilitychange', visible)
    return () => {
      window.removeEventListener(QUEUE_EVENT, changed)
      document.removeEventListener('visibilitychange', visible)
    }
  }, [drain, refresh])

  const waiting = entries.filter((entry) => entry.failure === null)
  const failed = entries.filter((entry) => entry.failure !== null)

  useEffect(() => {
    if (waiting.length === 0) return
    const timer = window.setInterval(() => void drain(), RETRY_EVERY_MS)
    return () => window.clearInterval(timer)
  }, [waiting.length, drain])

  if (online && entries.length === 0) return null

  const describe = (entry: QueuedWrite) =>
    entry.kind === 'status' ? (
      labels.status.replace('{status}', entry.label)
    ) : (
      <>
        {entry.label} · <span dir="ltr">{entry.filename}</span>
      </>
    )

  return (
    <div
      role="status"
      aria-live="polite"
      className="shrink-0 border-b border-border bg-warning-soft px-z4 py-z2 text-sm text-ink"
    >
      {!online ? <p className="font-medium">{labels.offline}</p> : null}
      {waiting.length > 0 ? (
        <p className="font-medium">
          {labels.waiting.replace('{n}', String(waiting.length))} ·{' '}
          {!online ? labels.kept : sending ? labels.sending : labels.retrying}
        </p>
      ) : null}
      {waiting.map((entry) => (
        <p key={entry.id} className="text-xs text-ink-2">
          {describe(entry)}
        </p>
      ))}
      {failed.map((entry) => (
        <div
          key={entry.id}
          className="flex items-center justify-between gap-z3 py-z1"
        >
          <p className="text-xs">
            <span className="font-medium">{labels.notSent}</span>{' '}
            {describe(entry)} — {entry.failure}
          </p>
          <button
            type="button"
            onClick={() => void dismiss(entry.id)}
            className="min-h-[44px] shrink-0 rounded-control border border-border-strong bg-surface px-z3 text-sm font-medium text-ink"
          >
            {labels.dismiss}
          </button>
        </div>
      ))}
    </div>
  )
}
