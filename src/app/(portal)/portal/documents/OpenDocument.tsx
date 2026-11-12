'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/Button'

// The same shape as the operator's LoadDocuments: a short-lived URL is minted
// by the route and opened, never a redirect that would put a signed R2 URL in
// the browser's history. The route is the PORTAL's, gated by the own-documents
// predicate.

interface Props {
  documentId: string
  labels: { open: string; opening: string; failed: string }
}

export function OpenDocument({ documentId, labels }: Props) {
  const [opening, setOpening] = useState(false)
  const [failed, setFailed] = useState(false)

  const open = async () => {
    setOpening(true)
    setFailed(false)
    try {
      const response = await fetch(
        `/api/portal/documents/${documentId}/download-url`,
      )
      if (!response.ok) throw new Error(String(response.status))
      const { url } = (await response.json()) as { url: string }
      window.open(url, '_blank', 'noopener,noreferrer')
    } catch {
      setFailed(true)
    } finally {
      setOpening(false)
    }
  }

  return (
    <div className="flex shrink-0 flex-col items-end gap-z1">
      <Button type="button" size="large" onClick={open} disabled={opening}>
        {opening ? labels.opening : labels.open}
      </Button>
      {failed ? (
        <p role="alert" className="text-xs text-danger">
          {labels.failed}
        </p>
      ) : null}
    </div>
  )
}
