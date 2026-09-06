'use client'

import Link from 'next/link'

// §6.1 — 48px. Search, company filter, notification bell, user menu.
//
// §6.3 AS AMENDED, AND THEN AMENDED AGAIN 2026-09-06: THE AUTHORITY FILTER IS
// GONE FROM HERE.
//
// It was a FILTER and never a switcher — it wrote `?company=` into the URL and
// nothing else — which is exactly why removing it costs so little. No state was
// stored, so none is lost. `?company=` is still honoured by every screen that
// read it; the loads list now offers it beside its other filters, where a
// narrowing belongs. A bookmark carrying the parameter still works.
//
// WHY IT WENT: the owner does not need it. Of five production memberships only
// one is unscoped — the other four are already restricted to two authorities by
// their membership, so for them this offered a choice between two things they
// could equally reach by filtering. It occupied the top of every screen to do
// it.
//
// A STORED DEFAULT WAS REJECTED and the reasoning belongs here rather than in a
// commit message: a saved scope is a MODE, and a dashboard silently narrowed to
// one authority under-reports receivables with nothing on the page saying why.
// The original §6.3 amendment ruled the switcher out for that reason; a
// preference is the same thing wearing a settings screen.
interface TopbarProps {
  /** Pre-translated. A translator closure cannot cross to a client component. */
  labels: {
    notifications: string
    userMenu: string
  }
}

export function Topbar({ labels }: TopbarProps) {
  return (
    <header className="flex h-topbar shrink-0 items-center gap-z4 border-b border-border bg-surface px-gutter">
      {/* SEARCH IS NOT BUILT, SO IT IS NOT SHOWN.
       *
       * This was a full-width control with a ⌘K hint and no handler, carrying
       * a comment promising Phase 2 would wire it. Phase 2 came and went. A
       * dispatcher on their first morning clicks it, nothing happens, and what
       * they learn is that the application is flaky — which costs more than the
       * missing feature does.
       *
       * The space is still reserved, so the shell does not rearrange around it
       * when the real thing lands. `topbar.searchHint` stays in i18n for the
       * same reason: three translations that would have to be written again. */}
      <div aria-hidden className="flex-1" />

      <button
        type="button"
        aria-label={labels.notifications}
        className="flex h-control-compact w-control-compact items-center justify-center rounded-control text-ink-2 hover:bg-surface-3"
      >
        <span aria-hidden>◔</span>
      </button>

      {/* A link, not a menu. The account screen is the only destination behind
       * it today, and a dropdown holding one item is a dropdown to click
       * twice. It becomes a menu when it has a second thing to hold.
       *
       * IT USED TO READ "OW", AND THAT WAS A HARDCODED STRING. Not the user's
       * initials, not the role — the literal `userInitials="OW"` passed from
       * the layout, identical for every person who has ever logged in. It read
       * as a fact about the viewer and was a placeholder that shipped.
       *
       * THE LINK STAYS BECAUSE IT IS THE ONLY DOOR TO /account — nothing in the
       * sidebar reaches it — so this is a glyph rather than a deletion. When
       * real initials are wanted they come from the session, which is where a
       * fact about the viewer has to come from. */}
      <Link
        href="/account"
        aria-label={labels.userMenu}
        className="flex h-control-compact w-control-compact items-center justify-center rounded-control border border-border-strong bg-surface-2 text-ink-2 hover:bg-surface-3"
      >
        <span aria-hidden>◍</span>
      </Link>
    </header>
  )
}
