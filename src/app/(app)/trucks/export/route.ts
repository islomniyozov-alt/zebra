import {
  ForbiddenError,
  UnauthenticatedError,
  withCurrentOrg,
} from '@/lib/auth-context'
import { readTruckListParams } from '@/lib/truck-list'
import { readTruckListExport } from '@/lib/truck-list-page'

// §6.5 part 1 — the trucks list's current view as CSV.
//
// THE LIST'S OWN QUERY STRING, THE LIST'S OWN `where`, THE LIST'S OWN ROWS,
// under `read truck`, exactly the list's permission. Every row the filter
// selects, not the 500 on screen (§7.1.5). The work is `readTruckListExport`,
// where a test can reach it; this file reads the URL and answers.

export async function GET(request: Request): Promise<Response> {
  const params = readTruckListParams(
    Object.fromEntries(new URL(request.url).searchParams),
  )
  try {
    const { body, filename } = await withCurrentOrg(
      'read',
      'truck',
      (tx, session) => readTruckListExport(tx, session, params, new Date()),
      { timeoutMs: 60_000 },
    )
    return new Response(body, {
      headers: {
        'content-type': 'text/csv; charset=utf-8',
        'content-disposition': `attachment; filename="${filename}"`,
        // A live fleet: a stale copy is worse than a slow one.
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
