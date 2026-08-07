'use client'

import { useState } from 'react'

/**
 * A document link that fetches its own signed URL on click.
 *
 * The URL is short-lived and minted per request, so it cannot be rendered into
 * the page ahead of time. Four panels had grown their own copy of this by the
 * end of step 5; the browser made it five, which is where a private helper
 * becomes a shared one.
 *
 * A 403 and a 404 look identical here on purpose — the download endpoint
 * answers 404 to a document the role may not read, and the caller is not
 * entitled to tell "not yours" from "not there".
 */
export function DocumentLink({
  id,
  filename,
  failedLabel,
}: {
  id: string
  filename: string
  failedLabel: string
}) {
  const [failed, setFailed] = useState(false)

  return (
    <button
      type="button"
      className="font-mono text-xs text-accent hover:underline"
      onClick={async () => {
        try {
          const response = await fetch(`/api/documents/${id}/download-url`)
          if (!response.ok) throw new Error(String(response.status))
          const { url } = (await response.json()) as { url: string }
          window.open(url, '_blank', 'noopener')
        } catch {
          setFailed(true)
        }
      }}
    >
      {failed ? failedLabel : filename}
    </button>
  )
}
