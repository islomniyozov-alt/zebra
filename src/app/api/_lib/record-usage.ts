import { withCurrentOrg } from '@/lib/auth-context'
import { recordExtractionUsage } from '@/lib/extraction-usage'
import type { ExtractionUsageInput } from '@/lib/extraction-usage'
import type { ReadCost } from '@/lib/claude'

// ---------------------------------------------------------------------------
// WRITE THE COST ROW, AND NEVER LET IT BREAK THE READ.
//
// ── THE ASYMMETRY IS DELIBERATE ───────────────────────────────────────────
//
// The money in `ExtractionUsage` is OURS — it is what an engine charged us to
// read somebody's document. Losing a row costs a cent of accounting. Refusing
// the upload because the ledger was unavailable costs a dispatcher standing at
// a scanner their afternoon, for a table they will never look at.
//
// So this swallows. It is the one place in this codebase where a failed write
// is logged and forgotten, and it says so out loud rather than being a bare
// `.catch(() => {})` somebody later reads as an oversight.
//
// WHAT IT DOES NOT SWALLOW IS SILENCE. The failure goes to `console.error`
// under a named tag, which is what a Worker tail shows — so a ledger that has
// quietly stopped recording is discoverable rather than merely absent. An
// empty table and a broken table look identical in a query.
//
// SHARED BY BOTH READ ROUTES so the swallow is written once. Two copies of
// "ignore this error" is how one of them ends up ignoring a different one.
// ---------------------------------------------------------------------------

/**
 * One ledger row for one engine call, best-effort.
 *
 * `cost` is null when no engine was reached — a document refused for its size
 * or type — and there is then nothing to bill and nothing to write. Passing it
 * through rather than making the caller check keeps the call site one line at
 * every branch that needs it.
 */
export async function recordUsageQuietly(
  cost: ReadCost | null,
  input: Omit<ExtractionUsageInput, 'cost'>,
): Promise<void> {
  if (!cost) return
  try {
    // THE TENANT COMES FROM THE SESSION, NEVER FROM THE REQUEST. `withCurrentOrg`
    // sets the row-level security variable from the signed session, so a row
    // lands under the organization that actually did the reading and could not
    // be attributed elsewhere by anything a browser sent.
    //
    // `read` on `document` rather than a write permission: this records what
    // the caller has already been allowed to do, and gating the ledger behind
    // a second permission would mean some legitimate reads go uncounted — a
    // ledger with holes that depend on a role.
    await withCurrentOrg('read', 'document', async (tx, session) => {
      await recordExtractionUsage(tx, session.organizationId, {
        ...input,
        cost,
      })
    })
  } catch (error) {
    console.error('[zebra.usage] the extraction ledger refused a row', error)
  }
}
