// ---------------------------------------------------------------------------
// "+ ADD AUTHORITY", AND THE WAY BACK (TMS v11.35 §6.4, owner 2026-11-19).
//
// The Transfer dialog on a driver, truck or trailer ends its authority list
// with "+ Add authority", which opens Admin → Authorities → new carrying the
// record it came from; saving (or Cancel) returns there with the dialog open.
//
// THE RETURN PATH IS A CLAIM FROM THE URL, so it is checked against the only
// places it may lead: a driver, truck or trailer record in this application.
// Anything else — another site, `//host`, a path with a query of its own —
// is refused, and the form falls back to the authorities list.
// ---------------------------------------------------------------------------

const ASSET_RECORD = /^\/(drivers|trucks|trailers)\/[A-Za-z0-9_-]{1,64}$/

/** The option value that stands for "+ Add authority" in the Move-to list. */
export const ADD_AUTHORITY_VALUE = '__add_authority__'

/** The query flag that opens the Transfer dialog on arrival. */
export const OPEN_TRANSFER_PARAM = 'transfer'

/** A record path the new-authority form may return to, or null. */
export function safeReturnPath(raw: unknown): string | null {
  return typeof raw === 'string' && ASSET_RECORD.test(raw) ? raw : null
}

/** Admin → Authorities → new, remembering the record to come back to. */
export function addAuthorityHref(recordPath: string): string {
  const back = safeReturnPath(recordPath)
  return back
    ? `/companies/new?${new URLSearchParams({ return: back })}`
    : '/companies/new'
}

/** The record, with its Transfer dialog open. */
export function transferReturnHref(recordPath: string): string {
  return `${recordPath}?${OPEN_TRANSFER_PARAM}=1`
}

/** Whether a page was asked to open its Transfer dialog. */
export function opensTransfer(
  params: Record<string, string | string[] | undefined>,
): boolean {
  return params[OPEN_TRANSFER_PARAM] === '1'
}
