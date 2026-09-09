// Which message a refused certificate read gets, in one place.
//
// THE REFUSALS SORT INTO THREE GROUPS, and a dispatcher told the wrong one
// wastes a trip:
//
//   TAKE A BETTER PHOTOGRAPH — the certificate was reached and could not be
//   read from.
//   THIS IS NOT A CERTIFICATE — nothing came back at all, or the coverages
//   table was empty. A second photograph will not fix either.
//   TRY AGAIN — the call failed. Ours or the network's.
//
// SHARED BY BOTH READ ROUTES rather than written out in each: two copies of a
// message table are two answers to the same refusal, and the one nobody edits
// is the one a dispatcher sees.
export function coiNoticeFor(reason: string): string {
  if (reason === 'call_failed') return 'safety.coi.failed'
  if (reason === 'not_a_certificate' || reason === 'no_coverage_rows') {
    return 'safety.coi.contradictory'
  }
  return 'safety.coi.unreadable'
}
