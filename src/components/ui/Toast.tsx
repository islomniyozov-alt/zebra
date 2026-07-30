'use client'

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
} from 'react'
import type { ReactNode } from 'react'
import { cx } from '@/lib/cx'

// §7.9. Bottom-leading corner, 4 seconds, one at a time, queued.
//
// Two rules with teeth:
//   * Success is quiet. Errors do NOT auto-dismiss and carry a retry where
//     retrying is meaningful — a toast that vanishes before it is read is a
//     failure nobody knows about.
//   * The toast repeats the verb from the button. "Publish" produces
//     "Published"; "Generate settlement" produces "Settlement generated".

export interface Toast {
  id: number
  tone: 'success' | 'danger'
  message: string
  retry?: { label: string; onRetry: () => void }
}

interface ToastContextValue {
  /** Quiet, auto-dismissing. Say the verb in the past tense. */
  success: (message: string) => void
  /** Stays until dismissed. Optionally carries a retry. */
  error: (message: string, retry?: Toast['retry']) => void
}

const ToastContext = createContext<ToastContextValue | null>(null)

export function useToast(): ToastContextValue {
  const context = useContext(ToastContext)
  if (!context) throw new Error('useToast must be used inside <ToastProvider>.')
  return context
}

const AUTO_DISMISS_MS = 4000

export function ToastProvider({ children }: { children: ReactNode }) {
  const [queue, setQueue] = useState<Toast[]>([])

  const dismiss = useCallback((id: number) => {
    setQueue((current) => current.filter((toast) => toast.id !== id))
  }, [])

  const push = useCallback(
    (toast: Omit<Toast, 'id'>) => {
      const id = Date.now() + Math.random()
      setQueue((current) => [...current, { ...toast, id }])
      if (toast.tone === 'success') {
        setTimeout(() => dismiss(id), AUTO_DISMISS_MS)
      }
    },
    [dismiss],
  )

  const value = useMemo<ToastContextValue>(
    () => ({
      success: (message) => push({ tone: 'success', message }),
      error: (message, retry) =>
        push({ tone: 'danger', message, ...(retry ? { retry } : {}) }),
    }),
    [push],
  )

  // One at a time, queued (§7.9).
  const current = queue[0]

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div
        aria-live="polite"
        aria-atomic
        className="pointer-events-none fixed bottom-z4 start-z4 z-50"
      >
        {current ? (
          <div
            className={cx(
              'pointer-events-auto flex items-center gap-z3 rounded-card border px-z4 py-z3 text-base shadow-sm',
              current.tone === 'success'
                ? 'border-success bg-success-soft text-success'
                : 'border-danger bg-danger-soft text-danger',
            )}
          >
            <span>{current.message}</span>
            {current.retry ? (
              <button
                type="button"
                onClick={() => {
                  current.retry?.onRetry()
                  dismiss(current.id)
                }}
                className="font-medium underline"
              >
                {current.retry.label}
              </button>
            ) : null}
            {current.tone === 'danger' ? (
              <button
                type="button"
                onClick={() => dismiss(current.id)}
                aria-label="Dismiss"
                className="font-medium"
              >
                ×
              </button>
            ) : null}
          </div>
        ) : null}
      </div>
    </ToastContext.Provider>
  )
}
