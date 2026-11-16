// ---------------------------------------------------------------------------
// WHICH SIDEBAR ENTRY A PATH LIGHTS (§6.2, amended 2026-11-16).
//
// The longest href the path sits under, and only that one. A plain prefix
// test lit two entries wherever one route lives under another: /loads/incoming
// lit All Loads beside Incoming Loads, and once DQF and Inspections became
// entries, /safety/dqf would have lit Compliance beside DQF. `/loads/123`
// still lights All Loads, because nothing longer claims it.
//
// Its own module rather than a line in the Sidebar, because the Sidebar is a
// client component and this is the part a test can reach.
// ---------------------------------------------------------------------------

/** The href among `hrefs` that `pathname` lights, or `null` for none. */
export function activeNavHref(
  pathname: string,
  hrefs: readonly string[],
): string | null {
  let best: string | null = null
  for (const href of hrefs) {
    const under =
      href === '/'
        ? pathname === '/'
        : pathname === href || pathname.startsWith(`${href}/`)
    if (under && (best === null || href.length > best.length)) best = href
  }
  return best
}
