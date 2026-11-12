# ZEBRA — PHASE 7 BRIEF: THE DRIVER PORTAL

**Version 1.1** — 2026-11-12, numbered Phase 7 and four rulings recorded;
brief only, no code. Version 1 was `DRIVER-PORTAL-BRIEF.md`, 2026-11-11.
**For:** Claude Code, working in the zebra repo
**Reads with:** `TMS-DESIGN-SYSTEM.md` §6.8 (the route matrix) and §9 (the
driver portal), `src/lib/permissions.ts`, `prisma/schema.prisma`, and the five
closed briefs. Every standing rule carries.

> Transcribed into the repository on the day it was asked for, per the rule
> Phase 3 earned: a brief that lives only in a chat log cannot be cited in
> review and its acceptance criteria cannot be checked. **§8 records what has
> been flagged against it**, in the Phase 1 style — the first flag is the
> file's own name. The owner's instruction was "Phase 6 driver portal"; the
> repository's `PHASE-6-BRIEF.md` is Create Load v2 and the Amazon pipeline,
> and `AGENTS.md` still names Phase 5 as current. **Ruled 2026-11-12: this is
> Phase 7; Phase 6 stays Create Load v2.** The same ruling settled §4.2, §4.3
> and §4.6; §4.4, §4.5, §4.7 and §4.8 are open with proposed answers sent.

