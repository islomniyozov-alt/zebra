import {
  ForbiddenError,
  UnauthenticatedError,
  withCurrentOrg,
} from '@/lib/auth-context'
import { readLoadListParams } from '@/lib/load-list'
import { readLoadListExport } from '@/lib/load-list-page'

// §6.7 item 7 — the loads list's current view as CSV.
//
// THE LIST'S OWN QUERY STRING, THE LIST'S OWN `where`, THE LIST'S OWN ROWS,
// under `read load`, exactly the list's permission. Every row the filter
// selects, not the page on screen (§7.1.5): the button sits above a footer that
// says "1–100 of 2,156", and exporting a hundred would be the most plausible
// wrong answer possible. The work is `readLoadListExport`, where a test can
// reach it.

export async function GET(request: Request): Promise<Response> {
  const params = readLoadListParams(
    Object.fromEntries(new URL(request.url).searchParams),
  )
  try {
    const { body, filename } = await withCurrentOrg(
      'read',
      'load',
      (tx, session) => readLoadListExport(tx, session, params, new Date()),
      { timeoutMs: 60_000 },
    )
    return new Response(body, {
      headers: {
        'content-type': 'text/csv; charset=utf-8',
        'content-disposition': `attachment; filename="${filename}"`,
        // Live freight: a stale copy is worse than a slow one.
        'cache-control': 'no-store',
      },
    })
  } catch (error) {
    if (error instanceof UnauthenticatedError) {
      return new Response('Sign in first.', { status: 401 })
    }
    if (error instanceof ForbiddenError) {
      return new Response('Your role does not permit this.', { status: 403 })
    }
    throw error
  }
}
