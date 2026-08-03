# ZEBRA — UAT CHECKLIST

**Version 1** — 2026-08-03
Hand-testing pass before real freight. Each item says **where** to run it, **how**, and **what passing looks like.** Tick the box only when you saw the pass with your own eyes.

Rule of tiers: anything that only _reads_ or manages users → production. Anything that _creates business data_ (loads, documents) → dev, which runs the identical commit (`npm run check:drift` proves it). The first real load is the only production data test, by design — load numbers are never reused and audit history is forever, so production stays clean of fakes.

---

## Tier 0 — prerequisites (production, ~5 min)

- [ ] Old "Disptach" typo account: **Deactivated** and stays that way
- [ ] Real dispatcher account exists: correct name, **their own email**, role **Dispatcher** (check the dropdown before Save), credentials delivered via **Share via Telegram**
- [ ] **Live Check** account exists: role **ADMIN**; its temp password copied into local `.env` as `PROD_CHECK_EMAIL` / `PROD_CHECK_PASSWORD` (this one never goes to Telegram and never changes its password)
- [ ] After Live Check is set: tell Claude Code to run the production live check — **expect 18/18**, the paired half finally running

## Tier 1 — access & security (production, ~20 min)

### Logins per role

- [ ] **Dispatcher signs in** with the shared temp password → immediately changes it at Account → "Password changed. Other devices are signed out."
- [ ] **Dispatcher's sidebar**: Operations, Fleet, Records — **zero Money links, no Admin**. (This is the machine-verified check done by eye: any Money link visible = role misassignment, stop and report.)
- [ ] **Dispatcher types a forbidden URL** — `/users` and `/invoices` by hand → gets 404 / redirect, never the page
- [ ] **Accounting sidebar** (already verified once): Money group present, Admin absent — re-glance after any role changes
- [ ] **Owner sees everything** — you, daily use, continuous test

### The locks

- [ ] **Wrong password refused** with the neutral message (same wording whether the email exists or not — that's deliberate)
- [ ] **Rate limiter**: 5 wrong tries on a test of your own account → 6th try with the _correct_ password also refused → wait 15 min → correct password works. (You've met this one in the wild; this run is just watching it on purpose.)
- [ ] **Deactivation kills access**: deactivate a test account that has a live session → their open tab bounces to /login on next action → they cannot sign back in → **Reactivate** → they can, with their old password intact
- [ ] **Reset email**: request for your own account → email arrives from onboarding@resend.dev → link works once → a second click on the same link is refused
  - _Known limit, not a failure:_ reset mails deliver **only to the owner's inbox** until a sending domain is verified. Dispatchers' resets = you re-mint their account for now.

### The trail

- [ ] Ask Claude Code: _"Pull today's audit trail for the Users screen activity"_ → the morning's creates/deactivations/reactivations appear, attributed to you, with timestamps. What you did is what it recorded.
  - _Needs a hand-off:_ the change log is the `AuditLog` table and there is no production connection string on the machine that runs Claude Code. Either pass `PROD_DIRECT_DATABASE_URL` for the length of that one command, or leave this box until an audit screen exists. The Analytics Engine sink carries audit _health_ only — gaps and failures, not who did what.

## Tier 2 — the working day (dev: zebra-dev.tajikcargollc.workers.dev, ~40 min)

Sign in on dev (dev's owner password — the one in `.env`). Create freely; this data gets cleaned or ignored.

### Reference data

- [ ] Create a broker with a contact → appears in list → edit → soft-delete → gone from list
- [ ] Create a truck + trailer + driver under RAM → each appears with the right authority
- [ ] **Transfer** the truck RAM → Dolphins → old period closed, new period open, visible in its history
- [ ] Pair driver ↔ truck on the driver form → dispatch board row shows the driver's name

### The load lifecycle (the core test)

- [ ] **Create a load keyboard-only**, stopwatch running: authority → broker (typeahead) → truck → driver → stops → dates (type `810`, not the calendar) → miles → rate → save. Target: repeat load in well under 40s; your first ever will be slower — time the _second_ one
- [ ] **Rate con attached during create**: "Preparing…" then "Uploading…" visibly distinct; the save never waits for it
- [ ] Load appears in the table: status stripe, **Booked**, correct authority chip
- [ ] **Assign from the dispatch board** (click path, no drag) → status flips to **Dispatched** by itself → timeline shows the event marked **AUTOMATIC**
- [ ] **Conflict refusals speak**: try assigning the same truck to an overlapping load → refused, message names the conflicting load number; try an out-of-service truck → refused in words
- [ ] **Mark Delivered** — the one manual click
- [ ] **Upload a POD** on the load detail → status moves to **POD received on its own** → timeline shows AUTOMATIC with the document as cause
- [ ] **Download the POD back**: click the filename button → the PDF opens/downloads → _this is the file you'd send a broker_
- [ ] **Cancel a different test load** with a reason → it greys out, nothing deleted, timeline records it

### The furniture

- [ ] **Saved view**: filter to something, save it, sign out, sign in → still there
- [ ] **Density** toggle → rows change height → survives sign-out
- [ ] **Russian** switch: screens read correctly, nothing truncated; **Farsi**: layout mirrors right-to-left properly

## Tier 3 — first real freight (production — this is the acceptance run)

- [ ] Dispatcher books the **first real load**, rate con attached, alongside the old TMS
- [ ] **Send Claude Code the load number** → it rides `verify-upload` on it: the rate con's bytes come back out of R2 through the interface. Two minutes, settles the last unproven production link
- [ ] The load runs its real life: Dispatched on assignment → Delivered click → real POD upload → POD received by itself → POD downloads back
- [ ] Old TMS gets the same load entered second. Parallel-run clock officially starts
- [ ] **Friction log** takes its first real entries

## Not testable — because not built (so nobody hunts for them)

- **Search (⌘K)**: never built. The topbar carried a full-width control with a keyboard hint and no handler, and a comment promising Phase 2 would wire it — Phase 2 came and went. **The affordance is now hidden** (the space stays reserved so the shell does not rearrange when it lands), because a control that looks finished and does nothing teaches a dispatcher the application is flaky, which costs more than the missing feature. Loads by number, brokers by name and trucks by unit are the obvious first scope; the friction log will say within a week whether people reach for it.
- **Notifications/alarms** (POD missing, insurance expiring, invoice overdue): tables exist, engine doesn't. Phase 5 of the original plan — _unless_ the parallel run proves it's a must-have sooner; say so and it moves into Phase 3's brief.
- **Invoicing, payments, AR, settlements**: Phase 3. The Money screens render empty by design.
- **Editing a user** after creation (flag 22): deactivate + recreate is the current path.
- **Reset emails to non-owner inboxes**: waits on the domain.
- **Driver portal**: Phase 6.

## When every box is ticked

Tier 1 green = the doors and locks work. Tier 2 green = the working day works. Tier 3 green = production proved on real freight. From there the only ongoing "test" is Part B itself: every load in both systems, the weekly count, the friction log — for the weeks it takes to earn Part C's exit criteria.
