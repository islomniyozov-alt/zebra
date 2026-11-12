# ZEBRA — DRIVER PORTAL BRIEF

**Version 1** — 2026-11-11, brief only, no code
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
> and `AGENTS.md` still names Phase 5 as current. So this brief carries no
> phase number until the owner gives it one.

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
   city-to-city, date, and the driver's **own pay for the load** when the
   settlement line exists — never the broker rate, never revenue, never the
   company's totals (§9; §4 ruling 3 asks whether pay before settlement is
   shown at all).
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
   already renders. Which statuses are visible is §4 ruling 2.
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
confirming the document arrived). Whether a driver may skip a step is §4
ruling 4.

## 2. What §6.8 already grants, and what it does not

| Need                                  | Granted today                                            | Missing                                                                               |
| ------------------------------------- | -------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| A driver signs in and reaches nothing | Yes — 53 refusals, one reach, proven nightly             | They land on a 404; the portal needs a landing and the login a role-aware redirect    |
| Read own loads                        | `portal.load:read`                                       | A route, the own-row predicate, a lib function, an integration test with two drivers  |
| Set a status                          | `portal.load:update`; `StatusSource.DRIVER_PORTAL`       | The action and its narrowing to forward steps on an own load                          |
| See own documents                     | `portal.document:read`                                   | A route and the predicate (`loadId IN own loads OR driverId = own`)                   |
| Upload a document                     | `portal.document:create`; `PendingUpload`; presigned put | Camera-first client, type limited to seven, attach to own load only, offline queue    |
| See own settlements                   | `portal.settlement:read`; statement PDF                  | A route, the predicate (`Settlement.driverId = own`), the status rule (§4.2)          |
| A driver IS a roster row              | `Driver.userId`                                          | **Nothing writes it.** `createUser` makes a User and a Membership, never the link     |
| The portal is not the operator app    | `portal.*` is its own vocabulary; §9 is its own shell    | The shell: a `(portal)` route group, no sidebar, its own layout, its own type scale   |
| Farsi                                 | `fa` locale, RTL direction, logical properties app-wide  | Every portal string in three languages from the first component                       |
| The sweep covers it                   | Routes come from the filesystem; six roles already       | A seed driver WITH a roster row and loads, or every portal page sweeps as empty state |

## 3. What is missing, as work — no code in this brief

1. **The link.** A way to say "this sign-in is that driver": the Users screen
   gains, for role DRIVER only, a required picker over live roster rows with
   no user yet, and `createUser` writes `Driver.userId` in the same
   transaction. A roster row with a terminated date refuses the link. The
   dev seed gives the sweep's DRIVER account a roster row with two loads, one
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
   Phase 6? The file is renamed on the ruling; nothing else changes.
2. **Which settlements a driver sees.** APPROVED and PAID only (the office's
   DRAFT is still being worked), or DRAFT too with the word on it? Dev holds
   107 drafts to 35 approved-or-paid; the answer decides whether the
   settlements tab is mostly empty for most of a week.
3. **Pay on the load before settlement.** Show `Load.driverPayCents` on My
   loads as soon as it is set, or only once a settlement line exists?
4. **Status steps.** Strictly one forward step at a time, or may a driver
   jump (`DISPATCHED → LOADED` when they forgot to tap at the pickup)? The
   dispatch board's engine already answers one way; the portal should not
   answer differently without a ruling.
5. **Co-drivers.** `Load.coDriverId` exists. Does a co-driver see the load,
   and may they set its status? Suggested: sees, cannot set.
6. **Who links.** The Users screen (OWNER/ADMIN) per §3.1, or the driver
   record's own page (Fleet, which MANAGER reaches)? Suggested: the Users
   screen, because it is where the sign-in is minted and the link is a
   sign-in fact.
7. **Termination.** When `Driver.terminationDate` is set, is the user
   deactivated in the same write (sessions revoked, `setUserActive`), or
   does the office do it by hand? Suggested: the same write.
8. **Onboarding mail.** A driver's first password is set by Forgot password
   only once production sends from a verified domain (README "Parked" step
   4; today's sender delivers only to the Resend account owner). Until then
   the temporary password from the Users screen, over Telegram, is the
   hand-over. The portal's first real driver waits on that step or on that
   hand-over — the owner picks which.

## 5. Order of work — one step per session, doc first at every step

| Step | Work                                                                                                                                                                                                              |
| ---- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 0    | Rulings 1–8 recorded in this file's §4; §6.8's table gains the portal rows as `refuse` for five roles and `reach` for DRIVER; `TMS-DESIGN-SYSTEM.md` §9 gains the tab bar and the landing rule, in its own commit |
| 1    | The link: Users screen picker for role DRIVER, `createUser` writes `Driver.userId`, seed gives the sweep's driver a roster row and loads; integration test with two drivers                                       |
| 2    | The shell and Home: `(portal)` group, layout, redirect by role, `portal.ts` predicates, the current load with stops and the one primary action; RTL pass; sweep green with the new rows                           |
| 3    | My loads and Settlements, read-only, with rulings 2, 3 and 5 applied; statement PDF reachable                                                                                                                     |
| 4    | Status write: `recordPortalStatus`, `DRIVER_PORTAL` events on the load's timeline, the dispatch board shows the source word                                                                                       |
| 5    | Documents: camera-first upload through `PendingUpload`, seven types, attach to own load; the office sees it on the load the same minute                                                                           |
| 6    | Offline queue and pending badge; measured on a phone on cellular; acceptance run; brief closed with flags in the Phase 3/4 style                                                                                  |

## 6. Acceptance excerpt

- [ ] A DRIVER signs in and lands on their current load; every operator route
      still refuses them (the matrix, 53 rows) and every portal route
      refuses the other five roles (six new rows) — proven by the sweep
- [ ] Two drivers in one organization: neither sees a load, a document or a
      settlement of the other's, and each sees at least one of their own
      (counts above zero in the test)
- [ ] A status set from the portal appears on the load's timeline as
      `driver portal` with the driver's name; a backwards step or a step on
      another driver's load is refused in words
- [ ] A POD photographed on a phone attaches to the right load as `POD`,
      and `/loads/[id]` in the office shows it without a refresh of anything
      but the page
- [ ] A settlement visible in the portal matches the statement PDF the
      office sent, to the cent
- [ ] Every portal screen passes the RTL pass in Farsi; every identifier reads
      left-to-right
- [ ] An upload started offline is sent on reconnect and shown pending
      until then; killing the app mid-queue loses nothing (measured)
- [ ] The Users screen refuses to mint a DRIVER without a roster row, and
      refuses a terminated one

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
   portal: Phase 6" before Phase 6 was assigned. This file is
   `DRIVER-PORTAL-BRIEF.md` until §4.1 is ruled.
2. **§9 says "no broker rates beyond their own load", which can be read two
   ways** — a driver sees the rate on their own load, or a driver sees no
   broker rate at all. §1.2 above takes the second reading (own pay, never
   the broker's rate) because §6.8's owner's words name "loads, statements
   and documents" and not money, and because `Load.driverPayCents` is the
   number a driver has a claim to. §4.3 asks the owner to confirm.
3. **The sweep's DRIVER account has no roster row**, so every portal page
   would sweep as an empty state and the matrix would say `reach` about a
   screen with nothing on it — the "sees no rows" vacuity AGENTS.md names.
   §3.1 gives the seed a roster row; it is a step, not a note.
4. **`Driver.userId` has existed since Phase 1 and nothing has ever written
   it** — 167 drivers, 0 links on dev. A column with a writer nobody built is
   the ComplianceItem lesson again; §3.1 is where it gets one.
