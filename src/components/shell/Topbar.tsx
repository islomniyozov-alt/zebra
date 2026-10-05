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
  /** The person's name, or their email when they have not set one. */
  accountName: string
  /**
   * The database this worker reads, or `null` on production (§6.1.2).
   *
   * DECIDED ON THE SERVER by `ribbonBranch`, because the binding is not on the
   * client and a value the browser could compute is a value the browser could be
   * wrong about.
   */
  dataFrom: string | null
  /** Pre-translated. A translator closure cannot cross to a client component. */
  labels: {
    notifications: string
    userMenu: string
    /** `DATA: {branch}`, already substituted. */
    dataFrom: string
  }
}

export function Topbar({ accountName, dataFrom, labels }: TopbarProps) {
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
      {/* §6.1.2 — WHICH DATABASE, IN THE SPACE THAT WAS ALREADY EMPTY.
       *
       * The reserved search region is where this goes, rather than a band of its
       * own above the topbar: a band would cost a row of freight on every screen
       * in the application, forever (standing rule 1), and this needs to be seen
       * rather than to be large.
       *
       * PRODUCTION RENDERS THE PLAIN SPACER. Not an empty ribbon and not the word
       * "production" — the absence is the signal, and an element that can print a
       * label on production can print the wrong one. */}
      {dataFrom === null ? (
        <div aria-hidden className="flex-1" />
      ) : (
        <div className="flex flex-1 items-center">
          <span className="rounded-control bg-warning-soft px-z2 py-[2px] text-xs font-medium uppercase tracking-[0.04em] text-warning">
            {labels.dataFrom}
          </span>
        </div>
      )}

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
       * IT READ "OW" UNTIL 2026-09-06, AND THAT WAS A HARDCODED STRING —
       * `userInitials="OW"` passed from the layout, identical for every person
       * who ever logged in. It looked like a fact about the viewer and was a
       * placeholder that shipped.
       *
       * THE NAME, NOT INITIALS, AND TRUNCATED RATHER THAN ABBREVIATED. Daler,
       * holding a Datatruck screenshot showing an avatar and "Admin Account":
       * "everybody will call it account or admin account or dispatch account;
       * OW means nothing to anyone." A name answers the only question the
       * control raises — whose is this — and "Islom Niyozov" clipped at the
       * edge still answers it, where "IN" starts a guessing game. Hence
       * `truncate` and a max width instead of building initials.
       *
       * THE ROLE IS NOT SHOWN. It was the one fact on screen the viewer could
       * not be uncertain about, and it is what "OW" was mistaken for.
       *
       * THE LINK STAYS WHATEVER ELSE CHANGES: nothing in the sidebar reaches
       * /account, so this control is the only door to it. */}
      <Link
        href="/account"
        aria-label={labels.userMenu}
        className="flex h-control-compact items-center gap-z2 rounded-control border border-border-strong bg-surface-2 px-z2 text-ink-2 hover:bg-surface-3"
      >
        <span
          aria-hidden
          className="flex h-z5 w-z5 items-center justify-center rounded-full bg-surface-3 text-xs"
        >
          ◍
        </span>
        {accountName ? (
          <span className="max-w-[14rem] truncate text-xs font-medium">
            {accountName}
          </span>
        ) : null}
      </Link>
    </header>
  )
}