The goal, stated honestly: a driver standing in a yard, in gloves, in
sunlight, holding a phone, sees **their current load, their own documents, and
their own settlement — and nothing else** (§9, owner's words in §6.8: "a
driver must see only their own loads, statements and documents"). The operator
application never becomes that phone screen; the portal is a separate shell on
the same tenant, the same row-level security and the same permission file.

## 0. What already exists — build on, not beside

Measured on dev, 2026-11-11, one read-only transaction; the code facts are the
tree at `d41b57c`.

- **The vocabulary is decided.** `permissions.ts` has three portal resources —
  `portal.load`, `portal.document`, `portal.settlement` — and DRIVER holds
  exactly five permissions: `portal.load:read`, `portal.load:update`,
  `portal.document:read`, `portal.document:create`,
  `portal.settlement:read`. Nothing operator-side. OWNER's "everything" is
  defined as every permission that does NOT start with `portal.`, so no
  operator role reaches the portal by accident either.
- **The matrix is settled for the driver column.** §6.8's table gives DRIVER
  `reach` on `/account` and `refuse` on the other 53 pages; the sweep proves
  it nightly and, since `d41b57c`, after every dev deploy. The shell renders
  for a driver (GAPS 2026-10-10 fixed the `company:read` throw), so a driver
  who signs in today lands on `/dashboard` and reads a **404**.
- **The schema has the hooks.** `Driver.userId` (nullable) is the link from a
  roster row to a sign-in. `LoadStatusEvent.source` already has
  `DRIVER_PORTAL` beside `MANUAL`, `AUTOMATIC` and `INTEGRATION`.
  `PendingUpload` is the upload-before-attach path Phase 5 §1.5 made the
  real shape. `Document` already hangs off `loadId`, `driverId` and
  `settlementId`, and `DocumentType` already names `POD`, `BOL`,
  `LUMPER_RECEIPT`, `SCALE_TICKET`, `FUEL_RECEIPT`, `DETENTION_PROOF`,
  `PHOTO`. The i18n file carries `loads.source.driverPortal` in three
  languages.
- **What is on dev, by count.** 167 live drivers, **0 with a user**, 1
  membership in the DRIVER role (the sweep's seed account, with no roster
  row). 59 open loads carry a driver, 31 do not. 13 documents sit on loads
  (12 POD, 4 rate confirmations in the top types), 0 on a driver.
  Settlements: 107 DRAFT, 32 APPROVED, 3 PAID. Status events: 1,693
  INTEGRATION, 782 AUTOMATIC, 29 MANUAL, **0 DRIVER_PORTAL**. Production is
  not readable from here; its driver count is the owner's to supply.
- **The money and document libraries exist and are tested.** `settlements.ts`,
  `settlement-view.ts`, `statement-pdf.ts` and `statement-send.ts` already
  produce the statement a driver is sent; `documents.ts` already presigns
  the R2 put and get (25 MB cap) and attaches a pending upload at save.
- **The design rules exist.** §9: 15 px base type, 44 px targets, 52 px
  primary, one primary action per screen, camera-first upload, offline queue
  with a pending indicator, 7:1 body contrast, and the sentence that is the
  whole brief — _do not build the component and hide it_. §12: Farsi is RTL,
  identifiers are `dir="ltr"`.

## 1. What a driver sees

Four screens, one shell, no sidebar. Every read is inside the tenant
transaction (`withCurrentOrg`), and every predicate is **the driver's own
roster row**, resolved once per request as
`Driver.userId = session.userId AND deletedAt IS NULL`. No driver row, no
portal: the screen says so and offers nothing (the sweep's seed driver will
read exactly this until a fixture gives it a roster row — §3.3).

1. **Home = the current load.** The one open load (`OPEN_LOAD` from
   `truck-list.ts`: active, not cancelled, not closed history) whose
   `driverId` is theirs, soonest stop first when there are two. Stops in
   sequence with name, address, appointment or window, the reference number
   (`PU# / DEL#`), the gate code and dock notes from facility memory — every
   identifier `dir="ltr"`. **One primary action**: the next status the driver
   may set (§1.5). Below it: the documents this load still needs (POD after
   delivery, BOL after pickup), as the upload invitation, not a list. A driver
   with no open load sees their next booked load or "No load assigned" with
   nothing to press.
2. **My loads.** Their own loads, newest first: open ones, then the last
   thirty days of finished ones. Status word and stripe (§2), stops as
   city-to-city, date, and the driver's **own pay for the load, only once the
   settlement that includes it is finalised** (APPROVED or PAID) — no
   projected pay, never the broker rate, never revenue, never the company's
   totals (§9; §4.3, ruled 2026-11-12). A load whose settlement is still
   DRAFT, or has none, shows no money at all.
3. **Documents.** Their own: documents on their loads plus documents with
   their `driverId` (CDL copy, medical card — read only, the compliance desk
   owns those). **Take photo** is the primary control, the file picker
   secondary; multi-page captures combine into one PDF on the device;
   compression before upload. An upload is a `PendingUpload` that attaches to
   the load as `POD`, `BOL`, `LUMPER_RECEIPT`, `SCALE_TICKET`,
   `FUEL_RECEIPT`, `DETENTION_PROOF` or `PHOTO` — the driver picks the type
   from those seven, nothing else (the rate confirmation is the
   dispatcher's). Offline: queued with an explicit pending badge, sent on
   reconnect, never silently lost (§9).
4. **Settlements.** Their own statements, newest first: period, gross,
   deductions, net, paid date, and the statement PDF `statement-pdf.ts`
   already renders. **Finalised only** — APPROVED and PAID, their own, and
   nothing before finalisation: a DRAFT never reaches the portal in any form
   (§4.2, ruled 2026-11-12). On dev today that is 35 statements visible and
   107 not.
5. **Account.** The existing `/account` (name, email, password change, sign
   out), restyled to the portal's type scale. Locale switch here, because a
   Farsi-speaking driver is the portal's first user (§12).

What a driver may **write**, in full: a status change on their own open load,
and a document upload onto their own load. The status change is one of the
forward operational steps — `DISPATCHED → AT_PICKUP → LOADED → IN_TRANSIT →
AT_DELIVERY → DELIVERED` — recorded as a `LoadStatusEvent` with
`source: DRIVER_PORTAL` and `changedByUserId`, through the same engine the
dispatch board uses, which already owns the transition rules. No backwards
step, no cancel, no billing axis, no `POD_RECEIVED` (that is the office
confirming the document arrived). One forward step at a time — the engine's
own rule — and a missed tap is the office's correction on the board (§4.4,
ruled). A co-driver on the load sees it and may upload a document to it, and
never sets its status (§4.5, ruled).

## 2. What §6.8 already grants, and what it does not

| Need                                  | Granted today                                            | Missing                                                                                |
| ------------------------------------- | -------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| A driver signs in and reaches nothing | Yes — 53 refusals, one reach, proven nightly             | They land on a 404; the portal needs a landing and the login a role-aware redirect     |
| Read own loads                        | `portal.load:read`                                       | A route, the own-row predicate, a lib function, an integration test with two drivers   |
| Set a status                          | `portal.load:update`; `StatusSource.DRIVER_PORTAL`       | The action and its narrowing to forward steps on an own load                           |
| See own documents                     | `portal.document:read`                                   | A route and the predicate (`loadId IN own loads OR driverId = own`)                    |
| Upload a document                     | `portal.document:create`; `PendingUpload`; presigned put | Camera-first client, type limited to seven, attach to own load only, offline queue     |
| See own settlements                   | `portal.settlement:read`; statement PDF                  | A route, the predicate (`Settlement.driverId = own AND status IN (APPROVED, PAID)`)    |
| A driver IS a roster row              | `Driver.userId`                                          | **Nothing writes it.** The writer is a picker on the driver's record, OWNER/ADMIN only |
| The portal is not the operator app    | `portal.*` is its own vocabulary; §9 is its own shell    | The shell: a `(portal)` route group, no sidebar, its own layout, its own type scale    |
| Farsi                                 | `fa` locale, RTL direction, logical properties app-wide  | Every portal string in three languages from the first component                        |
| The sweep covers it                   | Routes come from the filesystem; six roles already       | A seed driver WITH a roster row and loads, or every portal page sweeps as empty state  |

## 3. What is missing, as work — no code in this brief

1. **The link.** A way to say "this sign-in is that driver" — **on the
   driver's record, by OWNER or ADMIN, never by the driver** (§4.6, ruled
   2026-11-12). The Users screen keeps minting the DRIVER sign-in as it does
   today; the driver's own page (`/drivers/[id]`) gains a "Sign-in" picker
   over users holding the DRIVER membership and no roster row yet, and the
   save writes `Driver.userId` in `src/lib/`. The picker is gated by
   `user:update`, which OWNER and ADMIN hold alone — not by `driver:update`,
   which MANAGER holds through `FLEET_WRITE` — and the gate is decided in
   `permissions.ts` and nowhere else. A roster row with a terminated date
   refuses the link; setting `Driver.terminationDate` deactivates the
   sign-in in the same write, and bringing a driver back is a new link by
   OWNER or ADMIN whose audit row names who (§4.7, ruled); nothing under
   `(portal)` can set the column. The dev
   seed gives the sweep's DRIVER account a roster row with two loads, one
   open and one delivered, and one POD — so the sweep's driver column reads
   a portal with content, not empty states.
