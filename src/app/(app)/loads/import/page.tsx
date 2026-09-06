import { redirect } from 'next/navigation'

// ---------------------------------------------------------------------------
// THE BOARD IMPORT'S URL, KEPT AS A DOOR TO THE ONE SCREEN THAT REMAINS.
//
// This was a screen: authority, an Upcoming/Finished radio pair, and a file
// picker, reading one Relay export as one load per row. It is gone as a
// destination, and Daler reached it four times by accident and never on
// purpose — the Amazon tab's only button pointed here, at the reading that is
// wrong for about 95% of the files this office imports.
//
// THE ROUTE STAYS SO A BOOKMARK LANDS SOMEWHERE THAT WORKS. Deleting it would
// turn a saved link into a 404 for a capability that still exists; the
// redirect turns it into the screen that replaced it, which is what somebody
// following an old link actually wanted.
//
// THE CAPABILITY LIVES ON AS THE PREVIEW'S ESCAPE HATCH. One load per row is
// now a grouping — `planTrips(legs, 'row')` — offered as a button that prints
// what it would produce ("12 loads instead of 3"), after a file has been
// chosen and a preview has been read. Same parse, same landing derivation,
// same writer.
//
// AND THE RADIO PAIR WENT WITH IT, which was the urgent part. `landsDelivered`
// reads each row's own execution status, so the action had already stopped
// consulting the radios — leaving a control on production that a dispatcher
// could set and nothing would honour. A screen that ignores a deliberate
// choice is worse than either the old behaviour or the new one.
// ---------------------------------------------------------------------------
export default function RelayImportRedirect(): never {
  redirect('/loads/import/trips')
}
