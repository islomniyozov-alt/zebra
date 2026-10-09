'use client'

import { useToast } from '@/components/ui/Toast'

// §6.7 item 4 — copy the load number from the list.
//
// OUTSIDE THE ROW'S NAMED LINK. A button inside an anchor is invalid HTML and
// opens the load instead of copying, so `Table` renders this in the cell's
// `trailing` slot, raised above the row's overlay.
//
// THE TOAST REPEATS THE VERB (§7.9), and a refusal SAYS so and stays: a copy
// that silently did not happen gets pasted into Relay as whatever the clipboard
// held before.

interface Props {
  value: string
  labels: {
    /** "Copy load number" — the button's accessible name, with the number. */
    copy: string
    /** "Load {n} copied". */
    copied: string
    /** "Could not copy load {n}…". */
    failed: string
  }
}

export function CopyLoadNumber({ value, labels }: Props) {
  const toast = useToast()

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value)
      toast.success(labels.copied.replace('{n}', value))
    } catch {
      toast.error(labels.failed.replace('{n}', value))
    }
  }

  return (
    <button
      type="button"
      onClick={copy}
      title={labels.copy}
      aria-label={`${labels.copy}: ${value}`}
      className="inline-flex size-[20px] items-center justify-center rounded-control text-ink-3 hover:text-accent focus-visible:outline focus-visible:outline-2"
    >
      <svg
        aria-hidden
        viewBox="0 0 16 16"
        className="size-[13px]"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
      >
        <rect x="5" y="5" width="8.5" height="9" rx="1.5" />
        <path d="M10.5 3.5V3A1.5 1.5 0 0 0 9 1.5H4A1.5 1.5 0 0 0 2.5 3v7A1.5 1.5 0 0 0 4 11.5h.5" />
      </svg>
    </button>
  )
}