2. **The shell.** `src/app/(portal)/…` with its own `layout.tsx`: no sidebar,
   a bottom tab bar (Load · Loads · Documents · Settlements · Account), §9's
   scale and contrast, `dir` from the locale, and the "DATA: dev" ribbon
   where the operator shell has it. Sign-in redirects a DRIVER to `/portal`
   and every other role to `/dashboard`; an operator role that opens
   `/portal` is **refused** — §6.8's table gains six portal rows, and the
   sweep's matrix test reads them as it reads the rest.
3. **The predicates, in `src/lib/portal.ts`,** one per surface and nowhere
   else: `ownDriver(tx, session)`, `ownLoadsWhere`, `ownDocumentsWhere`,
   `ownSettlementsWhere`, `nextStatusFor(load)`. Tested the way
   `truck-list.ts` is: an integration test with TWO drivers in one
   organization, asserting the second driver's rows never appear — and that
   the count for the first is above zero, so the test cannot pass on an
   empty table (the isolation-coverage lesson).
4. **The writes.** `recordPortalStatus(tx, session, loadId, toStatus)` —
   own load, forward step, `DRIVER_PORTAL` source — and the upload attach
   limited to own load and the seven types. Both audited as every write is.
5. **The device half.** Camera capture, client-side compression and
   multi-page PDF assembly, and the offline queue with its pending badge —
   the only part of this brief that is new engineering rather than new
   surface. It is a service worker and IndexedDB; the queue replays through
   the same presigned put. Measured before it ships: one POD photo's bytes
   before and after compression, and the upload's wall time from a phone on
   a cellular connection.
