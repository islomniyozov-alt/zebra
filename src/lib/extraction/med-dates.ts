// ---------------------------------------------------------------------------
// THE MEDICAL CERTIFICATE'S DATE RULE, WHICH IS NOW SHARED.
//
// The implementation moved to `us-dates.ts` on 2026-09-09, when the ACORD
// certificate of insurance needed the same three printed shapes and the same
// stated MM/DD assumption. One parser, two contracts: a second would be a
// second answer to "what day does this say", and they would drift the first
// time one learned a format the other did not.
//
// THE OLD NAME SURVIVES HERE ON PURPOSE. `med-refusal.ts`, `med-cert.ts` and
// the medical tests all read `parseMedDate`, and the reasoning they carry is
// about a medical certificate. Renaming every call site would have made the
// diff about a rename rather than about the sharing.
// ---------------------------------------------------------------------------

export type { UsDateResult as MedDateResult } from './us-dates'
export { parseUsDate as parseMedDate } from './us-dates'