6. **The sweep and the ritual.** Portal routes join the filesystem walk
   automatically; the matrix gains their rows; the RTL pass runs on every
   portal screen before it ships (§12); the deploy sweep (§6.8, `d41b57c`)
   renders them after every dev deploy. Any new table carrying
   `organizationId` gets its fixture row in the same commit (AGENTS.md).

## 4. For the owner's ruling, before any step starts

1. **The number.** Is this Phase 7, or does it displace Create Load v2 as
   Phase 6? **RULED 2026-11-12: Phase 7. Phase 6 stays Create Load v2.** The
   file is `PHASE-7-BRIEF.md`; nothing else changed.
2. **Which settlements a driver sees.** APPROVED and PAID only (the office's
   DRAFT is still being worked), or DRAFT too with the word on it? Dev holds
   107 drafts to 35 approved-or-paid. **RULED 2026-11-12, the owner's words:
   "a driver sees only settlements that are finalised, and only his own;
   nothing before finalisation."** Finalised is read as APPROVED or PAID — the
   two statuses after the office's approval — and a DRAFT is absent from the
   portal, not shown with a word on it.
3. **Pay on the load before settlement.** Show `Load.driverPayCents` on My
   loads as soon as it is set, or only once a settlement line exists? **RULED
   2026-11-12, the owner's words: "pay shows per load only after the
   settlement that includes it is finalised — no projected pay."** So the
   number on My loads is the settlement line's, read through the finalised
   settlement, never `Load.driverPayCents` on its own. This also settles §8
   flag 2: a driver sees their own pay and no broker rate.
4. **Status steps.** Strictly one forward step at a time, or may a driver
   jump (`DISPATCHED → LOADED` when they forgot to tap at the pickup)? The
   dispatch board's engine already answers one way; the portal should not
   answer differently without a ruling. **RULED 2026-11-12: one forward
   step, the engine's own rule; a missed tap is the office's correction on
   the board,** where the timeline shows who moved what.
5. **Co-drivers.** `Load.coDriverId` exists. Does a co-driver see the load,
   and may they set its status? **RULED 2026-11-12: a co-driver sees the
   load and uploads to it, never sets its status** — one driver of record
   per status change.
6. **Who links.** The Users screen (OWNER/ADMIN) per §3.1, or the driver
   record's own page? **RULED 2026-11-12, the owner's words: "linking a
   sign-in to a roster row is done by Owner/Admin on the driver's record
   (pick the user), never by the driver."** §3.1 is rewritten to match: the
   picker lives on `/drivers/[id]`, gated by a permission only OWNER and
   ADMIN hold.
7. **Termination.** When `Driver.terminationDate` is set, is the user
   deactivated in the same write (sessions revoked, `setUserActive`), or
   does the office do it by hand? **RULED 2026-11-12: the same write —
   termination date set means the sign-in is deactivated in that write;
   reactivation needs OWNER or ADMIN to re-link on the driver record, and
   the audit row names who.** So reactivating the driver never reactivates
   the sign-in by itself, and the re-link is a second audited act.
8. **Onboarding mail.** A driver's first password is set by Forgot password
   only once production sends from a verified domain (README "Parked" step
   4; today's sender delivers only to the Resend account owner). Until then
   the temporary password from the Users screen, over Telegram, is the
   hand-over. **RULED 2026-11-12: the Telegram hand-over for the first
   drivers,** as for the accountant; the verified domain is its own item and
   blocks no step.

All eight ruled on 2026-11-12. "Finalised" is APPROVED or PAID, confirmed by
the owner the same day. The rules are transcribed into
`TMS-DESIGN-SYSTEM.md` §9 (v10.85), which is what a screen is held to.

## 5. Order of work — one step per session, doc first at every step

| Step | Work                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| ---- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 0    | DONE 2026-11-12: all eight rulings recorded in §4; `TMS-DESIGN-SYSTEM.md` v10.85 §9 gains the tab bar, the landing rule, the money, write and link rules and Load's two-statement budget, in its own commit; §6.8 records the four portal routes' INTENT in prose — the rows enter the table at step 2 with the pages, because the matrix test refuses a row that names no page (flag 5)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| 1    | DONE 2026-11-12 (dev): the Sign-in tab on the driver's record (§6.4 part 2 v10.86), OWNER/ADMIN under `user:update`, writes `Driver.userId` through `src/lib/driver-link.ts` — ONE predicate for "may be linked", held to a SQL spelling with both sides above zero; termination deactivates and unlinks in the same write, re-linking reactivates; `tests/integration/driver-link.test.ts`, two organizations, two drivers, twelve cases; five guards watched failing. DEFERRED to step 2 by name: the seed's roster row and loads for the sweep's DRIVER account, which only the portal pages need                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| 2    | DONE 2026-11-12 (dev), with step 3 in the same chain on the owner's instruction: the `(portal)` group and its five-tab shell (§9), sign-in lands a DRIVER on `/portal`, `src/lib/portal.ts` holds one predicate per surface from the driver's own roster row, Load shows the current load with stops, facility memory and the documents it still needs; the four §6.8 rows entered with the pages; the seed gives the sweep's driver a linked roster row, SWEEP-1 open and SWEEP-2 delivered; `tests/integration/portal.test.ts` — two drivers, every surface own-only with counts above zero, the DRAFT absent, pay only through the APPROVED line, and Load counted at TWO statements. NOT in this step, by name: the primary action (step 4), the RTL pass on a phone (the owner's look on dev), the Account tab's restyle (flag 6)                                                                                                                                                                                                                                                                                                                                                                                                 |
| 3    | DONE 2026-11-12 (dev), with step 2: My loads (open first, then thirty days, pay through a finalised settlement's line only), Settlements (own, APPROVED or PAID, DRAFT absent) with the statement PDF through `/api/portal/statements/[id]` under the own-settlements predicate, Documents read-only with the download through `/api/portal/documents/[id]/download-url` under the own-documents predicate; the operator's statement route and the portal's render one function, `statementPdfFor`, extracted so the two cannot drift                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| 4    | DONE 2026-11-12 (dev): the one primary action on Load — `recordPortalStatus` in `src/lib/portal-status.ts`, one forward rung of the driver's six-step ladder computed from the load's status at the moment of the write (a stale tap is refused in words, never applied as a jump), through `transitionOperational` with `source: DRIVER_PORTAL` and the driver's user; the driver of record only — a co-driver sees a sentence, never the button, and the write refuses the second seat by name; the load's timeline on `/loads/[id]` prints "driver portal" beside the name (the dispatch board itself carries no timeline — flag 8); five integration cases and a node test of the ladder, four guards watched failing                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| 5    | DONE 2026-11-12 (dev): camera-first upload on Documents — Take photo (52 px, the camera opened directly) first, a file picker second, one of the seven types, onto the current load on either seat — through the office's own compress → hash → mint → PUT → confirm, behind the portal's own routes (`/api/portal/documents/upload-url` and `/confirm`) under `portal.document:create` and two predicates in `src/lib/portal-documents.ts`; a POD confirm moves the load to POD received as the office's does, so the office sees it on the load the same minute; one capture per upload (flag 9). Flag 8's ruling built in the same chain: the tap is the stop's check-in                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| 6    | DONE 2026-11-12 (dev): the offline queue — a tap or a capture the office never answered is kept on the phone in IndexedDB (`src/lib/offline-queue-store.ts`), the capture already compressed and the tap with its own time, and replayed by the shell's strip (`PendingQueue`, `src/lib/offline-queue.ts` holds the rule with no browser in it) through the same route the live write takes, oldest first, on open, on reconnect, on foreground and every thirty seconds while anything waits; a refusal in words stays on the strip until dismissed, never silently dropped; the pending indicator is explicit on every portal screen and Load shows the kept rung where the button was; a replayed tap clocks the stop at the tap inside a 24-hour window (`clockTimeFor`). `tests/offline-queue.test.ts` walks every branch of the replay with a map and a scripted office; `tests/integration/portal.test.ts` gains the replayed tap's clock, two cases; four guards watched failing. NOT a service worker (flag 10). NOT measured on a phone here — no phone in the session; the procedure is in §9 and the box stays open until the owner's measurement (flag 11). The acceptance run is §9; what the next phase inherits is §10 |

## 6. Acceptance excerpt

- [x] A DRIVER signs in and lands on their current load; every operator route
      still refuses them (the matrix, 53 rows) and every portal route
      refuses the other five roles (six new rows) — proven by the sweep
- [x] Two drivers in one organization: neither sees a load, a document or a
      settlement of the other's, and each sees at least one of their own
      (counts above zero in the test)
- [x] A status set from the portal appears on the load's timeline as
      `driver portal` with the driver's name; a backwards step or a step on
      another driver's load is refused in words
- [ ] A POD photographed on a phone attaches to the right load as `POD`,
      and `/loads/[id]` in the office shows it without a refresh of anything
      but the page
- [x] A settlement visible in the portal matches the statement PDF the
      office sent, to the cent
- [ ] Every portal screen passes the RTL pass in Farsi; every identifier reads
      left-to-right
- [ ] An upload started offline is sent on reconnect and shown pending
      until then; killing the app mid-queue loses nothing (measured)
- [x] The driver record's "Sign-in" picker is reachable by OWNER and ADMIN
      only, lists users with the DRIVER role and no roster row, refuses a
      terminated driver, and nothing under `(portal)` can write
      `Driver.userId` (the two-driver test asserts it)
- [x] A DRAFT settlement appears nowhere in the portal, and a load shows no
      pay until the settlement that includes it is APPROVED or PAID
- [x] Setting a termination date signs the driver out and refuses the next
      sign-in; the re-link is a second act by OWNER or ADMIN and its audit
      row names them
- [x] Load (`/portal`) renders in two statements inside the tenant
      transaction, counted by the query log, before the screen ships

## 7. Parked, with names

- **Push notifications** ("your load was assigned"): needs a push provider
  and a device token table; not in v1. The driver opens the app.
- **Location sharing / ELD**: the AI truck-recommendation note in Phase 5 §4
  stands — a later phase, never this one.
- **In-app messaging with dispatch**: `Communication` exists as a model; the
  portal reads nothing from it in v1.
- **A native app**: the portal is the web, installed to the home screen. A
  store listing is a decision for after the first month of real use.

## 8. Flagged against this brief

Recorded rather than resolved, per Phase 1's discipline.

1. **The name.** The instruction said "Phase 6 driver portal". `PHASE-6-BRIEF.md`
   is Create Load v2 and the Amazon pipeline; UAT 2026-10-04 wrote "Driver
   portal: Phase 6" before Phase 6 was assigned. This file was
   `DRIVER-PORTAL-BRIEF.md` until §4.1 was ruled; **Phase 7 since
   2026-11-12.**
2. **§9 says "no broker rates beyond their own load", which can be read two
   ways** — a driver sees the rate on their own load, or a driver sees no
   broker rate at all. §1.2 above takes the second reading (own pay, never
   the broker's rate) because §6.8's owner's words name "loads, statements
   and documents" and not money, and because `Load.driverPayCents` is the
   number a driver has a claim to. **Confirmed by §4.3's ruling of
   2026-11-12,** which goes further: own pay only after finalisation.
3. **The sweep's DRIVER account has no roster row**, so every portal page
   would sweep as an empty state and the matrix would say `reach` about a
   screen with nothing on it — the "sees no rows" vacuity AGENTS.md names.
   §3.1 gives the seed a roster row; it is a step, not a note.
4. **`Driver.userId` has existed since Phase 1 and nothing has ever written
   it** — 167 drivers, 0 links on dev. A column with a writer nobody built is
   the ComplianceItem lesson again; §3.1 is where it gets one.
5. **Step 0 said §6.8's table gains the portal rows, and the table cannot
   take them yet.** `tests/sweep.test.ts` fails by name on a row that names
   no page, and `scripts/sweep.mjs` counts one as a problem (`matrix row, no
page`), so four rows written before the pages would turn the deploy sweep
   and every nightly red. Where a brief disagrees with the design system's
   instruments, the instruments win (AGENTS.md): §6.8 carries the four
   routes' intent in prose (v10.85) and the rows enter the markers in step
   2's commit with the pages, where the pin "a driver reaches only
   `/account`" also moves. Flagged 2026-11-12 at step 0. _Discharged at step
   2 the same day: the four rows are in the table, the pin names five
   routes._
6. **The Account tab opens the operator shell.** §1.5 and §9 say `/account`
   "restyled to the portal's type scale"; step 2 links the tab to the
   existing `/account`, which renders under the operator shell — sidebar
   with no groups, topbar — because restyling it means either a second
   account page or a shell that switches by role, and neither was in the
   owner's step 2 list. A driver reaches it, changes their password and
   signs out; it reads at 13 px, not 15. Flagged 2026-11-12 at step 2, for a
   step of its own or the owner's word that the operator shell is enough.
7. **Documents for the sweep driver are not seeded.** The seed gives the
   sweep's driver a roster row and two loads and no document row: a
   `Document` row names an R2 object, and a row without an object behind it
   would be a list entry whose Open fails — the "sees no rows" vacuity
   swapped for a dead control. The sweep reads `/portal/documents` as an
   empty state until step 5 uploads one from the portal itself. The
   two-driver integration test, not the sweep, is where the document
   predicate is proven above zero. Flagged 2026-11-12 at step 2.
8. **The driver's tap moves the status and nothing else.** Step 4 writes
   the status step through the engine; it does not stamp the stop's
   `arrivedAt` / `departedAt`, which the office's check-in on the board
   owns with its own attribution (`stop-actuals.ts`). So "At pickup" from
   the portal is a status fact and not an arrival time, and `documentsNeeded`
   reads the status rather than the stop times for the BOL. Whether the
   driver's tap should also be the stop's check-in — one tap, two facts — is
   for the owner's ruling; it is a cheap step if yes. And §5 step 4 said
   "the dispatch board shows the source word": the board has no timeline;
   the source word reads on the load's own timeline (`/loads/[id]`), where
   the office reads every status change. Flagged 2026-11-12 at step 4.
   **RULED 2026-11-12, the owner's words: "the tap is the stop's check-in —
   At pickup stamps the pickup stop's arrival, the departure rung stamps its
   departure, same for delivery; office edit still allowed and audited."**
   Built with step 5: `stampStopForStep` in `portal-status.ts` stamps the
   first stop of that type whose clock is still empty, in the same
   transaction as the status, under the driver's attribution (the audit row
   names the driver, which is what the stop table's "who" reads); a clock
   the office already set is never overwritten, and the office's later edit
   is its own audited write. Intermediate stops are not on the ladder and
   stay the office's to clock.
9. **Multi-page captures are not combined into one PDF on the device.** §9
   asks for it; there is no PDF library in the dependencies and writing one
   is its own step. Step 5 ships one capture per upload — a second page is a
   second upload of the same type — and the office sees two files. For the
   owner's ruling: add a client-side PDF assembler (a dependency), or leave
   pages as pages. Flagged 2026-11-12 at step 5. **RULED 2026-11-12, the
   owner's words: "no assembler; one capture per upload, office sees them
   grouped by type on the load."** Which §7.8 already does — `LoadDocuments`
   on `/loads/[id]` groups by type and never by upload order — so nothing
   was built; §9's "combine multi-page captures into a single PDF on the
   device" is retired by the ruling (v10.91).
10. **No service worker.** §3.5 said "a service worker and IndexedDB". Step
    6 ships IndexedDB and no worker: the portal shares the office's origin,
    and a worker registered at the root would intercept the office's
    requests too — the one thing a service worker adds over the open page
    is Background Sync, replay with the app closed, which is Chromium-only
    and would leave an iPhone replaying from the open page anyway. So the
    queue replays from the page: on open, on reconnect, on foreground, and
    every thirty seconds while anything waits; `tests/offline-queue.test.ts`
    pins that nothing under `src/app` or `src/lib` registers a worker. For
    the owner's ruling: a worker scoped to `/portal/` with Background Sync
    for Android, as its own step, or the open page as it is. Flagged
    2026-11-12 at step 6.
11. **The phone measurements were not taken.** §3.5 asks for one POD
    photo's bytes before and after compression and the upload's wall time
    from a phone on cellular; §6's offline box says "(measured)". There is
    no phone in a session: the numbers are the owner's to take on dev, and
    the procedure is in §9 against the open box. Flagged 2026-11-12 at
    step 6.

## 9. How §6 closed

Each box, and where the evidence lives. Run `npm run check`,
`npm run test:integration` and the deploy sweep to reproduce; the three
boxes only a phone can tick are OPEN, by name, with the procedure.

| Box                                                                   | Closed by                                                                                                                                                                                                                                                                                                                                                                                                                         |
| --------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| DRIVER lands on the current load; the matrix both ways                | The deploy sweep on every dev deploy (`deploy-sweep-<run id>` artifact): 59 pages × 6 roles, the driver reaching 5 and refused 53, the four portal rows refusing the other five roles "by the table"; `tests/sweep.test.ts` pins 59 and the driver's five; `src/app/(auth)/actions.ts` sends DRIVER to `/portal`                                                                                                                  |
| Two drivers, nothing of the other's, each above zero                  | `tests/integration/portal.test.ts` — Home, My loads, Documents, Settlements each asserted own-only for A and for B with counts above zero, and the second seat counted                                                                                                                                                                                                                                                            |
| A portal status on the timeline as `driver portal`; refusals in words | `tests/integration/portal.test.ts` "the driver's status step" — source `DRIVER_PORTAL`, the user named, a stale tap and a backwards tap refused with one event on the load, the co-driver refused by name                                                                                                                                                                                                                         |
| A POD from a phone attaches as `POD`; the office sees it              | The predicates in `tests/integration/portal.test.ts` "the driver's upload target"; the confirm is the office's own `confirmUpload` (`src/lib/documents.ts`), which calls `podConfirmed` — proven in `tests/integration/loads.test.ts` — and `tests/portal-documents.test.ts` pins the portal's confirm route to that function. **OPEN for the phone:** photograph a POD on dev as the sweep driver and open SWEEP-1 in the office |
| A settlement matches the statement PDF to the cent                    | One function renders both: `statementPdfFor` in `src/lib/statement-document.ts`, called by the office's route and the portal's; `tests/statement-workbench.test.ts` reads it; the portal's numbers are the settlement row's own (`ownSettlements`)                                                                                                                                                                                |
| RTL pass in Farsi; identifiers LTR                                    | Every portal class is a logical property and every identifier carries `dir="ltr"` (load number, reference, filename, dates). **OPEN for the phone:** the owner's look on dev in Farsi on every portal screen                                                                                                                                                                                                                      |
| An upload started offline is sent on reconnect; a kill loses nothing  | `tests/offline-queue.test.ts` — kept offline, sent in order on reconnect, a refusal kept with its words, a network failure stops the pass; the store is IndexedDB. **OPEN for the phone (flag 11):** airplane mode on, tap a rung and take a photo, kill the app, reopen, airplane mode off; both land and the strip empties                                                                                                      |
| The Sign-in picker: OWNER/ADMIN, the predicate, nothing under portal  | `tests/integration/driver-link.test.ts` (12 cases) and `tests/driver-record.test.ts`; `tests/portal-status.test.ts` "nothing under the portal writes the roster" reads every file under `(portal)`, `api/portal` and `src/lib/portal*` and finds no driver write and no link call                                                                                                                                                 |
| No DRAFT in the portal; no pay before finalisation                    | `tests/integration/portal.test.ts` — the draft absent from Settlements, `payCents` null on the open load, 65,000 through the APPROVED line                                                                                                                                                                                                                                                                                        |
| Termination signs out; re-link is a second audited act                | `tests/integration/driver-link.test.ts` — termination deactivates in the same write, the re-link reactivates, the audit row names the actor                                                                                                                                                                                                                                                                                       |
| Load at two statements, counted                                       | `tests/integration/portal.test.ts` "costs 2 statements inside the transaction — the budget", a logging client counting                                                                                                                                                                                                                                                                                                            |

## 10. What the next phase inherits

- **The Account tab opens the operator shell** (flag 6): a driver reaches
  `/account` at 13 px under a sidebar; restyling it is a step or the owner's
  word that the operator shell is enough.
- **Replay with the app closed** (flag 10): a service worker scoped to
  `/portal/` with Background Sync for Android, if ruled.
- **The phone measurements** (flag 11): compression bytes before and after,
  upload wall time on cellular, the offline round trip — the owner's, on dev.
- **No seeded document for the sweep driver** (flag 7): the sweep reads
  Documents as an empty state until a portal upload on dev leaves one.
- **Parked in §7:** push notifications, location sharing, in-app messaging,
  a native app.
