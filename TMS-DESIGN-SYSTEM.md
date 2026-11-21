# TMS-DESIGN-SYSTEM.md

**Project:** Zebra — Transportation Management System
**Status:** v11.41 — §6.3, saving an authority returns to /companies with a "Saved" notice and the row shows the new MC and DOT; every field on the form is one list read by the form, both actions and the edit page, held by a round-trip test (owner's report 2026-11-21: after Look up and Save the form stayed open and nobody could tell it had saved; it had). Before it, v11.40 — §6.3, the plan's authority cap counts authorities that are not retired, and the "{used} of {limit} used" line counts the same way (owner's ruling 2026-11-21: dev read "5 of 5 used" with three Retired placeholders); a retired authority with no MC, no DOT and nothing ever filed under it may be removed permanently by the OWNER alone, audited. Before it, v11.39 — §6.4 part 1, leaving Inactive (Terminated) opens an assignment period (owner's ruling 2026-11-20, GAPS 48): a driver set from `INACTIVE` back to work, on the record form or the bulk bar, gets an open `AssetAssignment` period under their own authority in the same write unless one is open; three reactivations on dev without one failed every CI run on 2026-11-19. Before it, v11.38 — §6.4 part 1, /drivers has three tabs (Active · Inactive · All; Inactive is what Terminated was), a Search box (name, phone, truck unit) and Unassigned and Vacation as filter chips (owner's ruling 2026-11-19). Before it, v11.37 — §0 standing rule 13, a saved value is the one every screen reads (record, list, statements, dispatch, exports), held per entity by an integration test (owner 2026-11-19). Before it, v11.36 — §6.5 part 2, the truck record: Save keeps every field it shows (owner name and four more were lost on reload), two columns like the driver Main, and a Details tab for fuel type, fleet status, owner, gross weight and axles (owner 2026-11-19). Before it, v11.35 — §6.4, the Transfer dialog on drivers, trucks and trailers lists every active authority except the current one and ends with "+ Add authority" (Admin → Authorities → new, returning to the dialog) for a role that may create one (owner 2026-11-19). Before it, v11.34 — §6.4 part 2, the driver qualification file is five rows (owner's ruling 2026-11-19): Contract, Road test, Copy of the CDL, MVR, Medical card; hire date, prior-employer inquiries, annual review and clearinghouse removed; "since" no longer depends on the hire date. Before it, v11.33 — §6.2.10 part 7 step 4, the statement page in Datatruck's shape (owner's brief 2026-11-18; rulings R12, R15, R16 of 2026-11-17, R16 reaffirmed 2026-11-18): four summary cards (Settlement · Earnings · Fuel & balances · Trips, with RPM = gross ÷ miles, shown and never stored); seven tabs with their counts, a zero tab shown (Trips · Fuel · Toll · Balances · Recurring · One-time · Attachments & notes); the batch's deduction lines shown for the first time (the page read hand-added lines only); actions Post · Add deduction · Send to driver · Download, Add deduction on a batch draft writing the batch's one-time charge so a refresh keeps it. Before it, v11.32 — §6.2.10 part 7 step 3, the batch screen in Datatruck's shape (owner's brief 2026-11-18; rulings R8, R11–R14 of 2026-11-17): the statements table leads, with All / Unposted / Posted / Paid tabs and ten columns (Truck behind the chooser); the right rail's General and Totals, every figure a stored statement column or a sum of them; Send (posted only), Post all unposted, Add driver, Add trip (the tick grid, behind a panel) and Add deduction (a one-time charge the engine already reads, then the draft refreshed); editable while any statement is Unposted, Delete while nothing is posted. Before it, v11.31 — §6.4 part 2, Main's empty CDL fields read from the newest CDL record and filing a CDL fills them (one source; a reading of the same card completes its record). v11.30 — §6.4 part 1, the Terminated and Vacation tabs' date column takes a seat inside the nine-column cap rather than adding a tenth (both tabs answered 500); and §6.4 part 2, the driver record's Documents and Safety tabs (safety team on dev, 2026-11-17): Documents gains Upload by kind, the list with uploaded date and the expiry of the record each document evidences, and the CDL and medical-card readers with the driver stated; every DQF row gains the act that satisfies it (hire date → Main, document rows → Upload, dated rows → Record), an on-file row links its document, and one predicate per row (`dqfRowSatisfied`) is held in agreement with the actions over fixtures. Before it, v11.29 — §12 two locales, EN and RU: Farsi removed 2026-11-17 by owner; Afghan drivers use Russian. The `fa` dictionary, the language option and the right-to-left layout go, with their tests; the driver portal ships EN and RU like the office. Logical properties stay (rule 6) and identifiers keep `dir="ltr"`. Before it, v11.28 — §6.2.10 part 7 step 2's carry-over floor (owner's ruling 2026-11-17; MONEY-DESIGN §6; migration 74): "Delivered earlier, not yet paid" reaches back to the organization's payroll cutover date, a Settings field for OWNER/ADMIN, audited; default per authority the start of its earliest Zebra batch, else today; the floor bounds the carry-over, never the range; a seventh picker group, Delivered before payroll cutover. Before it, v11.27 — §6.2.10 part 7 step 2 gains the catch-up (owner's ruling 2026-11-17; MONEY-DESIGN §6): any Delivered trip on no statement is eligible for the next batch of its authority regardless of date; Create lists them as a second group, "Delivered earlier, not yet paid", by name and ticked by default; the no-overlap rule binds the range, not these; "outside the range" means after it only. Before it, v11.26 — §6.2.10 part 7 step 2's range basis is the DELIVERY DATE, labelled "Delivery date" (owner's rulings 2026-11-17; MONEY-DESIGN §6 "Which period a trip belongs to"): the last drop's actual departure, else the time the status reached Delivered; the POD date no longer selects trips (Amazon loads carry no POD of their own); a Delivered trip settles without its POD; the picker gains No delivery date, and In transit reads Not delivered. Before it, v11.25 — §6.2.10 part 7 step 2, Create batch (owner's rulings R1–R3 and the overlap ruling, 2026-11-17): a free date range pre-filled with the last full settlement week, any whole-day period accepted by `openBatch`; a period that overlaps a live batch of an overlapping scope is refused by name, because weekly charges are taken once per statement and would otherwise be taken twice; the authority required for a new batch; the driver's column headed Driver pay, freight kept as Load gross and Datatruck's "Load pay" flagged against §6.2.2; part 1's fixed-week bullet kept as the record. Before it, v11.24 — §6.2.10 part 7, Driver Pay in Datatruck's shape (owner's brief and rulings 2026-11-17, `DRIVER-PAY-BRIEF.md`), step 1: the office's status words from one function (Unposted · Partial posted · Posted · Paid · Void), Post all unposted for Finalise, no Change status control, Delete while Unposted, the Batches list's nine columns with Created by read from the audit row and the batch's own authority, and one Payroll tab strip. Part 1's fixed week is reversed by ruling (a free date range), to be amended with the Create step. Before it, v11.23 — §7.13's two fixes from the owner's review of the Amazon load detail on dev (2026-11-17): the tracker's digits sit above the connector bars (z-10; the deploy sweep renders every digit and requires it on top and upright), and the header carries neutral actions only, Cancel load red in the ⋮ menu. Before it, v11.22 — §6.4 part 2's Main tab in Datatruck's shape (owner's brief 2026-11-17 and its rulings the same day): two columns — Personal information (photo, middle name, birth date, Telegram, a derived driver status and tenure) with Compliance under it, and Assignments (truck, trailer, authority, an assigned dispatcher, notes, tags) with a DERIVED Team block; what Safety stores is linked, not duplicated; migration 73 adds four nullable columns; part 3 gains a Team column on `/drivers` behind the chooser from the facts call; percent salary, the team's Main flag and picker, and the brief's six Datatruck-only fields are listed as not built. Before it, v11.21 — §7.1 records two decisions the owner accepted on shipping the loads list's second pass (2026-11-17): a place cell prints a stop's facility when it has no city or state, and the paying party is the Customer on every screen. Before it, v11.20 — §7.13's stops table keeps Arrived / Departed beside the appointment window (owner's change on accepting v11.19, 2026-11-16): scheduled against actual on one row, in the stop's zone, the clocks the portal's taps write. Before it, v11.19 — §7.13: the Amazon load detail takes Datatruck's shape (owner's brief 2026-11-16, from Islom's screenshots, `corpus/datatruck-load-detail-2026-11-16-*.png`): one predicate `isAmazonLoad` — the customer is Amazon by name, or the load settles directly — that every rule here hangs on, non-Amazon loads unchanged; no document prompts, no factoring "Still missing", no fuel surcharge; the header, the second row, five tabs that show only with content, an eight-step tracker from one mapping function, stops and trips as tables, three cards, and a right rail of Activity and a Profit box from existing figures. Flagged against §7.12 (the tracker's seventh word), and Create invoice and Edit load, which Zebra has no route for. Before it, v11.18 — §6.2's destination table names Billing → Invoice's nine tabs, which v11.17 moved there from `/loads` and did not write into it. Before it, v11.17 — the loads list's second pass (owner's brief 2026-11-16, §6.7): six tabs with counts, the invoicing chips moved to Billing → Invoice as tabs, warnings off by default with a dot after the number, twelve default columns in Datatruck's order (cap twelve, memory on a new key), one toolbar row. Before it, v11.16 — the sidebar scrolls on its own (owner's report 2026-11-16, §3): the wordmark pinned, the list `min-h-0 flex-1 overflow-y-auto` with a thin nav-token scrollbar; the shell check scrolls every entry into view at 1366×768. Before it, v11.15 — the shell is `relative` (owner's report 2026-11-16, §3 content column): the sr-only wrappers of v11.14 shrank /dashboard's document from 2,743 px to 1,860 and did not end it, because an absolute element with no positioned ancestor is laid out against the document wherever it sits; positioned and `overflow-hidden`, the shell contains and clips every one. Before it, v11.14 — the document is one window tall, rendered (owner's report 2026-11-16, §3 content column): `sr-only` goes on a div around a table, never on the table, and the deploy sweep renders every chart page at 1886×961 and 1366×768 and holds the shell to the window. Before it, v11.13 — the sidebar speaks Datatruck's vocabulary (owner's ruling 2026-11-16, §6.2): Dashboard alone at the top, then Load Management, Planning Calendar, Billing, Payroll, Customer Management, Safety, Fleet Management, Maintenance, HR Management and Admin; labels and groups only — no route, page or permission moved — and §6.8's notes name the new groups. Before it, v11.12 — the three CSV export routes are rows of §6.8 (owner's report 2026-11-16): `/exports`, `/loads/export`, `/trucks/export`, each with its page's roles; the sweep fetches them and follows every export link a page renders. Before it, v11.11 — `/trucks` in one call (owner's ruling 2026-11-15; §6.5 part 1): the trucks with their five loaders, the counts, the makes, the health counts and the column row one statement through the tenant reader; 14 → 2 targeted. Before it, v11.10 — `/loads` in two calls (owner's ruling 2026-11-15; §6.7): the authorities, preferences and labels, then the rows, warnings and every chip from the day the first names, through the tenant reader; 10 → 3 targeted. Before it, v11.09 — the statement page's own reads in one call (owner's ruling 2026-11-15; §6.2.2): the statement, fuel and tolls, the column memory and the four neighbours one statement through the tenant reader; the addable trips stay in their own transaction. Before it, v11.08 — the batch screen's own reads in one call (owner's ruling 2026-11-15; §6.2.10 2c): the batch, its statements, the preview's window and the ticks one statement through the tenant reader; the engine's input stays in its own transaction; FINAL 6 → 2 targeted. Before it, v11.07 — `/drivers/[id]` in one call (owner's ruling 2026-11-15; §6.4 part 2): every main-tab read a CTE of one statement through the tenant reader, the tab-only reads in their own transaction; 23 → 2 targeted. Before it, v11.06 — the payroll Balances tab in the page's one call (owner's ruling 2026-11-15; §6.2.9): `balancesSql`, shared with the export, as a CTE; no transaction on either tab; 8 → 5 targeted. Before it, v11.05 — the dashboard's charts drawn in the browser from their figures, and sparklines as one SVG path (owner's instruction 2026-11-15: the document under 60 KB, render under 150 ms of CPU; §6.1.1 amended — it said no client JavaScript). Before it, v11.04 — `/drivers` on the one-call read (owner's ruling 2026-11-15, before the code; §6.4 part 1): no transaction; the head and the list in one `zebra_tenant_read` call, the facts in a second; 6 → 3 targeted. Before it, v11.03 — the tenant setting and `/payroll/batches`' own read in one round trip (owner's ruling 2026-11-14, before the code; §6.2.9): `zebra_tenant_read`, a SECURITY INVOKER function that sets the tenant and runs the read as two statements inside one implicit transaction, row-level security unchanged; trips 9 → 6 targeted. Before it, v11.02 — `/drivers` is six statements (owner's instruction 2026-11-14, before the code; §6.4 part 1): the head counts and preferences in one statement, the list as today, the listed drivers' facts in one statement; 21 → 6 targeted. Before it, v11.01 — `/payroll/batches` is four statements of its own and seven streamed behind it (owner's instruction 2026-11-14, before the code; §6.2.9): the page's six reads become one statement with a named CTE each, and the blockers strip reads the engine's gross half; 25 → 12 targeted. Before it, v11.00 — the load's rate is the total the broker pays, with line haul, fuel surcharge and accessorials as lines under it (owner's ruling 2026-11-14, §7.6; replaces the 2026-10-06 reading of the rate field as the line haul; storage and pay-rule basis unchanged; the form change is not yet built). Before it, v10.99 — the two role-change limits are ruled (owner, 2026-11-13) and recorded in §6.8: an ADMIN may not change an OWNER's role or grant OWNER, and DRIVER is neither granted nor removed from `/users`. Before it, v10.98 — changing a member's role (owner's instruction 2026-11-13, before the code; §6.11): OWNER and ADMIN only, through `user:update`; never yourself; never the last OWNER, counted inside the transaction; an ADMIN grants what an ADMIN may create and may not change an OWNER's role; DRIVER is neither granted nor removed here (the driver link owns it); the change revokes the member's live sessions in this organization; the audit row is the extension's `Membership` update with `changes.role` from and to. Before it, v10.97 — the dashboard is ONE STATEMENT, each card its own named CTE (owner's ruling 2026-11-13, the fallback named in v10.96, before the code): two transactions in parallel read owner 12 statements and 692 ms on dev's median against 568 before, so the wall was not back; the seven cards' SQL becomes seven named CTEs in one SELECT that returns one row of JSON, one column per card, inside one `withCurrentOrg` — three statements (`set_config`, the read, `COMMIT`), four with the shell. Each card's SQL text is built by ONE function in its own module and read by both paths: the card's own reader (`moneyRows`, `needsYouCounts`, `panelFigures`, `topDriversByGross`, `dqfRoster`, `complianceOnce`, `listedAuthorities`' SQL twin) and the one-row read; each card's parser accepts both the driver's types and JSON's; the one-row read's result is held equal to the per-card read for three sessions (owner unscoped, owner with a chip, dispatcher). Spans: every card settles when the one statement does, so each permitted card's span is the statement's wall — the meaning the spans had before v10.95, time from the start to the card's settle (§6.1.1). Before it, v10.96 — the dashboard is TWO transactions in parallel, money beside the other six (owner's ruling 2026-11-13 on the wall, before the code): one transaction in sequence put the owner at 10 statements and added 381 ms to the page's median on dev, the cards' sum where their max had been; so the money card — the longest — runs in its own `withCurrentOrg` beside the six others', two statements more (owner at 12, on the line), and the wall is measured after; if it is not back at or under the before (568 ms owner median), the fallback is the one-row statement with each card's SQL as its own named CTE (§6.1.1). Before it, v10.95 — the dashboard is ONE transaction and ONE statement per card (owner's instruction 2026-11-13, before the code: 35 statements on the owner's dashboard, target under 12): the seven reads that each opened a transaction — fourteen statements of `set_config` and `COMMIT` before a single row — run inside one `withCurrentOrg`, in sequence, and each card is one statement with one predicate: the money card's four reads (per week and company, per customer, per day, first settled period) become one statement over one `delivered` CTE, split by a `kind` column; the DQF ring's roster and two facts reads become one statement with the facts as array subselects, `isQualifiable` still the only rule and still in TypeScript; the compliance queue's three reads become one — the items inside the longest horizon with each row's latest expiry per subject and type and the scope's lead days as columns — read ONCE for the Needs-you row and the 30/60/90 panel, which were the same read twice; `panelFigures`, `topDriversByGross`, `needsYouCounts` and `listedAuthorities` were one statement each already. Each one-statement read has an agreement test against the reads it replaces, the dashboard's whole read has a statement budget on a real client, `dashboard.timing` keeps its seven spans (now each card's own sequential span) and `page.timing` is the before/after on dev (§6.1.1). AND RULING 7 ON GAPS 44: the memory-ceiling exemption retires only when the isolate probe reads clean BESIDE A RED SWEEP — one clean beside clean proves nothing (§6.8). Before it, v10.94 — the dev isolate's memory ceiling gets its own row and its own instrument (owner's rulings 2026-11-13, before the code): a 5xx whose worker account names the ceiling (`exceeded memory limit`, either wording) is REPORTED BY NAME in the deploy sweep's receipt and NOT COUNTED, until GAPS 44's instrument reads clean — every other fault still fails it, a 5xx with no worker account included, because "unreadable is not clean"; the instrument is `scripts/isolate-probe.mjs`: ONE role, ONE fixed route set in a fixed order, the 500 count against the number of DISTINCT routes the isolate has loaded, then a second pass that loads nothing new, so a ceiling that is the parsed code of distinct routes reads differently from one that is per request; its reading is GAPS 44's (§6.8, §6.10). Before it, v10.93 — the shell's three reads are one (owner's instruction 2026-11-12 on GAPS 42, item 3, before the code): one statement, `zebra_shell_context(hash)`, a SECURITY DEFINER function — the density preference is under row-level security and the tenant setting exists only inside a transaction — whose one predicate ties the preference to the session row the hash found, its own user and its own active organization, never an argument; `search_path` pinned, STABLE, executable by `zebra_app`; the validity checks stay in the application beside `resolveSession`'s; `getSession` is derived from the one read, so a route or an action pays the same single statement; `shell.timing` keeps its fields with `accountMs` and `densityMs` null; the agreement test holds the function's row against the three reads, two organizations, both sides above zero; measured before and after on dev (§6.10; migration 71). Before it, v10.92 — every request writes a `page.timing` line with its statement count (owner's instruction 2026-11-12 on GAPS 42, before the code): the request's own client enables Prisma's query events and counts every statement it sends — BEGIN, `set_config`, the read, COMMIT — the same source the two-statement budget reads in the integration tests, so the tail and the budget agree; `statementsOf(client)` reads the count, null for a client not built there; each shell layout schedules the line from `after()` with a thunk, so the count and the wall are read once the response has gone out and include the page's own reads; the line carries role, statements, totalMs and startedAt and nothing else (§6.10). Before it, v10.91 — the offline queue, Phase 7 step 6, and flag 9's ruling (owner, 2026-11-12, before the code): a tap or a capture the office never answered — the phone says it is offline, or the request dies before a response — is KEPT on the phone, in IndexedDB, in the order it happened, the capture already compressed and the tap with its own time; a refusal the office answered in words is shown, never kept. The portal's shell replays the queue through the same route the live write takes — Load's server action for a status, the portal's mint → PUT → confirm for a document — when the phone comes back online, when the portal is opened or foregrounded, and every thirty seconds while anything waits; a sent entry leaves, a refusal stays on the strip with the words until dismissed, a network failure stops the pass and keeps the rest. The pending indicator is explicit on every portal screen: a strip under the header naming no signal, how many wait and each by name; Load shows the kept rung where the button was. A replayed tap clocks the stop at the tap when it is within twenty-four hours and not in the future, else at the write; the status event stays the write's time. No service worker (flag 10). Flag 9 ruled: no assembler, one capture per upload, the office groups by type (§7.8). Before it, v10.90 — the driver's upload and the tap as check-in, Phase 7 step 5 and flag 8's ruling (owner, 2026-11-12, before the code): §9's camera-first upload is built on Documents — Take photo first and the camera opened directly, a file picker second, one of the seven types onto the load the driver is on (either seat), through the office's own compress → hash → mint → PUT → confirm behind the portal's own routes under `portal.document:create`, a POD confirm moving the load to POD received as the office's does; one capture per upload until a PDF assembler is ruled on. And the tap is the stop's check-in: At pickup the pickup's arrival, Loaded its departure, the same pair for delivery, on the first stop of that type whose clock is empty, under the driver's attribution, never over a value the office set. Before it, v10.89 — Load's one primary action, Phase 7 step 4 (owner's instruction 2026-11-12, before the code): the driver's ladder is six rungs, DISPATCHED to DELIVERED; the 52 px button names the next rung in words; the write re-reads the load and refuses in words any rung but the next from the status at that moment, never a jump, through the engine with `source: DRIVER_PORTAL` and the driver's user; the co-driver gets a sentence, never the button, and the write refuses the second seat by name; the tap moves the status and nothing else, stop times staying the office's check-in (§9 "The write rules"). Before it, v10.88 — §6.8's sweep: the owner's pass honours the table (amended 2026-11-12, before the code): a 4xx on the owner's pass for a route whose row refuses the owner — the four portal rows — is "refused by the table", listed by name, neither rendered nor a problem; the first deploy sweep after the portal rows (run 43228750311 on `3ad274b`) was NOT OK on four `CLIENT ERROR 404: /portal` lines that were the table's own answer. Before it, v10.87 — the driver portal's pages, Phase 7 step 2 (owner's instruction 2026-11-12, before the code): §6.8's table gains the four portal rows WITH the pages that serve them — `/portal`, `/portal/loads`, `/portal/documents`, `/portal/settlements`, `reach` for Driver and `refuse` for the five office roles — so the driver column reaches five routes and the sweep's pin moves with it; §9's shell, landing rule and money rules are built as written, every portal read through one predicate per surface in `src/lib/portal.ts` from the driver's own roster row, the statement PDF and the document download through the portal's own routes under the same predicates, and the Account tab opening the existing `/account` under the operator shell until it is restyled (flagged in the brief); Load's two-statement budget is measured by the integration test, not asserted. Before it, v10.86 — the driver record's Sign-in tab, Phase 7 step 1 (owner's instruction 2026-11-12, before the code): §6.4 part 2's "Mobile app login" tab becomes **Sign-in**, shown to OWNER and ADMIN only under `user:update`, holding the link between the roster row and a sign-in — one select over the ONE predicate (role DRIVER, member here, not already linked to a live driver here) and Link; linked, the name, address, last sign-in, _deactivated_ when it is, and Unlink; terminated, one sentence; a termination through the roster deactivates the sign-in, revokes its sessions and drops the link in the same write, and linking again reactivates it, one act, one audit row naming who. Before it, v10.85 — the driver portal's rules, Phase 7 step 0 (owner's rulings of 2026-11-12 on `PHASE-7-BRIEF.md` §4, before the code): §9 gains the shell's five-tab bar, the landing rule (DRIVER to `/portal`, everyone else to `/dashboard`, operator roles refused at the portal, no roster row means one sentence and nothing else), the money rules (finalised settlements only, pay per load only after its settlement is finalised, no projected pay), the write rules (one forward step, the engine's own; a co-driver sees and uploads and never sets status), the link (OWNER/ADMIN on the driver record under `user:update`, termination deactivates the sign-in in the same write, reactivation is a new link and audited), onboarding by Telegram hand-over, and Load's budget of TWO statements in the tenant transaction; §6.8 records the four portal routes' intent — `reach` for Driver, `refuse` for the five office roles — with the rows entering the table in the commit that creates the pages, because the matrix test and the sweep refuse a row that names no page. Before it, v10.84 — the sweep's window matcher serves a stalled sign-in only, and an invocation that names another role is refused by name (§6.10 amendment of 2026-11-12, before the code): the first deploy sweep's artifact read the cause of the 11-08/11-09 shared matches — a sign-in POST the tail never delivered borrowed its neighbour's invocation through the window. Before it, v10.83 — the dev deploy ends with the rendered-page check (owner's brief 2026-11-11, §6.8, before the code): `check-deploy-drift.mjs --require-current dev` refuses unless dev serves HEAD, then the six-role sweep renders every page and its verdict is read from the `deploy-sweep` status file, its detail an artifact; what fails it is a 5xx or error boundary for any role, an unrefused anonymous request, a new matrix disagreement, a stalled sign-in, a ray claimed twice. Before it, v10.82 — trucks round two, owner's brief 2026-11-10 (before the code): a truck's STATUS DERIVES FROM ITS OPEN LOADS — In transit on a moving load (the board's own `MOVING` set), Dispatched on any other open load, else Available — in ONE predicate in `truck-list.ts` read by the column, the stripe, the status filter, the footer's chips and the export; the stored column keeps only the manual overrides, In maintenance / Out of service / Sold, which win over the loads, and the record's form offers Automatic and the three; the agreement test holds the SQL to the Prisma listing per status and both to the loads list's own predicates, every count above zero (§6.5 part 1 round two, §7.1.7 untouched); v10.81 — the trucks list ACCEPTED on dev and two rulings, 2026-11-10 (before the code): `/trucks` is capped at ELEVEN, Model and Odometer in the default set, the flag of v10.79 closed (§6.5 part 1, §7.1.7); and the 66 OUT*OF_SERVICE seed trucks become REMOVED with the reason "inactive in Datatruck export 2026-09-09" by a data migration script — identified by the seed's own signature, preview by default, `--write` to act, `--production` guarded and naming the organization, counts before and after by the list's own predicates (dev: Active 119 → 53, Inactive 0 → 66), dev first, then production — while the 6 named by an open load KEEP the link and the load gets a `truck_inactive` warning read in the one load-facts statement (§6.5 part 1); v10.80 — §6.8's sweep amended 2026-11-10 (owner's brief on the nightlies of 11-08 and 11-09, both NOT OK on one named problem, `SHARED MATCH … accounting#1, driver#1`, before the code): A RAY IS CLAIMED ONCE — the matcher assigns an invocation to the first sign-in that claims it and records a second claimant as unmatched, "ray already claimed by accounting#1", said by name in the verdict and counted as a problem, never a measurement under the wrong role; and CI KEEPS THE SWEEP'S DETAIL FILE as a workflow artifact on every nightly, pass or fail, so the next shared claim is read from the file and not guessed from the log; measurement first, nothing in the application changes (§6.8); v10.79 — THE TRUCKS LIST TAKES DATATRUCK'S SHAPE, the owner's brief from Islom's screenshot 2026-11-10 (§6.5 part 1, before the code): four views as chips with counts — Active (default) · Unassigned · All · Inactive — one predicate each behind `?view=`, replacing the Needs attention and Show removed links; Datatruck's column order, fitted and shared per §7.1, with Owner name, VIN, Fleet status, Aging and Heading to behind the chooser; a unit / plate / VIN search, the §6.3 authority dropdown, a Filters popover (status, fleet status, make, year range, warnings), the Columns chooser and an Export that is the current view; the status counts as read-only chips in the footer above the data-health row; no Import file, no bulk actions, no Save view. FLAGGED: the brief's default set is eleven columns and §7.1 caps a grid at nine, so Model and Odometer stay behind the chooser as §7.1.7 already had them until a ruling raises the cap as /loads' was raised to ten. MEASURED FIRST on dev: 66 of 119 live trucks are OUT*OF*SERVICE, every one from the all-trucks seed's placeholder, for the owner's ruling (§6.5 part 1, §7.1, §7.1.7); v10.78 — the breakdown by authority is CLOSED BY DEFAULT, owner's ruling on dev 2026-11-07 (round five, before the code): the by-authority donut on the dashboard and the company cut of Accounting → Reports (the per-authority charts and the matrix, By authority and By week alike) sit behind a "Show breakdown" control, open for the current view only, never persisted, absent from the document while closed — the same reason as the dropdown, closing §6.3's open item (§6.1.1, §6.2.7, §6.3); v10.77 — the loads list, owner's review on dev 2026-11-07 (before the code): the chip row FITS and a scrollbar under it is a defect — measured after v10.76 at 1,024 px needed against the 1,102 px the row has at a 1,366 viewport, so the five authority chips were the overflow; should it ever not fit, the billing chips move into the Filters popover rather than the row scrolling; and A COLUMN IS AS WIDE AS WHAT IT HOLDS — identifiers, dates, badges and money are fitted to their content and the truncating columns share the rest by weight, Driver at two because it holds two seats, because the browser's distribution had given a twelve-character date 202 px while Driver had 123 px and truncated 70 rows of 100 (§6.7, §7.1); v10.76 — the authority filter is a DROPDOWN, owner's third-round review on dev 2026-11-06 (before the code): closed it shows "Authority: All" or the one selected name, the authorities appear only while it is open, one component (`AuthorityFilter`) on every screen including /loads and the accident register, URL contract unchanged, counts inside the options where a screen has them — because someone beside the owner's screen must not read the list of companies (§6.3, §7.4.2); v10.75 — the dashboard chart, owner's second-round review on dev 2026-11-06 (before the code): the gross bar is always solid and only the driver-pay slot is hatched when pay is unrecorded, drawn to the gross bar's top because unknown pay has no height of its own; the legend row sits UNDER the x axis on every bar chart, because the value above the tallest bar lands where a legend above the plot sits (§6.1.1); v10.74 — the operational look, amended 2026-11-06 (owner's brief, before the code): the sidebar takes a navy dark set of its own (§3.6) and §3.5 stops being the only dark surface; the six soft status fills deepen one step so a pill reads at a glance (§3.3, §7.2); Standard density's cell padding is 6px, which makes §5.1's 36px Standard row reachable for the first time (§5.1); the shell's content column is the scrolling region, so no page can be clipped by `h-screen overflow-hidden` again (§6.1, rule 10); the dashboard's KPI cells follow §7.3 as written; the sign-in card carries the wordmark on the same navy (§6.1.3); v10.73 — §6.10's cutover gate amended 2026-10-26 (owner's ruling on the Row 37 chain, before the cutover): the per-acquisition CPU test is replaced by "no `pg.connect` wall over 1,000 ms and no invocation that ends without a response", because workerd reports CPU per invocation only; met on `bc668b3` (206 ms worst, 0 of 18); production takes the HYPERDRIVE binding on this ruling; v10.72 — §6.10 amended 2026-10-26 (owner's ruling 1 on the Row 37 chain, before the code): the physical connect on the pg path is timed from inside the client — the adapter builds the pool from a `PoolConfig` naming `connectionTimeoutMillis` and a `Client` class that logs its own `connect()` as `pg.connect {wallMs, outcome}`; a caller-built pool is never handed to the adapter again, because one survived `$disconnect` and hung every sign-in for 600 s; v10.71 — §6.10 amended 2026-10-23 (owner's ruling (a) on GAPS 37, before the code): production stays on Neon until 37 is understood; the measurement chain — every transaction opener fills its budget from one named default (5 s to acquire, 10 s to run) and the sign-in line carries the membership span's budget; the pg path builds its own pool, logs every connection acquisition as `pg.connect` with wall and pool counts, and fails a hung connect by name at 5 s; the pg and pg-cloudflare changelogs are read, not guessed; three dev sweeps report unavailable /60, signin.error by class and the pg.connect distribution; the cutover gate is 0 unavailable, no acquisition over 500 ms CPU, first query under 500 ms median; v10.70 — §6.10 gains its production section 2026-10-23 (owner's ruling, before the code): a second Hyperdrive config for production, created by Islom with production's zebra*app credential, bound under env.production only, read back and printed by every production deploy; acceptance three clean check:prod-signin runs; rollback is removing the binding; GAPS 37's signin.error line ships first and alone; v10.69 — §6.10 corrected 2026-10-23 (before the code): on the Hyperdrive path the `zebra_app` role is assured by the Hyperdrive config, read back before every sweep, not by the binding's string — which carries Hyperdrive's own generated credentials and refused every request under the old guard; v10.68 — §6.10 amended 2026-10-23 (owner's ruling on chain 2, before the code): the dashboard render is measured on its own request — after each sign-in the sweep GETs `/dashboard` with the new session and reads its lines by that invocation's ray; logs written during the render inside the sign-in POST do not reach the tail, a known limitation not to be chased; v10.67 — §6.8 and §6.10 amended 2026-10-13 (owner's rulings on chain 1, before the code): the pool's idle floor is 5,000 ms with `after()` still ending the pool; row 32 stays open pointed at 33; a sign-in renders the dashboard inside its own POST response by design, its timing lines are written from `after()` into that invocation's log, and the sweep matches by ray only; v10.66 — §6.10 added 2026-10-12 (owner's ruling on GAPS 33, before the code): the connection path, and Cloudflare Hyperdrive on the dev worker only — switched by the binding, query caching off because RLS makes a cached read a cross-tenant read, rollback by unbinding, production only on the owner's ruling against a first-query median under 500 ms and a fan-out median under 1,500 ms; v10.65 — §6.8 amended 2026-10-12 (owner's rulings on GAPS 31 and 32, before the code): one Prisma client per request, reused across `withCurrentOrg` calls and handed to the sign-in, the account read and the inbound-email store; it is disconnected in `after()`, with a 1 s pool idle timeout as the floor; v10.64 — §6.8 amended 2026-10-12 (owner's ruling on GAPS 28, before the code): the sign-in stall was the Worker's 128 MB limit on the argon2id verify over a warm isolate, caught as `exceededMemory` in three sweeps; argon2id moves to m=7168, t=5, p=1 with rehash-on-login for any hash not at the current profile; row 24 was closed in error; v10.63 — §6.8 amended 2026-10-12 (owner's rulings closing GAPS 24, before the code): the sign-in stall was Neon's scale-to-zero cold start; production is always awake and must stay so; the sweep warms dev first and records the cold start separately; production's sign-in first-query span is checked at 3 s by its own script; v10.62 — §6.8 amended 2026-10-11 (owner's rulings, before the code): GAPS 23 — `dqf` covers the file and nothing else; the drivers list's DQF warning and the dashboard's DQF ring are readiness signals that accounting sees; and a 500 on a sweep is recorded with its ray, role, body and Worker log in the verdict file, and becomes a GAPS row rather than a re-run; v10.61 — §6.8 amended 2026-10-11 (owner's rulings on GAPS 19–22, before the code): the DQF roster and the driver record's DQF checklist are refused to accounting under a `dqf` permission of their own; accounting opens trailers read-only; accounting creates brokers and a manager is refused factoring, which move the matrix and not the code; v10.60 — §6.9 amended 2026-10-11 (before the code, first and alone): a driver's random selections on the driver record are the pool one person at a time, so they follow the pool's Part 40 rule — loaded and shown only to roles that read `randomTesting`, and absent, not empty, for every other role; v10.59 — §6.9 added and §6.8 amended 2026-10-11 (owner's ruling on GAPS 18, before the code, shipped first and alone): accounting is refused the random pool under 49 CFR Part 40, and the renewal need it carried is met by a counts-only testing summary — pool size, selections and tests completed per quarter by kind, no names, no results — under its own resource so granting it never grants the pool; v10.58 — §6.8 extended 2026-10-10 (owner's brief, before the code): the route matrix gains Admin, Manager, Accounting and Driver columns — every role — written from the UAT checklist, Phase 3's accounting rule, the manager's read-not-set rule and the owner's words for the driver ("nothing org-wide"), with inferred calls marked; a seed account per role on dev only; v10.57 — §6.8 amended 2026-10-10 (owner's rulings on GAPS 13–16, before the code): a dispatcher opens Authorities read-only and does not create trucks, trailers or drivers — the matrix moves to the code, which was right; a dispatcher records cargo claims and roadside inspections, read and create but never update — the code moves to the matrix; v10.56 — §6.8 amended 2026-10-10 (owner's ruling on GAPS 17, before the code, shipped first and alone): the drug and alcohol random pool is refused to a dispatcher in the code as well as the matrix, because under 49 CFR Part 40 selection lists are owner/safety only; `/documents` reached is confirmed; v10.55 — §6.8 added 2026-10-10 (owner's brief, before the code): the ROUTE MATRIX — every one of the 54 protected pages, reach / refuse / redirect for the owner and a dispatcher, written as intent from §6.2's groups and not generated from `permissions.ts`; the sweep reads this table and signs in as both roles; a disagreement is a GAPS row named in the table's note, and an unnamed one fails the sweep; a seed dispatcher on dev only; `/safety/random` refused and `/documents` reached are flagged calls; v10.54 — §6.7 chain two specified 2026-10-09 (the owner's rulings on four flagged decisions, then items 7–9, before the code): Attach POD confirmed, so nothing sets POD received by hand; only rate and billing start hidden and `/loads` is capped at TEN columns — §7.1.7 amended for that one grid by the ruling, every other grid keeps nine; column memory becomes the set a person HID, for every grid, so a new column appears for everyone, with an old saved choice migrated once on read; the filter bar fits two rows at 1920, chips on row one, search, a Filters popover, the chooser and density on row two; every chip count and the footer total come from ONE grouped statement, a second SQL expression of the predicates held to them by a per-chip agreement test; export of the current view, row expand and a row menu; v10.53 — §6.7 added 2026-10-08 (queue item 21, the owner's brief from Islom's screenshots, before the code): the loads list takes Datatruck's shape — four date views by name (`picksUpToday`, `deliversThisWeek`, and `pickup`/`delivery` over `from`–`to`) read on the FIRST pickup and the FINAL delivery in each stop's own zone, broker and driver typeaheads with the driver matching either seat, linked broker, driver and truck cells for roles that may open them, a copy button beside the load number, a DEL date column, and Upcoming and Unpaid as counted views; every filter is ANDed because two `OR`s merged by spread overwrote each other, and every chip count now honours the active view; export, row expand and the chooser are the second chain, and the brief's "Mark POD received" is answered as Attach POD because Phase 2 §2 makes POD received automatic and never manual; v10.52 — §6.1.1 amended 2026-10-07 (production walk, queue item 20 (8), before the code): the compliance panel's 30/60/90 figures are counts over `complianceQueue`'s OWN rows at a fixed 90-day horizon — actionable subjects, superseded dropped, expired in all three, cumulative — and not raw SQL over every `ComplianceItem`; the Needs-you row and the panel read 54 against 96 on one production screen because the panel counted sold trucks' lapsed registrations and renewed records the queue drops; the SQL columns go, the 2026-10-01 ruling against re-expressing the horizon in SQL is honoured by removing the SQL, and the one remaining difference is the horizon, said in the panel's note; v10.51 — §6.2.10 part 1 amended 2026-10-07 (production walk, queue item 20 (7), before the code): "0 available" never stands alone — the picker's header line names the buckets that took the rest, with their counts, so the answer to "why zero" sits on the same line as the zero; measured on dev for 9/20–26, 16 of 23 candidates were never delivered in Zebra; v10.50 — §6.6 added 2026-10-07 (production walk, queue item 20 (6), before the code): the accident register's driver picker is the ACTIVE drivers of the authority — the Active tab's population and people, through the one predicate the drivers' data-health base also reads; v10.49 — §7.12 added 2026-10-07 (production walk, queue item 20 (5), before the code): the load detail on direct-settled freight — the accessorial summary carries two named figures (billed, and the approved "Other" lines not billed), the payment type derives from `settlesDirectly` and is refused otherwise, the tracker's fourth word is "On statement" on that freight, and a load whose flag disagrees with its customer is a data row; v10.48 — §6.4 part 2's Safety tab amended 2026-10-07 (production walk, queue item 20 (4), before the code): the DQF's "Copy of the CDL" is satisfied by a live CDL compliance record as well as by the document, read by its date when it is the record alone; and a missing hire date is a ninth row, "Hire date recorded", rather than the reason a file reads 8 of 8 missing; v10.47 — §6.5 part 0 amended 2026-10-07 (production walk, queue item 20 (3), before the code): an EMPTY scope is every company for the data-health counts as it is for every list — the owner's scope is `[]`, the counts read it as "no company", and both footers said 0 while the grid showed the gaps; the count and the filter now share the scope rule, and the agreement test runs scoped and unscoped on a blank-odometer truck row; v10.46 — §7.1's row-link rule amended 2026-10-07 (production walk, queue item 20 (2), before the code): the stretch is PER CELL, because Chromium does not let a positioned table row contain the anchor's `::after` — measured on dev, a 97 px anchor on a 1,056 px row — so every cell is its own containing block, the first cell's anchor is the row's one named link, and the other cells carry hidden overlay anchors to the same href; v10.45 — §6.2.10 part 2b added 2026-10-07 (production walk, queue item 20 (1), before the code): the batch route IS the batch screen — the part 1 grid for the batch's own week and scope with ticks read from the persisted exclusions, Save writes the delta through the two exclusion verbs, the item 3 facts stay below, the Statement column links to the statement in every status, Open a batch lands on the batch; v10.44 — §6.5 part 0b added 2026-10-07 (queue item 18 part 0b, before the code): the DATA-HEALTH row for Drivers by the owner's five — no CDL on file, no medical card, no phone, no pay rule in force, no truck — over the Active tab's people only, the same module, the same generic row, the same agreement test, and then a hold for the Trucks brief; v10.43 — §6.5 added 2026-10-07 with part 0 (queue item 18, before the screen and before the code): a DATA-HEALTH row under the Trucks grid — five counts, one definition each, every figure a link to the filtered list, zero shown, one query, the same five figures as a Data row in GAPS, written per subject so Drivers follows without a second design; v10.42 — §6.4 part 2 amended 2026-10-07 (queue item 17, GAPS code gap 10, before the code): pay-to, kind and tags get editors — pay-to as its own small form on Accounting under `driver.pay:update`, read at generation and frozen onto the statement so an edit never restates a paid one; kind and tags as fields on Main's form under `driver:update`, which is the ruling the queue item implies for who may turn a person into a payee; tags split on commas by the one rule the import already uses; v10.41 — §6.4 part 3 added 2026-10-07: team drivers — a truck carries up to two drivers through the pairing that already exists, capped where it is written; the load's second seat is pre-filled from the truck's crew and saved by the dispatcher, never filled by the engine; both records say "Team with"; v10.40 — §6.4 part 2 added 2026-10-07: the driver RECORD becomes eleven tabs over one page, each reading what exists today behind it — the form, documents, pay, safety, assets, statistics, the §7.10 timeline for a person — and a tab with nothing behind it says so in one sentence rather than rendering an empty panel; a tab a role may not see is not rendered at all; v10.39 — §6.4 added 2026-10-07 (queue item 16, part 1): the drivers LIST takes Datatruck's shape on the existing grid machinery — five tabs over one grid (Active · Unassigned · All · Terminated · Vacation board), ten named columns inside §7.1's cap with email and CDL behind the chooser, an ASSIGN STATUS derived on read from the DQF and the assigned truck's compliance and never stored, roster bulk actions through the one edit function, saved views per grid; the brief's "employee status" column is answered by the tab and the one-status ruling of 2026-09-21 rather than by a second badge, and its export and import are flagged against §7.1.7 and the loads-import precedent rather than quietly built; v10.38 — the driver's type gets its own name, before migration 70: `Driver.driverType` is a `DriverType` — `COMPANY_DRIVER ǀ LEASE_OPERATOR ǀ OWNER_OPERATOR`, a person's words — and `OwnershipType` goes back to being a truck's title; the VALUE IS SEEDED FROM THE DATATRUCK EXPORT'S OWN `Driver Type` COLUMN per driver, because comparing the stored value against it first found 56 of 167 dev drivers inverted by the seed's tariff threshold (owner's instruction, 2026-10-06), with the old value used only where the export is silent and those drivers listed; the frozen copy on the statement (66) and the standing charge's scope (§6.2.4) carry the same words, every driver's landing value is decided before the retype and asserted after, and `/payroll/statements` gets the funnel §6.2.10 part 6 held back until the enum could be typed by name; v10.37 — §6.2.2's held row move lands as migration 69, before its code: EVERY workbench trip is a `SettlementLoadLine`, like the batch's — `generateSettlement` writes a load line per trip (freight from the load's billed total, pay from the rule, the rule frozen beside it, places and sheet dates on the row) and no `LOAD_PAY` line at all, `SettlementLine` is for what is put on by hand, the drift checker's snapshot arm reads the load lines' snapshots, the statement page's separate "Load pay" list goes because the trips grid now shows every statement's trips, and `SettlementLoadLine` gains nullable `puActual`/`delActual` so the workbench's plan-or-record flags survive the move while the batch's rows say nothing they do not know; 69 moves the rows already placed with the net asserted unchanged; v10.36 — two owner's rulings of 2026-10-06, before their code. §7.6: THE RATE FIELD IS THE LINE HAUL — prefilled from `money.linehaul` and never from the total, with the fuel surcharge and the accessorial lines going to their own columns off the server's copy of the extraction when its parts agree with its total; the basis is then the pay rule's job (`PERCENT_LINEHAUL` on line haul, `PERCENT_GROSS` on the total, chosen per driver by the accountant), which is what load 1177 — $887.25 read today against $735.00 under the rule — turned on; migration 68 backfills every hand-created load whose rate con carries an agreeing split and LISTS the rest. §6.2.2: FREIGHT IS NEVER CALLED PAY — per line it is \_Load gross* (Datatruck's own header), the summary says \_Earnings* before deductions and \_Net pay* after, \_Total pay* is removed as a label everywhere, and _Total gross_ renders the freight sum; the question v10.34 flagged is answered; v10.35 — §6.2.2's header rule NARROWED the same hour, before its code: measuring the move of the generate path's `LOAD_PAY` rows into `SettlementLoadLine` found twelve test sites and six readers that address those rows directly — the drift checker, the settleable exclusion, the trips section of the statement page, three importers' tests — so the move is its own step (68) and 67 is what the ruling asked for: the workbench writes the batch engine's header over BOTH tables wherever its trips happen to sit, a hand-added trip is priced or refused and gets no `LOAD_PAY` twin, and the backfill rewrites headers only, net asserted unchanged; v10.34 — §6.2.2 gains THE HEADER'S COLUMNS, BOTH ENGINES on 2026-10-06, before migration 67: the batch engine's meaning of the statement's money columns is the meaning — `grossCents` the freight, `earningsCents` the driver's cut, `otherPayCents` the add-backs, `deductionsCents` negative — and the workbench engine conforms: its trips live in `SettlementLoadLine` like the batch's, `refreshTotals` becomes the one header writer over BOTH line tables (which is what closes GAPS.md gap 2), and a trip added by hand is PRICED by the rule in force or refused, because `Recalculate` re-adds and does not re-price and the comment that said otherwise had been paying 100% of the freight to anyone who believed it; 67 moves the existing workbench rows and rewrites their headers with the net asserted unchanged; v10.33 — §6.2.10 part 6's held migration lands 2026-10-06, after 64 and 65 reached production: `Settlement.driverType` is NULLABLE and written by both engines at generation, read first and the live driver row only for a statement issued before it — nothing invented for a document already handed over; v10.32 — §6.2.10 part 6 specified 2026-10-06, before its code: the driver's type is the office's word from `drivers.employment.*`, keyed by the enum value so every site says the same thing without a second mapping; it goes beside the name on the record (it was only a select inside the form) and into `/payroll/statements` as a default-hidden, sortable, NOT funnel-able column — the funnel matches the stored value, and a funnel that wants `OWNED` typed for a company driver is the failure this part names; the statement shows the driver's CURRENT type and that is flagged rather than decided — the frozen copy is `Settlement.driverType`, migration 66, which the deploy order's step 5 holds behind the production dispatch 64 and 65 are waiting on; v10.31 — §6.2.10 part 5 specified 2026-10-06, before its code: the salary report is one row per driver per settlement week per authority, COUNTED BY THE STATEMENT'S STATUS (APPROVED or PAID) and not the batch's — because part 3 made PARTIAL real and a batch-keyed rule hides the approved statements on a half-posted week, and because the old join through the batch left out every statement the workbench engine issued; the two engines fill the statement's money columns under different names and signs, so the reader reconciles them in ONE CASE and the agreement test holds gross + other pay + deductions = net on every row, both engines present; the §6.2.9 sparkline moves to the same rule, because "what this driver has been paid" cannot have two answers on two screens; v10.30 — §6.2's two tables amended 2026-10-06 to name the fourth cut on Reports (Transactions), because `tests/accounting-surface.test.ts` asserts a page's tab count against §6.2's table rather than against the code, and §6.2.10 part 4 had added the cut three screens down without touching the table it is counted from — the guard fired on the first `npm run check` after the code, which is what it is for; v10.29 — §6.2.10 part 4 specified 2026-10-06, before its code: the transactions report is a fourth cut on /accounting/reports whose rows are the UNION of the three line tables rather than a fourth copy, with the office's four words (trip pay · advance · deduction · adjustment) mapped from the schema's types in a table so the mapping is not improvised twice, deductions kept negative because a ledger is read down to a net, the deduction category taken from §6.2.7's own CASE so two screens cannot categorise one line two ways, and an agreement test that every driver's rows sum to their statements' net; v10.28 — §6.2.10 part 3 specified 2026-10-06, before its code: a batch's status is DERIVED from its statements and never set by hand (none approved DRAFT · some PARTIAL · all FINAL · all paid PAID), recomputed in the same transaction as every change that can move it; a refresh rebuilds only the statements still in DRAFT, because an approved statement is a document with a number and a name on it — today's refresh deleted every statement on the batch, a latent defect PARTIAL makes impossible; `finaliseBatch` becomes "approve every statement still in draft". v10.27 — §6.2.10 added 2026-10-05: payroll takes Datatruck's shape from Islom's walkthrough, and the owner's rulings on the three places it met the existing design — `SettlementBatch.companyId` is NULLABLE with null meaning the whole organization, so the 2026-09-11 one-run ruling stays the default and a named company scopes its own standing charges and `recentWeeks`; THE WEEK IS NOT REVERSED, a batch is still a settlement week by construction and the from/to fields merely SHOW it; and the tick is an EXCLUSION SET rather than a picked set, persisted per batch with who and when, so a refresh can only ever ADD freight and never un-excludes — because a picked set cannot tell "not chosen" from "arrived after they chose", and its failure mode is a trip silently dropping out of somebody's pay. v10.26 — §6.1.2 added 2026-10-05: every worker that is not production says which database it is looking at, in the topbar that already exists rather than a band of its own (standing rule 1), decided by `NEON_BRANCH` because it names THE DATA — not `NODE_ENV`, which is `production` in dev's built worker too, and not the hostname, which breaks the day zebratms.com lands; anything that is not the production label is marked and the ribbon NAMES the branch it found, while production renders nothing at all, because an element that could print the wrong label on production is worse than no ribbon. v10.25 — §7.1.7 amended 2026-10-04, hours after it was written, because the same probe found a THIRD grid over the cap: `/payroll/batches`, taken from eight columns to eleven by §6.2.9 earlier the same day, with a chooser already on the page — which is what proves a chooser alone is not the fix, since a user with no stored preference gets every column back. THE CAP NOW LIVES IN `readGridColumns`, the one function every grid calls, rather than in each page; a page names which columns go first and the function bounds the count. v10.24 — §7.1.7 added 2026-10-04 (found by the UAT live check): the two OPERATIONAL lists run past §7.1's cap and therefore 500 — `/trucks` for every organization and `/loads` for any carrier with more than one authority — so both adopt §7.1.4's chooser, which already exists; the cap is a SLICE in code rather than a convention because a stored preference outlives every deploy, and the warnings column is never default-hidden because an absent warnings column reads as "nothing wrong"; v10.23 — §6.2.9 added 2026-10-04 (accounting polish part 3): /payroll/batches gains a pipeline strip of draft / final / paid money AS OF TODAY with each figure linking to that status, the batch list gains per-batch gross / net / deductions out of the statement that already groups them — and the doc says the three are NOT an equation because reimbursements and other pay are added back — /payroll/statements gains a per-driver net-pay sparkline over the last thirteen settlement weeks REGARDLESS of the picker, which is the only deliberate exception in the product to the chips-and-period rule and is written down as one; v10.22 — §6.2.8 amended 2026-10-04 (owner ruling, resolving flag 49): the strip carries TWO KINDS OF FIGURE with two labels and never mixes them — a BALANCE (open, overdue, factored, unapplied) is as of today with no date bound and links to a list with no period filter via `?period=all`, and a FLOW (invoiced in window, received in window) carries the picker; a balance was windowed before, which hid the five-month-old unpaid invoice on the screen whose job is to show what is owed; `?period=all` is a URL state and not a fifth preset, and the chip counts stay windowed because they describe the list; v10.21 — §6.2.8 added 2026-10-04 (accounting polish part 2): Invoices and Payments gain a four-figure summary strip where every figure is a LINK to the list it summarises and ties to the cent to it, FACTORED is never inside OPEN and overdue is a stated subset, every chip and tab count becomes a COUNT(\*) rather than a length over a capped list reader, the rolling picker and authority chips replace the from/to range here as on Reports, and the strip answers FOR THE WINDOW — which hides old open paper and says so, pointing at the unwindowed aging bar on Reports (flag 49); v10.20 — §7.5.1 and §7.11 added 2026-10-04 (the login bug): every refusal names itself IN WORDS on the form, the closed failure set includes the row everybody forgets — the request was fine and the system was not — one silent retry before words, NOTHING FALLIBLE after the credential is accepted, and src/app/error.tsx is one worded page with a try-again link that carries its own three sentences because a client boundary cannot ask the server for words; v10.19 — §6.2.7 added 2026-10-03 (accounting polish part 1): /accounting/reports gains four charted sections on §6.1.1's contract, the rolling picker and authority chips become ONE shared pair of components rather than a copy, the from/to range and the weekly/monthly toggle are REMOVED because v10.17 makes grain a property of the preset, factored paper is its own series and never inside collected, the four deduction categories are assembled with SOURCE BEATING LABEL since the schema stores no category, and every figure ties to the cent to the screen it summarises — with the list caps named as the limit of that claim; v10.18 — dashboard part 3 fills the Fleet, Cash and Compliance panels 2026-10-02: top drivers credits BOTH crew seats, receivables aging is invoiced-unpaid-non-factored only, Cash is money-roles-only, and the 30/60/90 compliance counts are a DIFFERENT question from the Needs-you warn-days row rather than a second expression of it; v10.17 — owner ruling 2026-10-02: CALENDAR WINDOWS ARE OUT, the picker becomes Last 7 days / Last 4 weeks / Last 13 weeks / Last 52 weeks, each ending with the current settlement week with the partial week drawn as far as today AND MARKED, grain is a property of the preset rather than the span, default Last 13 weeks; v10.16 — owner review of the charts on dev 2026-10-02: the period picker drives EVERY chart and the two-window permission is REVOKED, default period becomes This quarter, every chart carries a worded legend, every bar its value and label with gridlines and a visible CSS tooltip, every KPI a sparkline, and an empty period keeps its axis and legend; bars and sparklines become HTML/CSS while rings stay SVG; v10.15 — §6.1.1 gains the chart contract 2026-10-02: server-rendered inline SVG with no library and nothing that could animate, hover detail as a <title>, the palette an ACCENT RAMP rather than the status hues §3.3 fixes to meanings, and the same figures as a visually hidden table under every chart; v10.14 — §6.1.1 added 2026-10-01 (dashboard redesign part 1): chips and period govern the whole page, "after driver pay" is an em dash for any period Zebra was not settling, closed history counts in totals and appears in no queue, Needs-you becomes a right rail. _The brief for this said "Design system v10.2"; the file was already at v10.13, so this is v10.14 and the discrepancy is flagged rather than resolved — see `PHASE-5-BRIEF.md` §7 flag 42._ v10.13 — §7.10 added 2026-10-01: a record's history is ONE activity timeline, six kinds of entry that do not dress alike, a document's upload read from the `Document` row rather than its audit row, and adding a note is its own control; v10.12 — §6.2.1’s batches row reworded 2026-10-01: the bar is `checkbox selection · Finalise · Mark paid`, not a control called Change status; v10.11 — migration 61 lands 2026-10-01: §6.2.4 standing charges built and the Charges tab table goes to four, §6.2.3's deduct side built with the fuel mode frozen per statement, and the scope offered is the schema's three ownership types rather than the two §6.2.4 first named; v10.10 — §6.2.6 the statements grid 2026-10-01: Deductions is every net-reducing line, status and batch filters, bulk Post and Mark paid; v10.9 — §6.2.5 applying a payment 2026-09-30, and §7.5’s six-field cap applied against a brief asking for a modal; v10.8 — §6.2: Invoices gains a Factored tab, a status filter and bulk Mark sent 2026-09-30; v10.7 — §6.2.4 standing charges specified and held for migration 61, 2026-09-30; v10.6 — §6.2.2: the Trip column is the broker’s reference and Add trips is unconditional 2026-09-30; v10.5 — §6.2.2: every statement exports, a draft’s PDF is watermarked 2026-09-30 (owner’s ruling, reversing the same day’s refusal); v10.4 — §8’s heading rule decides by an allowlist of issued series 2026-09-30; v10.3 — §8 forbids an internal id in a heading and §6.2.2 gives the statement its title rule 2026-09-30 (owner’s ruling); v10.2 — §6.2.2’s trips grid corrected to nine columns behind a chooser 2026-09-29 (it named eleven and §7.1 throws above nine); §6.2.2 (the settlement workbench) and §6.2.3 (fuel and tolls) added 2026-09-29, with eleven more rows in §6.2.1, against `ST-005562.pdf` and six workbench screenshots; §2's stripe gloss removed from page headers 2026-09-29; §6.2 split into Accounting and Payroll 2026-09-28 (the artefact’s shape, owner’s ruling); §6.2.1 added and §7.1.2/§7.1.3's footer scope corrected from the artefact 2026-09-28; §7.1.3–§7.1.6 added 2026-09-28 (the grid contract: columns chooser, export, tabs over one grid); §6.2, §7.1, §7.4 amended 2026-09-28 (the Accounting section; sort, totals row, date range, company filter on financial lists); §5.1 amended 2026-08-01 (density moves the cell padding); §8 amended 2026-07-31 (midnight-local bare dates); §6.3 amended 2026-07-29 (company switcher → company filter)
**Scope:** the operator application (desktop/tablet), the driver portal (phone), and the wall-display dispatch board.

This file is the source of truth. If a component in the codebase disagrees with this document, the component is wrong. Amend the document deliberately, in a commit of its own, before changing the code.

---

## 0. Standing rules

Numbered so they can be cited in review. These are carried forward from `DESIGN-SYSTEM.md` v2 where marked, plus the rules specific to this application.

1. **Density is a feature.** Never add whitespace that reduces the number of rows visible on a 1080p screen. A dispatcher's job is comparison; comparison requires adjacency.
2. **Status colors are semantically fixed.** A hue that means "delivered" never appears as decoration anywhere. _(carried from v2)_
3. **Every appointment time renders in the stop's local timezone**, with the zone abbreviation shown. Never the browser's timezone. This is the single most expensive bug class in dispatch software.
4. **Money is right-aligned, tabular, two decimals, never abbreviated in tables.** Abbreviation (`$2.5k`) is permitted only in KPI cards.
5. **Never color-only.** Every status shows its word. Color is reinforcement, not the signal.
6. **Logical CSS properties only** — `margin-inline-start`, never `margin-left`. Both locales are left-to-right since Farsi was removed (2026-11-17, §12); the rule stays because it costs nothing and keeps a right-to-left locale a dictionary away rather than a rewrite.
7. **Every surface declares its own background.** No inheriting from `body`. _(carried from v2)_
8. **Inventory standalone CSS before restyling anything.** _(carried from v2)_
9. **Grep before deleting a token.** _(carried from v2)_
10. **No inner scroll container in the app shell** except designated table bodies and the notification drawer. _(carried from v2 §11 — this bug cost a session on the marketing site)_ _Clarified 2026-11-06: the shell's CONTENT COLUMN is the scrolling region §6.1's diagram has always drawn, and it scrolls by itself. A page that owns a table body still shrinks that body inside the column; a page that does not — a long form, a batch of fifty trips — overflows the column and the column scrolls. Before this the column was a bounded box with `overflow-hidden` above it, so every page had to opt in with three classes of its own, and the draft batch page did not (fixed per page on 2026-11-02, `e104482`). The rule forbids a SECOND scroll region inside the content, not the one the shell provides._
11. **Destructive actions are never accent-colored.** Danger or ghost only.
12. **Nothing from the marketing design system enters the app shell** without being re-specified at application density. The two systems share brand color and nothing else.
13. **A saved value is the one every screen reads** — the record, its list, statements, dispatch and exports. _Owner's rule, 2026-11-19 (v11.37), after the truck record lost five fields between Save and reload (§6.5 part 2)._ No screen keeps its own copy, a cache or a hand-built list of a record's values: each reads the stored column through its reader. Held per entity by an integration test that changes a field through the writer the form calls, then reads the record, the list and one downstream screen (the loads export) and finds the new value in each — `tests/integration/saved-value.test.ts`, for drivers and trucks.

---

## 1. What this system is not

The AR Safety Support design system sells a service. It is airy, large-typed, scroll-snapped, and generous with whitespace — correct for a person deciding whether to buy.

Zebra is used by someone who already bought, at 6am, on their fourth coffee, comparing nineteen loads against seven trucks. Whitespace they have to scroll past is whitespace working against them.

**Do not carry over:** the type scale, the vertical rhythm, scroll-snap, full-viewport sections, the hero pattern, autoplay, animated reveals, or any component sized for marketing.

**Do carry over:** `#171a20` as ink, `#3e6ae1` as accent, 4px corner radius, and weight 500 as the heaviest weight for headings.

---

## 2. Signature: the status stripe

Every row, card, and detail header carries a **3px vertical bar on its leading edge**, colored by status.

This is the one memorable element, and it is load-bearing rather than decorative: it lets a dispatcher read the state of a forty-row board peripherally, without reading a single word. It is also the only place the project's name shows up in the interface, which is the right amount.

Rules:

- The stripe reflects **operational** status on load surfaces, **billing** status on invoice and AR surfaces, and **compliance urgency** on fleet and driver surfaces. One meaning per screen.
- The stripe is never the only indicator (rule 5). **The status word sits in the row, and that is where its meaning is stated** — not in a gloss beside the page title.

  \_Amended 2026-09-29. This said "stated in the screen's header", and the
  Accounting build did exactly that: `stripe: the driver's line`,
  `stripe: billing status`, `stripe: in force today`, in grey, next to every
  page title. Read on the deployed screens it is a note from one developer to
  another about a rendering decision — the owner's word for it was "leaked" —
  and it is furniture the reader has to skip past to reach the grid, which is
  rule 1's whole objection.

  IT WAS ALSO REDUNDANT WHERE IT MATTERED. Every one of those grids carries the
  status as a WORD in its own column, because rule 5 has always required it. The
  header gloss named a fact the row already states, which is the definition of
  something to delete.\_

- The stripe does not animate. Ever.
- Cancelled rows get the muted stripe _and_ 60% text opacity. Nothing else in the system reduces text opacity.

---

## 3. Color

Tokens live in `:root`. Never hard-code a hex outside this block.

### 3.1 Neutrals

```css
--z-ink: #171a20; /* primary text, table values */
--z-ink-2: #5c6370; /* labels, secondary text, column headers */
--z-ink-3: #8a919e; /* placeholder, disabled, timestamps */
--z-surface: #ffffff; /* cards, table body, modals */
--z-surface-2: #f7f8f9; /* page background, table header */
--z-surface-3: #eef0f2; /* row hover, pressed states */
--z-border: #e2e5e9; /* hairlines, table rules, input borders */
--z-border-strong: #c9ced6; /* input focus rest state, dividers that matter */
```

### 3.2 Accent — action only

```css
--z-accent: #3e6ae1;
--z-accent-hover: #3457c4;
--z-accent-soft: #eaefff; /* selected row, active nav item */
```

Accent means "you can do something here." It never encodes state. A blue badge does not exist in this system.

### 3.3 Status — semantically fixed

Each status has a text/border hue and a soft fill. Never mix pairs.

```css
--z-neutral: #5c6b82;
--z-neutral-soft: #ebeff4; /* available, draft, uninvoiced */
--z-progress: #0e7490;
--z-progress-soft: #daf0f6; /* dispatched, in transit, sent */
--z-success: #15803d;
--z-success-soft: #e5f8ec; /* delivered, POD received, paid */
--z-warning: #b45309;
--z-warning-soft: #fdf1e7; /* POD missing, due soon, partially paid */
--z-danger: #b91c1c;
--z-danger-soft: #f8cece; /* overdue, disputed, out of service */
--z-muted: #94a3b8;
--z-muted-soft: #eef2f6; /* cancelled, inactive, void */
```

_Amended 2026-11-06, owner's brief ("clearer status pills"). The soft fills
were one step off white — `#f0fdf4` for success, `#fffbeb` for warning — and a
filled badge on a white row read as an outline with a tint. Each fill is now
the DEEPEST value at its status hue whose text-on-fill contrast still clears
4.5:1 — computed, not eyeballed, because contrast is a function of luminance
alone and the room a fill has is set by how dark its text is: danger's text is
dark, so its fill can be `#f8cece`; warning's is lighter, so its fill moves
less. Progress, success, warning and danger measure 4.54, 4.53, 4.52 and 4.53._

_Neutral's TEXT hue moved, one step, from `#64748b` to `#5c6b82`. At `#64748b`
it cleared 4.5:1 on nothing but white — 4.34 on its own old fill — so no
deeper fill could exist for it; at `#5c6b82` the pair measures 4.69 and the
outlined badge and the stripe darken by the same step. Muted is left alone
at 2.28 (it was 2.45): it marks cancelled, inactive and void, every one of
which also carries 60% text opacity and its word in the row (§2), and a muted
pair that passed would be a pair that no longer read as muted. The pairs are
still pairs — §3.4 names the same six, and no screen mixes them._

### 3.4 Status mapping

Bind these once, in one module. No screen decides its own mapping.

| Load — operational                                     | Token                                                         |
| ------------------------------------------------------ | ------------------------------------------------------------- |
| Available, Booked                                      | neutral                                                       |
| Dispatched, At Pickup, Loaded, In Transit, At Delivery | progress                                                      |
| Delivered                                              | warning _(delivered but no POD is an action item, not a win)_ |
| POD Received                                           | success                                                       |

| Load — billing               | Token    |
| ---------------------------- | -------- |
| Uninvoiced, Ready to Invoice | neutral  |
| Invoiced, Sent               | progress |
| Partially Paid               | warning  |
| Paid                         | success  |
| Overdue, Disputed            | danger   |
| Written Off, Void            | muted    |

| Fleet / compliance              | Token   |
| ------------------------------- | ------- |
| Expires in > 30 days            | neutral |
| Expires in 8–30 days            | warning |
| Expires in ≤ 7 days, or expired | danger  |
| Out of Service                  | danger  |
| Sold, Inactive                  | muted   |

**Delivered mapping to warning is deliberate.** In this business a delivered load is unfinished work until the POD lands, and a green badge tells a dispatcher to stop looking at it.

### 3.5 Wall-display dark set

The dispatch board runs on a wall screen across a room. It and the sidebar (§3.6) are the two dark surfaces in the system, and they are different sets: the wall is near-black for a room, the sidebar is navy for a desk.

```css
--z-wall-bg: #0d1014;
--z-wall-surface: #171a20;
--z-wall-border: #2a2f38;
--z-wall-ink: #e8eaed;
--z-wall-ink-2: #9aa2ae;
```

Status hues lighten for dark ground: raise lightness ~18%, drop saturation ~8%. Define as a separate token set; do not filter at runtime.

### 3.6 Navigation dark set — _added 2026-11-06_

_Owner's brief, the operational look: "make the sidebar stronger and darker,
closer to Datatruck's navy; keep the content area light; prefer black, white
and neutral greys, accent secondary."_

The sidebar is the one dark surface on the desk. Its set is its own — not
§3.5's, which is tuned for a wall across a room, and not an inversion of §3.1
computed at runtime.

```css
--z-nav-bg: #1b2231; /* the sidebar */
--z-nav-surface: #242d3f; /* item hover */
--z-nav-active: #2c3850; /* the active item's fill */
--z-nav-border: #303b50; /* the wordmark's rule, hairlines on the navy */
--z-nav-ink: #eef1f5; /* item text on hover and when active, the wordmark */
--z-nav-ink-2: #9aa5b8; /* item text at rest, group labels */
```

- **The content area stays light.** Nothing from this set appears to the
  right of the sidebar's edge. The topbar is `--z-surface`, as before.
- **Accent stays secondary.** The active item is `--z-nav-active` with
  `--z-nav-ink` text and the 2px `--z-accent` bar on the leading edge that
  the light sidebar already carried — accent means "you can do something
  here", and the current page is the one place in the navigation where it
  still says so. No accent fill, no accent text, on the navy.
- **Group labels are `--z-nav-ink-2`, 11px, uppercase, 0.08em tracking**, with
  more room above them than below so the label reads as a heading for the
  items under it and not a footer for the ones above.
- **Status hues do not appear on the navy.** The sidebar carries no counts,
  no badges and no stripe; a status colour there would be decoration (rule 2).
- **The wordmark sits in a 48px row** aligned with the topbar, so the two
  rules meet at the corner, and is `--z-nav-ink` at 15px, weight 500, 0.08em
  tracking — the weight the system allows a heading and no heavier (§1).

---

## 4. Typography

**Family: IBM Plex.** One superfamily, three roles.

```css
--z-font-ui: 'IBM Plex Sans', system-ui, sans-serif;
--z-font-dense: 'IBM Plex Sans Condensed', 'IBM Plex Sans', sans-serif;
--z-font-mono: 'IBM Plex Mono', ui-monospace, monospace;
```

Plex was drawn for an engineering context and it shows — slightly squared terminals, a mechanical rhythm, no warmth it hasn't earned. It holds up at 12px where friendlier faces go mushy, and the condensed cut buys column width on the wall board without shrinking type. Self-hosted; no CDN.

**Mono is for identifiers and money only:** load numbers, invoice numbers, VINs, MC/DOT numbers, reference numbers, and every currency figure. These are things people read character by character, compare across rows, and read aloud over the phone. Mono makes transposition errors visible.

### 4.1 Scale

Dense by design. The base is 13px, not 16px.

```css
--z-text-xs: 11px / 16px; /* badges, table meta, timestamps */
--z-text-sm: 12px / 18px; /* table body, dense secondary text */
--z-text-base: 13px / 20px; /* default UI text, inputs, buttons */
--z-text-md: 15px / 22px; /* section headings, modal titles */
--z-text-lg: 18px / 26px; /* page titles */
--z-text-xl: 24px / 32px; /* KPI values */
--z-text-2xl: 30px / 36px; /* dashboard headline KPI, wall board */
```

### 4.2 Weight

400 body · 500 headings, labels, buttons · 600 KPI values and table column headers only. **No 700 anywhere.**

### 4.3 Numerals

```css
font-variant-numeric: tabular-nums;
```

Applied globally to every table cell, every KPI value, every currency and mileage field. Non-negotiable — proportional figures make columns of numbers unreadable.

Tracking: `-0.01em` on `--z-text-xl` and above. Zero elsewhere.

---

## 5. Space and density

4px base unit. `--z-1` through `--z-8` = 4, 8, 12, 16, 20, 24, 32, 40.

| Element            | Value                                     |
| ------------------ | ----------------------------------------- |
| Sidebar            | 224px, collapsed 56px                     |
| Topbar             | 48px                                      |
| Page gutter        | 20px desktop · 16px tablet · 12px phone   |
| Card padding       | 16px                                      |
| Table cell padding | 6px 12px _(Standard; §5.1 moves the 6px)_ |
| Control height     | 32px default · 28px compact · 36px large  |
| Input height       | 32px                                      |

### 5.1 Row density

A user preference persisted per user, defaulting to Standard.

| Mode        | Row height | Body size | Cell padding |
| ----------- | ---------- | --------- | ------------ |
| Compact     | 32px       | 12px      | 4px 12px     |
| Standard    | 36px       | 12px      | 6px 12px     |
| Comfortable | 44px       | 13px      | 12px 12px    |

**Row height is a MINIMUM, and the vertical cell padding is what moves.**

_Amended 2026-11-06, owner's brief ("tables denser and more operational"):
Standard's vertical padding is 6px, down from 8px. The arithmetic is the point:
a filled badge is 22px tall (16px line, 2px padding each side, 1px border each
side), and 22 + 2 × 8 = 38 is why the 2026-08-01 note below measured Standard
at 39px and called the 36px target unreachable. 22 + 2 × 6 = 34 sits UNDER the
36px minimum, so the minimum governs and a Standard row with a badge measures
36px for the first time — three more rows on a 1080p screen (rule 1), and the
table above stops describing a row that did not exist. Compact and Comfortable
are unchanged: Compact was already governed by its 32px minimum, and
Comfortable is the mode for someone who asked for room._

_Amended 2026-08-01. The reason, measured on the deployed worker: with §5's
fixed 8px vertical cell padding, a Loads row carrying a status badge renders at
39px — taller than Standard's 36px and Compact's 32px both. Changing only
`--z-row-height` therefore changed nothing at all. Compact and Standard both
measured 39px and the preference was a control that appeared to work and did
not. Moving the padding with the mode is what there is to give: Compact now
measures 32px, Standard 39px._

_Standard keeps §5's 8px exactly, so the table above does not contradict the
one above it — it says which of §5's numbers is fixed and which is the
Standard case of a scale. The literal 36px Standard row remains unreachable
while a badge sits in the row; the number stays as the target it always was,
and the honest claim a check can make is that Compact rows are shorter than
Standard ones._

### 5.2 Radius

4px on buttons, inputs, badges, and menus. 6px on cards and modals. **0 on table cells.** Nothing larger — generous radii read consumer, and this is equipment.

---

## 6. Layout

### 6.1 App shell

```
┌────────────┬──────────────────────────────────────────────┐
│            │  ⌘K search      company switcher   🔔   user │ 48
│  ZEBRA     ├──────────────────────────────────────────────┤
│            │  Page title                    [ Add load ]  │
│  OPERATIONS│  ─────────────────────────────────────────── │
│   Dashboard│  filter bar · saved views · density · export │
│   Dispatch │  ─────────────────────────────────────────── │
│   Loads    │                                              │
│   Calendar │   content — the only scrolling region        │
│            │                                              │
│  FLEET     │                                              │
│   Trucks   │                                              │
│   ...      │                                              │
└────────────┴──────────────────────────────────────────────┘
   224px
```

**The content column scrolls; nothing above it does.** _Added 2026-11-06,
rule 10 as clarified._ The shell is `h-screen` with `overflow-hidden`, the
sidebar and topbar are fixed in it, and the column that holds the page is
`min-h-0 flex-1 overflow-y-auto`. A page that owns a table body (§7.1) gives it
`min-h-0 flex-1` and the body scrolls under its sticky header while the column
does not move; a page with no table body — a detail form, the draft batch's
fifty trips — grows past the column and the column scrolls. Before this the
column did not scroll and every page carried the three classes itself, which
is an opt-in, and the batch page had not opted in (2026-11-02). A page may
still carry them; it no longer has to. `tests/batch-page-scroll.test.ts` pins
the column.

**And so the document is one window tall, rendered.** _Added 2026-11-16,
owner's report: dev `/dashboard` at 1886×961 showed the shell ending part way
down with the grey page under it and "Loads delivered per day" cut._ The shell
was 961 px; the DOCUMENT was 2,743 px, because every chart's screen-reader
table carried `sr-only` itself — a table treats `height: 1px` as a minimum and
ignores `overflow: hidden`, and with no positioned ancestor its rows hung off
the page, so scrolling the page lifted the shell out of the window. **`sr-only`
goes on a `div` around a table, never on the table.** The deploy sweep renders
every page that draws a chart at 1886×961 and 1366×768, scrolls the page as far
as it goes, and counts a problem unless the shell's top is 0, its height is the
window's and the document is no taller (`scripts/shell-height.mjs`;
`tests/shell-height.test.ts` holds the page list to the pages that import a
chart, and the cause by source).

v11.15: **and the shell is `relative`.** The wrappers alone took the document
from 2,743 px to 1,860 and no further on dev at `cd56789` — the sweep's first
run of this check said so — because the `sr-only` div is itself absolute: with
no positioned ancestor it sits at its place deep in the scrolled page while
being laid out against the document. The shell is `h-screen overflow-hidden`
already; positioned, it contains and clips every absolute element that has no
nearer box, so no future one can grow the page either.

**The sidebar scrolls on its own; the wordmark does not.** _Added 2026-11-16,
owner's report: on dev at 961 px the eleven groups ran past the window and
Maintenance, HR Management and Admin could not be reached — the column was
`h-full` and its list did not scroll._ The wordmark row stays pinned at the
top and the list under it is `min-h-0 flex-1 overflow-y-auto`, so the
sidebar scrolls independently of the content column and neither moves the
other. Its scrollbar is thin and drawn in the nav tokens — `--z-nav-border`
on transparent — so it reads as part of the navy rather than a light system
bar laid over it. The deploy sweep's shell check holds it at 1366×768: every
sidebar entry, scrolled to inside the sidebar, lands inside the window and is
the element at its own centre.

**The sidebar is navy (§3.6) and the content is light.** _Added 2026-11-06,
owner's brief._ The 224px column is `--z-nav-bg` edge to edge, the wordmark
row is 48px so its rule meets the topbar's at the corner, and the six groups
(Operations, Fleet, Accounting, Payroll, Records, Admin) are unchanged in
order and membership — this is a surface change, and `navigationFor` still
decides what is in it. Items are 32px, text at rest `--z-nav-ink-2`, hover
`--z-nav-surface` with `--z-nav-ink`, active `--z-nav-active` with `--z-nav-ink`
and the 2px accent bar on the leading edge (inline-start, rule 6).

#### 6.1.3 Sign-in — _added 2026-11-06_

The unauthenticated shell has no sidebar, and the sign-in card is where the
navy appears instead: a 48px `--z-nav-bg` band across the top of the card
carrying the wordmark in `--z-nav-ink`, exactly as the sidebar's wordmark row
renders it, then the form on `--z-surface`. One card, `--z-border-strong`,
6px radius, 400px wide, centred on `--z-surface-2`. Nothing else: no
illustration, no tagline, no second column. Somebody signing in at 6am wants
the field, and the band says which application this is in the same place the
sidebar will say it a second later.

#### 6.1.2 Which database am I looking at — _added 2026-10-05_

Every worker that is not production says so, on every screen, in the topbar that
is already there.

- **`NEON_BRANCH` decides, never the hostname.** It is the discriminator
  `statement-send.ts` already uses, for the reason written there: it names THE
  DATA. `NODE_ENV` is `production` in every built worker including dev's, a
  hostname check breaks the day a custom domain lands, and the question the
  ribbon answers is "whose rows are these".
- **Anything that is not `production` is marked.** CI forks per-run branches
  named `ci-<run id>`; a preview worker would be something else again. The
  ribbon names the branch it found rather than asserting it is "dev", because a
  marker that says the wrong thing is worse than none.
- **It states the branch, not the word "development".** "DEV · dev" is noise;
  `DATA: dev` answers the question in the words of the thing it read.
- **In the topbar, not above it** (standing rule 1). A band of its own costs a
  row of freight on every screen in the application, forever, and the topbar has
  a reserved empty region sitting in the middle of it.
- **`--z-warning-soft`, and that is a deliberate reading of §3.3.** The hue
  vocabulary is fixed to meanings and warning means "attention"; a worker that is
  not production IS attention — it is the difference between typing real freight
  into a sandbox and sandbox data into the carrier's books. It carries its word
  as text, never colour alone (standing rule 5).
- **Production renders nothing at all.** Not an empty element, not a ribbon that
  says "production": the absence is the signal, and an element that could render
  the wrong label on production is a worse failure than having no ribbon.

_The ruling for this was made in conversation and never written down, which is
why implementing it started by transcribing it (AGENTS.md: a rule that lives only
in a chat log cannot be cited in review). The specifics above are this
transcription's, not the original ruling's, and are open to correction._

#### 6.1.1 The dashboard — _added 2026-10-01_

_Owner's brief, dashboard redesign part 1. The screen somebody opens at 6am._

**Company chips and a period picker at the top, and they govern everything
below them.** Not per panel. A dashboard where the KPI strip answers for the
quarter and the chart for the week is one where two true numbers sit side by
side answering different questions, which is worse than one wrong number
because nothing looks broken.

**The KPI strip is plain numbers** (§14 forbids the gradient hero card). Gross,
after driver pay, loads, miles, cents per mile.

**"After driver pay" is NEVER "profit" or "net"**, and it is an EM DASH for any
period Zebra was not yet settling. Dev, Jul–Sep 2026: gross $2,755,782.16
against $184,774.65 of recorded pay, because 13,517 of those loads were paid in
Datatruck before this system existed. Their pay is UNKNOWN, not zero —
`by-company.ts` already says a zero there "would read as 'this freight cost
nothing to drive', which is the most expensive wrong number this page could
print", and a margin KPI is exactly where somebody would read it. The screen
says where the data starts rather than leaving a reader to wonder about the
dashes.

**Closed history counts in every TOTAL and appears in no QUEUE.** The carrier
earned that money, so it is in the gross (item 7's rule). Nobody can action a
load another system closed and paid two years ago, so it is out of Needs-you —
enforced by `NOT_CLOSED_HISTORY` on every counting row, including the dispatch
row that was safe only by coincidence until 2026-10-01.

**Needs-you is a RIGHT RAIL, not the first thing on the page.** It was the
whole dashboard; it becomes a column beside the money. Rows that count zero are
dropped — a queue of noughts is a queue nobody reads — and a row the session
cannot read is never COUNTED, not counted and hidden.

**THE DASHBOARD IS ONE TRANSACTION AND ONE STATEMENT PER CARD** _(owner's
instruction 2026-11-13, before the code; GAPS 42)._ Measured on dev at
`80b4242` through `page.timing`, the owner's dashboard was 35 statements —
the most of any page — and the accountant's own session (GAPS 42) paid a
3.4 s dashboard inside a 6 s sign-in. Of the 35, FOURTEEN were `set_config`
and `COMMIT`: seven cards, each its own `withCurrentOrg`, so the page paid
the tenant setting seven times before reading a row; the compliance queue
was read twice (the Needs-you row at the authorities' lead days, the panel
at 90); the money card read the same delivered loads three times for three
groupings. So:

- **One transaction.** `readDashboard` (`src/lib/dashboard-page.ts`) runs
  every card the role may see inside ONE `withCurrentOrg`, in sequence —
  a transaction holds one connection, so cards run one after another, and
  `dashboard.timing` keeps its seven spans as each card's own duration; the
  wall is read, not promised, because a card that scanned once where three
  scanned before may well be faster in sequence than three were in
  parallel.
- **One statement per card, one predicate each.** The money card:
  `moneyRows` — one `delivered` CTE under the one window-and-scope
  predicate, priced once, then the per-week-and-company, per-customer and
  per-day groupings and the first settled period as a `UNION ALL` split by
  a `kind` column; `assembleDashboard` is unchanged. The DQF ring:
  `dqfRoster` — the scope's drivers with their compliance types, expiries
  and document types as array subselects in the one SELECT; `isQualifiable`
  and `dqfChecklist` stay the only rules, in TypeScript, over the rows. The
  compliance read: `complianceOnce` — the items inside the longest horizon
  the page needs (the authorities' lead days or 90, whichever is longer),
  each row carrying its own latest expiry per subject and type and the
  scope's lead days, under the actionable-subject predicate written in SQL
  once; `shapeRecords` applies the rule, and the Needs-you count and the
  30/60/90 figures are both read from that one result. `panelFigures`,
  `topDriversByGross`, `needsYouCounts` and `listedAuthorities` were one
  statement each already and stay.
- **Each one-statement read has an agreement test** against the reads it
  replaces, on fixtures that exercise the rule (a superseded registration, a
  sold truck, a payee, a load with no customer) — the shell's one read set
  the pattern (§6.10 v10.93). **And the whole read has a budget:** on a real
  client, `readDashboard` for the owner is at most NINE statements including
  `set_config` and `COMMIT`, named, so with the shell's one the owner's
  `page.timing` reads ten. Over twelve fails by name.
- **Measured before and after on dev through `page.timing`**, the same
  roles and the same page, ray-matched, recorded in GAPS 42 when taken.
- **TWO TRANSACTIONS, MONEY BESIDE THE SIX** _(owner's ruling 2026-11-13 on
  the after-measurement, before the code)._ One transaction in sequence read
  owner 31 → 10 statements and 568 → 949 ms on the page's median: each card
  cheaper, their SUM where their MAX had been. So `readMoney` runs the money
  card in its own `withCurrentOrg` and `readCards` the other six in theirs,
  the two in parallel from the page — two statements more (`set_config`
  and `COMMIT` once again), owner at TWELVE, on the line and not under it.
  The budget test holds money at three and the cards at eight, named.
  Measured after; IF THE WALL IS NOT BACK at or under the before (568 ms
  owner median), the fallback is the ONE-ROW STATEMENT: the seven cards as
  seven named CTEs in one SELECT returning one JSON row, three statements
  and one round trip, each card's SQL readable under its own name.
- **THE ONE-ROW STATEMENT** _(the fallback taken, 2026-11-13: the split read
  owner 692 ms against 568)._ `readDashboardOneRow`
  (`src/lib/dashboard-one-row.ts`) sends `WITH money AS (…), needs AS (…),
compliance AS (…), compliance_row AS (…), panels AS (…), top_drivers AS
(…), dqf AS (…), authorities AS (…) SELECT` one column per card, each the
  card's rows as JSON. A card the role may not see has NO CTE — its column
  is a literal null, so its query does not run, the §6.1.1 rule for cash.
  `compliance_row` exists only when a chip narrows the panel and not the
  row. Each CTE's text comes from the one function that also feeds the
  card's own reader, so there is one SQL text per card; the parsers take
  `bigint` or a JSON number and a `Date` or a JSON timestamp string (UTC, as
  the columns are). The budget is three statements with `set_config` and
  `COMMIT`, named; the agreement test holds the result equal to
  `readDashboard` for the owner unscoped, the owner with a chip, and a
  dispatcher.

**~~The thirteen-week series is always thirteen weeks, whatever the period
picker says.~~ REVOKED 2026-10-02, owner's review of the charts on dev.** This
said two windows on one screen were honest "because the heading names each". On
the screen they were not: the bars showed a quarter while the donuts beside them
showed the month, so one dashboard stated two things at once and nothing marked
which. A heading is not enough when two panels disagree at a glance.

**THE PERIOD PICKER DRIVES EVERY CHART, and the windows are ROLLING:**

| period        | buckets        | grain  |
| ------------- | -------------- | ------ |
| Last 7 days   | 7 daily bars   | daily  |
| Last 4 weeks  | 4 weekly bars  | weekly |
| Last 13 weeks | 13 weekly bars | weekly |
| Last 52 weeks | 52 weekly bars | weekly |

**CALENDAR WINDOWS ARE OUT.** _Owner's ruling 2026-10-02, replacing This week /
This month / This quarter / Year to date._ A calendar window is empty for the
first days of whatever it names: "this quarter" on 2 October is two days long and
rendered $0, which is the same defect the default was changed to avoid one ruling
earlier. A rolling window is the same size every day it is opened.

**Each window ends with the CURRENT SETTLEMENT WEEK (Sunday–Saturday), and the
partial current week is drawn as far as today.** So the last bar is short because
the week is unfinished, not because the business fell off — and because that is
exactly the misreading a short final bar invites, THE PARTIAL BUCKET IS MARKED
and its tooltip says so. An unmarked partial bar is a lie of the same family as a
zero-height driver-pay bar.

**The grain is a property of the preset, not of the span.** The span rule that
preceded this — daily under about five weeks, weekly above — existed because a
calendar quarter could be two days old. Rolling windows have a fixed size, so
each preset names its own grain, and "Last 4 weeks" is weekly even though 28 days
would have been drawn daily under the old rule.

**The default is LAST 13 WEEKS.** A quarter of trading, always populated,
whatever the date.

**Every KPI carries a sparkline** over the same buckets, so a figure is never a
number without a direction. Six cells, six sparklines: gross, driver pay, after
driver pay, loads, miles, per mile.

**Every chart carries a legend, in words.** Not a colour a reader has to infer:
solid is gross, grey is driver pay, hatched is "driver pay not yet recorded in
Zebra". A chart with no legend does not ship.

**The legend row sits UNDER the x axis, not above the plot.** _Owner's review
on dev, second round, 2026-11-06._ The rule below puts a value above every bar,
and the value above the TALLEST bar sits in the 12px between the plot's top
and whatever is above it — which was the legend, so on every period the peak
label and the legend met. The owner offered two ways out: move the legend
under the chart, or drop the bar-top labels. The labels stay (they were his
own review of 2026-10-02) and the legend moves, on every bar chart that
carries a value above its bars — the dashboard's money chart and the
accounting report's series chart alike. The empty period still keeps its
legend; it is simply under the axis it keeps.

**The gross bar is ALWAYS solid. Only the driver-pay portion is hatched when
pay is unrecorded.** _Same review._ Until this the whole gross bar was hatched
and dimmed for a bucket whose pay was never recorded, so the gross — a figure
the carrier earned and knows exactly — read as doubtful. The doubt belongs to
the pay alone. So the gross bar draws solid, and the pay slot inside it (the
half-width bar the known-pay buckets carry in grey) is drawn hatched, TO THE
GROSS BAR'S TOP: unknown pay has no height of its own, and a slot drawn to the
top says "somewhere in here, unrecorded" where a slot drawn to any guessed
height would be a number. The legend's hatch swatch carries the same pattern
on the same accent, so it matches what the bar shows. A zero-height pay bar is
still never drawn — this is the same rule as before, applied to the right
series.

**Every bar carries its value above it and its period below it**, and the plot
carries horizontal gridlines with money ticks. `$12.4k` above, `Sep 20` or
`Oct 2` beneath. Hover shows the full set — week, gross, driver pay, after
driver pay, loads — as a VISIBLE tooltip and not only a `<title>`: a native
tooltip is slow, unstyled, and absent on touch.

**An empty period keeps its axis, its ticks and its legend.** It says no freight
was delivered and shows the shape of the thing that is empty. A blank panel is
indistinguishable from a broken one, which is the same objection §14 makes to
"No data available".

**Panels, in this order:** Charts, Fleet, Cash, Compliance. _Part 1 rendered
them as empty cards; part 3 fills the last three, 2026-10-02._

**FLEET** — the five tiles (trucks with a driver / idle, drivers with a truck /
idle, moving now) plus **top drivers by gross for the window**: horizontal bars,
name, money and loads, top ten, one named remainder. **Both crew seats are
credited on a team load**, which is the same rule the settlement engine applies
and the opposite of how a load count works: one load, two drivers paid, two
drivers credited.

**CASH** — receivables aging as a stacked bar across 0–30 / 31–60 / 61–90 / 90+
with money labels, over **invoiced, unpaid, non-factored** invoices only;
unapplied payments as a figure and a count; and the settlement pipeline as three
money figures, draft / final / paid, for the window. **Money roles only** — not
rendered for a dispatcher, and its query does not run.

**COMPLIANCE** — expiring within 30 / 60 / 90 days as three counts, each linking
to the safety screen, and a DQF complete / incomplete donut.

**The 30/60/90 counts and the Needs-you compliance row are ONE READER, at two
horizons.** _Amended 2026-10-07 (production walk, queue item 20 (8)) — this
said "two questions, two readers", and the office read 96 on the panel against
54 on the row beside it as one number disagreeing with itself._ The Needs-you
row is `complianceQueue`: subjects somebody can act on (no sold or
out-of-service truck, no inactive driver), superseded records dropped, the
authority's own `complianceWarnDays` horizon, expired included. The panel's
three figures were raw SQL over every live `ComplianceItem` row inside 30, 60
and 90 days — sold trucks' lapsed registrations and renewed-then-superseded
records included — and the 42 between the two numbers was that difference,
which nobody on the floor can see. So the panel's figures are COUNTS OVER THE
QUEUE'S OWN ROWS, read once at a fixed 90-day horizon (`horizonDays` overrides
the warn-days reading and nothing else changes), bucketed by days left against
30 / 60 / 90, expired in all three, cumulative. The SQL columns go. The
2026-10-01 ruling stands the other way round: it refused to re-express the DOT
horizon in SQL, and the fix removes the SQL rather than teaching it the subject
rule. The one place the two still differ is THE HORIZON ALONE — a medical card
expiring in 45 days is in the 60-day figure and not in a 30-day Needs-you row —
and the panel's note says so in words. The agreement test is in
`tests/integration/dashboard.test.ts`: a sold truck's expired registration and
a superseded one are in neither figure; a live truck's registration at 20 days
is in both and in all three horizons; the 45-day medical card is in 60 and 90,
not in 30, and not in the row.

**Every panel obeys the part-2b chart rules**: a legend in words, a value on
every bar, the same figures as a visually hidden table, and an empty state that
keeps the axis and the legend.

**Charts carry no charting library and nothing that animates.** §14 forbids
charts that animate on every render, and the cheapest way to obey that is to
have nothing capable of it.

**ON THE DASHBOARD, THE CHARTS ARE DRAWN IN THE BROWSER FROM THEIR FIGURES.**
_Amended 2026-11-15 (owner's instruction: the dashboard's document under 60 KB
and its render under 150 ms of CPU, measured by ray; v11.05) — this said "no
client JavaScript"._ Measured on dev, one ray: the document was 221 KB and the
Worker spent ~400 ms of CPU rendering it, more than its four statements took.
A server-rendered chart is paid twice in that document — once as markup, once
in the RSC payload that repeats the server tree as JSON — and the weekly bars
alone were 22 KB of markup, thirteen hover tooltips of it. So the weekly bars,
both donuts and the daily strip are client components the server renders as a
slot of the chart's height under its heading, and the browser draws once
hydrated: the figures cross the wire, the tree does not. The charts are the
same components — legend, value on every bar, hover, hidden table, empty state
— and still nothing animates: the chart appears whole in the space the slot
held. Elsewhere (`/accounting/reports`, statements) they still render on the
server, which is the default until a page's bytes say otherwise.

**BARS ARE HTML AND CSS; RINGS AND SPARKLINES ARE SVG.** _Amended 2026-10-02 —
this said inline SVG for everything. Amended 2026-11-15 (v11.05): sparklines
were HTML too, a `<span>` per column with its own classes and inline style,
~150 bytes a column paid twice; a sparkline carries no label, value or tooltip,
so nothing in it needs layout, and it is now ONE SVG path — a closed rectangle
per recorded bucket, nothing for a null._ A bar chart that must carry a value above
each bar, a label beneath it, gridlines behind it and a styled tooltip on hover
is a layout problem, and HTML does layout. The SVG version needed hand-placed
text at computed coordinates for all four, and a native `<title>` for the
tooltip — which is slow to appear, cannot be styled, and does not exist on
touch. A ring has no HTML equivalent and stays SVG.

The tooltip is a sibling element revealed by `:hover` on the bar's group. CSS,
not script.

**A chart's palette is the ACCENT RAMP, never the status hues.** §3.3 fixes
`--color-success`, `--color-warning`, `--color-danger` and `--color-progress` to
meanings; a donut that coloured RAM Haulage red and Dolphins green would be
saying one authority is in trouble and the other is fine. Slices differ in
VALUE, not in kind, so they differ in intensity: `--color-accent` at descending
opacity, with `--color-ink-3` for the remainder. No new token and no hex outside
the block.

**The by-authority donut is closed by default** _(amended 2026-11-07, owner's
ruling on dev, round five)._ It sits behind §6.3's **Show breakdown** control,
open for the current view only and never persisted, because a donut naming
every authority with its gross beside it is the list §6.3 stopped showing.
The by-customer donut beside it is unchanged.

**Every chart carries the same figures as a visually hidden table** (§13). A
`role="img"` with a summary sentence tells a screen-reader user what they cannot
inspect; a table lets them read it. The SVG is `aria-hidden` because it is a
second rendering of that table, not the content.

### 6.2 Navigation groups

The spec lists seventeen destinations. Seventeen flat items is a wall. Group them, with the group label at 11px `--z-ink-3`, uppercase, `0.06em` tracking:

- **Dashboard** — first, and under no heading
- **Load Management** — All Loads, Incoming Loads, Documents
- **Planning Calendar** — Dispatch Board
- **Billing** — Invoice, Payments, Reports, Factoring
- **Payroll** — Driver Pay, Statements, Charges
- **Customer Management** — Customers
- **Safety** — Compliance, DQF
- **Fleet Management** — Trucks, Trailers, Inspections
- **Maintenance** — Work Orders
- **HR Management** — Drivers, Users
- **Admin** — Authorities, Settings, Audit

_§6.2 amended 2026-11-16, owner's ruling: **the sidebar speaks Datatruck's
vocabulary**, because that is the vocabulary RAM's and Dolphins' people read
every day before Zebra, and a destination they have to translate is one they
look for twice. LABELS AND GROUPS ONLY: every route, page and permission is the
one it was, and §6.8's rows are unchanged but for their notes. Where the two
products differ the ruling kept Zebra's word: **Authorities** stays (Islom's;
Datatruck has no twin), Payments is never "Bill", and **Charges stays under
Payroll** — Datatruck's Transactions group is fuel, tolls and advances, and
Zebra's charges are driver deductions with free-text labels while fuel and tolls
arrive on the statement from their imports. **Documents sits under Load
Management** (most of its files are a load's), **Users moved from Admin to HR
Management**, and three screens became entries: **DQF** and **Inspections**,
tabs of Safety until now, and **Factoring**, which had no entry at all. There
is no Locations page, so Customer Management holds Customers alone, and there
is no Transactions group. The unbuilt Calendar, Expenses and Fuel stay hidden,
in Planning Calendar and Billing. The item a path lights is the one whose route
is its longest prefix, so `/safety/dqf` lights DQF and not Compliance. Earlier
groups, for the record: Operations, Fleet, Accounting, Payroll, Records, Admin
(2026-09-28); before that Money._

_§6.2 amended 2026-11-17 (v11.29): **two locales, Farsi removed 2026-11-17 by
owner; Afghan drivers use Russian.** Every label above, and every label in the
driver portal, exists in English and Russian only. The rule's home is §12._

_§6.2 amended 2026-09-28, owner's ruling. The **Money** group had grown to
eight entries, six of them built, and three of those answered the same question:
`/money/this-week` and `/settlements/batches` and `/settlements` are one week's
pay seen from three distances. A group where three items land on the same
numbers is a group the reader has to try in turn, which is what happened: the
Tuesday screen was the entry point and the other two were reached from it, so
their sidebar entries only ever served people who had lost their place._

_**Two groups, six destinations.** Owner's ruling, 2026-09-28, revising the
one-section shape of the same morning: "the spec was mine and theirs is better."
Datatruck splits Accounting from Payroll and the artefact in
`corpus/datatruck/ui/` shows why — money coming IN and money going OUT are two
jobs, often two people, and one list of five made the reader scan past three
entries to reach the one their afternoon was about._

| Group       | Destination | The question                                                                                 |
| ----------- | ----------- | -------------------------------------------------------------------------------------------- |
| **Billing** | Invoice     | who owes us, and how old is it                                                               |
|             | Payments    | what came in, and what it paid for                                                           |
|             | Reports     | the same money cut by company, week or driver — and, line by line, what moved on the cheques |
| **Payroll** | Batches     | what pay runs exist, and what state each is in                                               |
|             | Statements  | what one driver was paid for one week                                                        |
|             | Charges     | what comes off cheques, standing and one-off                                                 |

_**Each destination is tabs over one grid** (§7.1.6):_

| Destination | Tabs                                                                                                                                                                           |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Invoices    | Invoices · POD received · Ready to invoice · Uninvoiced · Invoiced · Partially paid · Paid · Factored · Direct-settled (the five load tabs since 2026-11-16, §6.7 second pass) |
| Payments    | Payments · Unapplied                                                                                                                                                           |
| Batches     | Batches · Balances                                                                                                                                                             |
| Statements  | Driver statements                                                                                                                                                              |
| Charges     | Scheduled · Standing · One-time · This week                                                                                                                                    |
| Reports     | By authority · By week · By driver · Transactions                                                                                                                              |

_**What moved, and nothing was deleted.** The five Payroll TABS became three
Payroll DESTINATIONS plus two tabs. Batches and Balances stay together because
both are a run's totals; Driver statements earns its own entry because it is the
document a driver is handed and the thing people arrive looking for; the two
charge tabs join the Charges page, which leaves Accounting for Payroll._

_**"This week" is the third Charges tab, and is where the week-scoped view went.**
Scheduled is org-wide and every week; This week is what comes off the run on
screen. The distinction this section has recorded since it was built survives the
move — two tabs of one page rather than two pages, which is the honest shape for
two views of one table._

_**Standing is the second tab and reads a different table**, which is what keeps
it from being a filter on the first. Scheduled rows belong to a driver; Standing
rows belong to the organization and materialise onto whoever the week produces.
It sits beside Scheduled rather than at the end because the two together answer
"what comes off a cheque", and One-time and This week are both about a particular
week. See §6.2.4._

_**Charges → Scheduled and Charges → This week read the same table and are not
the same grid**, which is the one place this structure could collapse into a
duplicate. Scheduled is org-wide and every week — "who is not paying insurance",
which needs no batch to answer. This week is scoped to the run on screen. A rule
dormant until November appears on the first and not the second, and that
difference is the reason both exist._

_**The batches grid carries a per-company breakdown row under each batch.** The
batch is the organization's by ruling (Islom, 2026-09-11) and its money is not:
settle together, report apart. The breakdown is an indented continuation of its
parent row, never a separate grid — a reader comparing four authorities' shares
of one week is comparing rows that have to be adjacent (rule 1)._

#### 6.2.1 Where Zebra's Accounting differs from Datatruck's, and why

_Added 2026-09-28, against the four Salary and Invoice screenshots in
`corpus/datatruck/ui/`. Zebra is modelled on that surface; these are the places
it deliberately is not, recorded so that "it doesn't look like Datatruck" has an
answer other than somebody's memory._

| Datatruck                                                                                                                   | Zebra                                                            | Why                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| --------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Two sidebar groups** — Accounting (Invoice, Salary, Bill) and Payroll (Driver, Dispatcher, Vendor, Charges, Transactions) | **Two** — Accounting and Payroll, on a different split           | _Resolved 2026-09-28: the artefact won._ This row recorded a divergence for about four hours; the owner read it and ruled that theirs is better. The split differs — ours is MONEY IN / MONEY OUT rather than by payee kind, because Zebra settles drivers and pays neither dispatchers nor vendors.                                                                                                                                                                                                    |
| **One batch per pay company** — `SB-000448` Dolphin and `SB-000447` RAM both cover Sep 13–19                                | **One batch for the organization**, with a per-company breakdown | Islom's ruling of 2026-09-11. This is the root of two other differences: it is why Datatruck needs a Pay company COLUMN, and why Zebra needs a breakdown ROW.                                                                                                                                                                                                                                                                                                                                           |
| **Pay company column** carries a real authority                                                                             | **`All authorities`**, with the names on the breakdown rows      | _Resolved 2026-09-28, with no migration._ Datatruck needs the column because a batch belongs to one payer; Zebra's belongs to all of them, so the honest value IS "all authorities" and the split is the breakdown directly beneath. It had been reading `not recorded`, which described the schema rather than the money.                                                                                                                                                                              |
| **`POSTED` / `PARTIAL POSTED`** pills                                                                                       | **`DRAFT` / `FINAL` / `PAID`**                                   | `SettlementBatchStatus` has three values and no partial state. A fourth pill would be a status nothing can produce.                                                                                                                                                                                                                                                                                                                                                                                     |
| **Seven Salary tabs** (adds Salary report, Dispatcher salary)                                                               | **Five**                                                         | The spec names five. Dispatcher pay is not a thing Zebra settles at all.                                                                                                                                                                                                                                                                                                                                                                                                                                |
| **`No Rows To Show`**                                                                                                       | **A written empty state with an action**                         | §10 and §14 — "No data available" is listed as an anti-pattern by name. This is the one place Zebra should NOT match the artefact.                                                                                                                                                                                                                                                                                                                                                                      |
| **Footer is a strip of named figures**, left-aligned below the grid                                                         | **Column-aligned sticky foot**                                   | §7.1.2. A sum belongs under the column it sums; a strip makes the reader match figure to column by name. The COUNT is kept in words, as Datatruck has it.                                                                                                                                                                                                                                                                                                                                               |
| **A filter funnel on every column header**                                                                                  | **Both** — funnels that write the URL the bar reads              | _Built 2026-09-28 by ruling._ §7.4's objection was HIDDEN state, and these have none: a funnel sets the same query parameter the bar renders as a chip, so the two are one filter with two handles, and a filtered grid is still a link somebody can send.                                                                                                                                                                                                                                              |
| **Checkbox column, Delete, Change status**                                                                                  | **checkbox selection · Finalise · Mark paid**                    | _Built 2026-09-28 by ruling; reworded 2026-10-01._ This column read "Checkbox and Change status", which named a control the interface does not have: the bar offers TWO BUTTONS that each say where they go, not a status picker. Both run the SAME `finaliseBatch` / `markBatchPaid` per batch, blockers and all — a bulk path that skipped them would be a way to finalise a blocked week from a checkbox. Delete is absent because a batch is money, soft-deleted, and that is not a toolbar action. |
| **Breadcrumb** (`Accounting / Salary / Batches`)                                                                            | **Built, in these two groups only**                              | _Built 2026-09-28 by ruling._ It earns its place here and nowhere else: two groups, six destinations and eleven tabs is the point at which "where am I" stops being obvious. The rest of the shell is one level deep.                                                                                                                                                                                                                                                                                   |

_Eleven more, added 2026-09-29 against `ST-005562.pdf` and the six workbench
screenshots:_

| Datatruck                                                                          | Zebra                                                         | Why                                                                                                                                                                                                                                                                                                                                            |
| ---------------------------------------------------------------------------------- | ------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **The trip is the unit** — `TR-016783-01`, a numbered leg                          | **The load is the unit**                                      | Zebra has no trip entity: a load is dispatched once and its stops are its legs. The Trip column prints the load number rather than inventing an `-01` suffix that nothing allocates and nothing can look up.                                                                                                                                   |
| **A `TIME` selector** on the open-batch screen — Delivery time / Pickup time       | **The POD, always**                                           | A settlement week is decided by when the POD landed (MONEY-DESIGN §0). A control offering to bound the window by delivery date would preview a set `openBatch` then refuses to produce — a filter that disagrees with the thing it is previewing.                                                                                              |
| **Four unavailable buckets, one of them a pair** — `In transit outside date range` | **Five, disjoint, with a stated precedence**                  | Zebra adds `no driver` and `no pay rule`, which Datatruck cannot need because a trip there always carries a payee. The PAIR is not reproduced and the reason is the row above: Datatruck ranges on the delivery date, so a load can be both in transit and out of range. Zebra ranges on the POD, and a load in transit has no POD to compare. |
| **Unavailable groups are collapsible rows inside the grid**                        | **A section below, per-reason heading, count always visible** | The counts and the what-to-do sentence never collapse; the load numbers under them do, and are capped. `Already in batch (7,052)` rendered flat is the one shape this screen must not take, and `no pay rule (3)` hidden behind a triangle is the one fact on the page somebody can act on.                                                    |
| **Check date = created + 2** — every batch from `SB-000433` to `SB-000449`         | **Period end + 13**                                           | Zebra's cadence, owner's ruling of 2026-09-27, not a defect in either. Recorded because the two artefacts sit in one folder and the difference otherwise reads as a bug the next time somebody checks a check date against the corpus.                                                                                                         |
| **`Post` the action, `POSTED` the pill**                                           | **`Post` the action, `APPROVED` the pill**                    | §10 says name things as the user names them, and the office says post. A BUTTON names an action and may speak the office's language; a PILL names a stored state on rows somebody was paid on. Renaming the enum is a migration over money that buys nothing a label already gives.                                                            |
| **Per-cell edit pencils** on deduction rows                                        | **No pencil; remove and re-add**                              | Extends the 2026-09-28 ruling to the workbench. A line carries a frozen `payRuleSnapshot`; editing the amount in place leaves the snapshot describing a figure that is no longer on the row.                                                                                                                                                   |
| **`Send to driver`**                                                               | **Built, and it refuses by name**                             | One channel exists (`sendEmail`, Resend) and `Driver.email` is nullable. A driver with no address gets a named refusal. It sends from production only: a dev deploy holds real drivers' real addresses, and a rehearsal that reaches one of them is not a rehearsal.                                                                           |
| **`+ Deduction tariff`** on the workbench                                          | **Not built**                                                 | It creates a STANDING rule from inside one statement. Zebra's standing rules live on Payroll → Charges where they are visible across every driver; a rule created from one statement is how a deduction nobody can find gets onto forty cheques.                                                                                               |
| **`Dispatcher salary` tab**                                                        | **Not built**                                                 | Recorded already at the five-tabs row; repeated here because the workbench's tab bar shows seven and the difference is now visible on two screens.                                                                                                                                                                                             |
| **Fuel: four show-and-deduct modes**                                               | **Built 2026-10-01, migration 61**                            | All four, and the mode is FROZEN on the statement rather than read from the authority at render — §6.2.3. The row stays in this table because the two still diverge: Datatruck's mode is a live setting, and a Zebra statement records the one it was built under, so re-opening an August statement after a policy change shows August's.     |

_**Factored is a tab and not a chip**, added 2026-09-30 by ruling. A factored
invoice is SOLD — the factor collects it, so it is not our receivable and it
does not age on our books. That is a different question about the same rows
rather than a narrowing of the list, which is what §7.1.6 makes a tab. The
status filter beside it IS a chip, because "show me the disputed ones" is a
narrowing of the question already asked._

_**Mark sent is a BULK action on the selection**, through the same
`markInvoiceSent` per invoice, refusals named rather than counted — the same
argument as the bulk status change on batches (§6.2.1). Finishing a week means
sending twenty invoices, and a path that sent them one detail page at a time
would be the reason somebody stops using the screen._

_**Receivables folds into Invoices.** Aging is a view of the invoice list, not a
second list of the same rows — §7.4 already makes a filter a URL, so "over 60
days" is a chip rather than a page._

_**Reports leaves Records for Accounting**, and `/money/by-company` becomes its
company cut. A report is read by the person who reconciles, and they are already
in this section when the question occurs to them._

_**Payroll absorbs This week, Settlements and Settlement batches.** The week
selector is what the three had between them: one page where the week is a
control rather than a route. The per-driver statement stays its own page,
because it is a document somebody prints and hands over._

_Expenses and Fuel stay unbuilt and keep their Phase 5 marker._

Groups render only where the user's role grants at least one child. A dispatcher without financial permission never sees an empty **Money** heading.

Active item: `--z-accent-soft` fill, `--z-accent` text, 2px accent bar on the leading edge. Icons at 16px, always paired with a label. Icon-only navigation is forbidden except in the collapsed rail, which shows tooltips.

#### 6.2.2 The settlement workbench — _added 2026-09-29_

_Owner's ruling, 2026-09-29, against `corpus/datatruck/ST-005562.pdf` and the
six workbench screenshots added to `corpus/datatruck/ui/` the same day._

**The statement page stops being a document with edit panels bolted under it and
becomes the place the week is actually assembled.** The page it replaces was
nine stacked cards — header, trips, lines, totals, add trips, add line,
recalculate, approve, mark paid — each a full-width panel, so a statement with
four loads ran past three screens and the figure somebody opened the page to
check was below the fold. The artefact fits the same work in one screen because
it treats the totals as a HEADER and the edits as ROWS.

Top to bottom, four parts:

**THE PAGE'S OWN READS IN ONE CALL** _(owner's ruling 2026-11-15, "page's
own reads only to one call; batchInputForOrg stays as it is, no second
spelling"; v11.09)._ Measured on dev before: an approved statement 18
statements (page 329 ms as the owner, 304 as accounting), a draft 34 (467 /
474 ms) — the statement in one transaction, then fuel and tolls, the column
memory and the four neighbours each in a transaction of its own, side by side.
Those four are named CTEs of ONE statement sent through the tenant reader
(`readSettlementPageHead`), and no transaction; the column memory opens one
only to rewrite a legacy row. Each CTE is a second spelling of a read other
code still makes (`fuelAndTollsFor`, `statementNeighbours`, the column
memory's read, the page's own `findUnique`), held equal by
`tests/integration/settlement-page-head.test.ts` through both transports. A
draft's addable trips still come from `addableTrips` through
`batchInputForOrg`, the engine's reader, in a transaction of their own.

**1. The action row**, top-right, belonging to the page (§7.1.6): Add trips ·
Add charges · Recalculate · Send to driver · Post · Export PDF.

**Add trips is present whenever the statement can be edited, even with
nothing to add.** _Owner's ruling, 2026-09-30._ It was the one action gated on
its own contents — shown only when unsettled freight existed — so a week with
nothing outstanding looked like a week where trips could not be added at all.
The panel it opens renders with an empty state instead, which §10 makes an
invitation rather than a dead end: it is where somebody looks to confirm that
nothing is missing, and that is an answer worth being able to reach.

**Export PDF is offered on EVERY statement, drafts included, and a draft's PDF
is watermarked.** _Owner's ruling, 2026-09-30, reversing the same day's
"absent on a draft"._

The earlier rule came from the route, which refused a draft with a 409 on the
reasoning that a draft's lines are rebuilt on every refresh, so a PDF of one is
a figure that will be different tomorrow. That reasoning is sound and it is an
argument for SAYING SO ON THE PAGE, not for withholding the page — the people
who need a draft on paper are the ones checking it before it is posted, which
is the whole job the workbench exists for.

- **The watermark is the disclosure**, diagonal across the sheet, and it is the
  reason the refusal is no longer needed: a document that says DRAFT on its
  face cannot be mistaken for the one somebody was paid on.
- **No number until one is issued.** The Settlement line prints empty on a
  draft rather than showing the placeholder id (§8) — the same rule as the
  heading, on the same reasoning, and the watermark already says why it is
  blank.
- **A settlement with no batch renders too.** Batch ID prints empty and the
  dates come from the settlement's own frozen fields.

**1a. The title.** _Owner's ruling, 2026-09-30._ The settlement number where
one has been issued; otherwise `Draft — <driver> · <period>`. Never the
placeholder id (§8).

**A STATEMENT NUMBER IS MINTED WHEN THE DOCUMENT STOPS BEING A DRAFT**, which
is the rule the title is only the visible half of. `finaliseBatch` already
mints one per settlement; posting a single statement did not, so a batch draft
posted on its own kept `DRAFT-<batch>-<driver>` through APPROVED and into PAID
— and a paid statement carrying a row id is a document somebody was paid on
that cannot be cited. Both paths mint now, and marking paid mints as a
backstop for rows approved before this ruling.

**2. The header box.** One dense block of label:value pairs at body size, in the
artefact's own order and grouping:

**THE HEADER'S COLUMNS, BOTH ENGINES** — _added 2026-10-06, before migration 67_.
Two engines write a `Settlement`: the batch (`settlement-week.ts`) and the
workbench (`settlements.ts`: `generateSettlement`, `addTripsToSettlement`,
`refreshTotals`). Until 67 they filled the header under different names AND
signs — the workbench put the driver's pay in `grossCents`, the add-backs in
`reimbursementsCents`, a POSITIVE `deductionsCents`, and never touched the
other three — so a workbench statement printed its pay under _Total pay_ and
`$0.00` under _Earnings_, the statements grid showed gross `0` for it, its
trips grid was EMPTY (the grid reads `SettlementLoadLine`, which the workbench
never wrote), and the salary report needed a CASE to read the two at once.

- **The batch engine's meaning is the meaning.** `grossCents` is the FREIGHT the
  percentage was taken of (`grossFor`'s decision per load), `earningsCents` the
  driver's cut, `otherPayCents` everything added back (with `reimbursementsCents`
  its reimbursement part), `deductionsCents` NEGATIVE — the ledger's sign, as
  every line table stores it — and `netCents` = earnings + other pay +
  deductions. `advancesCents` is the batch's own "Advance" other-pay row and
  stays zero on a workbench statement, whose `DEDUCTION_ADVANCE` is a
  deduction.
- **Every workbench trip is a `SettlementLoadLine`, like the batch's — migration 69.** 67 left the generate path's trips as `LOAD_PAY` lines in `SettlementLine`
  because the move touched twelve test sites and six readers and was not what
  that ruling asked for; 69 is that move, as its own step. `generateSettlement`
  writes one load line per trip — freight (`grossCents`) from the load's billed
  total, pay (`amountCents`) from the rule in force when the load ran, the rule
  frozen beside it, the broker's reference, the places and the sheet dates on
  the row — and no `LOAD_PAY` line at all. `SettlementLine` is for what is put
  on by hand: accessorial pay, bonus, reimbursement, the typed deductions.
  **The sheet dates keep their plan-or-record flags**: `SettlementLoadLine`
  gains `puActual` and `delActual`, NULLABLE — true or false on a workbench row,
  null on a batch row, which records nothing the batch did not know rather
  than a default that reads as "plan". The drift checker's snapshot arm reads
  the load lines' snapshots (every row that carries one), the statement page's
  separate "Load pay" list goes — the trips grid shows every statement's trips
  now, and a second list of the same freight was the thing the grid existed to
  replace — and `removeSettlementLine`'s guard stays, because a `LOAD_PAY` row
  that somehow survived is still not removable by hand. 69 moves the rows
  already placed (dev: four lines on two statements) with every net asserted
  unchanged.
- **`refreshTotals` is the one header writer for a workbench statement, over
  BOTH tables**: earnings = Σ `LOAD_PAY` + Σ load lines' pay + Σ
  `ACCESSORIAL_PAY`; other pay = Σ `BONUS` + `REIMBURSEMENT`; deductions = Σ
  the `DEDUCTION_*` lines as stored; gross = Σ the `LOAD_PAY` lines' loads'
  billed totals + Σ load lines' freight; net = the three summed. That is
  GAPS.md gap 2 closed by construction: a hand line on any statement moves the
  net by its amount and nothing else, and the drift checker's totals arm
  applies the same rule to the same two tables.
- **A trip added by hand is PRICED, or refused.** `addTripsToSettlement` wrote
  the freight as the pay and its comment deferred the pricing to
  `Recalculate`, which re-adds and does not re-price (`recalculateAction`
  says so in its own words). Nobody had done it to a real statement — 0 of 6
  workbench statements on dev carry a load line — and it is closed before
  anybody does: the amount is `payFor(load, rule in force at delivery)`, and a
  load with no usable rule is refused whole, the way `generateSettlement`
  refuses, rather than added at a hundred percent.
- **Migration 67 is data, not DDL, and touches headers only.** For every
  `batchId IS NULL` statement it rewrites the six money columns by the rule
  above — freight read off the `LOAD_PAY` lines' loads — with `netCents`
  ASSERTED unchanged on every row before the transaction commits. Rehearsed on
  dev with counts: no row is added or removed in any table, and the net
  column's sum is the same number before and after.
- **What retires with it:** the salary report's CASE on `batchId`
  (`salaryByDriverWeek` reads the columns), and the `ST-000018` sign finding.
  The statements grid keeps computing _Deductions_ from the lines, because
  §6.2.6 defines that column as every net-reducing line, not as one header
  figure.

**FREIGHT IS NEVER CALLED "PAY".** _Owner's ruling, 2026-10-06, answering the
question v10.34 flagged._ Per trip line the freight is **Load gross** — Datatruck's
own header, and the word the PDF already printed — beside **Driver gross**, the
cut. In the summary, **Earnings** is the driver's cut before deductions and **Net
pay** is after; **Total gross** renders the freight sum (`grossCents`); **Total
pay** is removed as a label everywhere, on the screen and in the words file, so
it cannot come back under a key that still exists. Row 2 above loses it; row 3
renders _Total gross_ and _Net pay_ as written. The grid column keeps its stored
key (`totalPay`) under the new header, because a column chooser preference is a
row in somebody's settings and renaming the key would silently drop it.

| Row | Fields                                                                        |
| --- | ----------------------------------------------------------------------------- |
| 1   | Settlement no. `‹ ›` · Driver, period `‹ ›` · Driver type · Payment tariff    |
| 2   | Earnings · Other pay / Reimbursements · Deductions / Advances · Trips count   |
| 3   | Total gross · Net pay · Balances · Fuel & toll expenses · Attachments & notes |

- **Not KPI cards.** §7.3 is for a handful of figures somebody watches over time.
  Fourteen of them as cards is a wall, and these are not trends — they are one
  document's arithmetic.
- **Every figure in the header is the sum of something on the page below it.**
  A figure with nothing under it is a figure nobody can check, which is the
  whole objection this system has to a dashboard.
- **`Balances` and `Fuel & toll expenses` carry a Review link, not just a
  number**, because both are sums of rows that live elsewhere.
- **`‹ ›` on the settlement number steps through the batch's statements** in the
  grid's own order; **`‹ ›` on the period steps the same driver through their
  weeks.** Two different journeys, and the artefact puts them on the two things
  they move: a run and a person.

**3. The trips grid** — eleven columns behind a chooser, **nine shown by
default**, because §7.1 caps a table at nine and enforces it by throwing.

| Default                                                                                                   | Behind the chooser |
| --------------------------------------------------------------------------------------------------------- | ------------------ |
| Trip · Load gross · Driver gross · Status · Delivery date · Pickup date · Pickup · Delivery · Total miles | Load number · Unit |

**The Trip column is the BROKER's reference, falling back to Zebra's own load
number; Zebra's number keeps a column of its own behind the chooser.**
_Owner's ruling, 2026-09-30, the screen following the paper._

The statement PDF prints the broker's reference in its Load number column for
the reason the artefact does — `ST-005562` lists `116RX75DK`, and a driver
checking a line against his own paperwork has that number in front of him. A
grid that led with `DT-016018` while the sheet beside it led with the
reference would make the two documents look like different weeks.

- **The fallback is the frozen number**, so a trip is identifiable when the
  reference is missing, empty, or later moved.
- **Zebra's number is still a column**, behind the chooser, because it is what
  the load is called everywhere else in this system and somebody reconciling
  against a load page needs it.

_Corrected 2026-09-29, an hour after this section was written. The brief named
eleven columns, this section copied them, and the page threw §7.1's own error
on its first render — found by the screenshot run refusing to report a pass.
`AGENTS.md`: the design system wins and the contradiction is flagged, not
silently resolved. See `PHASE-5-BRIEF.md` flag 38._

- **`Load number` and `Unit` are the two that go**, and neither is arbitrary.
  Zebra's own number is a key somebody looks a load up by rather than a column
  anybody reads down — and since 2026-09-30 the Trip column already falls back
  to it, so it is only hidden where the reference makes it redundant. The Unit
  repeats: Zebra freezes one truck per settlement, so that column is the same
  number on every row, and it belongs in the header box where `ST-005562.pdf`
  prints it.
- **The artefact is not arguing for a wider table.** Datatruck shows eleven and
  ships a `Columns` control in the same toolbar. What it is arguing for is the
  chooser, which §7.1.4 already specifies.

- **It is the frozen snapshot, never a join to today's load** (§7, and the
  existing comment in `SettlementLoadLine`).
- **One mileage, labelled for which one it is.** The artefact shows 547.78 on
  the grid and prints 568.18 for the same load; the difference is the deadhead.
  The snapshot freezes ONE figure — the total the statement prints — so the grid
  shows that same figure under the header `Total miles`, and the two surfaces
  agree. A second column is a migration (`loadedMilesHundredths` on
  `SettlementLoadLine`) and waits with §6.2.3. **Until it exists, the grid must
  not label the frozen total as `Loaded miles`**, which would make the screen
  disagree with the paper by the deadhead and be the exact argument the freeze
  exists to settle.

**4. Other pay · Deductions · Driver balances**, three grids, each ending in an
**inline add-row** rather than a separate panel:

- Columns are the grid's own: Type (select) · Amount · Quantity · Total ·
  Description · Add.
- **The total is computed and never typed.** ST-005562 prints Quantity and Rate
  and the total is their product; a typed total that disagrees with its own
  factors is a money bug that survives every review because both numbers look
  deliberate.
- **Quantity defaults to 1 and amount to the type's own rate where it has one.**
- **No per-cell edit pencil** (ruled 2026-09-28). A line carries a frozen
  `payRuleSnapshot`; editing the amount in place leaves the snapshot describing
  a figure that is no longer on the row. Remove and re-add.

#### 6.2.3 Fuel and tolls — _added 2026-09-29_

_`FuelTransaction` already exists and carries the purchase; what it does not
carry is anything about being CHARGED to somebody. Owner's ruling, 2026-09-29:
the migration is HELD until production dispatches, so this section splits in
two._

**Built now, because none of it needs a column:** the header box's
`Fuel & toll expenses` figure and its Review panel read the driver's existing
`FuelTransaction` rows for the period, and the CSV importer's stub declares its
required headers and refuses a file it does not recognise. **A read is not a
charge** — nothing on a statement changes, and the figure is labelled as what
was BURNED rather than what was deducted, because those are not the same number
until somebody rules which of the four modes applies.

**~~Waits for the migration:~~ landed 2026-10-01** — every column below, the
deduct side, the `TollTransaction` model and `DEDUCTION_TOLL` are in migration 61. What the charge side does with them:

- **`Settlement.fuelMode` is frozen at refresh** from `CompanySettings.fuelMode`,
  and null where nothing was deducted — writing `RETAIL` on a statement that
  charged no fuel would claim a decision nobody made.
- **One line, not one per fill-up.** The corpus prints
  `Fuel · 1 · $1,234.56` and the detail lives on the workbench's Review panel.
  Twenty fill-ups as twenty statement lines would bury the figure the driver is
  checking.
- **The line says which amount it charged** — `retail`, `retail + fees` or
  `card invoice`. A driver comparing a deduction against the receipts in his cab
  needs to know he is looking at the card invoice, or the two numbers read as an
  error.
- **An INVOICE mode on a row with no invoice amount charges RETAIL and says so
  on the statement.** `invoiceCents` is nullable because it arrives from the
  import; charging zero would be a gift, and charging retail silently would
  produce a number the mode does not describe.
- **`settlementId` on the transaction is the record that it was charged, and it
  is written at FINAL only.** A draft that claimed its transactions would make
  the next refresh of that same draft find nothing and drop the line it had just
  printed.
- **The toll importer does not exist.** `TollTransaction` has a model, RLS, a
  fixture row and a charge path; nothing writes it but the add-row. The fuel
  importer is still the stub that names its columns.

- **Show and deduct are two booleans, not one.** The artefact has "Show fuel
  transactions" and "Add to calculate Fuel transactions" as separate checkboxes,
  and they are separate questions: a company-fuel driver is shown what was
  burned in his truck and charged nothing for it.
- **Retail and invoice are two amounts and the difference is not rounding.**
  $339.92 at the pump, $284.43 on the fuel-card invoice, on the same gallon of
  diesel. Which one a driver is charged is a policy decision that has to be
  recorded per statement, because changing it silently restates what somebody
  was paid. The artefact offers four modes — retail, retail plus fees, invoice,
  and invoice showing both — and all four print a different statement.
- **Money in cents, gallons in decimal** (§8, and `FuelTransaction` already does
  this).
- **Pending and added are states of the transaction, not two tables.** A
  transaction is pending until a statement claims it; the statement that claimed
  it is the record that it was charged once.
- **The importer names what it needs and refuses what it does not recognise.**
  The provider's format is unknown. A stub that guesses a column order will
  silently import the wrong column as money the first time a provider reorders
  its export — so it declares its required headers, fails closed on an
  unrecognised file, and says which header it could not find. A named refusal is
  a working importer for a format nobody has seen yet; a guess is not.

#### 6.2.6 The statements grid — _added 2026-10-01_

_Owner's ruling. The grid one person uses to finish a payroll week._

**The Deductions column is EVERY NET-REDUCING LINE, computed from the lines
and not read off the settlement.** `Settlement.deductionsCents` is written by
two paths that disagree about its sign — the batch engine sums
`SettlementDeductionLine.totalCents`, which is negative, while `refreshTotals`
sums `-amountCents` from `SettlementLine`, which is positive. Dev holds both
today: one settlement at `-45000` beside two at `+45000`. A column rendering
that field shows `-$450.00` beside `$450.00` for the same kind of charge, and
its footer SUMS THEM AGAINST EACH OTHER.

- **One definition, applied to both line tables.** A settlement's charges live
  in one table or the other depending on which path made it, never both, so
  the figure is the sum over both of whatever is negative — rendered as a
  positive magnitude under a column headed Deductions.
- **The stored field is left alone.** It feeds the statement PDF and the
  workbench header, where it is used consistently within each path; changing
  it is a migration over money and a separate ruling. The grid stops trusting
  it; nothing else changes.

**Status and batch are column filters** (§6.2.1's funnels), and the batch one
filters on the NUMBER a reader knows — `SB-000001` — not on an id.

**Post and Mark paid act on a selection**, per statement through
`approveSettlement` and `markSettlementPaid`, blockers intact, refusals named.
Marking paid asks once for the method and the reference, as the invoice
channel does and for the same reason: one wire pays a run, and "how was it
paid" is the question answered wrong from memory a month later.

#### 6.2.5 Applying a payment — _added 2026-09-30_

_Owner's ruling, 2026-09-30. Money arrives as one wire against several open
items; until it is applied it sits unapplied and nothing it paid for looks
paid._

**One list of the payer's OPEN ITEMS, both kinds together.** Direct-settled
loads with a balance and invoices with a balance, in one list — because the
question is "what does this payer owe us", and a screen that answered it in
two tables would make the person add up two subtotals to see whether the wire
is covered.

- **Every row's amount is prefilled to that item's balance and is editable.**
  The common case is a wire that clears its items exactly, and the common case
  should be one click.
- **Partial is allowed and the remainder STAYS UNAPPLIED.** Not forced onto the
  oldest item, not written off. Unapplied money is a real state — §6 already
  says so about `unappliedCents` — and a screen that always zeroed it would be
  inventing an allocation nobody made.
- **ONE TRANSACTION, ALL OR NOTHING.** This is the opposite of bulk Change
  status and bulk Mark sent, deliberately: those are independent acts on
  independent rows where partial success is honest. Here one person is
  DIVIDING ONE PAYMENT, and applying three of their five allocations while
  refusing two would leave a split nobody chose. Every refusal is named.
- **The application rows are written one at a time, not with `createMany`.**
  The audit extension reports `createMany` as an unfollowable operation, so a
  bulk insert would apply money with no audit trail behind it.

#### 6.2.4 Standing charges — _specified 2026-09-30, built 2026-10-01_

_Owner's ruling, 2026-09-30. The second tab on Payroll → Charges, joining
`Scheduled · One-time · This week`. Migration 61 landed on 2026-10-01 and the
tab table in §6.2 now reads four._

_Until that migration this section said the table "still reads three, and
deliberately", so the guard would not be put in the position of enforcing a
plan. It reads four now because the page has four, and the two were amended in
the same commit — which is the whole discipline that sentence was protecting._

**The scope offers four values, not the three this section first named.**
`company drivers / owner-operators / all` leaves lease operators reachable by
nothing but `ALL`, because the driver's type has three members. A charge aimed
at company drivers would silently skip every lease operator. The schema's
vocabulary wins (`AGENTS.md`) and the divergence is recorded in
`PHASE-5-BRIEF.md` §7 rather than resolved in this file. _Since migration 70 the
scope carries the driver's own words — `COMPANY_DRIVER`, `LEASE_OPERATOR`,
`OWNER_OPERATOR` — as `Driver.driverType` does; it was `OwnershipType`'s
`OWNED`/`LEASED` until then, and 70 rewrote the stored scopes with the rows._

**Two charges of one type cannot both be live, and `ALL` clashes with every
scope of its type.** `Ifta` for all drivers beside `Ifta` for owner-operators
charges the owner-operators twice — which is what somebody reaches for when they
mean "everyone pays $20, owner-operators pay $35". That is two rules with a
precedence nobody has specified, so it is refused by name rather than silently
summed.

A **scheduled** charge belongs to one driver. A **standing** charge belongs to
the ORGANIZATION and materialises onto whichever drivers the week produces —
which is the difference that makes it a separate thing rather than a filter on
the existing list. `Ifta` and `Admin Fee` are the cases: every driver pays
them, nobody signs up for them individually, and a driver hired on Tuesday
pays one on Friday without anybody adding a row.

**The rule:** kind · weekly amount · applies to (company drivers /
owner-operators / all) · effective from · effective to · per-driver exemptions.

- **It materialises at REFRESH, one line per settlement**, for every driver
  with freight in the week. Not a view computed at render: the line is a real
  `SettlementDeductionLine` like any other, so it shows on the workbench, it
  prints on the PDF, and it is frozen at FINAL with everything else.
- **A driver with no freight that week gets no line.** The charge follows the
  work, not the roster — billing a week somebody did not drive is the failure
  this sentence exists to prevent.
- **Editing the rule never touches a FINAL or PAID statement.** Same posture as
  `DriverPayRule` and `RecurringDeduction`, and the same reason: those
  documents were handed to a person. A change closes the old row with
  `effectiveTo` and opens a new one; only DRAFT statements pick it up, and they
  pick it up at the next refresh like everything else.
- **An exemption is a row, not a blank.** "This driver does not pay Ifta" is a
  fact somebody decided and should be able to explain, so it is recorded
  against the rule and the driver rather than inferred from an absence.

**HELD FOR MIGRATION 61, and the reason is a finding rather than a
preference.** The existing `RecurringDeduction` cannot carry this: `driverId`
is `String` NOT NULL with a required relation, there is no column for the
applies-to scope, and there is nowhere to record an exemption. Three of the
six fields have no home. See the schema, where the columns are written beside
`Payment.isAdjustment` in the same bundle.

_The workaround that fits today's schema is rejected on purpose: fanning the
rule out into one `RecurringDeduction` per driver at creation. Editing would
then mean superseding N rows, a driver hired next week would not pick the
charge up, and "applies to owner-operators" would be a filter frozen at
creation rather than a property of the rule. That is a different feature
wearing this one's name._

#### 6.2.10 Payroll takes Datatruck's shape — _added 2026-10-05_

From Islom's walkthrough of the system the office already knows. Five parts; this
section is the whole target and each part ships behind its own ritual.

**1 — Opening a batch.** Company (one, or all) · the week, shown · basis · a trip
grid with a tick per row.

- **`SettlementBatch.companyId` is NULLABLE and null is the default.** Null means
  the whole organization, which is the 2026-09-11 ruling unchanged — Zebra settles
  the organization in one run — and a named company is Datatruck's shape for the
  weeks the office wants it. Both are legitimate; neither is a migration of the
  other.
- **A named company scopes its standing charges and its `recentWeeks`.** A batch
  for RAM Haulage must not carry Dolphins' weekly insurance line, and the 13-week
  comparison beside it must be RAM's thirteen weeks. Owner's ruling: the scope
  follows the batch.
- **THE WEEK IS NOT REVERSED.** A batch is a settlement week by construction and
  `openBatch` still refuses anything else by name. The from/to fields SHOW the
  week — they are not free-form, and a reader who types into them is reading the
  wrong screen. The week is what statements are numbered against
  (`settlement-number.ts`), what standing charges are in force for, what
  `recentWeeks` steps through, and what "one batch per period" is enforced on;
  arbitrary windows would unmake all four. _REVERSED BY RULING, 2026-11-17
  (part 7, R1, and the overlap ruling the same day): a free date range,
  pre-filled with the last full settlement week, and a NEW batch names an
  authority (R2). What each of the four becomes is written in part 7's Create
  step; this bullet is kept as the record of why the week stood until then._
- **The basis selector offers "Delivery time" and nothing else.** It is the
  office's basis. It is a selector rather than a label because Datatruck has one
  and the screens must read alike, and it is honest about having one option rather
  than implying others exist.
- **Columns:** ID · payee · driver type · load ref · status · load pay · pickup ·
  delivery · locations. Nine, which is §7.1's cap exactly, so a tenth goes behind
  §7.1.4's chooser (§7.1.7).
- **"0 available" never stands alone.** _Production walk 2026-10-07, queue item
  20 (7): the week of 9/20–26 showed 0 available and the reasons were a scroll
  away._ The header line that says how many loads were considered now names the
  buckets that took the rest, with their counts, in the picker's order — "16 in
  transit · 5 outside the week · 2 on a statement" — so the answer to "why zero"
  is on the same line as the zero. The groups below stay as they were; this is
  their sum, said first. MEASURED on dev for that week: 23 considered, 16 never
  delivered in Zebra (8 in transit, 6 booked, 2 dispatched — imported freight
  whose status stopped mid-pipeline), 5 with a POD in a neighbouring week, 2
  already on statements, 0 available; the production reading is the same
  statement in the handover.

**2 — The tick is an EXCLUSION, not a selection.** Owner's ruling, and it is the
part worth reading twice.

> Draft = everything settleable in the week, MINUS the trips the office unticked.
> The exclusions are persisted per batch. `refreshDraft` re-adds new freight and
> never un-excludes.

- **Why this way round:** a picked set makes the absence of a trip ambiguous —
  nobody can tell "not chosen" from "arrived after they chose". An exclusion set
  is monotonic: a refresh can only ever ADD freight, so new deliveries appear
  without erasing a decision, and a decision cannot be undone by a background
  recompute. The failure mode of the other design is a trip silently dropping out
  of somebody's pay.
- **It carries who and when**, because unticking a trip is a decision about
  somebody's wages and "why is this not on my statement" has to have an answer.
- Checkboxes default **ticked**. "Select all available" and "Add N trips" read
  naturally on top of that: both are ways of clearing exclusions.
- **Un-excluding is a deliberate act on the batch**, never a side effect of a
  refresh.

**2b — The batch route IS the batch screen.** _Production walk 2026-10-07,
queue item 20 (1), specified before the code._ `/settlements/batches/[id]`
served MONEY-DESIGN item 3's draft list — totals, held lines, blockers — with a
Statement column that linked to the PDF after FINAL and said "Refresh draft"
before it. WHY THE WORKBENCH WAS NOT THERE: part 1 built the trip grid on the
open-a-batch screen, part 2 persisted the ticks, and no part named the route a
batch lives at afterwards — so opening a batch left the office on the picker,
and every link to a batch landed on the printout. The screen was never wrong;
it was the previous screen.

- **The route renders the part 1 grid for ITS OWN batch**: the batch's week and
  the batch's scope, the same nine columns, through the same reader
  (`previewBatch` with the batch named). A trip on this batch's statements is
  available and TICKED; a trip this batch has excluded is available and
  UNTICKED; a trip on another batch's statement stays "already on a statement".
  The ticks are read from the persisted exclusions, which is the only place
  they live.
- **Save ticks writes the DELTA, as one act.** Shown minus ticked is the
  exclusion set the office wants; against the set it has, the difference is
  excluded or included through `excludeTrips` / `includeTrips`, which refresh
  the draft in the same transaction. Nothing else changes a tick. On a FINAL or
  PAID batch the grid is read-only and says so: a document does not have boxes.
- **The item 3 facts stay, below the grid**: the statements table, the held
  lines by name, the blockers by name, the negative nets. **The Statement
  column links to the statement — `/settlements/[id]`, the workbench — in
  every status**, number shown, and the PDF is the statement page's own export.
  A draft is a document somebody is working on, not a thing that cannot be
  opened.
- **Open a batch lands here.** `openWeekAction` redirects to the batch it
  opened, or to the batch already covering the week, rather than leaving the
  picker on screen with a warning.
- **One place for the grid.** The columns and the table move to a server
  component the picker and the batch screen both render, so the nine columns
  cannot drift apart between "what would go in" and "what is in".

**2c — The batch screen's own reads in one call** _(owner's ruling
2026-11-15, "page's own reads only to one call; batchInputForOrg stays as it
is, no second spelling"; v11.08)._ Measured on dev before: a FINAL batch 6
statements (page 340 ms as the owner, 520 as accounting), a DRAFT 20 (1,011 /
1,229 ms). The batch with its statements, the preview's window and the
batch's exclusions are named CTEs of ONE statement sent through the tenant
reader (`readBatchPageHead`), and no transaction; the window is classified by
`previewFrom`, the picker's own function, so the two screens share one
precedence. The window's SQL (`previewLoadsSql`) is a second spelling of
`previewBatch`'s read, and `tests/integration/batch-page-head.test.ts` holds
the head equal to the reads it replaced, through both transports, on a week
with a load on both sides of every filter. An open batch's held lines and
blockers still come from `batchInputForOrg`, the engine's reader, in a
transaction of their own. Target: a FINAL batch 6 → 2 (the shell and the
call); a DRAFT loses the four the call absorbs.

**3 — Batch status: DRAFT → PARTIAL → FINAL → PAID.** `PARTIAL` is some
statements final and some not, which is the state the office works in and the one
the enum could not express. Finalising is per statement; the change-status bar
acts on the selected ones (§6.2.1, v10.12). _Specified 2026-10-06, before the
code:_

- **The batch's status is DERIVED from its statements, never set by hand.** None
  approved → `DRAFT`. Some approved or paid, not all → `PARTIAL`. All approved →
  `FINAL`. All paid → `PAID`. It is recomputed in the same transaction as every
  change that can move it — a statement approved, a statement paid, a draft
  refreshed, the batch finalised — so the list and the statements never disagree
  for an instant somebody could press a button in.
- **A refresh rebuilds only the statements that are still `DRAFT`.** An approved
  statement is a document: it has its number (`approveSettlement` mints it before
  the status changes, 2026-09-30) and a person's name on the approval. Today's
  refresh deleted every statement on the batch, which would have destroyed one
  the office had just posted from the statements grid — a latent defect that
  `PARTIAL` makes impossible rather than merely unlikely. The frozen statements'
  trips stay out of the rebuild by the rule that already exists: a load carrying
  a settlement line is not settleable.
- **`finaliseBatch` becomes "approve every statement still in draft".** Same
  outcome as before for a batch nobody has touched; on a `PARTIAL` batch it
  approves the remainder and the derivation lands on `FINAL`. The batch number
  was allocated at open and does not change.
- **The transition to `FINAL` stamps `finalizedAt` and who**, whichever path
  caused it — the last single approve or the batch button. The transition to
  `PAID` stamps `paidAt` the same way.
- **`PARTIAL` wears `--z-warning` on the list** (§3.3: attention — a batch half
  posted is a batch somebody is in the middle of), with its word.

**4 — Transactions report.** Every pay line in a window, by driver, exportable:
trip pay, deduction, advance, adjustment. The vocabulary exists —
`SettlementLineType` carries `LOAD_PAY`, `ACCESSORIAL_PAY`, `BONUS`,
`REIMBURSEMENT` and seven `DEDUCTION_*` — and "adjustment" has no type of its own
today, which this part has to name rather than improvise. _Specified 2026-10-06,
before the code:_

- **A fourth cut on `/accounting/reports`**, beside company, week and driver
  (§7.1.6: a tab is a different question about the same subject). The question
  here is "what moved on the cheques", line by line.
- **A row is one line from one of the three line tables**, and the report is
  their union, not a fourth copy: `SettlementLoadLine` (trip pay — `amountCents`,
  with the trip's gross beside it), `SettlementLine` (every other typed line) and
  `SettlementDeductionLine` (the deductions the statement printed). Each row
  carries the statement it is on, the driver, the batch, the period end as its
  date, the kind, the description and the amount.
- **The four kinds the office uses, mapped from what the schema has — and the
  mapping is written here so it is not improvised twice:**

  | office's word  | from                                                                                                  |
  | -------------- | ----------------------------------------------------------------------------------------------------- |
  | **trip pay**   | `SettlementLoadLine`; `SettlementLine` of `LOAD_PAY` or `ACCESSORIAL_PAY`                             |
  | **advance**    | `SettlementLine` of `DEDUCTION_ADVANCE`; a deduction line whose type is `Advance(s)`                  |
  | **deduction**  | every other `DEDUCTION_*` line and every other deduction line                                         |
  | **adjustment** | `SettlementLine` of `BONUS` or `REIMBURSEMENT` — the two the schema has for "something added by hand" |

  A deduction row also carries §6.2.7's category (standing · fuel & tolls ·
  advances · other) from the same `CASE` that report uses, **source beating
  label**, so the two screens cannot categorise one line two ways.

- **Signs are the ledger's, not a chart's.** Deductions stay negative as stored;
  §6.2.7 flips them because four negative slices are unreadable, and this report
  does not flip them because a transactions list is read down to a net. The
  foot sums to what the statements netted — which is the agreement test.
- **Exportable** through the §7.1.5 route as grid `reports.transactions`: codes
  not labels, cents as decimals, every page of the filter.
- **The window is the picker's** (§6.2.7's rolling picker), bounding the
  statement's period end, and the driver filter is a chip. The report never
  invents a line: a statement with no lines contributes nothing, and a VOID
  statement's lines are excluded because the statement was struck.
- **Agreement test, to the cent:** for every driver in the window, the sum of
  this report's rows equals the sum of `netCents` over that driver's non-void
  statements whose period ends in the window — both sides seeded above zero,
  with at least one line of each of the four kinds.

**5 — Salary report.** Totals per driver per period — gross / deductions / net —
by company, exportable. `reports.driver` is the half that exists (driver, weeks,
gross, deductions, net, with CSV); per-period rows and the company cut are what it
is missing. _Specified 2026-10-06, before the code:_

- **One row per driver per settlement week per authority.** The period is the
  statement's own `periodStart`; a day-grain preset (Last 7 days) still shows
  weeks, because nothing is settled by the day. Newest week first; the §7.1
  totals row foots every money column; the authority chips narrow the rows.
- **Counted by the STATEMENT's status — APPROVED or PAID — not the batch's.**
  `driverTotals` read `SettlementBatch.status IN (FINAL, PAID)`, which was the
  same rule while a batch was either all draft or all final. Part 3 made PARTIAL
  real: a half-posted week carries approved statements that are already
  somebody's pay, and a batch-keyed rule hid them until the last one posted. The
  join also left out every statement the single-statement engine issued
  (§6.2.2's workbench), which has no batch at all. A DRAFT still contributes
  nothing — it is recomputed on every refresh. **§6.2.9's sparkline moves to the
  same rule in the same commit**: "what this driver has been paid" cannot have
  two answers on two screens.
- **The two engines fill the header under different names AND signs, and the
  reader reconciles them in one CASE.** The batch engine writes the driver's pay
  to `earningsCents`, the add-backs to `otherPayCents` and a NEGATIVE
  `deductionsCents` (`grossCents` on its rows is the linehaul the percentage was
  taken of); the workbench engine writes the pay to `grossCents`, the add-backs
  to `reimbursementsCents` and a POSITIVE `deductionsCents`, and never touches
  the other three. `batchId IS NULL` names the engine. The report shows
  deductions NEGATIVE — the ledger's sign, as part 4 does — so on every row
  gross + other pay + deductions = net, whichever engine wrote it. _Unifying the
  columns so the CASE can go is a GAPS.md item; the old report did not have the
  problem only because it never showed a workbench statement._
- **The window is the statement's `periodEnd`**, as part 4's report counts it,
  so the two cuts of one screen agree on which weeks are in. **A removed
  driver's weeks stay**: this is what was paid, and `driverTotals` dropped them
  with `d."deletedAt" IS NULL`, which made a total shrink when a driver left.
- **Seven columns** — driver · authority · week · gross · deductions · other pay
  · net. Other pay is shown because §6.2.9 already had to say the three are not
  an equation without it; with it they are. Exportable as `reports.driver`
  through the same window the screen reads, replacing an export that sent the
  statements list instead.
- **Agreement test:** on every row gross + other pay + deductions = net; per
  driver the net equals that driver's issued statements to the cent, both sides
  above zero, both engines present; and a draft week inside the window — whose
  existence the test asserts first — appears in neither.

**6 — Driver type on the record, on trip rows, on statements.** Company driver or
owner-operator. `Driver.employmentType` already holds
`OWNED ǀ LEASED ǀ OWNER_OPERATOR` — an ASSET ownership enum on a person, where
"company driver" is spelled `OWNED`, which is why it appears nowhere a reader
would look for it. A person's employment is not a truck's title, and the two
reading alike is the reason this needs saying. _Specified 2026-10-06, before the
code:_

- **The word is the office's, from `drivers.employment.*`, keyed by the enum
  value** — company driver · lease operator · owner-operator — and it is the
  same word at every site because the key is built the same way: the batch
  picker (part 1), the statement header, and now the record and the statements
  grid. No second mapping anywhere.
- **On the record**: beside the name in the header, as a word. It was only inside
  the edit form, where it is a select — and a select is where you change a
  thing, not where you read it.
- **On trip rows**: the batch picker's column (part 1). A statement's trips are
  one driver's, so the type is said once in the statement header rather than on
  every row.
- **On statements**: `/payroll/statements` gains a `driverType` column,
  DEFAULT-HIDDEN behind §7.1.4's chooser because the grid is at §7.1's nine;
  sortable, and NOT funnel-able. The funnel matches the stored value (so that a
  filter works in every locale), and a funnel that wants `OWNED` typed for a
  company driver is the exact failure this part names. It gets a funnel when
  the enum gets its name.
- **THE STATEMENT SHOWS THE DRIVER'S CURRENT TYPE, AND THAT IS A FLAG, NOT A
  DECISION.** §6.2.2 freezes the unit, the payee and the tariff label beside the
  number; the type is not frozen, so a driver who converts in June relabels
  January's statements. The frozen copy is a column — `Settlement.driverType`,
  written by both engines at generation — which is migration 66, and the
  deploy order's step 5 holds every new migration behind the production
  dispatch that 64 and 65 are waiting on. This part makes nothing worse: the
  statement header read the live row before it too. _Migration 66 prepared
  2026-10-06, the same day, once 64 and 65 were on production: the column is
  NULLABLE, both engines write it at generation off rows they already read,
  and every reader takes the frozen copy first and the live row only where
  the copy is null — a statement issued before 66 keeps saying what it said._
- **The driver's type has its own name — migration 70.** `Driver.employmentType`
  was an `OwnershipType`, a truck's title on a person, with "company driver"
  spelled `OWNED`. It is `Driver.driverType`, a `DriverType`: `COMPANY_DRIVER ǀ
LEASE_OPERATOR ǀ OWNER_OPERATOR` — the three words the industry says about
  people, which the screens already printed and the column could not. The
  frozen copy on the statement (66) and the standing charge's scope string
  (§6.2.4) carry the same words; `OwnershipType` stays on trucks and trailers,
  where `OWNED` is the plain truth. **The value is seeded from the export, not
  mapped from the old column.** _Owner's instruction, 2026-10-06._ Dev showed 103
  owner-operators to 64 company drivers and the office's screen showed mostly
  company drivers; compared per driver against the Datatruck export's own
  `Driver Type` column (joined on `externalId`), **56 of 167 disagreed** — one
  rule, inverted: 49 the office calls company drivers on 85–100% tariffs were
  stored owner-operators, 7 it calls owners on 30–60% were stored company
  drivers. The seed's tariff threshold had contradicted the office's column for
  a third of the roster. So migration 70 takes the export's word where the
  export knows the driver (170 ids, generated into the migration from the
  artefact rather than typed), the old value only where it does not, decides
  every driver's landing value before the retype and asserts it after; the
  drivers the export does not know are listed for GAPS.md by
  `scripts/driver-type-gaps.mjs`, which reads the id list back out of the
  migration so there is one source. The frozen copy on a statement (66) is
  mapped by its old value: it records what the statement said. The importer's
  planner now prefers the export's column and falls back to the tariff only
  where the column is blank. **And the funnel arrives**: the
  `driverType` column on `/payroll/statements` is funnel-able now, because
  `company`, `lease` and `owner` each match the stored word — which is the
  condition this part set for it.

**7 — Driver Pay in Datatruck's shape** _(owner's brief 2026-11-17, Uktam's
daily tool; `DRIVER-PAY-BRIEF.md` maps the four screens,
`corpus/datatruck-driver-pay-2026-11-17-*.png`, and §6 there holds the
seventeen rulings as made the same day)._ Shape and workflow only: the engine's
money rules do not move, and every figure is a stored `Settlement` column or a
sum of them. Step 1 is the status words and the Batches list; Create, the
batch screen and the statement page are later steps, each amending this part
before its code.

- **The office's words, from ONE function.** `src/lib/pay-status.ts` maps every
  stored status to its word and its tone, and every payroll screen reads it —
  the Batches list, its pipeline strip, Driver statements, the batch screen and
  the statement page. Nothing is renamed in the schema; `deriveBatchStatus`
  does not change.

  | stored (statement) | word     |     | stored (batch) | word           |
  | ------------------ | -------- | --- | -------------- | -------------- |
  | `DRAFT`            | Unposted |     | `DRAFT`        | Unposted       |
  | `APPROVED`         | Posted   |     | `PARTIAL`      | Partial posted |
  | `PAID`             | Paid     |     | `FINAL`        | Posted         |
  | `VOID`             | Void     |     | `PAID`         | Paid           |

  A test walks every value of both enums, so a status added to the schema and
  not to the map fails by name rather than rendering an empty badge. The verbs
  follow: the batch's Finalise is **Post all unposted** (`finaliseBatch`
  unchanged — it posts every statement still in draft), and a statement's
  approve is **Post**.

- **No "Change status" control (R7).** A batch's status is derived from its
  statements and is never set by hand — part 3, reaffirmed. The list's
  selection bar and the batch's header carry **Post all unposted** and **Mark
  paid**, each through `finaliseBatch` / `markBatchPaid`, refusing per batch by
  name as before.

- **Delete, while Unposted (R6).** `deleteBatch` refuses a batch with any
  Posted or Paid statement, by name (`batch.error.posted`). Otherwise, in one
  transaction: its draft statements are deleted (their lines cascade, as
  `refreshDraft` deletes them), its exclusions are deleted, and the batch is
  soft-deleted (`deletedAt`), so its trips are available again and its week
  can be opened again. The batch number is not reissued: a gap in the SB-
  series is the record that a batch existed. A void statement stays where it
  is, as history. Offered on the list's selection bar; the server decides.

- **Columns (R4, R5): Batch ID · Status · Created by · Created date · Check
  date · Period · Settlements · Amount · Authority**, nine shown, with gross,
  deductions and notes a tick away in the chooser (§7.1.7). This reverses
  `list-columns.ts`'s "not gross, deductions or amount" by the owner's ruling:
  Datatruck's list has neither, and Amount stays shown.
  - **Created by is read from the audit row, not stored.** `audit.ts` audits
    every write to `SettlementBatch`, so the batch's `AuditLog` CREATE row names
    the user; a scalar subquery in `batchRowsSql` reads it (the
    `(organizationId, entityType, entityId)` index), no migration. A batch
    created with no user in context prints "—".
  - **Authority is the batch's own company** (`SettlementBatch.companyId`,
    since part 1), and "All authorities" where it is null — the org-wide
    batches opened before R2. The 2026-09-28 note that this column is always
    "all authorities" described the schema before part 1; the breakdown rows
    under each batch stay.

- **One Payroll tab strip (R10): Batches · Driver statements · Balances ·
  One-time charges**, over the routes as they are — `/payroll/batches`,
  `/payroll/statements`, `/payroll/batches?tab=balances`,
  `/payroll/charges?tab=oneTime`. Tabs the role cannot read are not shown
  (the three after Batches are `driver.pay`). Scheduled payments stays inside
  Charges.

**Step 2 — Create batch** _(rulings R1, R2, R3 and the overlap ruling,
2026-11-17; `corpus/datatruck-driver-pay-2026-11-17-create.png`)_.

- **A free date range (R1).** From and To are typed, pre-filled with the LAST
  FULL settlement week (Sunday–Saturday, the week before the one today is in —
  11/08–11/14 on 11/17, as the screenshot shows), not the week that is due.
  `openBatch` accepts any period of whole UTC days whose start is on or before
  its end (`isBatchPeriod`), and refuses anything else by name
  (`batch.error.badRange`); `finaliseBatch` holds a batch to the same test.
- **NO OVERLAP PER AUTHORITY — the overlap ruling.** The deductions engine
  takes every weekly charge (insurance, escrow, standing charges) ONCE PER
  STATEMENT, whatever the period's length, and that rule does not move. Trips
  cannot be settled twice (`alreadyInBatch`), but charges could: two batches
  for RAM over 11/08–11/14 and 11/10–11/16 would each take RAM's weekly
  insurance. So `openBatch` refuses a period that OVERLAPS a live batch whose
  scope overlaps — the same authority, or either side org-wide — by name, and
  hands that batch back so the screen links to it. Two authorities may share
  dates freely. This replaces "one batch per period", which matched only an
  identical start.
- **What the week's four dependents become.** Statements are numbered from the
  series, not the week (`settlement-number.ts` never read it). The check date
  is `checkDateFor(period)` — range end + 13, unchanged. Standing charges are
  "in force at any point in the period" (`inForce`), unchanged. `recentWeeks`
  and the Batches page's week strip find a batch by its start; a batch whose
  range is not a week is on the list and not on the strip.
- **The authority is required (R2).** Create is offered only with an
  authority chosen; with none the line above the grid says so and the button
  is off, and the action refuses an empty one by name
  (`batch.error.noAuthority`). Org-wide batches opened before this ruling
  stay readable and are still counted by the overlap test.
- **The grid (R3).** Driver pay per trip is already the engine's (`payFor`,
  the function that will settle it, §6.2.10 part 1); its column is headed
  **Driver pay**. The freight column stays **Load gross**: Datatruck heads it
  "Load pay", and §6.2.2's "freight is never called pay" is a rule of this
  document, so the word is flagged to the owner rather than changed here. Nine
  columns, unchanged.
- **The range bounds the DELIVERY DATE, labelled "Delivery date"** _(owner's
  rulings 2026-11-17, v11.26; MONEY-DESIGN §6 "Which period a trip belongs
  to")_. It said "the range bounds the POD" until the owner ruled the same day:
  a trip is placed by the last drop's actual departure, else the time its
  status reached Delivered (`deliveryDateOf`, one definition with a Prisma
  spelling and the preview's SQL spelling), and the POD date no longer selects
  trips — Amazon loads carry no POD of their own. A Delivered trip settles
  without waiting for its POD (the second ruling: a late broker POD would
  otherwise strand a trip behind the no-overlap rule). The picker gains a sixth
  group, **No delivery date** — Delivered, with neither source recorded — and
  "In transit" becomes **Not delivered**; the range's last day counts whole on
  the screen as in the engine.
- **Delivered earlier, not yet paid — the catch-up** _(owner's ruling
  2026-11-17, v11.27; MONEY-DESIGN §6)_. Any Delivered trip on no statement is
  eligible for the next batch of its authority, regardless of date: a batch
  drafts its range AND every earlier Delivered trip of its scope that no
  statement carries (`settleableUpTo`, "delivered on or before the end"). Create
  lists them as a **second group** under the range's grid, by name, ticked by
  default, in the same form, so an untick is an exclusion like any other. The
  picker reads them however old (`catchUpWhere`, beside its fourteen-day
  window) so nothing is drafted that the screen did not list. **The no-overlap
  rule applies to the range, not to these**: the statement fence is what keeps
  a caught-up trip from being paid twice. "Outside the range" now means after
  it only. A trip with no delivery date is not "earlier" and stays in No
  delivery date. Every reader of the engine's batch input sees the catch-up too:
  the batch screen, the payroll week's blockers strip and the money screen's
  Ready figure.
- **The carry-over floor: the payroll cutover** _(owner's ruling 2026-11-17,
  v11.28; MONEY-DESIGN §6; migration 74)_. "Delivered earlier, not yet paid"
  reaches back to the organization's **payroll cutover date** and no further;
  a trip delivered before it never carries over. It is one date for the
  organization, `Organization.payrollCutoverDate`, set on **Settings → Payroll**
  above the per-authority forms, by OWNER and ADMIN (`organization:update`),
  empty meaning the default. The audit extension records every change with its
  from and to. **The default is per authority**: the start of its earliest live
  Zebra batch (an org-wide batch counts for every authority), else today. So an
  authority's first batch carries nothing over unless the date is set.
  `readCarryOverFloor` reads it in one statement (`carryOverFloorSql`, also a
  CTE in the batch screen's one-statement head). **The floor bounds the
  carry-over, never the range**: the engine drafts from the earlier of the
  range's start and the floor. The picker gains a seventh group, **Delivered
  before payroll cutover**, so a trip the floor keeps out is listed by name
  rather than vanishing. "Delivered outside the range" reads **Delivered after
  the range**.

**Step 3 — The batch screen** _(owner's brief 2026-11-18; rulings R8, R11, R12,
R13, R14 of 2026-11-17; `corpus/datatruck-driver-pay-2026-11-17-batch.png`)_.
`/settlements/batches/[id]`. Part 2b's order is reversed: Datatruck leads with
the statements and so does Zebra now. The engine does not move —
`batchInputForOrg`, `computeBatch`, `refreshDraft`, `finaliseBatch` and
`markBatchPaid` are called as they are — and **every figure on the screen is a
stored `Settlement` column or a sum of them.** Nothing is priced on the page.

- **Top to bottom:** the header (batch number, the office's word, period,
  authority) with the actions; the blockers by name; the tabs and the
  statements table beside the right rail; held lines and negative nets. The
  blockers and held lines stay: they are the engine's own refusals about
  somebody's wages, and Datatruck's lack of them is not a reason to hide them.
- **Tabs: All · Unposted · Posted · Paid** (`?tab=`), each with its count,
  filtering the statements by stored status through `pay-status.ts`'s words:
  Unposted is `DRAFT`, Posted `APPROVED`, Paid `PAID`. All includes a `VOID`
  statement, struck through as on every grid; no tab is Void's alone.
- **The table: Statement · Driver type · Truck · Payee · Status · Trips · Pay
  rule · Total pay · Total gross · Net pay.** Ten columns, so **Truck goes
  behind the chooser** (R11; §7.1.7's cap is nine) under the grid id
  `settlements.batch`, which is document-scoped and not exportable, like
  `settlements.trips`. Each is stored on the statement: the number (links to the
  statement in every status), the frozen `driverType`, `unitNumber`,
  `payToName` (else the driver's name), `status`, the load-line count,
  `payTariffLabel`, `grossCents`, `grossCents`, `netCents`. **Total pay and
  Total gross are the same figure, by R12 as reversed:** Datatruck prints both
  and the office reads both, so both are kept. Accounting is dropped (§8 of the
  brief: no Zebra concept). Money columns foot over the rows shown.
- **The right rail.** _General:_ created by (the batch's audit CREATE row, as on
  the Batches list), pay by (the authority), statement date, **week number**
  (R8, PROVISIONAL until a second batch confirms it: week 1 is the week
  starting the year's first Sunday, so 11/01/2026 is week 44; a period starting
  before that Sunday belongs to the previous year's count). _Totals:_ trips,
  statements, unposted / posted / paid counts, period, check date, then total
  gross, total pay, earnings, other pay, reimbursements, deductions, advances
  and net pay — each the SUM of that stored column over the batch's non-void
  statements. A void statement is history, not money.
- **Send (selected), posted only (R13).** The table's selection bar sends each
  ticked statement through `sendStatementToDriver`, one transaction per
  statement, as Post does on Driver statements. An Unposted or Void statement
  is refused by name (`not_final`, `voided`), as are no address and the dev
  guard. One email per driver; the refusals come back listed.
- **Post all unposted** is `finaliseBatch` (posts every draft; refused by name
  while a driver blocks), offered while any statement is Unposted — PARTIAL as
  well as DRAFT. **Mark paid** stays on a Posted batch.
- **Editable while any statement is Unposted.** Add driver, Add trip and Add
  deduction show only while the batch is DRAFT or PARTIAL, and each server
  verb refuses a batch that is not (`not_draft`), because a refresh rebuilds
  drafts only (part 3) and a posted statement is a document.
  - **Add trip** is part 2b's tick grid, unchanged — same reader, same Save,
    same delta — behind a panel that opens over the table.
  - **Add driver (R14 (b))**: re-include every trip of a driver this batch has
    excluded. The choice lists the drivers with an excluded trip on this
    batch; the verb (`includeDriver`) reads the batch's exclusions for that
    driver's loads and hands them to `includeTrips`, which refreshes. A
    driver with no trips this week (R14 (a)) waits for its own ruling.
  - **Add deduction**: a one-time charge per ticked Unposted statement's
    driver, the `SettlementCharge` the engine already reads — signed negative,
    `appliesOn` the batch's last day so it falls inside the period — then the
    draft is refreshed in the same transaction, so the statement shows it.
    `finaliseBatch` marks it settled as it marks every one-off. **The charge
    carries the batch's authority and batch id, and only a batch of that
    authority takes it** (owner's ruling 2026-11-18; MONEY-DESIGN §4;
    migration 75): the same driver in another authority's batch over
    overlapping dates is not charged twice. Deleting the batch deletes the
    charges added from it that no batch has taken, as it deletes its
    exclusions. It is not a
    `SettlementLine` added to the draft: a refresh rebuilds drafts, and a line
    added by hand would vanish at the next Save. Refused by name: no
    description, an amount that is not a positive figure, a statement that is
    not Unposted or not on this batch.
- **Delete, while nothing is posted (R6).** The header carries Delete when
  every statement is Unposted or Void (`deletableBatch`); `deleteBatch` decides
  on the server and refuses by name. Afterwards the screen goes to the Batches
  list.
- **Reads.** The new columns, the counts and the created-by subquery join part
  2c's one statement as more columns of the same CTEs; the stored column
  choice is one more CTE, as on the statement page. No new round trip.

**Step 4 — The statement page** _(owner's brief 2026-11-18; rulings R12,
R15, R16 of 2026-11-17, R16 reaffirmed 2026-11-18;
`corpus/datatruck-driver-pay-2026-11-17-statement.png`)_. `/settlements/[id]`.
§6.2.2's one dense header box becomes Datatruck's four cards and its stacked
grids become tabs. The engine does not move, and **every figure is a stored
`Settlement` column, a stored line, or a sum of them** — except RPM, a ratio of
two stored columns, computed by one function in `money.ts` and never stored.

- **The four cards**, across the top above the tabs; the net stays above the
  fold, which was §6.2.2's reason for one box.
  - _Settlement summary:_ driver (link) · settlement number ‹ › within the
    batch · period ‹ › for the driver · driver type (frozen) · authority ·
    unit · batch (link) · check date · the office's status word.
  - _Earnings summary:_ earnings · other pay / reimbursements · deductions /
    advances · net pay.
  - _Fuel & balances:_ balances (the escrow lines' sum) · fuel (burned, and
    what is already coming off) · tolls · pay rule (`payTariffLabel`).
  - _Trip summary:_ total pay · total gross (the same stored figure, by R12 as
    reversed) · trips · total miles · **RPM** — `ratePerMileCents(grossCents,
milesHundredths)`, half up on the cent, a dash when there are no miles
    (R15; Datatruck's $3.38 = $6,940.68 ÷ 2,055.77 mi).
- **Seven tabs, each with its count, a zero tab shown** (R16, reaffirmed by the
  owner on 2026-11-18 over the brief's "tabs with data only"): the strip is the
  same on every statement, so a zero reads as "Zebra looked and there is
  none". `?tab=`, Trips by default.
  - _Trips:_ the trips grid as it is, chooser and all, and Add trips under it
    on a draft.
  - _Fuel:_ the driver's fuel transactions in the period (date, vendor, place,
    gallons, total, on a statement or not), and the fuel deduction line when
    the statement took one.
  - _Toll:_ the driver's toll expenses in the period (date, vendor, amount,
    deducted from the driver or not), and the toll deduction line.
  - _Balances:_ the escrow lines — the batch's and any added by hand.
  - _Recurring:_ the batch's deduction lines that came from a rule
    (`recurringDeductionId` set), escrow aside.
  - _One-time:_ the batch's deduction and other-pay lines with no rule — the
    one-time charges the engine took — and the lines added by hand, with the
    add-row where one is allowed.
  - _Attachments & notes:_ the statement's documents (count, linked to
    Documents) and its notes.
- **The batch's deduction lines, shown for the first time.** A batch statement
  stores its deductions as `SettlementDeductionLine` rows; the page read only
  `SettlementLine` (lines added by hand), so a batch draft's insurance, escrow
  and one-time charges were in the header's figures and in no grid. The head
  reads them as one more CTE, with the fuel and toll rows, inside its one
  statement. Each kind goes to one tab by one function (`statementTabOf…` in
  `statement-tabs.ts`): Escrow → Balances; Fuel → Fuel; Tolls → Toll; a rule
  → Recurring; the rest → One-time.
- **The actions: Post · Add deduction · Send to driver · Download.** Post is
  `approveSettlement` (a draft, `settlement:approve`). Send to driver is
  `sendStatementToDriver` (posted only). Download is the statement PDF, a
  draft's watermarked, on every statement (§6.2.2). **Add deduction** on a
  statement in a batch, while it is Unposted, is step 3's verb for one
  statement — the batch's one-time charge, carrying its authority, then the
  draft refreshed — because a line added by hand to a batch draft is deleted
  by the next refresh. On a statement with no batch it stays the add-row
  (`addSettlementLine`), which nothing rebuilds. Recalculate, Mark paid and
  Void stay where they are.
  the trips left ticked sum to the batch's
  gross, and the salary report equals the statements it summarises. Same chart and
  strip rules as everything else (§6.1.1, §6.2.8's two kinds of figure).

**One migration carries the schema for parts 1–3** — `companyId`, the exclusion
table and the `PARTIAL` value — so the production step is ONE command for the
owner rather than three.

#### 6.2.9 Payroll: the pipeline strip and the figures on the lists — _added 2026-10-04_

**THE PIPELINE STRIP on `/payroll/batches`: draft, final, paid, as money.** Three
figures, three states, **AS OF TODAY** and labelled so — §6.2.8's balance rule,
because "how much pay is sitting in draft" is not a question about a period. Each
links to the batches list filtered to that status, carrying no period filter.

**THEY ARE A PIPELINE, NOT A PARTITION, AND THE ORDER IS THE POINT.** Draft is
being built and can still change; final is approved and unpaid — money the carrier
owes this week; paid has left the account. A figure that merged them would hide
the only one with a deadline.

**PER-BATCH GROSS, NET AND DEDUCTIONS ON THE BATCH LIST.** Three money columns
from the statement that already groups the batch's settlements — no extra query.

**AND THE THREE ARE NOT AN EQUATION.** `net = gross − deductions + reimbursements

- other pay`, so a reader checking `gross − deductions` against net will be out by
  whatever was added back. The columns are not placed to invite the subtraction, and
  §8's rules about labels apply: _Deductions_ is what came off, never "expenses".

**A NET-PAY SPARKLINE PER DRIVER ON `/payroll/statements`.** One row, one shape:
what this driver has been paid, settlement week by settlement week, so a week that
collapsed is visible beside the week that caused the phone call. §6.1.1's
sparkline, unchanged — no axis, no labels, the figure beside it is the number.

**THE SERIES IS THE DRIVER'S OWN HISTORY, NOT THE WINDOW'S.** A sparkline over
four points says nothing, so it runs over the last thirteen settlement weeks
whatever the picker shows — and that is a DELIBERATE exception to "the picker
governs everything below it", written here because it is the only one in the
product. The row's figures are the window's; the shape beside them is the
driver's. A week with no settlement is a GAP, never a zero: unpaid and
not-yet-settled are different facts, and §6.1.1 already refuses that zero.

**THE PICKER GOVERNS THE LISTS, BY THE DATE EACH LIST ALREADY SORTS AND FILTERS
ON** — the batch CHECK DATE, the settlement period start, the one-time charge’s
apply date. Each shape names it in `dateOf`, and the picker writes the same
`from`/`to` the removed range wrote, so the window means what the list already
meant by a date.

_This sentence said “by the batch’s period start” when §6.2.9 was written, which
is not what `batchShape` filters on: it is the check date, and the range this
replaces was labelled “Check date”. Corrected before the code rather than
silently built to match the doc or the doc quietly bent to the code._

**BATCHES KEEPS ITS WEEK PICKER AS WELL.** That control chooses which week a run
is FOR; the period picker chooses which runs are listed. Two questions, two
controls, and §6.2.1 settled that they are different.

**`/payroll/batches` IS FOUR STATEMENTS OF ITS OWN AND SEVEN STREAMED BEHIND
IT** _(owner's instruction 2026-11-14, the slow-pages chain on GAPS 42, before
the code; v11.01)._ Measured on dev before: 25 statements per request, median
page wall 5,571 ms as the owner and 5,378 ms as accounting. Two changes:

- **The page's own reads are ONE statement**, each read its own named CTE,
  §6.1.1 v10.97's shape: `week` (the chosen week's batch), `opened` (which of
  the offered weeks already have one), `batches` and `breakdown` (the grid and
  its per-authority rows, Batches tab only), `pipeline` (the strip, Batches tab
  only) and `columns` (the grid's stored column preference). Each CTE is the
  SQL text its own reader sends, so `readBatches` and `pipelineStrip` keep
  serving the export and the tests with the same SQL. The column memory's
  one-time legacy rewrite still writes, in the same transaction, only when the
  stored row is the old shape. The Balances tab keeps its own read.
- **The streamed blockers strip reads the gross half of the engine input**
  (`netPay: false`). A blocker is raised per load, from the load and the pay
  rule in force, and a held line from the load and its payments, so recurring
  deductions, escrow, opening balances, prior settlements, standing charges,
  fuel and tolls change neither list. They cost eight round trips on a strip
  that shows no net. A batch, which IS what somebody is paid on, still never
  passes false.

Target: 25 → 12 per request (shell 1, page 4 with BEGIN, `set_config` and
COMMIT, strip 7). Measured after on dev with `page.timing`, both roles.

**THE TENANT AND THE PAGE'S READ IN ONE ROUND TRIP — `/payroll/batches` FIRST**
_(owner's ruling 2026-11-14, "yes, carefully", before the code; v11.03)._ Every
tenant transaction pays three trips that are not the read — BEGIN,
`set_config`, COMMIT — about 200 ms each from the worker. They cannot be folded
by putting `set_config` beside the read in one statement: row-level security
reads `current_setting('app.current_org_id', true)`, a STABLE function, and
Postgres evaluates it when it chooses — the payroll plan shows it as One-Time
Filters run at executor start, before any sibling CTE — so a setting and a read
in one statement is a race the planner wins. Instead, migration 72 adds
`zebra_tenant_read(org_id text, sql text, args jsonb) RETURNS json`: plpgsql,
SECURITY INVOKER — it runs as `zebra_app`, without BYPASSRLS, so every policy
applies exactly as today and nothing about row-level security changes —
`search_path` pinned, EXECUTE granted to `zebra_app` alone. Its body is two
statements: `PERFORM set_config('app.current_org_id', org_id, true)`, then
`EXECUTE 'SELECT json_agg(q) FROM (' || sql || ') q' USING args`, a separate
statement planned after the setting exists. Sent outside BEGIN, the call is its
own implicit transaction, so the LOCAL setting ends when it returns: one round
trip, nothing left on a pooled connection. The read's text is built by Prisma
as now; its values travel in `args` and appear in the text only as typed casts
of `$1->n`, never concatenated. Wrapped as a subquery the text cannot write — a
data-modifying `WITH` must be top level. `assertOrgId` runs first, as in
`runInOrg`. Only the Batches tab's own read moves: the column memory's legacy
rewrite, the Balances tab and the streamed strip keep their transactions.
Target: trips 9 → 6, statements 7 → 5. **THE PROOF** is
`tests/integration/tenant-read.test.ts`, as `zebra_app`: two organizations,
each with batches and preferences; the page's read as A returns A's rows and
none of B's; a bare `SELECT count(*) FROM "SettlementBatch"` through the
function as A counts A's alone; an unknown organization reads nothing; and on
the same connection the setting is empty after the call. It is watched failing
with row-level security OFF on `SettlementBatch` (`NO FORCE` and `DISABLE`,
applied by the owner in the test's own setup under the break, restored after),
and with the function handed the other tenant's id.

**AND THE BALANCES TAB, IN THE SAME CALL** _(owner's ruling 2026-11-15, "one-call
reads continue: payroll Balances first"; v11.06)._ The tab's year of balances —
per driver, FINAL and PAID settlements summed, the `NET_PAY` opening balance,
the escrow held, deleted drivers left out — was three reads and a name lookup
inside a transaction. It is now `balancesSql`, one text that `readBalances`
sends for the export and the page's one call carries as a `balances` CTE, so
neither tab opens a transaction. Target: 8 → 5 statements. The proof is
`tests/integration/balances-sql.test.ts`: the text equals the Prisma reads it
replaced, kept in the test as the reference, on fixtures with a row on both
sides of every rule; the page's call carries the same rows; and through the
tenant reader as `zebra_app` the call is one statement and another
organization's settlement, opening balance and escrow appear in no row —
watched failing with the reader handed that organization's id.

#### 6.2.8 The summary strip on Invoices and Payments — _added 2026-10-04_

**Four money figures across the top, each one a LINK to the list it summarises.**
Invoices: open, overdue, factored. Payments: unapplied, with its count. A figure
nobody can act on is a notification; the link is what makes it a control (§10).

| figure    | what it is                                                  |
| --------- | ----------------------------------------------------------- |
| Open      | issued, not factored, balance outstanding                   |
| Overdue   | open, and past its due date                                 |
| Factored  | issued and SOLD — the factor collects it, so it is not open |
| Unapplied | money received that is not against an invoice yet           |

**FACTORED IS NEVER INSIDE OPEN.** §3.3 again: a sold invoice is the factor's
receivable. The three figures therefore partition the issued paper rather than
overlapping, and overdue is a SUBSET of open — stated on the strip, because
three figures that look parallel and are not is worse than four.

**STATUS CHIPS CARRY COUNTS, AND THE COUNTS COME FROM SQL.** The tab counts on
these screens were computed from the list reader's rows — `readInvoices` takes
2000 and `listPayments` takes 300 — so a count was right only while the business
was small enough not to need it. Any count on a chip or a tab is a `COUNT(*)`
over the same predicate the chip filters by.

**THE SAME PICKER AND CHIPS AS EVERY OTHER CHARTED SCREEN**, and they replace
the `from`/`to` range here as they did on Reports (§6.2.7): one window control,
never two.

**TWO KINDS OF FIGURE, TWO LABELS, NEVER MIXED.** _Owner's ruling, 2026-10-04,
resolving flag 49 — which recorded the opposite arrangement and the trade it
made._

| kind          | figures                                                      | label            | window       |
| ------------- | ------------------------------------------------------------ | ---------------- | ------------ |
| **A balance** | Open, Overdue, Factored (Invoices); Unapplied (Payments)     | _as of today_    | none         |
| **A flow**    | Invoiced in window (Invoices); Received in window (Payments) | _in this window_ | the picker's |

**A BALANCE IS NOT A PERIOD QUESTION, AND WINDOWING ONE HIDES THE WORST ROW IN
IT.** An invoice issued five months ago and still unpaid is the one somebody most
needs to chase, and a thirteen-week window made it invisible — in the figure, on
the screen whose job is to show what is owed. So the balances have no date bound
at all.

**AND THEIR LINKS CARRY NO PERIOD FILTER**, which is what keeps the agreement
honest: a figure with no window must open a list with no window, or the number
above the rows is not the number the rows add up to. `?period=all` is that state.
It is NOT a fifth preset — the picker still offers exactly four (v10.17) and
shows none of them active in this state; the reader leaves it by choosing one.

**THE FLOW FIGURE IS WHERE THE PICKER SHOWS UP ON THE STRIP**, so the control is
not decorative: it moves that figure, and it moves the list and the chip counts
with it. With `?period=all` the flow figure covers every date and says _all
dates_ rather than silently becoming a second balance.

**THE CHIP COUNTS DESCRIBE THE LIST, SO THEY ARE WINDOWED**, and they will
therefore differ from a balance above them — the unapplied chip counts this
window's payments, the Unapplied figure is every unapplied dollar. That is the
reason for the two labels: the only thing that makes two different true numbers
on one screen readable is saying which question each answers.

#### 6.2.7 Accounting → Reports: the charts — _added 2026-10-03_

Reports was three tables. It becomes the same three tables under four charted
sections, on §6.1.1's chart contract and §6.1.1's window.

**ONE WINDOW CONTROL ON THE SCREEN, AND IT IS THE ROLLING PICKER.** Last 7 days
/ Last 4 weeks / Last 13 weeks / Last 52 weeks, each ending with the current
settlement week, partial week drawn as far as today and marked, default Last 13
weeks (§6.1.1, v10.17). The picker and the authority chips are the SAME
components the dashboard uses — not copies. A second date control beside them
would be the two-window arrangement v10.16 revoked: one screen saying two
things, with nothing looking broken.

_This REPLACES the `from`/`to` range and the weekly/monthly toggle this screen
carried. Monthly grouping is no longer offered, because v10.17 makes grain a
property of the preset rather than a control — and a month that is not a whole
number of settlement weeks cannot be drawn on an axis aligned to them. A
removed control is recorded rather than quietly dropped: `PHASE-5-BRIEF.md` §7
flag 45._

**BY COMPANY** — weekly bars per authority: gross, driver pay, after driver pay,
with the hatch for a bucket whose pay was never recorded (§6.1.1). The matrix
table stays underneath, totals row included: the chart answers "which way is
this going" and the table answers "what exactly", and neither replaces the
other. Closed history is INCLUDED in gross here and excluded everywhere else,
which is item 7's rule and the reason this page exists.

**The breakdown by authority is closed by default** _(amended 2026-11-07,
owner's ruling on dev, round five)._ The per-authority charts and the matrix —
on the By authority and By week tabs alike, which are the same breakdown
ordered two ways — sit behind §6.3's **Show breakdown** control, open for the
current view only and never persisted. The receivables and settlements
sections name no authority and stay where they are.

**RECEIVABLES** — two charts.

1. The aging stacked bar, 0–30 / 31–60 / 61–90 / 90+, the SAME component and
   the SAME reader as §6.1.1's Cash panel.
2. Invoiced vs collected per week.

**FACTORED PAPER IS ITS OWN SERIES AND IS NEVER INSIDE COLLECTED.** A factored
invoice is sold — the factor collects it — so it is neither a receivable (it is
out of the aging bar, §3.3) nor money the carrier collected. For the same
reason COLLECTED excludes payments whose method is a factoring method: counting
a factoring advance as collection, beside the invoice it advanced against,
double-counts the same freight.

**SETTLEMENTS** — paid-per-week bars, gross against net, over batches that have
been PAID; and a deductions-by-category donut for the window.

**THE FOUR DEDUCTION CATEGORIES ARE ASSEMBLED, NOT STORED, AND THE PRECEDENCE
IS PART OF THE CONTRACT.** `SettlementDeductionLine` has no category column: it
carries a printed `type` label and the id of the rule or one-off that produced
it. So the four buckets are derived, in this order, first match winning:

| bucket           | rule                                                       |
| ---------------- | ---------------------------------------------------------- |
| Standing charges | `recurringDeductionId` matches a `StandingCharge`          |
| Fuel & tolls     | `type` is `Fuel` or `Toll`                                 |
| Advances         | `type` is `Advance`                                        |
| Other            | everything else — insurance, escrow, equipment, violations |

Precedence matters because the categories overlap: an org-wide fuel charge is
both standing and fuel, and a donut whose slices overlap is not a share of
anything. SOURCE BEATS LABEL, because "what did the organization's own rules
take off these cheques" is the question somebody asks of this chart.

**ONLY NEGATIVE LINES.** `totalCents` is signed and Other Pay shares the table;
a donut of "deductions" that included reimbursements would net two opposite
things into one slice.

**EVERY FIGURE TIES TO THE CENT TO THE SCREEN IT SUMMARISES** — invoiced to the
invoices list, collected to the payments list, paid-per-week to the batches
grid, aging to the Cash panel — and there is one agreement test per figure with
both sides seeded above zero. A test where both sides are empty agrees about
nothing, which is the most comfortable way to be wrong.

**THE CHARTS DO NOT READ THE LIST READERS, BECAUSE THE LISTS ARE CAPPED.**
`readInvoices` takes 2000, `listPayments` takes 300, `directAging` takes 500. A
52-week aggregate built on a reader that stops at 300 rows is wrong exactly
when the business is busy, and silently. So the charts aggregate in SQL and the
agreement tests hold over a window where the list is not truncated — which is a
real limit of the claim above, stated here rather than discovered later.

**ONE AGING RULE.** `agingBucketFor` in `factoring.ts` is the authority — a
bucket boundary is `daysPastDue <= 30`, inclusive — and any SQL expression of
it must agree at the boundary, with a test that seeds 29, 30, 31, 60, 61, 90
and 91 days past due. The dashboard's panel statement was off by one against it
until 2026-10-03; see flag 46.

**NO NEW CHART COMPONENT.** `BarChart` carries the weekly money bars, the
invoiced/collected bars and the paid-per-week bars; `Donut` carries the
deductions; the aging bar becomes a shared component extracted from the Cash
panel. `Sparkline` is not used on this screen — a figure here always has its
bars beside it, so a second shape of the same series would be decoration.

**EMPTY KEEPS THE AXIS AND THE LEGEND**, per §6.1.1, on all four sections.

### 6.3 Company filter

_Amended 2026-07-29. This section previously described a company **switcher** — a
modal control that put the interface into one authority at a time. That was
wrong, and wrong in a way that would have shaped every screen built on top of
it. Reason for the change: a dispatcher's actual question at 6am is "what is
running today", across all authorities the group operates. A mode forces them
to ask it twice and then hold the answer in their head. Worse, a mode makes
"which authority am I in" a piece of hidden state, and hidden state is exactly
what produces the outcome this section already warns about._

The topbar company control is a **filter**, not a mode. A user sees every
authority they are scoped to at once; the control narrows the view.

- Tables gain a company column and a per-company colour chip **only when the
  organization holds more than one company** (`maxCompanies > 1`). A
  single-authority organization sees none of this — no filter, no column, no
  chip.
- Creation forms take the operating authority as their **first field**,
  defaulting to last-used. The authority is an explicit, visible choice at the
  moment of writing, not an ambient setting that was decided earlier and
  elsewhere.
- **A destructive or financial action taken under the wrong authority is still
  the worst outcome this interface can produce.** The filter does not prevent
  that; the required first field does. Which is the point of moving the
  decision into the form.

**The authority filter is a DROPDOWN, and the authorities are never listed on
screen unless the user opens it.** _Owner's ruling on dev, third round,
2026-11-06. The reason, recorded because it is the whole rule: someone beside
the owner's screen must not read the list of companies._ A chip row names
every authority the viewer is scoped to, all the time, on every screen that
carries it — the dashboard, the three financial lists, the batch form, the
loads board, the accident register — and the list of a group's operating
authorities is not a thing a visitor, a driver at the counter or a camera
behind the desk should be handed for free. So:

- **Closed, the control shows `Authority: All`** — or the one selected name,
  and nothing else. No names, no counts, no chips.
- **The authorities appear only while the control is open**, as the options
  of a native `<select>`: the browser draws the list on demand and takes it
  away on blur, and nothing stays on the page.
- **One component, `AuthorityFilter`, on every screen**, including /loads,
  where the authority used to be a chip group inside the filter bar, and the
  accident register, where it used to be a row of links. A second
  implementation is a second place to list them.
- **The URL contract does not change.** `?company=` is still the key, All
  deletes it, every other parameter is preserved (`?view=`, `from`, `to`,
  `q`, `ref`), and a bookmark that carried the key still narrows.
- **Counts, where a screen has them, go INSIDE the options** — `RAM Haulage
(12)` — never beside the closed control, which would be the list again in
  numbers.
- **A single-authority organization still sees nothing**, as before.
- **A row's own authority is data, not this list.** The company column a
  table gains under the first bullet above stays; it names the authority of
  the freight in front of the reader, not the set of authorities the
  organization holds. The column funnel on it opens on demand like the
  dropdown does.

**A breakdown by authority is CLOSED BY DEFAULT.** _Owner's ruling on dev,
round five, 2026-11-07, closing the item that stood here open since v10.76._
The by-authority donut on the dashboard (§6.1.1) and the company cut of
Accounting → Reports (§6.2.7) — the per-authority charts and the matrix, on
the By authority and By week tabs alike, which are one breakdown ordered two
ways — name every authority with money beside each, and that is the list the
dropdown stopped showing, with figures attached. So each sits behind a **Show
breakdown** control:

- **Closed by default, and nothing of the breakdown is in the document while
  closed** — absent, not hidden with CSS, by the same rule that keeps a field
  a role cannot see out of the payload.
- **Open for the current view only, never persisted.** Component state and
  nothing else: not the URL, so a link somebody sends does not open it for the
  next reader; not a preference row or browser storage, so a reload or the
  next visit starts closed. A breakdown that remembered being open would be
  opened once and shown for ever.
- **One component, `Breakdown`,** on both screens. The by-customer donut and
  the receivables and settlements sections are not authorities and stay as
  they are.

**THE PLAN'S AUTHORITY CAP COUNTS WORKING AUTHORITIES ONLY; A RETIRED ONE
NEVER COUNTS.** _Owner's ruling 2026-11-21. Dev's Authorities page read "5 of
5 used" with three of the five Retired — AG FREIGHT INC, American Soldier
Transport, Midwest Global Logistics, placeholders with no MC and no DOT that
exist only to hold imported Datatruck freight — so the group could not add
the authority it runs under next._

- **`maxCompanies` is spent by authorities that are not `retired`.** A
  deactivated authority is still the group's own and still counts; reactivating
  it makes nothing new. The "{used} of {limit} used" line on /companies counts
  by the same rule as `addCompany`'s refusal, so the number the page shows is
  the number the refusal reads.
- **A retired authority may be removed permanently by the OWNER, and by no
  other role**, when it has no MC number, no DOT number and has never had
  anything filed under it — no loads, no drivers, no trucks, no assignment
  period, nothing `companyUsage` counts. A retired authority with a number is
  a real carrier's record and stays. An ADMIN keeps removing a working
  authority entered by mistake, as before. The check runs inside the delete's
  own transaction, and the delete is the audited extension's `Company` DELETE
  row naming who.
- **The Remove permanently control is absent, not disabled, where the rule
  refuses**, as it already is for an authority with history.

**SAVING AN AUTHORITY RETURNS TO THE LIST, SAYS SO, AND THE LIST SHOWS IT.**
_Owner's report 2026-11-21: edit an authority, Look up (FMCSA fills the
fields), Save — the page flashed, the FMCSA panel vanished and the form stayed
open, so nobody could tell whether it had saved. It had: dev's audit log holds
five such saves that day with every field. What failed was the answer, not
the write._

- **Save persists every field the form shows** — name, legal name, MC, DOT,
  address lines, city, state, ZIP, phone, email. One list of the form's
  fields, `COMPANY_FORM_FIELDS`, is what the form renders, what both actions
  read (`readCompanyForm`) and what the edit page loads back
  (`companyFormValues`), and a round-trip test saves and reloads every one.
- **A successful edit lands on /companies with a "Saved" notice** naming the
  authority (the quiet success toast), and the row shows the new MC and DOT.
  A refusal stays on the form with its sentence, as before. Saving from a
  Transfer dialog's "+ Add authority" still returns to that record (v11.35).

### 6.4 Drivers take Datatruck's shape — _added 2026-10-07_

Queue item 16, the owner's brief (`docs/QUEUE.md` §16), three parts: the list,
the record's tabs, team drivers. This section is written part by part, each
before its code. Where the brief meets a ruling already in this file, the
ruling wins and the brief's wording is answered rather than obeyed.

**1 — The list.** `/drivers` on the grid machinery every Accounting list already
runs on: `readGridColumns` with the §7.1.4 chooser, `gridView` for filter → sort
→ paginate, the funnels, the §7.1.2 footer, saved views (§7.4). _Specified
2026-10-07, before the code:_

- **Five tabs over one grid (§7.1.6), each a different question:**
  **Active** — the roster at work: not removed, not `INACTIVE`, not `VACATION`.
  **Unassigned** — Active with no truck: the dispatcher's own question.
  **All** — every roster row that is a person, whatever their state; a REMOVED
  row (`deletedAt`) is a mistake and not a person, and stays behind the
  existing toggle rather than in a tab.
  **Terminated** — `INACTIVE`, with the termination date as a column.
  _Leaving Terminated opens an assignment period, amended 2026-11-20 (owner's
  ruling, GAPS 48, v11.39, before the code):_ a driver set from `INACTIVE`
  back to any working status — on the record form or the bulk bar — gets an
  open `AssetAssignment` period under the driver's own authority IN THE SAME
  WRITE, dated the moment of the change, unless one is already open. Without
  it the driver is active with a `companyId` and no period: `currentAuthority`
  answers nothing, and `findAuthorityDrift` — which skips `INACTIVE` drivers
  and no one else — reports them. On 2026-11-19 three reactivations on dev
  failed every CI run and a production dispatch that way. A termination does
  not close the period; that is unchanged.
  **Vacation board** — `VACATION`, or an off-duty return date still ahead, with
  the return date as a column. The tab is in the URL, first tab default, each
  tab counted by a `COUNT(*)` of its own question (§6.2.8), never by the length
  of a capped list.
  _The tab's date column fits inside the cap, amended 2026-11-17 (safety team
  on dev, v11.30, before the code):_ the chooser lets a person show nine
  columns, the default for a multi-authority carrier IS nine, and Terminated
  and Vacation added their date as a tenth — so `Table` refused the render
  ("A table may show 9 columns at most; this one has 10") and both tabs
  answered 500 for every such person. The cap stays nine (§7.1.7; raising it is
  the owner's ruling, not a fix). **The date column takes a seat, it does not
  add one**: when the chosen set is already full it takes the place of **Last
  activity** — the one column that answers the same question less well on
  those two tabs — and if that is not shown, of the last chosen column before
  Warnings. The name stays first and Warnings stays last. `fitTabColumn` in
  `driver-list.ts` is the rule, the page passes the grid's cap to `Table`, and
  the sweep fetches `/drivers?tab=terminated&per=500` and the Vacation tab
  beside the plain list.
  _Three tabs, a search box and two filter chips, amended 2026-11-19 (owner's
  ruling, Islom; v11.38, before the code; supersedes the five tabs above):_
  **Active** — every person still employed: not removed, not `INACTIVE` (so a
  driver on `VACATION` is Active). **Inactive** — `INACTIVE`, with the
  termination date as its column; this is what "Terminated" was, renamed.
  **All** — every roster row, as before. Active and Inactive together are All.
  **Unassigned** and **Vacation** are no longer tabs: they are **filter
  chips** in the chip row, each narrowing whichever tab is open —
  _Unassigned_ is a working driver with no truck, _Vacation_ is `VACATION` or
  an off-duty return date still ahead (Vacation brings the return-date column
  with it). Each chip is counted inside the open tab; the tabs are counted by
  `COUNT(*)` as before. A **Search** box in the toolbar matches a driver's
  first or last name, phone or assigned truck unit — every word typed must
  match one of them — and the tab and chip counts honour it, so a number never
  describes rows the search has hidden. Old links still open: `?tab=terminated`
  reads as Inactive, `?tab=unassigned` and `?tab=vacation` as Active with that
  chip. The §6.8 sweep fetches `/drivers?tab=inactive&per=500` and
  `/drivers?only=vacation&per=500` in their place.
- **Ten columns, named by the brief, inside §7.1's cap (§7.1.7):** name · assign
  status · driver type · status · last activity · authority · phone · email ·
  truck · warnings — eleven with the CDL column that already exists. Email and
  CDL are DEFAULT-HIDDEN behind the chooser; warnings is never hidden; the
  authority column appears only with more than one authority (§6.3). The
  Terminated and Vacation board tabs swap in their date column.
- **"Employee status" is not a second column.** The brief lists it beside
  "driver status"; the owner's ruling of 2026-09-21 is ONE status per row,
  because two columns were two answers to one question. Here the tab IS the
  employee status — Active, Terminated, Vacation board — and the one badge keeps
  its rule: the derived dispatch status, except where the roster says something
  the freight cannot know. On All, where the tab says nothing, the badge says
  it. _Flagged as the brief's wording answered, not obeyed._
- **ASSIGN STATUS — Ready to go / Not ready — is DERIVED on read and never
  stored.** A driver is ready when they are qualifiable (§6.2's DQF rule: on the
  roster, not a referral payee), their DQF has nothing missing or expired, a
  truck is assigned, and that truck carries no expired compliance. "Not ready"
  NAMES THE FIRST REASON in words beside the badge — DQF, no truck, truck
  expired — because a red that does not say why is a red people learn to
  ignore. One pure function, `readinessFor`, in `src/lib`, with both branches
  tested; the facts come from the two loaders the page already runs once for
  the whole list, plus the trucks' compliance read once for the trucks on the
  page.
- **Filters stay chips (§7.4):** needs attention, the dispatch status, the tag,
  the company filter; the funnels (§6.2.1) on type, authority and truck write
  `f.<key>` like every other grid; the search box matches name, phone and
  email.
- **Bulk actions are ROSTER actions only:** checkbox selection, then Mark active ·
  On vacation · Terminated — the three values the form offers (owner's ruling,
  2026-09-21), written per driver through the one edit function and refused on
  a removed row. Nothing bulk touches freight, pay or compliance.
- **Saved views are per grid.** `view.loads` becomes one key of several; the
  component and its actions take the grid, and `/drivers` saves under
  `view.drivers`. Twelve per user, as before.
- **Export is NOT built in part 1, and that is flagged.** §7.1.5's export is the
  Accounting contract — one shared reader, codes not labels, every page of the
  filter — and §7.1.7 kept `/loads` and `/trucks` out of it for lacking that
  reader. `/drivers` lacks it too, and a drivers-only exception would be a second
  definition of what a list export is. The three operational lists get their
  export together, as one decision, or not at all.
- **Import file is NOT a screen in part 1, and that is flagged.** The Datatruck
  driver import exists as `scripts/seed-datatruck-drivers.ts`, preview by
  default, run by a person with the export in hand. The loads import was a
  screen and was removed as a destination because it read the wrong file for
  most of what the office imports; a drivers file picker would repeat that
  precedent before anybody has asked what file it would read.
- **The page reads 500 rows, not 200, and says so in the footer** when the
  filter selected more: warnings and readiness are computed, so there is nothing
  to page in the database, and a list that silently showed 200 of 240 drivers
  on All was the kind of cap this section replaces with a stated one.

**`/drivers` IS SIX STATEMENTS** _(owner's instruction 2026-11-14, the
slow-pages chain on GAPS 42, before the code; v11.02)._ Measured on dev before:
21 statements per request, median page wall 4,580 ms as the owner and 4,550 ms
as dispatcher. On dev every statement costs one round trip of about 200 ms
whatever it asks — the payroll page's one-row statement plans in 2 ms, runs in
8 ms and takes 208 ms on the wire — so the count is the wall. The page's one
transaction makes three reads:

- **The head, ONE statement:** the authority count, the five tab counts, the
  five data-health counts and the three preference rows (the grid's columns,
  `view.drivers`, density), each its own CTE. A tab's count is still a
  `COUNT(*)` of that tab's own question (§6.2.8), now one `FILTER` per tab
  from `driverTabSql`, beside `driverTabWhere` in `src/lib/driver-list.ts`;
  an agreement test holds the two equal for every tab, with and without
  removed rows, scoped and unscoped. Health is `countDriverHealth`'s own SQL
  text. The column memory's legacy rewrite stays in `readGridColumns`.
- **The list, as today:** one `driver.findMany` through `driverTabWhere`, the
  chips and the health filter.
- **The facts, ONE statement, keyed on the listed ids:** negative settlements,
  the DQF evidence, the roster columns `isQualifiable` reads, dispatch facts,
  last activity and the listed trucks' compliance, each its own CTE and each
  the SQL text its own loader sends — so `driverWarningFacts`,
  `dqfFactsForDrivers`, `dispatchFactsForDrivers`, `lastActivityForDrivers`
  and `truckWarningFacts` keep serving `/drivers/[id]`, `/safety/dqf` and
  `/trucks` with the same SQL. An empty list skips it.

Target: 21 → 6 per request (shell 1; `set_config`, head, list, facts, COMMIT;
Prisma logs no BEGIN). Measured after on dev with `page.timing`, owner and
dispatcher.

**`/drivers` ON THE ONE-CALL READ** _(owner's ruling 2026-11-15, "remaining
pages move to the one-call read, one page per commit", before the code;
v11.04)._ The page's transaction goes, and its reads go through
`zebra_tenant_read` (§6.2.9 v11.03) by `readCurrentOrg`, in TWO calls:

- **The head and the list, ONE call:** the list joins the head as a `list`
  CTE — the driver's own columns, the authority's name, the truck's id and
  unit — through `driverListSql`, which is `driverTabSql`, the base and the
  health filter as SQL, ordered by authority name, last name and then id, at
  most 500 rows, returned as one `json_agg` in that order. The health filter
  is `driverHealthFilterSql`, beside `driverHealthWhere`, and it spells the
  FILTER the figure links to, not the count: a phone is missing when it is
  null or exactly empty, as the link's `where` says today.
- **The facts, ONE call,** keyed on the listed ids, as v11.02.

The column memory is read from the head's row by `gridColumnsFromRow`; a
transaction opens only when that row is the legacy shape and must be
rewritten, as on `/payroll/batches`. Target: 6 → 3 statements and trips per
request (shell 1, head and list 1, facts 1). **THE PROOF:** an agreement test
holds `driverListSql`'s rows equal to `driver.findMany` through
`driverTabWhere` and `driverHealthWhere` — the ids in order and every column
the page shows — for every tab, with and without removed rows, scoped,
chipped, tagged and under each health filter; and a second organization's
driver, read through the function as the first, appears in no count and no
list. That case is watched failing with the reader handed the second
organization's id. Row-level security itself is `tenant-read.test.ts`'s proof
and does not change.

**THE RECORD IN ONE CALL** _(owner's ruling 2026-11-15, "one-call reads
continue: … then driver record"; v11.07)._ Measured on dev before: 23
statements as the owner, page 1,128 ms; 21 as a dispatcher. Every read the
record's main tab makes — the driver, the authorities, trucks, trailers, pay
rules, deductions, opening balances, the on-time rate, the DQF, the open
authority, the compliance records with their files and warning lead,
inspections with their violations, documents, the timezone, the team mate and
the sign-in link — is a named CTE of ONE statement sent through the tenant
reader (`readDriverRecordHead`), and no transaction. Each CTE is a second
spelling of a helper other pages still call, so the enforcer is named:
`tests/integration/driver-record-head.test.ts` holds every field equal to the
helpers' output on a driver with a row on both sides of every filter, full and
sparse, scoped and unscoped, with and without the sign-in link. The rows read
whole (Driver, RecurringDeduction, DriverOpeningBalance) turn their timestamps
back into dates by a list of names that a node test reads from the schema. The
tabs that read more — assets, safety, statistics, the log — open a
transaction for those reads alone. Target: 23 → 2 on the main tab (the shell
and the call).

**2 — The record.** `/drivers/[id]` was one long page of panels; it becomes
ELEVEN TABS over one page, the brief's names in the brief's order. _Specified
2026-10-07, before the code:_

- **The tab is in the URL (`?tab=`), Main is the default, an unrecognised value
  opens Main** — the same rule §7.1.6 gives a list, for the same reason: a stale
  link should open. **A tab a role may not see is NOT RENDERED**, never a tab
  that goes empty inside; the gates are the ones the panels already carry
  (`driver.pay`, compliance, inspections), decided in `permissions.ts` and
  applied here. Nothing is fetched that the open tab does not show.
- **Each tab reads what exists today:**
  **Main** — the record form and the authority actions, as today, plus two
  fields the form lacked (queue item 17, 2026-10-07): **kind** — a person or a
  referral payee, a select over `DRIVER_KINDS`, refused in words outside the
  list — and **tags**, one text field split on commas by the same rule the
  import uses, so a tag typed here and a tag imported are the same tag. Both
  under `driver:update` like the rest of the form; that is the ruling the item
  implies for who may turn a person into a payee, and it is flagged as such.

  _Main in Datatruck's shape, amended 2026-11-17 (owner's brief from Islom's
  screenshot, `corpus/datatruck-driver-main-2026-11-17.png`; the owner's
  rulings on its three open questions the same day), before the code:_ **two
  columns**, one form, one Save, under `driver:update` as before.

  **Left — Personal information:** the photo (the driver's newest live
  `PHOTO` document — the type exists — with an Upload under
  `document:create`, initials when there is none); first, **middle** and last
  name; **birth date**; contact phone; **Telegram**; email; the address
  (stored only here and read by pay-to and the 1099, so it stays — _kept
  beyond the brief_); **employment status** — the roster select, the
  2026-09-21 one-status ruling unchanged; **driver status**, read-only and
  DERIVED — the dispatch status the list shows (`dispatchStatusFrom`), never a
  second stored status; hire date; **tenure**, derived from the hire date to
  the termination date or today, "—" without a hire date. Then
  **Compliance:** DL number, DL state, DL class, driver type (company / lease /
  owner-operator), and kind (a person or a referral payee). **What is stored
  elsewhere is linked, not duplicated:** the CDL expiry, the medical card and
  the DQF are compliance rows on **Safety**, and Main links there in one
  sentence. The edit form's CDL-expiry field goes: `updateDriver` never wrote
  it, so on an edit it was a field that did nothing. **No SSN field.**

  **Right — Assignments:** assigned truck; assigned trailer; the authority
  (MC), read-only, its transfer the authority action under the form as today
  — **the Transfer dialog, on drivers, trucks and trailers alike** (v11.35,
  owner 2026-11-19): _Move to_ lists every ACTIVE authority except the
  asset's current one (a retired or deactivated authority takes no new
  assets, so it is not offered), and for a role holding `company:create` the
  list ends with **+ Add authority**, which opens Admin → Authorities → new
  and, once the authority is saved (or on Cancel), returns to the same record
  with the Transfer dialog open and the new authority in the list. The
  return path is checked: only a driver, truck or trailer record is a place
  to come back to. The Transfer button shows whenever there is another
  authority or the role can add one;
  **assigned dispatcher** — a member of this organization whose role is
  OWNER, ADMIN, MANAGER or DISPATCHER, refused in words otherwise
  (`dispatcher_not_member`); notes; tags. Then the **Team** block, DERIVED
  (owner's ruling 2026-11-17, "keep derived"): _Team driver_ Yes or No, and
  when Yes the co-driver by name, linked, with the unit they share — read from
  `team.ts`, the one place part 3 answers "who is my team-mate", and set the
  way part 3 sets it: by giving both drivers the same truck, which the block
  says in one sentence. The header's "Team with" is unchanged.

  **Four new stored facts, one migration** (73): `Driver.middleName`,
  `birthDate`, `telegram` and `dispatcherUserId` (a user, `SET NULL` on
  delete). All nullable, no default removed. Written by `updateDriver` only
  when the form sends them — omitted means unchanged, as kind and tags are —
  so an import or a script calling it clears nothing.

  **Not built, by name** (the brief's own list, and the owner's two rulings):
  rate stars, local driver, threshold, managers, track & trace, payment
  allocation; **percent salary** (owner's ruling: left out until the pay
  question is ruled — today each crew member is paid their own rule on the
  full gross, §6.2, and a stored split nothing reads would show a split the
  statements do not make); and the team's **Main** flag and **co-driver
  picker** (the team stays derived, part 3).
  **Documents** — _amended 2026-11-17 (safety team on dev, v11.30, before the
  code):_ the tab said "No documents on this driver" and offered nothing, so
  the one screen that lists a driver's paper was a dead end. It now carries
  three things, under the permissions the panels already use:
  - **Upload**, by kind: the driver document kinds (`DRIVER_DOCUMENT_KINDS` in
    `src/lib/driver-documents.ts` — copy of the CDL, medical card, employment
    application, prior-employer inquiry, road test certificate, photo, other),
    filed on the driver through the one upload pipeline. `document:create`.
  - **The list**, newest first: every live document on the driver AND every
    document attached to one of the driver's compliance records, each with its
    kind, its file (opened through the short-lived download URL), the day it
    was uploaded and, where it evidences a dated record, that record's
    **expiry** — the record it is attached to, or for a CDL copy or medical
    card filed on the driver, the newest live CDL or medical record. A
    document that evidences nothing dated prints no expiry, not a dash that
    reads like a missing one. The parked "not read — needs rotation" state and
    its button stay as they were.
  - **The readers where one exists**: the medical card (read → confirm → file,
    the Safety screen's flow with the driver stated) and the CDL (read →
    confirm number, state, class and expiry → file the CDL compliance record,
    and keep the image on the driver as the copy of the CDL). Both read and
    propose; nothing is written until the confirm. The licence fields on Main
    stay Main's: a reading that disagrees with them is shown beside them, not
    written over them. **An EMPTY Main field is one source with the CDL record**
    (v11.31, owner 2026-11-18, Adzhmal Alimi on dev — Safety held a current
    CDL record and file while Main's number, state and class were blank):
    Main reads each empty CDL field (number, state) from the newest CDL record
    (latest expiry), with the hint "From the CDL record on Safety" under it,
    for a role that reads compliance; and filing a CDL — the reader or the
    compliance panel — fills Main's empty number, state and class (class from
    the reading only; the record has no class). Filing a reading of the SAME
    card (same expiry) completes that record's empty number and state rather
    than being refused as a duplicate; a field both carry that differs is
    still refused.
    `compliance:create` (the CDL read also needs `driver:create`, as its route
    always has).
    **Sign-in** (the tab was "Mobile app login", one sentence, until 2026-11-12
    — Phase 7 step 1, before the code) — THE LINK between this roster row and a
    sign-in (§9 "The link"; `PHASE-7-BRIEF.md` §4.6, §4.7), holding what the
    empty tab promised: the login and its last sign-in. **Shown to OWNER and
    ADMIN only** — the tab is gated by `user:update` in `visibleRecordTabs`
    and not rendered for anyone else, because a MANAGER who edits the driver
    may not set who signs in as them. Not linked: one select over the users
    the ONE predicate offers — role DRIVER, member of this organization, not
    already the sign-in of a live driver here (`linkableMembershipWhere` in
    `src/lib/driver-link.ts`, the same object the write checks, held to a SQL
    spelling by `tests/integration/driver-link.test.ts` with both sides above
    zero) — and **Link**. Linked: the name, the address, the last sign-in (or
    "never"), the word _deactivated_ when it is, and **Unlink**, which drops
    the link and touches nothing else. Terminated: one sentence, no control.
    A termination through the roster deactivates the linked sign-in, revokes
    its sessions and drops the link in the same write; picking the sign-in
    again **reactivates it** — the link is the activation, one act, one audit
    row, and the audit row names who (the transaction's attribution on the
    Driver row's `userId` change, read on the Log tab like every other edit).
    **Recruiting** — NOTHING EXISTS: the Tenstreet pipeline is deferred
    (`docs/QUEUE.md`). One sentence.
    **Accounting** — pay rules, pay-to, standing deductions, opening balances.
    Money roles only; the tab does not exist for a dispatcher. **Pay-to is its
    own small form** (queue item 17, 2026-10-07): name and address, one Save,
    under `driver.pay:update` like the pay rules beside it, because who a
    statement is made out to is a pay fact. The statement READS these at
    generation and FREEZES them (`Settlement.payToName`), so a change here
    applies to the next statement and restates nothing already issued — the
    sentence under the form says so. Until this item they were read-only and
    the Datatruck import was their only writer.
    **Safety** — CDL and medical card as the compliance rows they already are,
    the DQF checklist, the compliance panel, the random-testing draws that
    selected this driver (or one sentence when none has), inspections.

  _The DQF checklist, amended 2026-10-07 (production walk, queue item 20 (4),
  before the code):_ **a live CDL compliance record satisfies "Copy of the
  CDL".** The row read only a `CDL_COPY` document, so a driver whose licence
  is on file as the dated `ComplianceItem` the alerts already watch showed the
  row MISSING, and the office saw files red for a licence it had recorded. Now
  either satisfies it: the document, undated, reads present; the record alone
  reads by its date — present, due, expired — the way the medical certificate
  does. The record stays out of `DQF_COMPLIANCE_TYPES`, because its expiry
  already warns through Phase 4 and a second warning for one date is one fact
  twice. **And a missing hire date is its own row, not a reason the file reads
  8 of 8 missing.** A driver with no recorded hire date showed every at-hire
  item "missing — no hire date recorded" and a summary that counted the file
  against a date nobody had typed. The checklist now opens with **Hire date
  recorded** (391.51, at hire, evidence the `Driver.hireDate` fact): present
  when it is set, missing when it is not, counted like any other row — so the
  office fixes the date where it is missing and the other rows date themselves
  from it. Nine rows; the roster's totals and the readiness badge read the
  same list.

  _Every row its action, amended 2026-11-17 (safety team on dev, v11.30,
  before the code):_ the checklist read "Missing — Since No hire date
  recorded" nine times and offered nothing, so a file could be read and not
  fixed. **Each row now carries the act that satisfies it**, derived from the
  row's own evidence so the two cannot disagree (`dqfRowAction` in
  `dqf.ts`):
  - the **hire date** (a fact) → a link to Main, where the date is set;
  - the **document** rows — application, prior-employer inquiries, road test,
    and the copy of the CDL → **Upload** on the row, filing that document kind
    on the driver;
  - the **dated** rows — MVR, annual review, medical certificate,
    clearinghouse → **Record** on the row: the date it expires (prefilled a
    year out for the annual items) and, optionally, the day it was done,
    written through `recordRenewal` as a compliance record of that type, the
    same writer the compliance panel uses.
    A row that is **on file links to the document** that satisfies it — the
    newest such document on the driver, or the one attached to the record that
    satisfies it — and a dated row on file with no document attached offers
    **Attach**. The actions follow the panels' permissions (`document:create`,
    `compliance:create`, `driver:update` for Main); a role without one sees the
    row and not the button. **"Since" prints a date or nothing:** "no hire date
    recorded" now prints on the hire-date row alone, which is where it can be
    fixed, rather than on every at-hire row under it.
    **One predicate per row, and the action agrees with it.**
    `dqfRowSatisfied` is the one predicate for what satisfies each row; the
    checklist reads it, and `tests/dqf-actions.test.ts` holds, over fixture
    files with rows on both sides, that every unsatisfied row's action files
    evidence the predicate accepts and every on-file link names a document the
    predicate accepts.

  _Five rows, amended 2026-11-19 (owner's ruling, Islom; v11.34, before the
  code):_ **the file is five rows, in this order: Contract (391.21, at hire,
  the `EMPLOYMENT_APPLICATION` document — the row was "Employment
  application"), Road test or CDL equivalent, Copy of the CDL, MVR (the row
  was "Motor vehicle record"), Medical card (the row was "Medical examiner
  certificate").** Hire date recorded, Prior-employer inquiries, Annual review
  of driving record and Clearinghouse query are **removed** from the file, its
  summary, the roster's totals, the readiness badge and the compliance
  warnings — they read one list (`DQF_REQUIREMENTS`), so removing a row there
  removes it everywhere. **"Since" no longer depends on the hire date:** a
  missing row prints no "since" at all (it printed the hire date, or "No
  hire date recorded" when there was none); a dated row on file that is due
  or expired prints its expiry, as before. The summary counts the five ("N
  of 5 not on file or expired"). The hire date stays on Main as a field; it
  is no longer a DQF row. This supersedes the hire-date row of 2026-11-17
  above, and its Main link.
  **Assets** — the current truck and trailer, then the assignment history from
  `AssetAssignment` periods for this driver, newest first, each with its reason
  and who did it. The Datatruck import wrote no periods, so a driver with none
  gets the sentence, not an empty table.
  **Statistics** — the on-time rate (as today), loads and miles over the last
  thirteen settlement weeks, and for money roles the net-pay-by-week shape
  §6.2.9 already draws, read by its reader. Figures, each with the window it
  counts; no chart that §6.1.1 would then have to govern.
  **Log history** — §7.10's ONE stream, for a person: created, field edits and
  deletion from `AuditLog`, documents by their upload, notes — through the same
  `activityEntries` the load uses, so money fields are omitted for a dispatcher
  by the one rule. A status entry is a load's kind of fact and does not apply.
  **Tasks** — NOTHING EXISTS. One sentence.
  **Others** — tags, notes and kind (a person or a referral payee): the facts
  that fit nowhere else, read here and changed on Main, which the tab says in
  one sentence. (Until queue item 17 kind and tags had no editor — GAPS code
  gap 10, closed 2026-10-07.)

- **"Says so in words" is a rule, not a tone.** A tab with nothing behind it
  renders one sentence stating the fact and naming what the tab will carry —
  never an empty panel, never a placeholder control that does nothing, never a
  grey table with no rows. Three tabs begin that way, and the sentence is the
  honest screen until they do not.
- **What this part does NOT change:** the panels themselves. Every tab renders
  the component the long page rendered, under a tab instead of a scroll; the
  new readers are the assignment history, the per-driver draws, the
  thirteen-week counts and the driver's timeline, and each is a function in
  `src/lib` with its merge order tested where it has one.

**3 — Team drivers.** A truck carries up to two drivers; both seats on the
load, both on the statement, shown on both records as "Team with". _Specified
2026-10-07, before the code, and MEASURED FIRST on dev:_ 90 trucks carry no
live driver, 25 carry one, 4 carry two, none carries three; 0 of 14,467 loads
carry a second seat; 0 of 142 statements froze a team-mate; and each of the
four pairs is one person imported twice (GAPS, duplicate driver rows).

- **Nothing new is stored.** A team is DERIVED three times over and this part
  adds no fourth place: two live drivers holding one truck
  (`Driver.assignedTruckId`, one row per seat), a load with its second seat set
  (`coDriverId`, the schema's own rule), a statement with its crew frozen
  (`teamWith` / `referralWith`). `src/lib/team.ts` is the one place the seat
  count and "who is my team-mate" are answered, so the records, the load form
  and the pairing writer cannot drift on either.
- **The cap is applied where the pairing is written**, in `fleet.ts` through
  `assertSeatFree`, for create and update alike, and refused in words
  (`truck_full`). The driver form does not know the number: an import, a
  script and a second screen reach the same writer, and only one of them has a
  dropdown. A driver keeping the truck they already hold is not counted against
  themselves. VACATION and OFF_DUTY keep their seat; INACTIVE and removed do not.
- **Both seats on the load, by the dispatcher's hand.** When the load's driver
  has a team-mate, the assignment form's second seat is PRE-FILLED with them
  and a sentence beside it says who and from which unit; pressing Save writes
  it, clearing the select does not. A SUGGESTION AND NOT AN ENGINE WRITE,
  because the four pairs that exist today are duplicates, and a silent fill
  would pay one person twice on every RAM Haulage load until the accountant
  merges them. The pre-fill is offered only when the team-mate is in the
  assignable list, so the control never names someone it cannot save.
- **Shown on both records.** The driver record's header names the team-mate
  after the type, as a link; the truck record's header lists its crew, or says
  in words that no driver holds it. The statement already prints "Team with X"
  from the frozen column and is not touched.
- **A Team column on `/drivers`, behind the chooser** (2026-11-17, with Main's
  Team block): the team-mate's name, linked, or nothing. Read in the list's
  facts call as one more CTE — `crewOfTrucksSql` over the listed trucks, the
  spelling `tests/integration/truck-list.test.ts` already holds to
  `crewOfTrucks` — and folded by `teamMateOf`, so no statement is added and no
  second definition of a seat exists. Hidden by default; a saved choice that
  never hid it shows it, the v10.54 rule for every new column.
- **What this part does NOT change:** the settlement split (each crew member
  is paid their own rule on the same gross, §6.2), the import's second-seat
  resolution (`CoDriverSeat`, which left every seat empty because the column
  named carriers), and the referral payee's place (`referralWith`).

### 6.5 Trucks take Datatruck's shape — _part 0 added 2026-10-07, part 1 added 2026-11-10_

The brief for the list and the record comes from Islom's screenshots
(`docs/QUEUE.md` item 18): the list's arrived on 2026-11-10 and is part 1
below; the record waits for the second screenshot. Part 0 precedes the screen, by the owner's
instruction of 2026-10-07: _"a 'data health' row on the Trucks list footer and
on GAPS — counts of trucks missing VIN, plate, odometer, registration expiry,
annual inspection — each a link to the filtered list. Same later for Drivers.
The office fixes data faster when the screen counts it."_

**0 — Data health.** _Specified before the code, and MEASURED FIRST on dev:_ of
119 live trucks, 26 have no VIN, 9 no plate, 119 no odometer, 29 no
registration record at all, 97 no annual-inspection record at all. (70 carry an
EXPIRED registration and 11 an expired inspection — those are the warnings
column's business and GAPS' "stale compliance dates", not this row's.)

- **Five counts, one definition each, in `src/lib/data-health.ts`.** VIN, plate
  and odometer are MISSING when the column is null or blank. Registration and
  annual inspection are MISSING when the truck carries NO live `ComplianceItem`
  of that type — a record whose expiry has passed is present and stale, which
  §6.1.1's 30/60/90 counts and the warnings column already say; counting it
  here too would make one fact two numbers. Removed trucks count nowhere.
- **The row sits under the grid, in the footer's register, and every figure is
  a LINK** to `/trucks?missing=<check>`, which applies the same definition as a
  query filter and keeps the other filters in the URL. Zero is SHOWN, never
  hidden (§7.1.6's rule for a count): a row that drops its zeros teaches the
  office that an absent figure means fine. The counts are over the list the
  user may see — company scope and the authority filter apply; the
  attention and tag filters do not, because the row answers "how much of my
  fleet is incomplete", not "how much of this view".

  **AND AN EMPTY SCOPE IS EVERY COMPANY, as it is everywhere else.**
  _Production walk 2026-10-07, queue item 20 (3)._ `companyScopeFilter`
  reads an empty scope list as "unscoped" — the owner's scope is `[]` — and
  the first cut of the counts read it as "no company", so both footers said
  0 for exactly the people who look at them while the grid showed the gaps.
  The filter was never wrong: `?missing=odometer` on a fleet where no truck
  has an odometer lists every truck, which is the right answer, and the
  number beside it said 0. The count and the filter now share the scope rule
  as well as the predicate, and the agreement test runs once with a named
  company and once unscoped, on a blank-odometer truck row, so the two
  readings cannot differ by scope again.

- **One query for the five**, a single `SELECT` with five filtered counts,
  inside the page's transaction beside the rows. Not five `count()` calls and
  not a count per row.
- **GAPS carries the same five figures as a Data row**, with the five links, so
  the file that lists what is wrong names the screen that counts it. The
  figures in the file are the reading of the day they were written; the screen
  is live.
- **Same later for Drivers**, by the owner's words: the module is written per
  subject so the drivers list adds its own five without a second footer design.

**0b — Data health for Drivers.** _Owner's five, 2026-10-07, after part 0
reported: "no CDL on file, no medical card, no phone, no pay rule, no truck
(active drivers only)." Specified before the code and MEASURED FIRST on dev:_
of 59 active person drivers, 13 have no CDL record, 59 no medical-card record
(none exists on dev at all), 6 no phone, 2 no pay rule in force, 26 no truck.

- **Active drivers only means the Active tab's population, and PEOPLE.** Live
  rows on a working roster value (`AVAILABLE · DISPATCHED · ON_ROUTE ·
OFF_DUTY`), and `kind` not a referral payee — a payee has no licence, card
  or truck by its nature, and `driver-kind.ts` already keeps it out of the DQF
  and the compliance warnings for that reason. Terminated and vacation rows are
  not counted: a gap on a row nobody can dispatch is not a gap the office can
  act on this week.
- **"On file" is a live `ComplianceItem` of the type** — the licence record with
  its expiry (`CDL`), the medical certificate with its expiry (`MEDICAL_CARD`).
  Missing, not stale, as for trucks: an expired card is a record, and the
  warnings column says it is expired. The DQF's own CDL item is a COPY of the
  licence, a document, and a different fact the DQF watches; the two are not
  merged here.
- **"No pay rule" is no rule IN FORCE TODAY**, by `ruleInForce`'s own test
  (`effectiveFrom ≤ now` and `effectiveTo` null or `≥ now`), because a driver
  whose only rule has closed generates an empty settlement exactly like one
  who never had one. A rule dated to start next week does not count as one.
- **No phone is null or blank; no truck is `assignedTruckId` null.**
- **The same row, the same module, the same agreement test.** The row sits
  under the Drivers grid as under the Trucks grid, every figure a link to
  `/drivers?missing=<check>` with the tab and the other filters kept; the
  filter applies the same `where` as the count, over the same base, so the
  number and the list agree whichever tab is open. One statement for the five.
  GAPS carries the day's reading with the five links. The component is the
  one the trucks row uses, made generic over the check list rather than copied.
- **Then hold for the Trucks brief**, by the owner's words. Nothing of item 18's
  list or record is built until the screenshots arrive.

**THE LIST IN ONE CALL** _(owner's ruling 2026-11-15, "one-call reads
continue: … then trucks"; v11.11)._ Measured on dev before: 14 statements,
page 360 ms as the owner, 346 as a dispatcher — the authorities, the trucks,
five per-list loaders (compliance, crews, heading-to, the fleet-status change,
the open loads), the counts, the makes, the five health counts and the column
row, in one transaction. They are named CTEs of ONE statement through the
tenant reader (`readTruckListData`), and no transaction. The rows' `where` is
spelled from the counts' fragments (`truckListRowsWhereSql`); three loaders
keep their own text over the listed ids (`headingToSql`,
`fleetStatusChangedSql`, `truckComplianceWhereSql`), the crews and open loads
are second spellings (`crewOfTrucksSql`, `openLoadStatesSql`), and the rows
are shaped by `truckRowsFrom`, the function the export's Prisma rows go
through too. `tests/integration/truck-list.test.ts` and `truck-status.test.ts`
hold the call equal to the Prisma reads view by view and filter by filter,
through both transports, and count ONE statement as `zebra_app`. Target: 14 → 2
(the shell and the call).

**1 — The list.** _The owner's brief from Islom's screenshot of Datatruck's
trucks list, 2026-11-10, transcribed here before the code. The record waits
for the second screenshot and is not touched._ `/trucks` keeps its grid
machinery — the chooser (§7.1.7), the data-health row (part 0) — and takes the
loads list's shape (§6.7): views as chips with counts, one `where` built once,
every number on the bar from one statement, an export that is the list.
Where the brief meets a rule already in this file, the rule wins and the
brief's wording is answered rather than obeyed, and each such place is marked.

- **Four views as chips with counts, `?view=`, one predicate each**, in
  `src/lib/truck-list.ts`, in this order:
  **Active** — the default: no `?view=`, and an unknown name opens it. Not
  removed and not `SOLD`.
  **Unassigned** — Active, and no live driver holds the unit, by the one seat
  definition `team.ts` already uses: not removed, not `INACTIVE`; vacation
  and off-duty keep their seat.
  **All** — every truck, removed included.
  **Inactive** — removed or `SOLD`.
  They replace the "Needs attention" and "Show removed" links. The view group
  has a DEFAULT chip: with no `?view=` the Active chip is lit, pressing it
  writes nothing, and pressing the lit Unassigned chip returns to Active. A
  removed truck is listed by All and Inactive rather than kept behind a toggle
  — the brief's words, and the opposite of §6.4's rule for a removed DRIVER,
  which stands: a removed truck is a unit that left, a removed driver is a
  mistake. _The difference is recorded, not resolved._
- **"Needs attention" becomes the warnings filter inside Filters**
  (`?attention=1`), narrowing the rows after the read as it always did, because
  warnings are computed and there is nothing stored to count. The view and
  status counts on the bar therefore do not honour it — the one filter a count
  ignores besides its own group. _Flagged._
- **The agreement test** creates, under one authority, a truck with one live
  driver, a truck with two, a truck nobody holds, a truck out of service, a
  sold truck and a removed truck, and requires each view's chip count to equal
  the rows the list returns for that view, both above zero, and for the view
  the status chips as well. The counts are ONE grouped statement — a second
  SQL expression of the predicates, held to the Prisma listing by that test,
  which is §6.7's mitigation applied again.
- **Columns, Datatruck's order:** unit · make · model · plate · VIN · year ·
  state · authority · driver · owner name · odometer · status · warnings, and
  the three optional columns the list already had — fleet status, aging,
  heading to — after status. The authority column exists only with more than
  one authority (§6.3). Unit is the row's link and carries a copy icon outside
  the anchor (§6.7 item 4). Driver names both seats of a team truck, each a
  link to the driver where the role may open one (§6.7 item 3); an empty seat
  is an em dash. Per §7.1's width rule: unit, plate, VIN, year, state,
  odometer, status, aging and warnings are FITTED; make, model, authority,
  owner name and heading to share at one, driver at two.
- **Default hidden: owner name, VIN, fleet status, aging** — the brief's four
  — **and heading to**, which the brief drops from the default set and this
  section keeps as a column. **`/trucks` IS CAPPED AT ELEVEN** _(owner's
  ruling 2026-11-10, on accepting the list on dev; this replaces the flag of
  v10.79, which had kept model and odometer behind the chooser to stay inside
  §7.1's nine)_: Model and Odometer are in the default set, which is the
  brief's eleven — unit, make, model, plate, year, state, authority, driver,
  odometer, status, warnings — eleven shown with the authority column, ten
  without. The cap is one line in `GRID_COLUMN_CAP`, the second grid after
  `/loads` (§7.1.7). Warnings is never hidden (§7.1.7).
- **Search by unit, plate or VIN** — one box like the loads list's reference
  box, `?q=`, a case-insensitive contains over the three columns, submitted on
  Enter. **The authority dropdown** per §6.3, `?company=`. **A Filters
  popover** with a badge counting what is set: status (`?status=`, the six
  `TruckStatus` values), fleet status (`?fleet=`, the three codes of
  `fleet-codes.ts`), make (`?make=`, a select over the makes in the viewer's
  fleet — one statement, because the makes are stored as the import spelled
  them and a typed filter would miss `FRHT` for Freightliner), a year range
  (`?yearFrom=`, `?yearTo=`, inclusive, either end alone valid), and warnings
  (`?attention=1`). The tag filter stays a URL-only filter, `?tag=`, honoured
  and uncontrolled as today. The data-health filter `?missing=` keeps its
  definition (part 0). **Every filter is ANDed** in one `where` builder, so
  no two filters can overwrite each other; a chip's count honours every other
  filter and ignores its own group (§7.4), the warnings filter excepted as
  above.
- **Columns and Export.** The chooser as today, grid `trucks.trucks`.
  **Export** is `/trucks/export` with the list's own query string, under `read
truck` exactly like the list, on §7.1.5's contract: every row the `where`
  selects, the person's visible columns in the table's order, codes not
  labels, both seats in the driver column separated by `/`, the file named
  `zebra-trucks-<view>-<yyyy-mm-dd>.csv` with the view's name (`active`
  without one) and the default authority's today. One reader builds the rows
  for the page and the file. The agreement test requires the export's row
  count to equal the list's, above zero. _§6.4 flagged that the three
  operational lists get their export together or not at all; `/loads` got its
  own in §6.7 item 7, and this is the second. The drivers list is the one still
  without._
- **No Import file, no bulk actions, no Save view.** The brief's words. §6.4's
  reasons hold for the first two: the import is
  `scripts/seed-datatruck-trucks.ts`, run by a person with the export in hand,
  and nothing bulk changes a unit's status today. A saved view is per grid
  (§7.4) and nobody has asked for one on trucks; the four views are the ones
  the office uses.
- **The footer: the status counts as read-only chips** — Available · In
  transit · Dispatched · In maintenance · Out of service, the brief's order —
  counted over the rows the current view selects (every filter the counts
  honour, the view included) by the same predicate as the Status column:
  `status`, over live rows. A removed row reads "Removed" in that column and is
  in no status chip. Sold and Removed chips appear only on the views that can
  hold them, All and Inactive — a chip for a value the view excludes by
  predicate would read as a broken count. Zero is SHOWN (§7.1.6's rule for a
  count). Not links, not filters: the status filter is in the popover, and a
  chip that both reported and narrowed would be two controls in one. The DATA
  HEALTH row stays beneath, unchanged.
- **The page reads 500 rows and says so** when the view selected more, as §6.4
  does for drivers: warnings and crew are computed, so there is nothing to page
  in the database, and 119 is the fleet today.
- **Measured first, on dev, 2026-11-10 — the brief's data question.** Of 119
  live trucks, **66 are `OUT_OF_SERVICE`**: Dolphins Transport 33, Midwest
  Global Logistics 23, RAM Haulage 6, American Soldier Transport 4. All 66 were
  created on 2026-09-09 by `scripts/seed-datatruck-all-trucks.ts`: the
  all-trucks export's 64 extra units beyond the first 49, which that script
  files `OUT_OF_SERVICE` because `TruckStatus` has no `INACTIVE`, `AVAILABLE`
  would put a sold truck on the dispatch board and `SOLD` would claim a
  disposal nobody recorded. None of the 66 has an open asset period, a live
  driver or an audit entry — nobody has touched the value since the seed — and
  6 of them are named by an OPEN load (RAM 3, Dolphins 2, Midwest 1), which is
  the kind of row the second axis exists to show (`fleet-codes.ts`).
  `fleetStatus` is null on all 119. So the Active view opens on 119 units of
  which 66 are out of service by a seed's placeholder and not by a yard's note,
  and the status chips in the footer will say so in numbers. GAPS carries the
  reading. _For the owner's ruling, with the list as the instrument: (a) the
  66 are real and stay, or (b) they left the fleet and become `SOLD` or
  removed, which the Inactive view then lists and the Active view's count
  drops to 53._

  **RULED (b), 2026-11-10: the 66 become REMOVED, with the reason "inactive
  in Datatruck export 2026-09-09".** _Specified before the code:_
  - **A data migration SCRIPT, not a schema migration** —
    `scripts/remove-datatruck-inactive-trucks.ts`, built like the seeds it
    undoes: preview by default, `--write` to act, `--production` guarded and
    naming the organization (`assertTenancy`), on the production allowlist of
    `tests/prod-url-guard.test.ts`. Dev first, then production; counts before
    and after on both.
  - **The rows are identified by the seed's own signature, never by a list
    typed by hand:** live, `OUT_OF_SERVICE`, NO asset-history period at all
    (the all-trucks seed wrote none, and every other writer opens one), and
    no audit `UPDATE` since. A truck a person has touched is not the seed's,
    whatever its status says, and is left alone and named.
  - **Removed through `retireAsset`, inside `runInOrg`**, so the write is the
    application's own: `deletedAt` set, any open period closed (there is
    none), the audit row written, with the reason as the batch's attribution.
    The reason is also appended to the truck's `notes`, so the record itself
    says why it is gone. A second run finds nothing to do.
  - **Counts before and after, by the list's own predicates**
    (`truckViewWhere`): on dev Active 119 → 53 and Inactive 0 → 66, printed
    by the script and read back by the chain's probe of `/trucks`.
  - **The 6 named by an open load KEEP the link**, and the load gets a
    **`truck_inactive` warning**: a load that is not finished (not
    `DELIVERED`, not `POD_RECEIVED`), not cancelled, not closed history, whose
    `truckId` names a REMOVED truck — read in the ONE load-facts statement
    (`loadWarningFacts`, which the shape test holds at three statements) and
    shown with the unit number as its detail. The warning is the sentence
    the row needs: the dispatcher reads "truck inactive" on an open load and
    reassigns, where a silently kept link would read as a truck still moving.

**Round two — Status derives from the open loads.** _The owner's brief of
2026-11-10, on accepting the list on dev; specified before the code._ The
stored column was a word somebody typed, which is the ruling of 2026-09-21
the dispatch board already lives by (`dispatch-fields.ts`): a truck hauling a
load to Gastonia read Available for as long as nobody went back to its page.
On both databases every live truck reads Available today, whatever it is on.

- **One predicate, in `truck-list.ts`.** A truck's status is DERIVED, in this
  order: an **override** if the stored column holds one (below); else **In
  transit** if the truck is on a load that is MOVING — `AT_PICKUP`, `LOADED`,
  `IN_TRANSIT`, `AT_DELIVERY`, the set the board and the drivers list's
  dispatch status already mean by it (`MOVING` in `dispatch-fields.ts`); else
  **Dispatched** if it is on any other OPEN load — not finished (`DELIVERED`,
  `POD_RECEIVED`), not cancelled, not removed, not closed history; else
  **Available**. _The brief's "in transit" and "booked/dispatched" answered
  with the board's own sets: a truck at the pickup is a truck on the road,
  and the board, the drivers' column and this column must not disagree about
  one movement. Closed history is excluded for `BOARD_LOAD`'s reason: an
  imported load still `DISPATCHED` on paper would otherwise dispatch a truck
  for ever._
- **The stored column keeps only the manual overrides** — In maintenance, Out
  of service, Sold — and an override WINS over the loads: a truck in the shop
  with a load still on it reads In maintenance, which is exactly the row a
  dispatcher needs to find. A stored `AVAILABLE`, `DISPATCHED` or
  `IN_TRANSIT` means "derive": the record's form offers **Automatic** (stored
  as `AVAILABLE`) and the three overrides, nothing else, and a stored
  `DISPATCHED` or `IN_TRANSIT` from before this round reads as Automatic and
  is rewritten to `AVAILABLE` on the next save. The pickers already read the
  overrides alone (`UNAVAILABLE_TRUCK`, `ASSIGNABLE_TRUCK`) and do not change;
  nothing writes the two derived values any more.
- **Every reader reads the one predicate:** the Status column and its stripe,
  the status filter in the popover, the footer's status chips, and the
  export's `status` code — the file also carries `override`, the stored
  override or nothing, so a reader can tell a shop from a road. The counts
  statement restates the predicate in SQL — a CASE over the overrides and two
  EXISTS over the loads — and the agreement test holds the SQL to the Prisma
  listing per status, as it does for the views.
- **And against the loads list's own predicates, both above zero:** every
  truck counted In transit is the truck of a load the loads list lists under a
  moving `?status=`; every truck counted Dispatched the truck of a load it
  lists under `BOOKED` or `DISPATCHED`, with no moving one; a truck whose only
  loads are delivered, cancelled or closed history is Available; an override
  holds against a moving load; a stored `IN_TRANSIT` with no load reads
  Available.
- **Cost:** one more statement per render — the open loads of the page's
  trucks, one query for the whole page, which also replaces nothing: the
  heading-to loader keeps its own predicate because it includes closed
  history by design. Measured on dev after the deploy and recorded in the
  chain's report.

**2 — The record.** _Owner's brief 2026-11-19 (Islom; v11.36), before the
code._ **Save keeps every field it shows.** Owner name and four other item-12
fields (fleet status, fuel type, axles, gross weight) were written on Save
and then not loaded back into the form, so the record reloaded blank and the
next Save wrote the blanks over them. The form's values now come from one
reader (`truckFormValues` in `src/lib/truck-form.ts`) that covers every field
the form offers, and the edit writer leaves a field it was not sent as it is
(omitted means unchanged, as `updateDriver` does), so a tab cannot clear
another tab's fields. `tests/integration/truck-form.test.ts` changes every
field on the form, saves, reloads and reads each one back.

**Two columns, like the driver's Main (§6.4 part 2), and a Details tab.**
_Main_ — **left, identity:** unit number, VIN, plate and plate state, make,
model, year; the authority (read-only, its transfer under the form) and the
driver (the crew, read-only, linking to each driver's record). **Right,
assignments and status:** status (Automatic and the three overrides),
ownership, odometer, notes. _Details_ — fuel type, fleet status, owner name,
gross weight and axles, with their own Save. The compliance, maintenance and
inspection panels stay under Main.

### 6.6 Safety — the accident register's driver picker — _added 2026-10-07_

_Production walk 2026-10-07, queue item 20 (6), specified before the code._ The
register's driver select listed every live driver row of the chosen authority
— terminated drivers and referral payees included — because its query asked
only "not removed". The owner's words: **the picker is the active drivers of
the authority.**

- **"Active" is the one word the product already has for it**: the Active
  tab's population (§6.4 part 1) — live rows on a working roster value
  (`AVAILABLE · DISPATCHED · ON_ROUTE · OFF_DUTY`) — and PEOPLE, never a
  referral payee, which is a commission and cannot be in a truck (§6.5 part
  0b's rule, for the same reason). ONE predicate, `activeDriversWhere()` in
  `driver-list.ts`; the drivers' data-health base reads it rather than
  restating it, and the picker reads it rather than writing a third.
- **Scoped to the chosen authority**, as before: an accident is one
  company's register.
- **The register records and voids; it does not edit.** So a picker that
  narrows to active people leaves no old entry without its driver: the entry
  carries its own driver by name, and a later termination changes the picker
  and not the record.

### 6.7 The loads list takes Datatruck's shape — _added 2026-10-08_

Queue item 21, the owner's brief from Islom's screenshots (`docs/QUEUE.md`
§21). Nine items. 1–6 ship as one chain and 7–9 as a second. This section
specifies all nine before any code. Where the brief meets a rule already in
force, the rule wins and the brief's wording is answered here rather than
obeyed. Kept from today's list: the warnings column, the billing chips, and the
authority chips. Not added: a trip planner, LTL, and generic bulk actions.

**THE LIST IN TWO CALLS** _(owner's ruling 2026-11-15, "one-call reads
continue: … then loads"; v11.10)._ Measured on dev before: 10 statements,
page 513 ms as the owner, 584 as a dispatcher — the authorities, the rows,
their warnings, the counts, the filter labels and three preferences, each its
own read in one transaction. Now two calls through the tenant reader and no
transaction: the HEAD (authorities, preferences, labels) and the BODY (the
page of rows, their warnings, every chip). TWO, NOT ONE, because "today" is
the default authority's local date and every date view and the Upcoming chip
are bounded by it, so the body is built from the day the head names. The rows'
`where` is spelled from the fragments the chip counts already use and hold
equal to the Prisma predicates (`loadListRowsWhereSql`); the rows are
`loadRowsSql`, shaped by `loadRowsFrom`, the function the export's Prisma
rows go through too. `tests/integration/load-list.test.ts` holds the page's
two calls equal to `readLoadRows(listWhere(…))`, the counts, the labels and
the preferences, view by view and filter by filter, through both transports,
and counts TWO statements as `zebra_app`. The export keeps its Prisma read.
Target: 10 → 3 (the shell and the two calls).

**Every filter on the list is ANDed.** The list used to merge its filters with
object spread, so two filters that each carry an `OR` overwrote each other.
`?view=unassigned&ref=T-1` dropped the reference search without a word. One
function in `src/lib/load-list.ts` now builds the list's `where` as an `AND` of
its parts. The page, the counts and the export (item 7) all read it, and the
agreement tests call it directly.

**A chip's count honours every other active filter, the view included.** It
ignores only its own group, which is §7.4's rule. Until now the status and
billing counts ignored `?view=` entirely, so "Booked 12" under a named view
opened fewer than twelve rows.

**1 — Date views.** Four new names in `load-views.ts`, resolved like the five
already there: one predicate per name, never a raw filter in the URL.

| `?view=`           | Means                                                       |
| ------------------ | ----------------------------------------------------------- |
| `picksUpToday`     | The FIRST pickup is today                                   |
| `deliversThisWeek` | The FINAL delivery is in this settlement week (Sun–Sat)     |
| `pickup`           | The first pickup is between `from` and `to`, both inclusive |
| `delivery`         | The final delivery is between `from` and `to`, inclusive    |

- **Which stop, and which date.** First pickup and final delivery are the stops
  the Pickup and Delivery columns already print, so a row can never sit in a
  view its own cells contradict. A stop's date is `scheduledAt`, and
  `windowStart` when there is no appointment. A stop with neither date matches
  no date view.
- **The day is the stop's own day (rule 3, §8).** A date-only stop is stored at
  midnight in its zone, so one UTC window would put an Eastern stop on the day
  before in Chicago. The zone is the load detail's rule, `renderStopTime`: the
  stop's state, and its authority's `timezone` when the stop has no state,
  which is every Relay stop. The predicate is one `OR` arm per zone. Each arm
  bounds the date by `zoneMidnight` in that zone, and every stop falls in
  exactly one arm.
- **"Today" is the date now in the default authority's zone.** That is
  `Company.isDefault`, or `America/Chicago`, the schema's default, when no
  authority is default. "This week" is the settlement week that date falls in,
  `weekOf`, which is the week every money screen means.
- **The two presets are queues, and the ranges are filters.** `picksUpToday` and
  `deliversThisWeek` leave out cancelled loads and closed history, as every
  queue view does. `pickup` and `delivery` leave out neither, because "what
  delivered in March" is a question about the archive (ruling 3 of
  `load-views.ts`). A range with only `from` is that one day. A missing or
  malformed `from`, or a `to` before it, narrows nothing, because an unknown
  name narrows nothing.
- **"Default chips" means offered by default, not selected by default.** `/loads`
  with no `?view=` still lists everything (ruling 3). Selecting a preset is one
  click. _The brief's wording, answered._
- **One view at a time.** `?view=` holds one name, so choosing Upcoming clears a
  pickup range. A second date dimension would need a second parameter and a
  second predicate family, so it waits until somebody asks for it. _Flagged._

**2 — Broker and Driver filters.** `?customer=<id>` and `?driver=<id>`, each a
typeahead in the filter bar.

- **The driver filter matches either seat**, `driverId` or `coDriverId`. A team
  load is that driver's load too (§6.4 part 3).
- **The options load on first focus, not on every render.** One read returns
  the brokers, which are shared across authorities, or the drivers in the
  viewer's scope with terminated drivers included, because the filter is for
  finding history. The page pays for a name lookup only while the filter is
  set, so the control can show the chosen name.
- **An id that matches nothing shows the filtered empty state**, with its Clear
  filters button. Unlike a view name, an id is not a vocabulary.

**3 — Linked cells.** Broker links to `/brokers/[id]`, each driver to
`/drivers/[id]`, and the truck to `/trucks/[id]`.

- **A link only where the role may open it.** A role without `read` on the
  target gets the name as plain text. A link that 404s is a broken screen, not
  a permission.
- **The cell's link sits above the row's overlay**, at `relative z-10` (§7.1).
  Clicking the name opens the record, clicking anywhere else opens the load,
  and middle-click works on both.
- **A Driver column is new.** Datatruck's list has one and today's does not. It
  shows both seats when there are two, each its own link.

**4 — Copy the load number.** A clipboard button beside the load number, outside
the row's named link, because a control inside an anchor is invalid HTML and
would open the load instead of copying. The toast repeats the verb (§7.9), for
example "Load 1234 copied". A refused clipboard says so in an error toast that
stays until dismissed, because a copy that silently did not happen gets pasted
into Relay as whatever was on the clipboard before.

**5 — DEL date column.** The final delivery's local date, date only, read in the
same zone as item 1. The Delivery cell keeps city and state, and still falls
back to the stop's own name when it has neither, because that fallback is what
makes Relay stops readable. _The brief's "city/state only", answered: no date
in the cell, and the fallback stays._

**Columns** _(owner's rulings of 2026-10-09; this paragraph replaces the
2026-10-08 one that hid pickup)._ Twelve declared, in this order: load ·
authority · broker · pickup · delivery · DEL date · driver · truck · status ·
billing · rate · warnings. **Only rate and billing start hidden.** That shows
ten with more than one authority and nine with one, which is why §7.1.7 now
caps `/loads` at ten.

**Column memory is the set a person HID** (every grid, not only this one,
because `readGridColumns` is the one reader). It used to be the set they showed,
so a column added later stayed invisible to everyone who had ever saved a
choice. The ruling's point is the reverse: a new column appears for everyone,
and only what somebody deliberately took away stays away.

- **Stored as `{ hidden: [...] }`** under the same `columns.<grid>` key. No row
  means the grid's defaults. A stored hidden set replaces the defaults
  entirely, so a person who restored Rate keeps it.
- **An old row is migrated once, when it is read.** A stored ARRAY is the old
  shape, the set shown. Its hidden set is everything the grid offers that the
  array leaves out, MINUS the columns that did not exist when the old shape was
  current: Driver and DEL date on `/loads`, which arrived on 2026-10-08. The
  new shape is written back in the same transaction, and the next read finds
  nothing to migrate.
- **Warnings is never cut by the cap.** When more columns are visible than the
  grid's cap, the cap drops from the end and skips the warnings column, because
  an absent warnings column reads as "nothing wrong" (§7.1.7).

**Column widths** _(added 2026-11-07, owner's review of the list on dev:
"Authority, Broker and Pickup have more room than they need while Driver
truncates")._ Under §7.1's width rule: load, DEL date, truck, status, billing,
rate and warnings are FITTED to their content, and authority, broker, pickup and
delivery share what is left at one each, **driver at two**, because it holds two
seats. Measured on dev before the change, 100 rows at 1920 (table 1,696 px):
DEL date held 202 px for a twelve-character date, Status 201 px for a badge and
Truck 113 px for a four-digit unit, while Driver had 123 px and was cut on 70
rows and Broker 129 px, cut on 98 — so the room was in the fitted columns, not
in Broker's. The widths after the change are measured by the same probe and
recorded in the chain's report, not predicted here.

**The filter bar is two rows at 1920.** Row one holds the chips: status,
Upcoming and Unpaid, and billing. It never wraps and carries no group labels,
because every chip already says what it is. **Row one FITS, and a scrollbar
under it is a defect** _(owner's review on dev, 2026-11-07)._ Measured on dev
after v10.76 took the authorities off the row: eleven chips need 1,024 px,
inside the 1,102 px the row has at a 1,366 viewport and the 1,656 px it has at
1920 — so the scrollbar the owner saw was the five authority chips, and the row
now fits at every width the application is laid out for. Should it ever not —
a locale whose labels run longer, counts past five digits — **the billing chips
move into the Filters popover**, by the owner's ruling, rather than the row
scrolling; the sideways scroll remains only as the fallback for the moment
before that move. _The 2026-10-09 sentence that capped authority chips at 128 px
after the walk measured row one 50 px past 1920 is history: v10.76 (§6.3) took
the authorities off the row and into the dropdown._
Row two holds the reference search; a **Filters** button with a badge counting
the active filters inside it; the Columns chooser; density; and Clear filters.
The **Filters** popover holds the two date presets, the pickup range, the
delivery range, the broker typeahead and the driver typeahead. Filling a pickup
range empties a delivery range, because the list holds one view at a time. The
saved-views row above the bar stays where §7.4 pins it, without its density
control.

**6 — Upcoming and Unpaid**, two more names with a count on each chip:

- **`upcoming`** — `BOOKED`, and the first pickup falls between today and seven
  days from today, both inclusive. Cancelled loads and closed history are out.
  A booked load whose pickup has passed is late, not upcoming, and it is not
  here.
- **`unpaid`** — `DELIVERED` or `POD_RECEIVED`, and billing is one of
  `UNINVOICED`, `READY_TO_INVOICE`, `INVOICED`, `PARTIALLY_PAID` or `DISPUTED`.
  That list names what to include. `WRITTEN_OFF` and closed history are
  decisions, not debts. Cancelled loads are out.
- **The agreement test** creates rows the seed never makes, an Eastern stop and
  a stateless Relay-shaped stop, and requires each chip's count to equal the
  list's rows for that view, with both counts above zero.

**The query budget** _(owner's ruling of 2026-10-09: 394 ms per render was too
slow)._ **Every number on the bar comes from ONE grouped statement**:
`loadListCounts` in `src/lib/load-list-counts.ts`. It reads the list's base set
once, tags each load with its status, its billing state and four flags (in
the active view, ready to invoice, upcoming, unpaid), and groups by them. A pure
function then derives every chip count and the footer's total from the
groups, by the same rule as before: a chip honours every other filter and
ignores its own group. This replaces six statements per render: the footer
count, two `groupBy`s and three counts. **The guard: a render issues at most
one counting statement**, asserted by an integration test that counts them.

- **The SQL is a second expression of the predicates**, as
  `dashboard-counts.ts` is for the Needs-you rows, and the mitigation is the
  same: an agreement test runs the SQL and the Prisma predicates over the same
  rows and requires the same number, ONE CASE PER CHIP AND PER VIEW, named.
- **In SQL, a stop's day is computed, not bounded.** The local date is
  `scheduledAt`, else `windowStart`, read at the zone a CASE over the state
  gives, else the authority's zone. The CASE is generated from
  `stop-time.ts`'s own map, so the two expressions share one table. The first
  pickup is the MIN of those days and the final delivery is the MAX. That is
  exactly the Prisma form's "one in range and none before or after".
- The Prisma predicates stay the definition of the LIST, which is the rows a
  person sees, and the export reads them too.

**7 — Export the current view** _(second chain)._ `/loads/export` with the
list's own query string, under `read load` exactly like the list. §7.1.5's
rules apply: every row the list's `where` selects, every page; codes, not
labels; money as `1234.56`; dates as `YYYY-MM-DD`.

- **The columns are the person's visible columns, in the table's order**, read
  through `readGridColumns`, so the file matches the screen it came from.
- **The filename is `zebra-loads-<view>-<yyyy-mm-dd>.csv`**, where the view is
  the `?view=` name, or `all` without one, and the date is the default
  authority's today.
- **One reader builds the rows for the page and the export**, `readLoadRows` in
  `src/lib`, so the two cannot describe a load differently. The agreement test
  requires the export's row count to equal the list's count, above zero.
- An **Export** button sits top-right with Add load, because it belongs to the
  page and not to a tab (§7.1.6).

**8 — Row expand and row menu** _(second chain)._

- **A chevron opens a continuation row (§7.1)** under its load. It lists the
  stops in order, each with its place and its local date and time (§8, rule 3);
  the load's notes, newest first, up to five; and every warning in words. The
  stops and warnings ride with the row. The notes are read when the row opens,
  through one server action, because reading them for a hundred rows on every
  render would cost a statement nobody asked for. **Open or closed is not
  stored**: a reload closes every row.
- **A menu at the row's end holds Open, Copy load number, and Attach POD.**
  _Owner's ruling of 2026-10-09:_ the Phase 2 rule stands, and nothing sets POD
  received by hand. **Attach POD links to the POD slot** of the load's
  documents panel, `/loads/<id>#pod`. It is offered only where a POD can still
  matter: the role may upload documents, the load is not cancelled, it has not
  reached POD received, and it is not direct-settled, since that freight
  reaches POD with Delivered.
- The chevron and the menu sit in cells of their own, like the selection
  checkbox. They are controls, not columns, and are not counted against the
  cap.

**9 — Columns chooser and density** _(second chain)._ Density moves from the
saved-views row into the filter bar's row two, and the chooser moves from the
page header to the same row. Both still store per user. The browser walk
hides a column, reloads, and requires it still hidden, then restores it.

**The list, second pass: six tabs, one toolbar** _(added 2026-11-16, the
owner's brief from Islom's Datatruck screenshot, kept at
`corpus/datatruck-loads-2026-11-16.png`. For `/loads` this replaces the
two-row filter bar above, the Columns paragraph's default set and order, and
item 6's chips; the predicates of Upcoming and Unpaid are unchanged, and the
saved-views row leaves this page)._

- **Tabs, exactly six, each with its count:** All loads · Upcoming ·
  Dispatched · In transit · Delivered · Unpaid. `?tab=`; none is All loads.
  ONE PREDICATE PER TAB, in `src/lib/load-tabs.ts`, spelled once for Prisma
  and once in the grouped count's SQL:
  - **Upcoming** — item 6's `upcoming`.
  - **Dispatched** — not cancelled; `DISPATCHED` or `AT_PICKUP`.
  - **In transit** — not cancelled; `LOADED`, `IN_TRANSIT` or `AT_DELIVERY`.
  - **Delivered** — not cancelled; `DELIVERED` or `POD_RECEIVED`. Closed
    history is included: it was delivered.
  - **Unpaid** — item 6's `unpaid`.

  A tab's count honours every other filter on the toolbar and ignores the
  tab, as a chip's does (§7.4), and comes from the same one grouped statement.
  The agreement test requires each tab's count to equal its rows, both above
  zero. _Flagged against §7.1.6, whose test makes anything writable as a filter
  a chip: the owner's brief names these six as the list's top-level questions,
  Datatruck's shape, and the brief is what overrides the test on this list._

- **The invoicing chips leave this page** and become tabs of Billing →
  Invoice, where accounting works: POD received · Ready to invoice ·
  Uninvoiced · Invoiced · Partially paid · Paid, after the Invoices grid and
  before Factored and Direct-settled. Each keeps the predicate its chip had:
  POD received is the status, Ready to invoice the `readyToInvoiceWhere`
  predicate (the queue it already was), the other four the billing column.
  The four new ones list LOADS — no invoice exists for an uninvoiced load — in
  pages of a hundred, and the agreement test holds each count to its rows,
  both above zero. The Invoices grid stays the default tab, so its strip and
  aging keep their links.
- **No caption.** "Stripe shows operational status" is removed; the stripe
  still means it.
- **Warnings are off by default**, and stay in the chooser. A load with
  warnings shows a small dot after its number — named for a screen reader
  and on hover ("2 to fix"), never colour alone — and nothing more; the
  expand lists them in words. _Flagged against §7.1.7's "the warnings column
  is never default-hidden": the dot is what stops an absent column from
  saying "nothing wrong", which was that rule's whole reason._
- **Default columns, in order:** Load · Ref · Status · Customer · Driver ·
  Truck · Trailer · Authority · Pickup · Delivery · DEL date · Documents.
  Billing, Rate and Warnings are behind the chooser. TWELVE with more than one
  authority, eleven with one, so `/loads` is capped at twelve (§7.1.7).
  - **Ref is its own column**, no longer a second line under the number.
  - **Pickup and Delivery are "City, ST"**, the zip on hover. A stop with
    neither prints its facility name, as `stopPlace` always has — the Relay
    export carries no addresses, and the cell would otherwise be blank on
    every Amazon load. The facility, the full stop and the zip are in the
    expand, on every stop.
  - **Documents** names the load's rate confirmation, BOL and POD where they
    exist — `RC · BOL · POD` — with `+n` for any other kind, and an em
    dash for none. Read with the rows, no statement of its own.
- **The new default reaches everyone once.** Every stored choice for this
  grid was made against the old set, and column memory (above) would add each
  new column on top of it until the cap dropped Documents and DEL date off the
  end. So the grid's memory moves to a new key, `columns.loads.loads.v2`; the
  old rows are left and read by nothing.
- **One toolbar row, nothing else above the table:** Filter · Pickup date ·
  Delivery date · Reference search · Authority · Export · Density · Columns.
  The page's title is the breadcrumb's (a heading for screen readers only),
  and New load sits at the end of the tab row. **Filter** opens the two date
  presets, the broker, the driver and Clear filters; **Pickup date** and
  **Delivery date** each open a from–to range, one at a time, because the list
  holds one view.

### 6.8 The route matrix — who reaches what — _added 2026-10-10_

_Owner's brief of 2026-10-10: the sweep signs in as the owner AND a dispatcher
and holds every protected page to this table; extended the same day to admin,
manager, accounting and driver — every role in `enum Role`. Before this section nothing
stated per-route access in prose; §6.2 named groups, and `permissions.ts`
decided. This table is the INTENT, written from §6.2's groups and the role
rules recorded in the briefs and the UAT. It is deliberately not generated
from `permissions.ts`, because a sweep that checked the code against a copy of
the code would agree with itself (AGENTS.md: build the instrument from the
artefact)._

- **`reach`** means HTTP 200 with no error boundary. **`refuse`** means a 4xx;
  the app answers 404 for a route the role does not hold (§13.10). **`redirect`**
  means a 3xx to a route of the same role. A server error is never an
  acceptable answer, in any column.
- **The sweep reads THIS TABLE**, by its rows: `scripts/sweep.mjs` parses the
  rows between this section's two markers. `tests/sweep.test.ts` fails by name
  for a page that has no row, or a row that names no page.
- **The owner's pass honours the table too** (_amended 2026-11-12, before the
  code_). Until the driver portal every row said `reach` for the owner, so
  the owner's pass could count any 4xx as a fault by construction — and did.
  The four portal rows say `refuse` for the owner, and the first deploy sweep
  after them (run 43228750311 on `3ad274b`) printed `CLIENT ERROR 404:
/portal` four times and was NOT OK on the table's own answer, with the
  matrix half of the same verdict reading 0 new disagreements. So a 4xx on
  the owner's pass for a route whose row refuses the owner is _refused by
  the table_: listed by name, counted neither as rendered nor as a problem.
  A 4xx where the row says `reach` stays the fault it always was.
- **Changing a role is `user:update` on `/users`, OWNER and ADMIN only, and
  two limits hold inside it** (_owner's ruling 2026-11-13, accepting §6.11
  as built_): an ADMIN may not change an OWNER's role — nor grant OWNER —
  so ownership moves only by an OWNER's hand; and DRIVER is neither granted
  nor removed from `/users`, because the driver link owns that sign-in and
  its Driver record. Both are refusals by name in `changeUserRole`, and the
  screen does not offer them (`roleChoicesFor`).
- **A row that disagrees with the code is a GAPS row**, and its last column
  names it as `GAPS n`. The sweep still prints that row, as KNOWN, and does not
  count it as a new problem. A disagreement with no GAPS reference is a problem
  and makes the verdict NOT OK.
- **The dispatcher's rule, from §6.2 and the UAT's Tier 1:** Operations, Fleet
  (with Safety) and Records are the dispatcher's work; Accounting, Payroll,
  every money document, and Admin are not. A dispatcher creates brokers and
  loads. _Amended by the owner's rulings of 2026-10-10 (GAPS 13–16):_ a
  dispatcher OPENS Authorities read-only, because they need to know which MC a
  load books under; does NOT create trucks, trailers or drivers, because
  roster creation is safety's job (this supersedes Phase 2's opening sentence
  for those three); and RECORDS a cargo claim or a roadside inspection — read
  and create, never update — because the dispatcher is the first to hear of
  either and safety reviews, edits and settles.
- **Two calls made here, both RULED by the owner on 2026-10-10.**
  `/safety/random` is REFUSED to a dispatcher, and the code changes to match:
  under 49 CFR Part 40 confidentiality, selection lists are owner/safety only
  (GAPS 17, the one that matters, shipped first and alone). `/documents` is
  REACHED: the documents a dispatcher handles (rate cons, PODs, BOLs) live
  there, and the money fields on them are the page's business to omit, not the
  route's to refuse.
- **Four more, RULED by the owner on 2026-10-11 (GAPS 19–22).** The DQF
  roster is REFUSED to accounting, and the code changes: the qualification
  file is safety's, so it gets a permission of its own (`dqf`) held by the
  roles that run fleet and safety, never by accounting or a driver. That
  permission guards the roster, the Safety hub's link to it, and the DQF
  checklist on the driver record — the same file, one driver at a time.
  Accounting CREATES brokers, and the matrix changes: an accountant adds a
  broker to invoice one. Accounting OPENS trailers read-only, and the code
  changes: read, never create or update. A manager is REFUSED factoring, and
  the matrix changes: factoring is Accounting's.
- **What `dqf` covers, RULED by the owner on 2026-10-11 (GAPS 23).** The file
  itself — its documents, its gaps, its dates — and nothing else. The drivers
  list's "DQF incomplete" warning, the "not ready" reason beside it and the
  dashboard's DQF ring are READINESS SIGNALS, not the file, and accounting
  sees them: an unready driver does not get a paid load, and accounting needs
  to know which. So they stay on `compliance`, and accounting sees the flag
  while the roster refuses it.
- **A server error is evidence, not weather (owner's ruling, 2026-10-11).**
  When any page answers 500 for any role, the sweep records the request's
  `cf-ray`, the role, the route, the first 2 KB of the response body and the
  Worker's log for that ray — read from a `wrangler tail` the sweep runs for
  its whole length — and writes them into its run-status verdict file, where
  `--check` prints them. "Transient" is a finding only once that record
  exists. A page that answers 500 on a sweep is a GAPS row, not a re-run.
- **The dev deploy is not finished until every page has rendered (owner's
  brief, 2026-11-11).** Twice on 2026-11-10 a `/trucks` that answered 500 to
  every role reached dev on a green CI (GAPS, the process row): the unit
  tests read the page's source and the integration tests call the lib, so
  nothing before the deploy rendered the page, and the chain's own dev probe
  was the first request to. So the dev deploy job in `ci.yml` ends with the
  rendered-page check, in this order, each step on the deploy's own
  condition. FIRST, Cloudflare is asked which commit dev now serves:
  `check-deploy-drift.mjs --require-current dev` reads the deployment back
  and REFUSES unless dev's stamp is HEAD — a clean sweep of the previous
  version would be exactly the false green this step exists to prevent, and
  the baseline is read from the thing measured, never supplied. THEN the
  same six-role sweep the nightly runs (this section's table, every
  `page.tsx` under `src/app`, with and without a session, the Worker's log
  tailed for its length) renders every page, and its verdict is read from
  the status file `deploy-sweep`. WHAT FAILS IT: a 5xx or an error-boundary
  render for any role, an anonymous request not refused, a NEW matrix
  disagreement, a stalled sign-in, an invocation claimed twice. Its detail
  file leaves with the run as the artifact `deploy-sweep-<run id>`, pass or
  fail. ONE EXCEPTION, UNTIL GAPS 44'S PROBE READS CLEAN BESIDE A RED SWEEP
  (owner's ruling, 2026-11-13; ruling 7 the same day: the probe read clean
  once beside a clean sweep, and one clean beside clean proves nothing — the
  exemption retires when the probe reads clean on an afternoon the sweep
  reads red, the reading that would explain the ceiling rather than miss
  it): a 5xx whose worker account — the tail event for its own
  ray — names the memory ceiling (`exceeded memory limit`, as the runtime
  writes it in `Dynamic import exceeded memory limits` and `Worker exceeded
memory limit`) is a MEMORY-CEILING 500: printed by name with its role,
  route, ray and the worker's line, kept in the detail file, and NOT
  counted as a problem — on the five sweeps of 2026-11-12/13 it was the
  only fault, 21–28 of 30–33 server errors on four commits three of which
  changed no code, and a receipt that reads red on a fault the code did not
  cause vouches for nothing. A 5xx with NO worker account stays a fault: the
  exemption needs the runtime's own word, not the hour's likely cause.
  The same 5xx is also a matrix disagreement for its role, and that
  disagreement is named and not counted on the same condition. The
  verdict says how many it named (`SWEEP CLEAN EXCEPT THE CEILING — OK …
N MEMORY-CEILING 500(S) NAMED`), so a clean read and a named read are
  never the same line. The cost is the browser install and about fifteen minutes on every
  push that deploys; the nightly keeps its own run on its own clock, and the
  GAPS 40 count reads the nightly alone.
- **The sweep measures the application, not Neon waking up (owner's ruling,
  2026-10-12, closing GAPS 24).** Both Neon computes had scale-to-zero on;
  a sign-in that stalled past 90 s was the compute's cold start on the first
  request after idle, and the 6.7 s transaction start that answered 500 on a
  sweep was the same wake-up. Production is now ALWAYS AWAKE (scale-to-zero
  off, a 0.25 CU floor) and MUST NEVER HAVE IT RE-ENABLED; dev keeps
  scale-to-zero by choice. So, before anything else — before its own
  id-resolving connection, which would otherwise be the wake-up nobody
  measured — the sweep WARMS DEV with one direct `SELECT 1` and one `GET
/login` answered 200, and records both wall times in its verdict file as
  `coldStart`, separately from every sign-in that follows.
- **Production's first query is checked, not assumed.** A cold start shows
  in the sign-in's first-query span (`rateLimitMs`, the socket open plus the
  rate-limit read) as 5 s or more; warm, it is under 2 s. So
  `scripts/prod-signin-check.mjs` signs in to production ONCE as the Live
  Check account, reads that span from production's own Worker log through
  `wrangler tail`, and FAILS at 3 s. It runs after the dev sweep in the
  ritual, and without the Live Check credentials (GAPS 8) it reports NOT
  OK by name rather than passing in silence.
- **The sign-in stall was the Worker's memory limit, not Neon (owner's
  ruling, 2026-10-12, GAPS 28; row 24 was closed in error).** Three warm
  sweeps caught it in the Worker's own log: the fifth sign-in of each sweep
  — after four roles' dashboards had rendered on the isolate — ended at ~3 s
  with `exceededMemory`, a 503 nobody received, and the browser waited the
  full 90 s; the retry on a fresh isolate took 3.5 s. argon2id at m=19456
  allocates ~19 MiB per verify, and on a warm isolate that is the allocation
  that crosses 128 MB. **The profile is now argon2id m=7168, t=5, p=1** (7 MiB,
  OWASP's low-memory recommendation; the same order of work, ~8% less) **with
  rehash-on-login**: verify honours the parameters encoded in the stored
  hash, so every existing hash still verifies, and a successful verify
  against any hash NOT at the current profile rewrites it at the current
  profile in the same request — "not current", not "weaker", because the new
  profile is lower on memory and higher on passes and the two do not order.
  Acceptance: zero `exceededMemory` across 18 sign-ins over three sweeps.
- **A request's database connection ends with the request (owner's rulings,
  2026-10-12, GAPS 31 and 32).** Measured: every invocation — the sign-in
  POST, the dashboard render, even a driver's shell-only render — held ~10 s
  of Worker wall after its response, with no CPU and no log line. Nothing
  closed the request's Neon pool; its default `idleTimeoutMillis` is 10,000
  ms, and OpenNext's `ctx.waitUntil` held the invocation until the idle
  socket dropped. And one dashboard render built about ten Prisma clients —
  ten pools, ten socket opens — because every `withCurrentOrg` opened a fresh
  request scope, and the shell's account read built its own. So:
  **ONE CLIENT PER REQUEST**, the request's: a scope already open is reused,
  never nested; a scope is seeded from React's per-request client; the
  sign-in, the account read and the inbound-email store take the request's
  client rather than constructing one. **AND IT ENDS WITH THE RESPONSE**: the
  client is disconnected in `after()` (OpenNext runs it under
  `ctx.waitUntil`), with `idleTimeoutMillis` on the pool as the floor where
  no request scope exists. Acceptance: Worker wall ≤ work + 1,000 ms on 18 of
  18 sign-ins and 18 of 18 dashboard renders; the shell's account span ≤ its
  session span + 200 ms.
- **THE FLOOR IS 5,000 ms, NOT 1,000 (owner's ruling, 2026-10-13).** At 1 s
  the pool closed connections DURING a request: the sign-in's closing writes
  (two queries in parallel, after the ~1 s argon2 gap) rose from 232 to 845
  ms median because the second pooled connection had been closed and was
  reopened. `after()` remains what ends the pool; the floor only bounds a
  client no request scope ended. Acceptance: closing writes ≤ 300 ms median,
  and Worker wall ≤ action + render + 1,000 ms — no linger.
- **Row 32 stays open, pointed at row 33.** The account read is on the
  request's client (grep-proof in `ef15d80`); its remaining ~500 ms over the
  session read is a socket open while the page's parallel reads hold the
  pool's open connections, which is the cost Hyperdrive exists to remove.

<!-- route-matrix:start -->

| Route                       | Owner    | Admin    | Manager  | Dispatcher | Accounting | Driver   | Note                                        |
| --------------------------- | -------- | -------- | -------- | ---------- | ---------- | -------- | ------------------------------------------- |
| `/account`                  | reach    | reach    | reach    | reach      | reach      | reach    | everyone's own account                      |
| `/accounting/invoices`      | reach    | reach    | reach    | refuse     | reach      | refuse   | Billing; a manager reads                    |
| `/accounting/payments`      | reach    | reach    | reach    | refuse     | reach      | refuse   | Billing; a manager reads                    |
| `/accounting/reports`       | reach    | reach    | reach    | refuse     | reach      | refuse   | Billing; a manager reads                    |
| `/audit`                    | reach    | reach    | refuse   | refuse     | refuse     | refuse   | Admin                                       |
| `/brokers`                  | reach    | reach    | reach    | reach      | reach      | refuse   | Customer Management — Customers             |
| `/brokers/[id]`             | reach    | reach    | reach    | reach      | reach      | refuse   | Customer Management — Customers             |
| `/brokers/new`              | reach    | reach    | reach    | reach      | reach      | refuse   | ruled 20: accounting adds one to invoice    |
| `/companies`                | reach    | reach    | reach    | reach      | reach      | refuse   | ruled 13: read-only, which MC books it      |
| `/companies/[id]`           | reach    | reach    | refuse   | refuse     | refuse     | refuse   | Admin — Authorities                         |
| `/companies/new`            | reach    | reach    | refuse   | refuse     | refuse     | refuse   | Admin — Authorities                         |
| `/dashboard`                | reach    | reach    | reach    | reach      | reach      | refuse   | org-wide; money panels per role             |
| `/dispatch`                 | reach    | reach    | reach    | reach      | refuse     | refuse   | accounting does not dispatch (Phase 3)      |
| `/documents`                | reach    | reach    | reach    | reach      | reach      | refuse   | Load Management; ruled: dispatcher reaches  |
| `/drivers`                  | reach    | reach    | reach    | reach      | reach      | refuse   | HR Management; accounting pays drivers      |
| `/drivers/[id]`             | reach    | reach    | reach    | reach      | reach      | refuse   | HR Management; tabs per role                |
| `/drivers/new`              | reach    | reach    | reach    | refuse     | refuse     | refuse   | ruled 14: roster creation is safety's       |
| `/exports`                  | reach    | reach    | reach    | refuse     | reach      | refuse   | CSV of a grid; swept as payments.payments   |
| `/invoices/[id]`            | reach    | reach    | reach    | refuse     | reach      | refuse   | a money document                            |
| `/loads`                    | reach    | reach    | reach    | reach      | reach      | refuse   | Load Management; accounting reads (Phase 3) |
| `/loads/[id]`               | reach    | reach    | reach    | reach      | reach      | refuse   | Load Management; fields per role            |
| `/loads/export`             | reach    | reach    | reach    | reach      | reach      | refuse   | CSV of /loads, its row                      |
| `/loads/import`             | redirect | redirect | redirect | redirect   | redirect   | redirect | a pure redirect to its first tab, no data   |
| `/loads/import/trips`       | reach    | reach    | reach    | reach      | refuse     | refuse   | creates loads; accounting does not book     |
| `/loads/incoming`           | reach    | reach    | reach    | reach      | refuse     | refuse   | creates loads; accounting does not book     |
| `/loads/new`                | reach    | reach    | reach    | reach      | refuse     | refuse   | creates loads; accounting does not book     |
| `/maintenance`              | reach    | reach    | reach    | reach      | reach      | refuse   | Maintenance — Work Orders; carries costs    |
| `/payments/[id]`            | reach    | reach    | reach    | refuse     | reach      | refuse   | a money document                            |
| `/payments/import`          | reach    | reach    | refuse   | refuse     | reach      | refuse   | sets money; a manager reads, does not set   |
| `/payments/new`             | reach    | reach    | refuse   | refuse     | reach      | refuse   | sets money; a manager reads, does not set   |
| `/payroll/batches`          | reach    | reach    | reach    | refuse     | reach      | refuse   | Payroll — Driver Pay; a manager reads       |
| `/payroll/batches/new`      | reach    | reach    | refuse   | refuse     | reach      | refuse   | sets pay; a manager does not                |
| `/payroll/charges`          | reach    | reach    | reach    | refuse     | reach      | refuse   | Payroll; a manager reads                    |
| `/payroll/statements`       | reach    | reach    | reach    | refuse     | reach      | refuse   | org-wide; a driver's own is not this page   |
| `/portal`                   | refuse   | refuse   | refuse   | refuse     | refuse     | reach    | Phase 7: the driver's own current load      |
| `/portal/documents`         | refuse   | refuse   | refuse   | refuse     | refuse     | reach    | Phase 7: the driver's own documents         |
| `/portal/loads`             | refuse   | refuse   | refuse   | refuse     | refuse     | reach    | Phase 7: the driver's own loads             |
| `/portal/settlements`       | refuse   | refuse   | refuse   | refuse     | refuse     | reach    | Phase 7: own, finalised only (§4.2)         |
| `/receivables/factoring`    | reach    | reach    | refuse   | refuse     | reach      | refuse   | ruled 22: Billing's; not a manager's        |
| `/safety`                   | reach    | reach    | reach    | reach      | reach      | refuse   | Safety — Compliance; accounting reads       |
| `/safety/accidents`         | reach    | reach    | reach    | reach      | reach      | refuse   | accounting reserves against claims          |
| `/safety/claims`            | reach    | reach    | reach    | reach      | reach      | refuse   | ruled 15; accounting reserves               |
| `/safety/claims/[id]`       | reach    | reach    | reach    | reach      | reach      | refuse   | ruled 15: read; no edit controls            |
| `/safety/claims/new`        | reach    | reach    | reach    | reach      | refuse     | refuse   | ruled 15: the dispatcher hears first        |
| `/safety/dqf`               | reach    | reach    | reach    | reach      | refuse     | refuse   | ruled 19: the safety file, not accounting   |
| `/safety/inspections`       | reach    | reach    | reach    | reach      | reach      | refuse   | Fleet Management — Inspections              |
| `/safety/inspections/[id]`  | reach    | reach    | reach    | reach      | reach      | refuse   | Safety                                      |
| `/safety/inspections/new`   | reach    | reach    | reach    | reach      | refuse     | refuse   | ruled 16: record; safety edits              |
| `/safety/random`            | reach    | reach    | reach    | refuse     | refuse     | refuse   | ruled 17, 18: Part 40, owner/safety only    |
| `/safety/testing-summary`   | reach    | reach    | reach    | refuse     | reach      | refuse   | ruled 18: counts only, §6.9                 |
| `/settings`                 | reach    | reach    | refuse   | refuse     | refuse     | refuse   | Admin                                       |
| `/settlements/[id]`         | reach    | reach    | reach    | refuse     | reach      | refuse   | a money document                            |
| `/settlements/batches/[id]` | reach    | reach    | reach    | refuse     | reach      | refuse   | a money document                            |
| `/trailers`                 | reach    | reach    | reach    | reach      | reach      | refuse   | ruled 21: accounting opens, read-only       |
| `/trailers/[id]`            | reach    | reach    | reach    | reach      | reach      | refuse   | ruled 21: accounting opens, read-only       |
| `/trailers/new`             | reach    | reach    | reach    | refuse     | refuse     | refuse   | ruled 14: roster creation is safety's       |
| `/trucks`                   | reach    | reach    | reach    | reach      | reach      | refuse   | Fleet Management; truck financials          |
| `/trucks/[id]`              | reach    | reach    | reach    | reach      | reach      | refuse   | Fleet Management; truck financials          |
| `/trucks/export`            | reach    | reach    | reach    | reach      | reach      | refuse   | CSV of /trucks, its row                     |
| `/trucks/new`               | reach    | reach    | reach    | refuse     | refuse     | refuse   | ruled 14: roster creation is safety's       |
| `/users`                    | reach    | reach    | refuse   | refuse     | refuse     | refuse   | HR Management                               |
| `/users/new`                | reach    | reach    | refuse   | refuse     | refuse     | refuse   | HR Management                               |

<!-- route-matrix:end -->

- **THE EXPORT ROUTES ARE ROWS, AND EVERY EXPORT LINK IS FOLLOWED (owner's
  report 2026-11-16, v11.12).** Export CSV on every grid linked to
  `/accounting/export`, which stopped existing on 2026-09-28 when the handler
  moved to `/exports` (`d9544cb`); it answered 404 for seven weeks because
  the sweep fetched `page.tsx` routes only. So the sweep also takes every
  `route.ts` under a directory named `export` or `exports`, each held to its
  row here — the roles of the page it exports, read on dev before the rows
  were written: dispatcher and driver 403 on `/exports`, driver 403 on the
  other two — with `/exports` asked for `?grid=payments.payments`. A route
  handler refuses a stranger with 401 rather than a redirect, and both count
  as refused. And every export `href` a page renders for the owner is
  fetched once: anything but a 200 is a problem, by link and page.

- **The seed role accounts exist on dev only.** `prisma/seed.ts` creates one
  account per role the sweep holds to this table — `SEED_ADMIN_EMAIL`,
  `SEED_MANAGER_EMAIL`, `SEED_DISPATCHER_EMAIL`, `SEED_ACCOUNTING_EMAIL` and
  `SEED_DRIVER_EMAIL` — each a member of the operating group across every
  authority in that role, beside the isolation counterpart and behind the
  same never-in-production branch. Each password comes from the matching
  `SEED_<ROLE>_PASSWORD`, which the sweep reads too, and none is printed.

- **The four columns added on 2026-10-10 (owner's brief, same method).**
  Admin: everything, as the Live Check ADMIN account's checklist expects (the
  owner less deleting the organization, which no page does). Accounting: the
  Accounting and Payroll groups and every money document, never Admin (UAT
  Tier 1: "Money group present, Admin absent"); it READS operations because
  an invoice is built from a load, and does not book or dispatch (Phase 3).
  Manager: runs operations, fleet and safety; READS money, including what a
  driver is paid, and does not set it (the role note the code's comments
  cite as §1, and the Phase 2 flag on promoting a dispatcher to manager); no
  Admin. Driver: **nothing org-wide**, owner's words — "a driver must see only
  their own loads, statements and documents" — and every one of these 54
  pages is org-wide, so a driver reaches only their own account; the driver
  portal is a separate surface (UAT wrote "Driver portal: Phase 6"; it is
  **Phase 7**, `PHASE-7-BRIEF.md`, by the owner's ruling of 2026-11-12). Rows
  marked _(inferred)_ are calls made here where no source speaks; a
  disagreement on one is a GAPS row like any other.

- **The driver portal's rows — the intent, written before the pages
  (Phase 7 step 0, owner's rulings 2026-11-12).** Four portal routes —
  `/portal` (the current load), `/portal/loads`, `/portal/documents`,
  `/portal/settlements` — are `reach` for Driver and `refuse` (404, §13.10)
  for Owner, Admin, Manager, Dispatcher and Accounting: the portal is the
  driver's surface as the 55 pages above are the office's, and an operator
  role that opens it is refused like any route it does not hold. `/account`
  stays everyone's. THE ROWS ENTER THE TABLE IN THE COMMIT THAT CREATES THE
  PAGES (step 2), not before: `tests/sweep.test.ts` fails by name on a row
  that names no page, and the sweep counts one as a problem (`matrix row,
no page`) — a decision about nothing would turn every nightly red. In that
  same commit the pin "a driver reaches only `/account`" becomes the five
  routes, and `/portal` joins the sweep's walk like every other `page.tsx`.
  Until then this paragraph is the decision, and the brief's step 0 names
  this constraint as its flag 5. _Entered 2026-11-12 with the pages (step 2,
  v10.87): the four rows sit in the table above, the driver column reaches
  `/account` and the four, and the sweep walks `src/app/(portal)` as it
  walks everything else._

### 6.9 The testing summary — counts, never names — _added 2026-10-11_

_Owner's ruling on GAPS 18, 2026-10-11._ Accounting is refused the random pool
(`/safety/random`), like the dispatcher: under 49 CFR Part 40 confidentiality
the selection lists are owner/safety only. The code's stated reason for
accounting's access was real — "accounting is asked for the year-end summary
at insurance renewal" — but that need is a COUNT, not a list. So it gets its
own page, and the pool keeps its people to itself.

- **`/safety/testing-summary`**, one year at a time (`?year=`, default the
  current year), one table per authority, one row per quarter: **pool size,
  then selections and tests completed for DRUG and for ALCOHOL**. Pool size is
  the quarter's draw's own `poolSize` (one draw per authority per quarter, by
  the schema's unique key); selections count `RandomSelection` rows by kind;
  completed counts outcome `TESTED`. A quarter with no draw says so in words
  rather than printing zeros that look like a draw that selected nobody.
- **Numbers only, no names, no results.** The reader selects counts in the
  database and returns no field that names a person or a driver id; results
  are not stored anywhere in Zebra, and NOT_TESTED reasons are not shown. An
  integration test asserts the page's data carries no name, no driver id and
  no memberKey, against a pool whose names it knows.
- **Who:** owner, admin, manager (safety) and accounting — a resource of its
  own, `randomTesting.summary:read`, so granting the summary can never grant
  the pool. Not a dispatcher, not a driver (§6.8).
- **Reached from the Safety hub**, beside the pool's link, for the roles that
  hold the summary.
- **Shipped first and alone**, with the refusal it makes safe: refusing
  accounting the pool without the summary would have cut off the renewal
  figure the ruling says is real.
- **The pool has a second door, closed 2026-10-11.** The driver record's
  Safety tab listed THAT driver's random selections — quarter, date drawn,
  outcome, date tested, the excuse reason — to every role with
  `compliance:read`, which a dispatcher and accounting both hold. That is the
  pool, one person at a time, and rulings 17 and 18 refuse it. Found while
  reading ahead for GAPS 19, after 18 had shipped. **A driver's selections
  follow the pool's rule: loaded and shown only to a role that reads
  `randomTesting`.** For any other role the panel is ABSENT, not empty —
  "no draws" would tell a dispatcher this driver was never selected, which is
  itself a disclosure. `drawsForDriver` takes the session and returns nothing
  without the permission, before it touches the database, so a future screen
  that calls it cannot reopen the door by forgetting the check.

### 6.10 The connection path — _added 2026-10-12 (GAPS 33)_

**Today.** Every request builds one Prisma client (§6.8, GAPS 32) on
`@prisma/adapter-neon`, whose pool opens WebSockets from the Worker to Neon's
proxy in us-east-2. Each socket open is a TLS and Postgres handshake across
that distance: measured 2026-10-12, the request's first query takes 1,620 ms
median (1,808 worst), and the dashboard's seven parallel transactions, each
needing its own connection, fan out in 3,791 ms median (4,662 worst).

**The candidate: Cloudflare Hyperdrive, on DEV ONLY until ruled.** Hyperdrive
keeps warm connections to the database near it and gives the Worker a
connection string to a pooler at the edge, so the handshake the Worker pays
is local. It speaks plain Postgres over TCP, not Neon's WebSocket protocol,
so that path uses `@prisma/adapter-pg` over `pg` (Workers TCP sockets under
`nodejs_compat`). Everything above the adapter is unchanged: interactive
transactions, `SET LOCAL app.current_org_id`, row-level security, the audit
extension, one client per request ended in `after()`.

- **The switch is the binding.** `createPrismaClient` uses `@prisma/adapter-pg`
  over the `HYPERDRIVE` binding's connection string when the Worker has one,
  and `@prisma/adapter-neon` otherwise. The binding is declared at the top of
  `wrangler.jsonc` — the dev worker. The `production` environment does not
  inherit bindings (wrangler's rule, written there), so production keeps the
  Neon path with no code difference. Tests, seeds and scripts run under Node
  with no binding and keep the Neon path.
- **The origin is `zebra_app` on Neon's DIRECT endpoint**, not its pooler —
  Hyperdrive is the pooler. **THE ROLE IS ASSURED BY THE HYPERDRIVE CONFIG,
  NOT BY THE STRING** (corrected 2026-10-23, after the first three Hyperdrive
  sweeps): the binding's connection string carries Hyperdrive's own generated
  user and password at a `*.hyperdrive.local` host, and the origin's user —
  `zebra_app` — lives in the config Cloudflare holds. A guard that looked for
  `zebra_app` in that string refused every request, a 500 in 10–35 ms, six
  of six sign-ins. So on this path the client requires a `*.hyperdrive.local`
  string and refuses anything else — a Neon URL pasted into the binding, or
  any string naming the owner role — and the role itself is READ BACK: the
  sweep runs `wrangler hyperdrive get` on the bound config before it sweeps
  and refuses to start unless `origin.user` is `zebra_app` and
  `caching.disabled` is true. Production keeps `DATABASE_URL`'s own
  `zebra_app` check, as before (§1: the owner bypasses RLS).
- **QUERY CACHING IS OFF, AND MUST STAY OFF.** Hyperdrive can cache read
  results keyed on the query text and parameters. Row-level security makes
  the same text return different rows per tenant through a session variable
  the cache key does not see — a cached read is a cross-tenant read. The
  config is created with caching disabled, and the check that it still is
  goes in the ritual for as long as the binding exists.
- **A sign-in renders its destination in the same response — expected, not
  missing (owner's ruling, 2026-10-13).** A server action that calls
  `redirect()` returns the destination page's payload in its own response:
  the sign-in POST carries the 303 AND the dashboard (129,141 bytes, shell
  and page, measured 2026-10-13), and the browser makes no separate request
  for it. Since one client per request (GAPS 32) this is what every sign-in
  does; "no GET" is the design. (Playwright's `response.body()` reports 73
  bytes for that 303 — it drops the payload; `route.fetch()` reads the whole
  body.)
- **The render is measured on its own request (owner's ruling, 2026-10-23,
  amending the ruling of 2026-10-13).** After each sign-in the sweep GETs
  `/dashboard` with the new session and reads `shell.timing` and
  `dashboard.timing` from THAT invocation, by its own ray and from nothing
  else — no time window. A sweep in which two sign-ins match the same
  invocation is NOT OK. **Known limitation, recorded once and not to be
  chased:** logs written during the render inside the sign-in POST do not
  reach the tail — not from a plain `console.log`, not from `after()`; 18 of
  18 sign-in POSTs on 2026-10-13 carried exactly the action's two lines.

  _Amended 2026-11-10 (owner's brief, before the code). The nightlies of
  2026-11-08 and 2026-11-09 were both NOT OK on exactly one problem,
  `SHARED MATCH <ray>: accounting#1, driver#1` — one invocation claimed by two
  sign-ins — and the cause could not be read: the detail file that names every
  claimed ray stayed on the runner, and the log prints only the verdict. Two
  mechanisms, measurement first, nothing in the application:_
  - **A ray is claimed once.** The matcher hands an invocation to the FIRST
    sign-in that claims it — by the POST's ray, by the window a stalled POST
    falls back to, or by the dashboard GET's ray — and a second claimant gets
    nothing: its record says `ray <ray> already claimed by accounting#1`, the
    verdict prints `UNMATCHED driver#1: …` by name, and it counts as a problem,
    because a sign-in without its measurement is a missing reading and
    unreadable is not clean. What it is never again is a measurement reported
    under the wrong role. `SHARED MATCH` stays as the guard behind it, now
    impossible by construction and still asserted.
  - **CI keeps the sweep's detail file.** Every nightly, pass or fail, uploads
    `.run-status/nightly-sweep.detail.json` and the sweep log as the workflow
    artifact `nightly-sweep-<run id>`, so the next shared claim is read from
    the file — which sign-in, which ray, which invocation, what the tail held
    — rather than guessed from forty lines of log. The two nights' cause is
    NOT KNOWN until the first artifact is read, and is said so.

  _Amended 2026-11-12 (the cause, read; before the code). The first deploy
  sweep (§6.8, run 43130526821 on `d41b57c`) printed the line this waited
  for — `UNMATCHED accounting#1: sign-in POST: ray a5919fd7097c7b82 already
claimed by dispatcher#1` — and its artifact says how: the dispatcher's own
  POST had NO tail event, the matcher fell back to the window, and the one
  sign-in POST inside that window was accounting's, whose own `signin.timing`
  line says `role: ACCOUNTING`. Claim-once stopped the double measurement;
  the window did the borrowing. So:_
  - **The window is for a stalled sign-in only.** A completed sign-in has a
    ray. When the tail never delivered that ray's event, the record says `no
tail event for this ray within 30 s` and nothing else — never the nearest
    invocation in time, which on 11-08, 11-09 and 11-12 was another role's.
    Only a stalled POST, which has no ray to look up, reads the window.
  - **An invocation names its role.** Its `signin.timing` line carries `role`;
    on either path, an invocation that names another role is refused by name
    (`ray <ray> names ACCOUNTING, not DISPATCHER`) and counted, because a
    tail that hands a sign-in another role's invocation is a reading to
    report, not to average in. Dev's tail dropping sign-in POST events — three
    of six across the two runs read so far — is watched as a measurement; the
    application answered every one of those sign-ins with a 303.

- **Rollback is unbinding**: remove the `hyperdrive` entry from
  `wrangler.jsonc` and deploy dev. The code falls back to the Neon path by
  itself; nothing else changes.
- **Acceptance on dev**, three sweeps: the sign-in's first query and the
  dashboard fan-out, median and worst, against 1,620 / 3,791. **Production
  only on the owner's ruling**, and the gate for asking is a first-query
  median under 500 ms and a fan-out median under 1,500 ms. _Met on
  2026-10-23: 301 / 617 and 1,010 / 1,288 over three sweeps, zero server
  errors._

**Production (owner's ruling, 2026-10-23).** The same path, its own config.

- **A second config, never the dev one.** `zebra-prod-hyperdrive`: origin
  `zebra_app` on PRODUCTION's direct Neon endpoint, query caching disabled,
  created with production's `zebra_app` credential — which lives only as a
  secret on the production worker, so the creation is Islom's command, not
  a script's. Its id is bound as `HYPERDRIVE` under `env.production` and
  nowhere else; the dev binding at the top stays the dev config. The test
  that said "production has no binding" says "production's binding is the
  production config, by id" from the day the binding lands.
- **Read back on every production deploy.** `scripts/deploy.mjs` asks
  Cloudflare for the bound config before the upload and prints the answer
  into the deploy log — `origin user zebra_app, caching disabled true` — and
  refuses the deploy on any other answer, as the sweep already does for dev.
  The guard in `db.ts` is unchanged: a `*.hyperdrive.local` string, never an
  owner-named user.
- **Acceptance:** `npm run check:prod-signin` three times in a row after the
  cutover — first query under 500 ms on all three, no `unavailable` — and
  production's sign-in numbers reported against its own pre-Hyperdrive
  1,906 ms first query and 8,737 ms browser POST.
- **Rollback is removing the `env.production` binding and redeploying.**
  Production falls back to the Neon path by itself; nothing else changes.
- **Before any of this, GAPS 37 is answered:** the sign-in's catch names
  what threw (`signin.error`: class, message, first frame, no PII), shipped
  alone, and three dev sweeps run clean of `unavailable`. One recurrence
  stops the cutover and the logged error goes to the owner.
- **GAPS 37 recurred and is measured before it is fixed** (owner's ruling
  (a), 2026-10-23: production stays on Neon until 37 is understood). Three
  of 39 Hyperdrive sign-ins failed with `Unable to start a transaction in
the given time` at the membership transaction — Prisma's own 2 s wait for
  a pooled connection — and one of them cost 11.7 s of CPU, which a wait
  does not. So, in this order and all of it measurement:
  - THE BUDGET IS OURS. Every transaction opener (`runInOrg`, `withOrg`,
    `runAsUser`) takes `maxWaitMs` and `timeoutMs` and fills what the call
    site leaves out from one named default, `TRANSACTION_BUDGET`: 5,000 ms
    to acquire, 10,000 ms to run. No transaction in the application runs on
    Prisma's defaults. The `signin.timing` line carries both figures beside
    the membership span (`membershipMaxWaitMs`, `membershipTimeoutMs`), so a
    stall is read against the budget it ran under.
  - THE PHYSICAL CONNECT ON THE pg PATH IS TIMED AND LOGGED, FROM INSIDE
    THE CLIENT. (Amended 2026-10-26, owner's ruling 1 on the chain, before
    the code.) The first version had the application build the `pg` pool
    and wrap its `connect()`; a pool the caller builds is "external" to the
    adapter and survives `$disconnect`, and on workerd that socket crossed
    the request boundary — every sign-in hung for 600 s until the runtime
    canceled it (`b406735`, reverted). So THE ADAPTER BUILDS THE POOL, from
    a `PoolConfig` that names two things: `connectionTimeoutMillis` 5,000
    ms, so a connect that does not complete errors by name instead of
    spinning, and a `Client` class whose own `connect()` writes one
    `pg.connect` line when it settles — `wallMs` and `outcome`, a number
    and a word, never the connection string or an error message. There are
    no pool counts on the line: with one pool per request the first
    acquisition IS the connect, and the counts would read 0/0/0 on the
    line that matters. The invocation's `cpuTime` from the tail is the CPU
    beside it. A caller-built pool is never handed to the adapter again;
    `tests/pg-connect.test.ts` refuses `new pg.Pool(` in `db.ts`.
  - READ, DON'T GUESS: the `pg` and `pg-cloudflare` changelogs between the
    pinned versions and current are read for anything about CPU or
    busy-waiting on connect under workerd, and reported in one line. No
    upgrade in this chain.
  - THREE DEV SWEEPS, reporting the `unavailable` count out of 60, every
    `signin.error` by class, and the `pg.connect` distribution — median and
    worst wall, and the CPU of the invocations that carried them. Any
    acquisition inside an invocation with more than 500 ms of CPU is the
    spin, and its surrounding spans are reported with it.
  - THE CUTOVER GATE after this chain, AS AMENDED by the owner's ruling of
    2026-10-26: 0 `unavailable` in the sweeps' sign-ins, **no `pg.connect`
    with wall over 1,000 ms, and no invocation that ends without a
    response**, first query under 500 ms median. The per-acquisition CPU
    test the gate first named — "no `pg.connect` with CPU > 500 ms" — is
    replaced because it cannot be read: workerd reports CPU per
    INVOCATION only, and every sign-in invocation carries argon2id
    (~1.2 s by design) while every dashboard GET carries its render, so
    the connect's own CPU is not separable from the request it sits in;
    the spin the test was after shows instead as a connect that does not
    settle (wall) or a request that never answers (the hang detector), and
    both of those ARE readable. Met on `bc668b3`: 206 ms worst connect
    wall over 149 acquisitions, 0 of 18 invocations without a response,
    first query 334 median. The production binding merges on that ruling;
    until then it stayed parked on its branch, rebased as `main` moved.

- **EVERY REQUEST WRITES A `page.timing` LINE WITH ITS STATEMENT COUNT
  (owner's instruction 2026-11-12 on GAPS 42, before the code; v10.92).**
  The first accountant complaint was "too slow", and the measurement that
  followed (GAPS 42) could rank the 37 Accounting pages by the worker's wall
  and not by query count, because nothing wrote one: the only counts in the
  system were the ones integration tests take with a logging client on
  single functions. So the request's own client counts: `createPrismaClient`
  enables Prisma's query events and counts every statement the client sends
  — BEGIN, `set_config`, the read, COMMIT, each one, the same source the
  two-statement budget reads in `tests/integration/portal.test.ts`, so the
  tail and the budget agree — and `statementsOf(client)` reads the count
  (null for a client not built there, never zero). Each shell layout (the
  operator's and the portal's) schedules the line from `after()` with a
  THUNK, `writeTimingLater`, so the count and the wall are read once the
  response has gone out and include the page's own reads, not only the
  layout's: `{"event":"page.timing","role","statements","totalMs",
"startedAt"}` — numbers and a role, nothing else. The sweep's
  `timingLinesOf` already reads any `.timing` line, and the accounting
  probe ranks by `statements` from it. This is the instrument; the shell's
  own three reads (GAPS 42 item 3) are the first thing it measures.

- **THE SHELL'S THREE READS ARE ONE (owner's instruction 2026-11-12 on GAPS
  42, item 3, before the code; v10.93; migration 71).** Every page the
  operator shell rendered paid three reads before its own, in sequence, each
  a round trip: the session by token hash, the viewer's own name and email,
  and the density preference inside a tenant transaction of its own — 840 ms
  median of `shell.timing` on every one of the 37 Accounting pages (GAPS 42,
  dev at `fef9f8d`), and FIVE statements before the page's first (the
  `page.timing` floor read at `80b4242`: session, account, `set_config`, the
  read, COMMIT). Now ONE statement: `zebra_shell_context(hash)`, a SECURITY
  DEFINER function (the preference is under row-level security, and
  `app.current_org_id` is set only inside a tenant transaction) whose ONE
  PREDICATE ties the preference to the session row the hash found — its own
  user AND its own active organization, never an argument — so a token reads
  its own density and nothing else; `search_path` pinned, STABLE, executable
  by `zebra_app`. `resolveShellContext` (`src/lib/shell-context.ts`) keeps
  the validity checks where `resolveSession` keeps them — revoked, expired,
  inactive, each null — and `getSession` is DERIVED from that one read
  (`getShellContext`, cached per request), so a route or an action pays the
  same one statement it paid before, with two more columns. The density is
  read for every role now, the driver's included — it is the person's own
  row, and a role with no grid simply does not use it; the `company:read`
  gate that used to stand in front of it was a permission on a preference.
  `shell.timing` keeps its fields: `sessionMs` is the one read, `accountMs`
  and `densityMs` are null — not 0 — because they did not run; the sweep
  reads the line as before. The agreement test
  (`tests/integration/shell-context.test.ts`) holds the function's row
  against the three reads it replaces, two organizations, both sides above
  zero, and counts the read as one statement on the request's own client.
  MEASURED BEFORE AND AFTER on dev, the same 37 pages twice through the dev
  tail: recorded in GAPS 42 when taken.
- **THE ISOLATE PROBE — the memory ceiling's own instrument (owner's ruling
  2026-11-13 on GAPS 43, before the code; GAPS 44).** The deploy sweep asks
  one dev isolate for every page as six roles inside twenty minutes, and on
  2026-11-12/13 it read `Dynamic import exceeded memory limits` on 21–28
  requests a run, on four commits — three doc-only, one the revert of the
  only code change the day shipped — while production, read from its
  persisted logs, never reached the ceiling once in a week. Eliminated by
  reading: the bundle (wrangler's own upload figures, 5 KiB apart), the
  item-3 code (the bisect), the runner's colo (clean at DFW, then red at
  DFW). What is left is what a dev isolate holds when asked for every
  distinct route, and no instrument here reads an isolate's memory. So the
  instrument is NARROW and reads the shape instead: `scripts/isolate-probe.mjs`
  signs in as ONE role (the seed account the matrix column names; accounting
  by default), fetches that role's `reach` routes ONCE EACH in a FIXED order
  — the §6.8 table's order, ids from dev — and prints, per request, the
  number of DISTINCT routes the isolate has been asked for so far, the
  status, the runtime's wall and CPU and its word for the failure, ray by
  ray through `startTail`; then a SECOND PASS over the same routes, which
  loads nothing new. The reading is two numbers and a shape: the 500 count
  of each pass, and the distinct-route count at the first 500. A ceiling
  that is the parsed code of distinct routes shows a first 500 at some
  count and a second pass as red as the first's end; a ceiling that is per
  request shows 500s scattered from the start; and a clean probe is zero
  500s on both passes, with the tail having delivered every ray's event
  (an undelivered ray is NAMED, and a probe that could not read its tail
  says NOT OK rather than clean). The ids come from dev's branch only
  (`little-lake` in `DIRECT_DATABASE_URL`, refused otherwise), the tail is
  `startTail` with its deadline, and the exemption in §6.8 holds until this
  reads clean.

### 6.11 Changing a member's role — _added 2026-11-13_

_Owner's instruction 2026-11-13: Admin → Users → change role._

- **Who: OWNER and ADMIN**, through `user:update`, which no other role
  holds (§6.8's matrix and `permissions.ts`; the test pins MANAGER out).
- **Never yourself.** A person cannot change their own role — the same
  rule as deactivation, for the same reason: the next screen is decided by
  the role, and a slip ends the session that could undo it.
- **Never the last OWNER.** An organization with no OWNER has nobody who
  can delete it or hand ownership on. Moving the only OWNER to any other
  role is refused by name, counted inside the transaction so two changes
  at once cannot both pass.
- **What an ADMIN may grant is what an ADMIN may create**
  (`grantableRoles`): every role but OWNER. AND AN ADMIN MAY NOT CHANGE AN
  OWNER'S ROLE — demoting the owner is the same escalation as minting one,
  reached from the other side. _Ruled by the owner 2026-11-13; recorded in
  §6.8._
- **DRIVER is not reached from here, in either direction.** A driver's
  sign-in is created and ended by the driver link (Phase 7 §2, `driver-
link.ts`), which also ties it to a Driver record; a role change to or from
  DRIVER would leave a portal user with no driver or a driver record with an
  office login. Refused by name. _Ruled by the owner 2026-11-13; recorded
  in §6.8._
- **It ends the member's sessions in this organization.** The role is
  copied onto each session at sign-in (§7), so a demoted ADMIN would keep
  ADMIN until the cookie expired; the change revokes every live session
  whose active organization is this one, and the member signs in again
  under the new role. Sessions in another organization are untouched.
- **The audit row is the extension's own** (`audit.ts`): the membership
  update writes `Membership` / `update` with `changes.role` `{ from, to }`,
  attributed to the acting user — one row, the old role and the new, and
  the integration test reads it back.
- **On screen:** the role cell on `/users` becomes a select and a button for
  a viewer who may update users, on every row but their own and but the
  rows the rules above refuse (an OWNER row for an ADMIN, a DRIVER row for
  anyone). A refusal returns to `/users` with its reason in words.

---

## 7. Components

### 7.1 Table

The primary interface of the application. Everything else is support.

- Sticky header, `--z-surface-2` background, 11px, weight 600, `--z-ink-2`, uppercase, `0.04em` tracking.
- Hairline row separators in `--z-border`. **No zebra striping** — despite the name. Stripes fight the status stripe and halve the legibility of the soft status fills. The name is a stripe that carries information; that's the joke, and it only works once.
- Row hover `--z-surface-3`. Row selected `--z-accent-soft`.
- **Alignment:** text left · numbers right · dates left · status left, after the stripe.
- Nine visible columns maximum. Anything beyond that goes behind a column chooser, persisted per user per table.
- **Truncate addresses and commodity. Never truncate a load number, invoice number, or money figure.** Those are the fields people copy.
- **A column is as wide as what it holds** _(added 2026-11-07, owner's review of /loads on dev)._ A column that is never truncated — an identifier, a date, a badge, a unit number, money — is FITTED to its content: `fit: 'content'` on the column sets the header's width to zero and lets nothing in the column wrap, so it settles at its widest cell and not a pixel more. What is left of the row goes to the truncating columns, each taking its `share` (default 1) of that width as a percentage of the table, so a column that holds two names can be given two. Measured before, on dev at 1920: the browser's own distribution gave DEL date 202 px for a twelve-character date and Status 201 px for a badge, while Driver had 123 px and cut 70 rows of 100. A grid OPTS IN by fitting at least one column; a grid that fits none keeps the browser's distribution, so every other grid is unchanged until it is reviewed. The loads list is the first (§6.7); the trucks list is the second (§6.5 part 1).
- Bulk selection raises a floating action bar over the table foot, showing the count and only the actions valid for the whole selection.
- Every table has a written empty state (§10).
- **A place cell is "City, ST"; a stop with neither prints its facility** _(accepted 2026-11-17, owner's ship of the loads list's second pass, §6.7)._ The zip is on hover and the facility, the full stop and the zip are in the row's expand. A stop that carries no city and no state — every Relay stop, whose export names facilities and no addresses — prints its facility code in the cell instead of an em dash, because a column of dashes on every Amazon load would hide the route the dispatcher reads the row for. This is `stopPlace` in `src/lib/load-list-rows.ts`, unchanged since before the second pass; the brief's "facility code moves into the expanded row" holds for every stop that has an address.
- **The party who pays for a load is the Customer** _(accepted 2026-11-17, same ship)._ The column, the record link and every label that said Broker say Customer — the word the sidebar has used since v11.13 and the brief's own column name. One key, `loads.column.customer`, in three locales (Customer / Клиент / مشتری), read on `/loads`, Billing → Invoice's load tabs, the dashboard, the new-load form and the load detail. The route stays `/brokers`, and so do the code's names: a rename of words on a screen, not of a model.

#### 7.1.1 Sort — _added 2026-09-28_

A sortable column header is a button carrying the column's name and, when it is
the active one, a direction caret. **Sort state serialises into the URL** on the
same argument §7.4 makes for filters: a sorted view is a thing somebody sends.

- Two query keys, `sort` and `dir`. An unrecognised column name sorts by the
  table's default rather than erroring — a stale link should open.
- **Sorting does not animate the rows** (§11). They are in a different order on
  the next paint, with no transition between the two.
- Money and dates sort by their stored value, never by the rendered string.
  `$1,000.00` sorts above `$9.99` as text and below it as money, and the
  rendered form is the one a reader would blame.
- The caret is not the only signal: the active header also carries
  `aria-sort`, and a sorted column's header sits in `--z-ink` where the others
  are `--z-ink-2`.

#### 7.1.2 Totals row — _added 2026-09-28_

A table of money gets a **sticky foot**, `--z-surface-2`, a 1px `--z-border-strong`
top rule, weight 600, aligned to its columns.

- **It totals every row the filter selected, and says how many.** The leading
  cell reads `Total (N rows)`, where N is the size of the filtered set — not the
  page. A foot that silently totalled everything while a filter was on would be
  the most expensive kind of wrong on a financial screen; stating N is what stops
  the figure being ambiguous about its own scope.

  _Corrected 2026-09-28, from the artefact. This said "the rows SHOWN" and,
  once pagination landed in §7.1.3, that meant the twenty rows on screen.
  Datatruck's Salary batches grid shows `1-20 of 251` beside
  `Batch total count: 251  Sum: $9,536,606.61` — the sum is over all 251. That is
  also the useful answer: an accountant filtering to one authority's week wants
  what the week costs, not what the first twenty rows of it cost. The page is
  stated separately, by the pagination bar, so there is still exactly one sum and
  its scope is still in words._

- Only summable columns carry a figure. A status column's foot is empty, not a
  count of something nobody asked about.
- A filtered total and an unfiltered one must never render identically — if the
  filter removed nothing, N still states the count.
- The whole row is clickable via a real anchor in the first cell — middle-click
  and keyboard both work. Interactive controls inside the row raise `z-index` as
  dead zones. _(pattern proven on the admin board)_

  **THE STRETCH IS PER CELL, NOT PER ROW.** _Amended 2026-10-07, production
  walk, queue item 20 (2)._ The rule used to say the anchor's `::after`
  stretched over the row from a `position: relative` `<tr>`. Chromium does not
  make a positioned table row the containing block for an absolutely positioned
  pseudo-element, so the stretch went nowhere: MEASURED on dev with a real
  session, the anchor's box was 97 px wide on a 1,056 px row and a click in the
  fourth cell did not navigate — on `/payroll/statements` and on
  `/payroll/batches` alike. The office reported it as "rows don't link". So
  every cell is its own containing block (`position: relative` on the `<td>`),
  the first cell's anchor stretches over the first cell, and every other cell
  carries an overlay anchor to the same href that is `aria-hidden` and out of
  the tab order — the mouse gets the whole row, the keyboard and the screen
  reader get ONE link per row, named by the first cell. A `<tr onClick>` is
  still refused: it gives none of middle-click, ⌘-click, tab order or a name.

#### 7.1.3 The grid contract — _added 2026-09-28_

Every grid in Accounting carries the same seven controls, and a grid that is
missing one is a grid that has to say which and why in `§6.2`'s table:

**Filter · Search · Sortable headers · Columns chooser · Company filter · Export
CSV · Footer (count + sum) · Pagination.**

- **Every control serialises into the URL** except the columns chooser, which is
  a per-user preference (below). One link reproduces what somebody is looking at,
  including the page they are on — which is what makes "the total on my screen is
  wrong" an answerable sentence.
- **The footer totals the FILTERED SET and the pagination bar states the page.**
  `Total (251 rows)` with the sums in the foot, and `1–20 of 251` in the bar
  below it. Two facts, two places, one sum.

  _Corrected 2026-09-28, from the artefact — this said the footer totals the
  page. Datatruck shows `1-20 of 251` and `Sum: $9,536,606.61` together, and the
  sum is over all 251. The hazard the original sentence was written against is
  real and is answered by SAYING N rather than by narrowing the sum: a figure
  whose scope is printed next to it is not ambiguous, and a page-sized sum on a
  financial screen is a number nobody asked for._

- **Pagination is a page size and a page number**, both in the URL, defaulting to
  50 rows. Not infinite scroll: §1's reader is comparing, and a list whose length
  they cannot state is a list they cannot finish reading.

#### 7.1.4 Columns chooser — _added 2026-09-28_

§7.1 has required this since Phase 1 for anything past nine columns, and never
specified where the choice lives.

- **Persisted per user per table**, in `UserPreference` under
  `columns.<table>`. That namespace was written into `schema.prisma`'s own
  comment before anything used it; this is the thing it was reserved for.
- **A stored column that no longer exists is ignored, not an error.** A renamed
  column must not empty somebody's grid — and a preference row is the one piece
  of state that outlives every deploy.
- **Hiding a column does not change the totals.** The sum is over rows, not over
  what is visible; a column somebody hid is still money they owe or are owed.

#### 7.1.5 Export CSV — _added 2026-09-28_

- **The export is the rows the filter selected — every page of them, not the
  page on screen.** The button sits beside a footer that says "12 of 340", so
  exporting 12 would be the most plausible possible wrong answer.
- **One definition of the rows and one of the filter, shared with the screen.**
  The export re-runs the same reader and the same `applyList`; it does not carry
  its own query. Two queries that are supposed to agree about money are two
  queries that will not.
- **Codes, not labels (§12).** Status values, load and invoice numbers and
  authority ids export untranslated, because a CSV is read by a machine
  downstream — and by an accountant who will paste it into something that does
  not speak Russian.
- **Money exports as a decimal figure with no currency symbol and no thousands
  separator**, because the file is arithmetic input. `1234.56`.

#### 7.1.6 Tabs over one grid — _added 2026-09-28_

A page in Accounting is **tabs across the top and one grid below**. Modelled on
the Salary page the office already knows.

- **A tab is a different QUESTION about the same subject, never a filter.**
  "Unapplied" is a chip; "Balances" is a tab. If a tab could be expressed as a
  filter on the tab beside it, it is a chip and it belongs in the filter bar.
- **The tab is in the URL** (`?tab=`), first tab default, and an unrecognised
  value opens the first rather than erroring — a stale link should open.
- **Each tab owns its own columns, sort, and column preference.** They are
  different grids; sharing a `sort` between them would carry a column name into a
  table that does not have it.
- **The page's actions are top-right and belong to the PAGE, not the tab**, so
  they do not move as somebody switches. An action that only makes sense on one
  tab lives in that tab's own toolbar.

#### 7.1.7 The two operational lists run past nine — _added 2026-10-04_

§7.1.4's chooser was built for Accounting. The two lists a dispatcher lives on
need it too, and did not have it:

| grid                      | columns declared                 | what §7.1 does |
| ------------------------- | -------------------------------- | -------------- |
| `/loads`                  | ten, with the authority column   | `Table` throws |
| `/trucks`                 | eleven — twelve with that column | `Table` throws |
| `/payroll/batches`        | eleven, since §6.2.9             | `Table` throws |
| `/settlements/[id]` trips | eleven — capped since v10.2      | fine           |
| everything else, 8 of 12  | five to nine                     | fine           |

So `/trucks` returned 500 for **every** organization and `/loads` for any
carrier with more than one authority, which is most of them. Found by the UAT
live check on 2026-10-04; introduced 2026-09-20 when the warnings column reached
the three lists — past a comment in `LoadsTable` that said, correctly at the
time, that the list was **already** at nine.

**`/payroll/batches` was the third, and it is the one that settles where the cap
belongs.** §6.2.9 added gross, deductions and net to that grid earlier the same
day; it took eleven, and it already HAD a chooser. A chooser alone does not help:
with no stored preference the read returns every column, so the page 500s on the
first visit of every user who has never set one, which is all of them.

**THE CAP IS THEREFORE IN `readGridColumns`, not in each page.** Three pages
solved or failed to solve this separately and the fourth will be written by
somebody who has not read this section. A page says which columns go first; the
function it cannot avoid calling is what bounds the count. A grid over the cap
that names nothing loses its last columns — visibly, to a control that puts them
back, rather than to a stack trace.

_`/payroll/statements` declares exactly nine. It is one column from the same
defect and has no room for another without a default-hidden set._

- **The remedy is the chooser, never a raised cap.** Nine is a legibility rule
  about a 1080p screen, not an implementation limit, and the page that found it
  (§6.2.2's trips grid) is the precedent: declare every column, show nine, put
  the rest a tick away.
- **One exception, by the owner's ruling of 2026-10-09: `/loads` is capped at
  TEN.** The ruling names ten default-visible columns for a multi-authority
  carrier: load, authority, broker, pickup, delivery, DEL date, driver, truck,
  status, warnings. Nine would drop one of them. Measured on dev at 1920, the
  nine-column list left more than a column's width empty. The cap is per grid
  (`GRID_COLUMN_CAP`), `Table` takes it as a prop, and every other grid keeps
  nine. _Flagged: the rule above said never, and the owner's ruling is what
  overrides it._ **And a second, by the owner's ruling of 2026-11-10:
  `/trucks` is capped at ELEVEN** — the brief's default set for the list
  (§6.5 part 1): unit, make, model, plate, year, state, authority, driver,
  odometer, status, warnings. Two grids, each by a ruling; every other grid
  keeps nine. _Amended 2026-11-16 (§6.7, the second pass): `/loads` is
  capped at TWELVE — the owner's default set of twelve columns for a
  multi-authority carrier._
- **Grid ids `loads.loads` and `trucks.trucks`** (§7.1.4, `UserPreference` under
  `columns.<table>`).
- **Default hidden on `/loads`: billing status.** The list carries two badges
  (§7.2) and only one of them is the dispatcher's question. Billing status is
  the accounting view of the same load and has whole screens of its own
  (§6.2.8).
- **Default hidden on `/payroll/batches`: created, notes.** `created` is the
  row's own age, sitting beside a check date and a period that are the dates
  anybody actually asks about; `notes` is free text that truncates to nothing
  useful in a column. **Not** gross, deductions or net — those three are why
  §6.2.9 touched this grid, and answering a 500 by hiding the feature's own
  columns would be a worse outcome than the 500.
- **Default hidden on `/trucks`: model, year, odometer.** Specifications
  identify a unit at a desk, once. This list is read for where the unit is and
  whether it can run. Make and plate stay, because they are how a truck gets
  described on the phone. _Amended 2026-11-10 (§6.5 part 1, the owner's
  brief): owner name, VIN, fleet status, aging and heading to start hidden —
  the brief's four and the column it dropped from the default set. Model and
  odometer stayed behind the chooser for a day, to keep the default set at
  nine; the owner's ruling of 2026-11-10 caps `/trucks` at eleven and puts
  them in the default set, so this bullet's reason no longer hides anything
  on this list. Year is shown: it is Datatruck's and four characters._
- **The warnings column is never default-hidden**, on either list. §7.1.4 says
  hiding a column does not change the totals; the same sentence on an
  operational list is sharper — an absent warnings column reads as "nothing
  wrong", which is the one thing a hidden column must not be able to say.
  _Amended 2026-11-16 for `/loads` (§6.7, the second pass, owner's brief):
  off by default there, and a dot after the load number says what the column
  would have — so the reason holds while the column does not._
- **The cap is a slice in code, not a convention.** A preference row outlives
  every deploy and can be hand-edited, so a stored list holding ten columns is
  truncated on read rather than handed to `Table`. Otherwise the page 500s for
  one person in a way nobody else can reproduce.
- **The trips grid keeps its own identical slice** (§6.2.2, v10.2). Redundant
  now, left in place deliberately: it has a guard watching it, and removing
  working belt-and-braces to make two files look alike is not a 500 fix.

### 7.2 Status badge

11px, weight 500, 4px radius, 2px/8px padding, soft fill, 1px border in the text hue.

Loads carry two badges — operational and billing — side by side, and they must be distinguishable at a glance:

- **Operational: filled.** Soft background, solid border.
- **Billing: outlined.** Transparent background, 1px border, colored text.

Same hue vocabulary, different construction. A dispatcher learns this in about ten seconds and then never has to read carefully again.

_Amended 2026-11-06: the filled badge's soft fill is the deeper set in §3.3.
The construction above is unchanged — same padding, same 4px radius, same
1px border in the text hue — and what moved is how much the fill differs from
the white row behind it (and neutral's text, one step darker, for the reason
§3.3 gives). Nothing else about a pill changed, because a pill that changed
shape would be a pill a dispatcher has to relearn._

### 7.3 KPI card

`--z-surface`, 6px radius, 1px `--z-border`, 16px padding. Label 11px `--z-ink-2` uppercase, value 24px weight 600 mono, delta 12px in success or danger with an explicit comparison period ("vs last week" — never a bare arrow).

No gradients. No sparkline unless the trend changes a decision. No icons in KPI cards.

_Amended 2026-11-06, owner's brief ("stronger KPI cards"): the dashboard's
six-cell strip (§6.1.1) FOLLOWS THIS SECTION, which it had drifted from — it
rendered the label in `--z-ink-3` and the value at 18px, weight 400. The
label is `--z-ink-2` at weight 500 and the value is 24px, weight 600, mono, as
written above; the cell keeps its 6px radius, 1px `--z-border` and 16px
padding, and the six cells sit 12px apart. The sparkline stays, because §6.1.1
ruled that a figure without a direction is half an answer. Nothing was added
to make a card "stronger": the specification was already strong, and the
strip now matches it._

### 7.4 Filter bar

Sits directly under the page title, never in a drawer. Chips, not dropdown menus, for the two or three filters a screen actually uses; everything else in a **More filters** popover. Active filters render as removable chips. Filter state serializes into the URL — a dispatcher sends a filtered board to a colleague by pasting a link.

**Saved views** are first-class: a named filter set, per user, pinned to the top of the table. "My trucks today" should be one click, not four.

#### 7.4.1 Date range — _added 2026-09-28_

Two date inputs, `from` and `to`, labelled with what they bound — **"Delivered",
"Issued", "Paid"**, never a bare "Date". Every financial list has more than one
date on it and an unlabelled range is a filter nobody can predict.

- Either end alone is valid. `from` with no `to` means "since", and the chip
  says so in words.
- The bounds are **inclusive**, and the screen says which field they apply to in
  the same breath as the range. An off-by-one day on a week boundary puts a
  Saturday's money in the wrong week, which is MONEY-DESIGN §0's own lesson.
- The range lands in the URL as two keys, and clears with the same **Clear
  filters** the chips use.

#### 7.4.2 The company filter on a financial list — _added 2026-09-28_

§6.3 makes the topbar control a filter rather than a mode, and financial lists
inherit that exactly: chips, one per authority, only where `maxCompanies > 1`.

**But a total is not a list.** Where a figure is the thing somebody acts on —
the batch a button opens, the week's Ready — the filter narrows the ROWS and
leaves that figure alone, and the screen says it is doing so. A total that moved
when an authority was picked would not correspond to anything anybody can press.
_(The Tuesday screen already worked this way; this writes it down.)_

### 7.5 Forms

Label above input, 12px `--z-ink-2`. Mark required fields, not optional ones. Validate on blur, never on keystroke. Errors sit under the field in `--z-danger`, 12px, and say what to do — see §10.

**Modals hold six fields at most.** Anything larger is a full page. The Add Load form is a full page.

_Applied 2026-09-30 against a brief that asked for a modal, and this rule won.
Part two of the accounting finish-week specified "a modal listing the payer's
open items". That surface is ONE EDITABLE AMOUNT PER OPEN ITEM and the count
is unbounded — Werner alone has two hundred loads ready to invoice, so a payer
with ten open items is ordinary rather than exceptional. Six fields is the
cap; ten amounts in a dialog would be a scrolling form inside a focus trap,
with the running total the reader most needs pushed off-screen. Built as a
full page, flagged rather than silently resolved (`AGENTS.md`), and the owner
can overrule it. See §6.2.5._

#### 7.5.1 Every refusal names itself, in words, on the form — _added 2026-10-04_

**A form that refuses and says nothing is the worst outcome a form has.** The
reader cannot tell a wrong password from a database that was unreachable for a
second, so the only move left is to try the same thing again and hope. Owner's
report, 2026-10-03: a correct password on production, refused, with no message.

**So an action's failure set is CLOSED and every member of it has words.** Not
"has error handling" — a named, translated string per outcome, including the
ones nobody plans for:

| outcome                                     | what the form says                  |
| ------------------------------------------- | ----------------------------------- |
| the input was wrong                         | which input, and what to do (§10)   |
| the credentials were wrong                  | one message for both halves         |
| the attempt was refused by a limit          | that it was, and that time fixes it |
| the request was fine and the system was not | **that the system was not**         |

**THE LAST ROW IS THE ONE THAT GETS FORGOTTEN.** A dropped database socket, a
timeout, a compute still waking: the action throws, and a thrown action shows
whatever the framework shows — which is not a sentence about this form.
`auth.unavailable` is that sentence for sign-in: _"Zebra couldn't reach its
database — try again in a moment."_ It says the system failed, not the person,
and it says the remedy.

**RETRY ONCE, SILENTLY, BEFORE SAYING SO.** A dropped socket is usually a
single event, and a message for something a retry would have fixed trains people
to distrust the message. One retry, then words — never a loop, because a form
that retries forever is a form that hangs.

**NOTHING FALLIBLE RUNS AFTER THE CREDENTIAL IS ACCEPTED.** Read everything the
response needs BEFORE the session is minted and the cookie is set, so the last
two statements are the cookie and the redirect. Otherwise a failure after the
cookie leaves somebody signed in and staring at a refusal — which is how one
defect produces two complaints that sound unrelated.

### 7.11 The error page — _added 2026-10-04_

**One worded page for anything that still throws.** `src/app/error.tsx`. It says
that something broke on Zebra's side, offers **try again**, and never shows a
stack, a digest, or the framework's default.

**It is a client component and therefore cannot ask the server for words**, so
it carries its own copies of its three sentences in the three languages and
picks by the locale cookie. That is a deliberate exception to §12's
one-dictionary rule, recorded here: the dictionary is a server module, and
importing it into an error boundary would ship every string in the product to
the browser to render two of them.

**It must not itself be able to throw.** No data reads, no formatting of a
figure, no date arithmetic — a boundary that fails is the one failure with
nowhere left to go.

### 7.12 The load detail on direct-settled freight — _added 2026-10-07_

_Production walk 2026-10-07, queue item 20 (5). Specified before the code, and
MEASURED FIRST on dev:_ of 14,467 live loads, 14,461 carry a customer that
invoices and the flag that says so; 4 carry a customer that settles directly and
the flag that says so; and 2 carry a customer that settles directly with a flag
that says it does not — booked before the flag was copied, so they get the
broker's screen: the documents panel, the factoring button, a tracker that asks
for an invoice. None of the 4 direct-settled loads has a payment type. The
accessorial lines on dev are 889 "Other" lines APPROVED and NOT billable
($122,976.31 — the import's), 664 "Other" lines BILLED and billable
($115,517.05), 42 TONU approved and not billable; the rate panel's one
"Accessorials" figure sums billable rows only, so the 889 are on the load and
in no figure the screen shows. The panel and the stored total agree on every
load.

- **The accessorial summary has two figures, both named.** _Accessorials
  billed_ is the sum that enters the total — billable and not denied, which is
  `recomputeTotals`' own rule and now the panel's too, status included. _Other
  lines, not billed_ is the sum of the approved lines that are not billable —
  the Datatruck "Other" lines — so the office sees the money the broker paid
  for and Zebra did not bill, instead of nothing. The total stays the invoice's
  number; a denied line is in neither.
- **The payment type derives from `settlesDirectly`.** A direct-settled load's
  arrangement IS "Direct": the panel shows it as a fact and offers no select,
  a load booked against a direct-settling customer is stamped "Direct" at
  booking, and `updateLoad` refuses any other value on a `directSettled` load
  by name (`payment_type_direct`). Broker freight keeps the select over the
  other three. `loadDetailView` carries the decision (`paymentTypeDerived`),
  read from the load's own flag — copied from the customer at booking, as the
  flag has always been.
- **Nothing on a direct-settled load asks for a rate confirmation or an
  invoice.** The documents panel is already withheld on that freight. The
  tracker's fourth word becomes **On statement** there: the choice of the
  literal word "Invoiced" on 2026-10-01 said "to be revisited if it turns out to
  matter", and the walk is where it mattered — the office read it as a demand.
  Five stages, same positions; the word is the view's (`settledWord`), and the
  pipeline rule itself does not move.
- **A load whose customer settles directly but whose flag says otherwise is a
  DATA row, not a screen rule.** The flag stays frozen at booking by the standing
  argument (a customer's terms changing next year must not restate freight
  already moved); GAPS lists the two on dev and the production count comes from
  the read-only statement handed over with this item, and the fix is the flag on
  the load, by the one write that may change it.

### 7.13 The Amazon load detail takes Datatruck's shape — _added 2026-11-16_

_Owner's brief 2026-11-16, from Islom's Datatruck screenshots
(`corpus/datatruck-load-detail-2026-11-16-*.png`, load DT-018794). Specified
before the code._

**Why §7.12 was not enough.** Every Amazon rule there hangs on
`Load.directSettled`, which `createLoad` copies from the customer at booking.
The Datatruck history import never sets it, so its Amazon loads — 11,196 in
the year's export, DT-018794 among them — carry `directSettled = false` and get
the broker screen: "Missing — this load needs one" under Rate con and POD,
"Still missing:" under Factoring, and a Fuel surcharge field on a rate Amazon
pays fuel-included.

**One predicate, `isAmazonLoad`, two sides.** In `src/lib/amazon-load.ts`:

- **Broker side** — the load's customer is Amazon by name: exactly
  `Amazon Relay` (`RELAY_CUSTOMER_NAME`, which the history import aliases
  `AMAZON LOGISTICS` to) or `AMAZON LOGISTICS` itself (dev once created it
  before the alias table existed), compared by `nameKey` — a stated table,
  never a similarity rule.
- **Relay side** — `directSettled`. There is no source column on `Load`; the
  Relay importers book through `createLoad` against `Amazon Relay`, which
  settles directly, so the flag is the mark a Relay-booked load carries.
  _Flagged:_ a second direct-settling customer would count as Amazon here.
  None exists today.

An **agreement test** holds both sides to a fixture where each side alone,
both, and neither are present, every side's count above zero — a side that
matched nothing would pass every other test. **Every rule below hangs on it;
a load it does not match renders exactly as before.** §7.12's rules that are
about direct settlement — the derived payment type, the TONU-only accessorial
list — stay on `directSettled`.

**1. Documents.** Amazon's rate con, POD and BOL live in Relay. On an Amazon
load no slot is required, so no "Missing — this load needs one"; the
Factoring panel is withheld, so no "Still missing:"; the Documents card says
**Documents are on Amazon Relay** and keeps an optional Upload per type. _No
load warning reads documents today_ (`loadWarnings` takes no document fact), so
"no document warnings in the Warnings count" is already true; a test pins it.

**2. Rate.** Linehaul only: the Fuel surcharge field is withheld on an Amazon
load (the column stays, as §7.12 item 4 already had it). Accessorials stay.

**3. Shape.** On an Amazon load the page is:

- **Header row:** back to `/loads`, **Loads / DT-nnnnnn** with copy, the
  operational status pill (and Cancelled when it is), actions at the end —
  **neutral only** _(v11.23, owner's review on dev 2026-11-17)_: Mark
  delivered as a secondary button and a ⋮ menu. **Cancel load is in the ⋮
  menu, and red only there**, behind the same confirmation; the header never
  carries a red button. (Reinstate load stays in the header on a cancelled
  load: it is not destructive.) Every other load detail keeps its inline
  actions — `LoadActions` takes `layout="menu"` here alone. _Flagged:_ **Create invoice** is
  not shown — §7.12 rules that nothing on direct-settled freight asks for an
  invoice, and Amazon freight is paid by statement — and **Edit load** is not
  shown, because Zebra edits a load in place on this page and has no edit
  route to send it to.
- **Second row:** Load ID (the reference — Amazon's id) with copy; **Total
  pay** (the load's total, only for a role with `load.financials` — absent
  from the payload otherwise); **Created by** — the person on the load's
  CREATE audit row, "Datatruck import" for a load the import created (it
  writes no audit row), else "—".
- **Tabs** (`?tab=`), **only those with content:** Load info (always), Trips
  (when the load has a leg), Documents (always — the card has its sentence),
  Financials (only with `load.financials`), Status updates (when a status
  event exists).
- **Tracker:** eight numbered steps — Offer, Booked, Assigned, Dispatched, In
  transit, Delivered, Invoiced, Paid — from `trackerStep` in
  `src/lib/load-tracker.ts`, one mapping, tested: `AVAILABLE` → Offer;
  `BOOKED` → Booked, or Assigned with a driver or truck on it; `DISPATCHED`
  and `AT_PICKUP` → Dispatched; `LOADED`, `IN_TRANSIT` and `AT_DELIVERY` →
  In transit; `DELIVERED` and `POD_RECEIVED` → Delivered; then the billing
  axis can only raise it — `INVOICED`, `PARTIALLY_PAID`, `FILED_WITH_FACTOR`,
  `DISPUTED` and `WRITTEN_OFF` → Invoiced, `PAID` → Paid;
  `CLOSED_IN_DATATRUCK` raises nothing. Cancelled is shown as cancelled over
  the steps. _Flagged against §7.12:_ on a direct-settled load the seventh
  word stays **On statement** — §7.12 found the office read "Invoiced" as a
  demand for an invoice — so the positions are the brief's and only that word
  differs, as §7.12 already arranged.
- **Each tracker digit sits above the bars** (v11.23, owner's report
  2026-11-17: "digits 1–6 render mirrored / upside down"). No transform did
  it: each step's connector bar is absolute and later in the DOM than the
  circle to its start, so it painted through that digit in the same blue. The
  circles are `z-10`, and `scripts/tracker-render.mjs`, run by the deploy
  sweep, renders a load's tracker and fails unless every digit is the topmost
  element at its own centre and nothing above it rotates or mirrors it. Read
  on dev before the fix with the check's own reader: steps 1–7 covered, 8
  clear. (The status names in the bullet above are code spans since v11.23:
  bare, their underscores were read as emphasis and two had turned into
  asterisks.)
- **Stops** as a table: position, facility code, city/state, zip, appointment
  window (`windowStart`–`windowEnd`, else `scheduledAt`, in the stop's zone),
  and **Arrived / Departed** beside it (`arrivedAt`, `departedAt`, same zone,
  "—" when unrecorded) — scheduled against actual on one row; the portal's
  taps write them (owner's change on accepting v11.19, 2026-11-16).
  _Kept beyond the brief:_ the address column with its missing-address flag
  and editor (§7.12's predecessors, items 2 and 4) — a facility code nobody has
  an address for still says so.
- **Trips** for the Relay legs: Trip ID, status, pickup, delivery, driver,
  truck, trailer, driver gross. A leg ends at a stop carrying a reference (the
  leg's Load ID, as the trips importer writes it); a load with none is one
  trip, first stop to last, under the load's reference. Driver gross is the
  load's statement lines' pay, summed — a figure only a finalised statement
  has, so "—" before one, and shown once because no per-leg pay exists. The
  column is absent without `load.financials`.
- **Three cards:** Load info (authority, Load ID, PO/BOL reference when
  there is one), Mileage (total, loaded, empty — the existing summary and its
  editor), Customer (the broker, linked).
- **Right rail:** Activity (the §7.10 timeline and its note composer) and a
  **Profit box** for `load.financials` only: revenue (the total), accessorials,
  driver pay (the statement lines' pay), gross profit (revenue less driver
  pay) and margin — gross profit and margin "—" while driver pay is unknown,
  never revenue presented as profit. No new money rule: two stored figures and
  one subtraction.

The most-used form in the product. It gets its own rules:

- Single column, keyboard-first. Tab order follows the workflow exactly: broker → truck → driver → pickup → delivery → dates → miles → rate → rate confirmation → save.
- Rate per mile, driver pay, estimated fuel and estimated profit compute live under the rate field as read-only text. Never in a separate panel the dispatcher has to look for.
- **THE LOAD'S RATE IS THE TOTAL THE BROKER PAYS; LINE HAUL, FUEL SURCHARGE AND
  ACCESSORIALS ARE LINES UNDER IT.** _Owner's ruling, 2026-11-14, closing the UAT
  rate question (`docs/UAT-RESULTS.md`) and REPLACING the 2026-10-06 ruling below
  for what the rate field means._ The storage and the pay-rule basis do not move:
  `totalRevenueCents` is the rate, `linehaulCents`, `fuelSurchargeCents` and the
  `LoadAccessorial` rows are its lines, the split is still taken only when
  `totalAgrees`, and `PERCENT_LINEHAUL` still pays on the line-haul line while
  `PERCENT_GROSS` pays on the total. What changes is the form: the rate field
  prefills from the rate con's `money.total` and is the figure rate per mile is
  computed from; the line haul, the fuel surcharge and each accessorial show as
  lines beneath it that must add up to it. NOT BUILT on the day of the ruling —
  the form still reads the field as the line haul, as below; the step that builds
  it is `PHASE-6-BRIEF.md` §4 step 6a, so the decision has a step behind it.
- _Superseded for the field's meaning by the ruling above; kept for the defect it
  fixed, which still stands._ **THE RATE FIELD IS THE LINE HAUL.** _Owner's ruling,
  2026-10-06, from load 1177._
  Until then the form prefilled it from the rate confirmation's `money.total` and the
  action stored that as `linehaulCents`, so fuel and accessorials became line haul
  and `PERCENT_LINEHAUL` paid on them: 1177 printed line haul 245,000 + fuel 38,750 +
  detention 12,000 = 295,750, stored line haul 295,750, and paid $887.25 under a 30%
  rule that should have paid $735.00. Now: the field prefills from `money.linehaul`
  and from nothing else — a rate con that printed only a total prefills an EMPTY
  field with the total in the hint, and a person decides; the fuel surcharge and
  each accessorial line go to their own columns from the SERVER'S copy of the
  extraction (`fuelSurchargeCents`, one `LoadAccessorial` per line), and only when
  the extraction's parts agree with its total (`totalAgrees`), because a split that
  does not add up is a question, not data. **The basis is then the pay rule's job**:
  `PERCENT_LINEHAUL` pays on the line haul, `PERCENT_GROSS` on the billed total, and
  the accountant picks per driver — the two names finally mean two things.
  **Migration 68 backfills**: every hand-created load whose attached rate con carries
  an agreeing split and whose stored line haul is the extraction's total gets the
  split (`linehaulCents`, `fuelSurchargeCents`, the accessorial rows); the billed
  total is unchanged and asserted so, as is every statement's net. A load whose
  rate con has no line haul is LISTED in GAPS.md by `scripts/rate-split-gaps.mjs`,
  never guessed. On dev the defect set is one load — 1177, the artefact.
- Broker, truck, driver, and location are typeahead selects that create-on-miss without leaving the form.
- `⌘/Ctrl + Enter` saves from anywhere in the form.
- Target: a repeat load entered in under forty seconds without the mouse. Time it. If it fails, the form is wrong.

### 7.7 Buttons

Primary (accent fill) · Secondary (1px `--z-border-strong`, surface fill) · Ghost (text only) · Danger (danger fill, or danger text on ghost).

32px tall, 12px horizontal padding, 4px radius, 13px weight 500. One primary per screen region. Labels are verbs that name the outcome: **Add load**, **Create invoice**, **Generate settlement**, **Mark paid**. Never "Submit," never "OK."

### 7.8 Documents

Upload is drag-and-drop plus a file picker, uploading **direct to R2 via a presigned URL** — the file never passes through the Worker. Show per-file progress, then the parsed result.

Each document row: type badge, filename, size, uploader, timestamp, and actions. Documents group by type, not by upload order. A missing required document for the load's current stage renders as a dashed placeholder slot in `--z-warning`, not as absence — an empty space communicates nothing.

### 7.9 Toasts

Bottom-leading corner, 4 seconds, one at a time, queued. Success is quiet. Errors do not auto-dismiss and carry a retry where retrying is meaningful. The toast repeats the verb from the button: **Publish** produces "Published."

### 7.10 The activity timeline — _added 2026-10-01_

_Owner's ruling. A record's history is **ONE stream**, not a panel per source
table._

The load detail page had two: a status timeline (`LoadStatusEvent` + notes) and
an Activity panel (`AuditLog` field edits). Both were correct and neither was
the answer to "what happened to this load" — that question was answered by
reading two lists and interleaving them by eye, which is the work the screen
exists to do.

**One list, newest first, sorted while the times are still `Date`s.** A rendered
time is a string, and sorting `"Sep 2, 8:04 PM"` is alphabetical order wearing a
chronology's clothes — stable, plausible and wrong. The merge happens on the
server and the rendered string is never the sort key.

**Six kinds of entry, and they do not dress alike:**

| kind         | source                               | reads as                                 |
| ------------ | ------------------------------------ | ---------------------------------------- |
| **created**  | `AuditLog` CREATE                    | one sentence, never its 24 field values  |
| **field**    | `AuditLog` UPDATE                    | `label: old → new`                       |
| **status**   | `LoadStatusEvent`                    | badge, `from → to`, source, refusals too |
| **document** | `Document.uploadedAt` / `uploadedBy` | type badge and filename                  |
| **note**     | `Communication` of type NOTE         | the sentence, verbatim                   |
| **deleted**  | `AuditLog` DELETE                    | one sentence                             |

**A note is not a status and a document is not a field edit.** "Somebody wrote
this down", "the load moved" and "a file arrived" are different kinds of fact; a
timeline that dressed them alike would invite the misreading it exists to
prevent. The rail carries the distinction, not the copy.

**Every entry names an actor and a time to the minute**, in the company's zone.
Where no actor was recorded the row says nothing about how it happened — not
"manually", not "system". We did not record it; we do not know, and inventing
an agent is worse than the gap.

**A document's upload is read from the `Document` row, not from its audit
row.** The row carries `uploadedAt` and `uploadedBy` already, so it is the
artefact rather than a claim about the artefact — and it still answers for
documents uploaded before the write was audited.

**The money rule is the same rule.** Permission is decided in
`load-activity.ts`, field by field and by omission: a reader without
`load.financials` never receives a rate change, and a row left empty by that
filter is dropped whole rather than rendered as "Owner updated this load" —
which still says money moved and when.

**Adding a note is its own control, always present**, never only a row in the
stream. Reading history and writing to it are different acts.

---

## 8. Data display

**Money.** `$` prefix, thousands separators, always two decimals, right-aligned, mono, tabular. Negative figures take a leading minus and `--z-danger` — not parentheses. Dispatchers are not accountants and parentheses read as a footnote.

**Rate per mile.** Two decimals, no dollar sign in table columns headed `RPM`.

**A heading never carries an internal id.** _Owner's ruling, 2026-09-30._

A cuid, a row id, or a placeholder built out of one — `DRAFT-g8hsz3mk-jcyy2u78`
— is a database fact, not a name. It tells the reader nothing, it cannot be
read aloud, and it appears at the top of the page where the name belongs.

- **When the thing has an issued number, the heading is that number.**
  `ST-005562`, `SB-000449`, `INV-001204`.
- **When it does not yet, the heading DESCRIBES the thing** in the words its
  reader would use: `Draft — Chapan Odiljon · 2026-08-30 – 2026-09-05`. Two
  people and a week, which is what somebody scanning a browser tab actually
  needs to tell one draft from another.
- **The id may still appear in the body**, in mono, as a field — that is where
  a value somebody might have to quote belongs.
- **"Is this a name" is decided by an ALLOWLIST of issued series, not by a list
  of the placeholder shapes somebody has met.** _Added 2026-09-30, an hour
  after this section, because the first implementation tested for `DRAFT-` and
  was already wrong: auditing dev turned up four drafts numbered
  `TMP-1788982650101`, an epoch timestamp, and nothing in the repository or its
  git history writes that prefix._ An unrecognised value fails closed — it is
  treated as not-a-name, kept out of the heading, and replaced when the
  document leaves draft. Being wrong that way costs a heading that describes
  the document; being wrong the other way puts a row id at the top of a page
  about somebody's pay.
- **And a document that has been PAID must have a real number.** A placeholder
  on a paid statement is not a display problem, it is a numbering bug showing
  through: see §6.2.2.

**Miles.** Integer, thousands separator, right-aligned. Deadhead shown in `--z-ink-2` next to loaded miles, never summed into the same figure.

**Dates and times.** Store UTC. Render appointment times **in the stop's timezone**, always with the zone: `Jul 28, 14:30 CDT`. Date-only fields — invoice date, due date, expiry — take no timezone: `Jul 28, 2026`. Relative time only under 24 hours: `2h ago`. Aging is an integer count of days, never "about a month."

**An appointment with a date but no time is stored at midnight IN THE STOP'S ZONE, and renders as a bare date.**

_Added 2026-07-31. The incident: a pickup typed as September 15th rendered as
`Sep 14, 19:00 CDT`. The date had been stored at UTC midnight and then rendered
in the stop's zone as rule 3 requires — so the two rules, each correct alone,
walked the day backwards between them. It was found by looking at a screenshot,
not by a test._

Three parts, and they only work together:

- **Store** midnight in the zone the stop is in, not UTC midnight. September
  15th in Dallas is `2026-09-15T05:00:00Z`, and the day then survives the round
  trip.
- **Render** it as `Sep 15` — no time, no zone. `00:00 CDT` would be inventing a
  midnight appointment nobody made, and §8 already says a date-only field takes
  no timezone.
- **Distinguish** the two cases by the stored instant: midnight-local means the
  time is unknown, anything else is a real appointment and renders `Sep 15,
14:30 CDT`.

The zone comes from the stop's own `timezone` where one is recorded, and is
derived from the state otherwise. A derived zone is shown as approximate,
because thirteen US states span two of them and the interface should not
pretend to a certainty it does not have.

**Phone numbers.** `(425) 566-0763`. Tap-to-call on every surface, including desktop.

**Identifiers.** Mono. Load and invoice numbers are click-to-copy with a copied confirmation.

**Empty vs zero.** `—` in `--z-ink-3` means no value recorded. `$0.00` means zero. These are different facts and must never render the same way.

---

## 9. Driver portal

A separate shell, not a responsive squeeze of the operator app. The user is standing in a yard, in gloves, in sunlight, holding a phone in one hand.

- **Base type 15px**, not 13. Labels 13px.
- **Minimum touch target 44px.** Primary actions 52px.
- One primary action per screen. The current load is the entire home screen; everything else is a tab away.
- Camera-first upload: **Take photo** is the primary control, file picker secondary. Compress client-side before upload and combine multi-page captures into a single PDF on the device. _Built at step 5 (2026-11-12, v10.90), the mechanism: on Documents, Take photo is the 52 px primary control and opens the camera directly (`capture="environment"`), Choose a file is secondary; the sequence is the office's own compress → hash → mint → PUT → confirm, behind the portal's own routes (`/api/portal/documents/upload-url`, `/confirm`) under `portal.document:create` and two predicates — the load the driver is on, either seat, and one of the SEVEN types (POD, BOL, lumper receipt, scale ticket, fuel receipt, detention proof, photo; the rate confirmation is the dispatcher's); a POD confirm moves the load to POD received as the office's upload does, so the office sees it on the load the same minute. One capture per upload: no PDF assembler is in the dependencies, flagged in the brief for a ruling; the offline queue is step 6._ _Flag 9 RULED 2026-11-12, the owner's words: "no assembler; one capture per upload, office sees them grouped by type on the load" — which §7.8 already does: `LoadDocuments` on `/loads/[id]` groups by TYPE and never by upload order, so a second page is a second file under the same heading, and "combine multi-page captures into a single PDF on the device" above is retired by the ruling._
- Status updates and uploads queue when offline and sync on reconnect, with an explicit pending indicator. Truck stops have bad signal; a silent failure loses a POD. _Built at step 6 (2026-11-12, v10.91), the mechanism. WHAT IS KEPT: a tap or a capture the office never answered — the phone says it is offline (`navigator.onLine`), or the request died before a response (`fetch` throwing, which is a TypeError in every browser, or an abort) — goes to the phone's queue in IndexedDB (`src/lib/offline-queue-store.ts`; memory for the session where a browser refuses IndexedDB, and the strip still says so), in the order it happened, the capture ALREADY COMPRESSED so the phone holds under a megabyte and not the camera's eight, the tap WITH ITS OWN TIME. What is never kept: a refusal the office answered in words — a type it will not take, a rung that is not the next, a load that is not the driver's — which is shown where the tap was made and not retried into a different fact. THE REPLAY (`replay`, `src/lib/offline-queue.ts`, the rule with no browser in it): the shell's strip (`PendingQueue`, mounted once in the portal layout) replays oldest first when the portal is opened — after a kill, this is the moment the kept queue comes back — when the phone says it is online again, when the portal returns to the foreground, whenever something is kept, and every thirty seconds while anything waits, because on one bar `online` never flips and the failures are timeouts; one pass at a time. Each entry goes through the SAME route the live write takes (`queue-senders.ts`): a status through Load's server action with the tap's time, a document through the portal's mint → PUT → confirm. A sent entry leaves the queue; a refusal in words STAYS on the strip with the words until the driver dismisses it; a failure before the office answered stops the pass and keeps the rest for the next. THE PENDING INDICATOR is explicit and on every portal screen: a strip under the header, in warning, saying "No signal" when there is none, how many are waiting and whether they are kept, sending or retrying, and each kept write by name — "Status: At pickup", "POD · pod.jpg"; Load shows the kept rung in a sentence WHERE THE BUTTON WAS, so a second tap cannot queue a second step; Documents says the capture is kept. A REPLAYED TAP CARRIES ITS TIME: `recordPortalStatus` clocks the stop (flag 8's stamp) at the tap when the tap is within the last twenty-four hours and not in the future, else at the write (`clockTimeFor`); the `LoadStatusEvent` stays the write's time, which is when the office learned, and the stop's clock is when the truck was there. NO SERVICE WORKER: the portal shares the office's origin and a worker at the root would intercept the office's requests too; replay with the app closed (Background Sync) is Chromium-only and is flag 10 in the brief, for a ruling. Killing the app loses nothing the phone has kept; the measurement is the owner's phone on cellular — airplane mode on, tap and capture, kill the app, reopen, airplane mode off — and is recorded in the brief when taken._
- Higher contrast than the operator app: body text against surface at 7:1 minimum for sunlight legibility.
- **A driver sees their own loads, their own documents, and their own settlement. Nothing else.** No company totals, no other drivers, no broker rates beyond their own load. This is a design rule as much as a permissions rule — do not build the component and hide it.

_Amended 2026-11-12 (Phase 7 step 0 — the owner's rulings on
`PHASE-7-BRIEF.md` §4, before the code). The brief is the source; these are
the rules a screen is held to._

- **The shell.** A `(portal)` route group with its own `layout.tsx`: no
  sidebar, a bottom tab bar of five — **Load** (`/portal`, the current load)
  · **Loads** (`/portal/loads`) · **Documents** (`/portal/documents`) ·
  **Settlements** (`/portal/settlements`) · **Account** (`/account`, restyled
  to this scale) — `dir` from the locale (§12), and the "DATA: dev" ribbon
  where the operator shell has it (§6.1.2). Every tab is 44 px tall at least;
  the one primary action on Load is 52 px. _Step 2 (2026-11-12) built the
  four portal pages and the bar; the Account tab opens the existing
  `/account` under the operator shell, unrestyled, until a step restyles it
  — flagged in the brief, not hidden. The primary action on Load lands with
  step 4; until then Load reads and asks nothing._
- **The landing rule.** Sign-in sends DRIVER to `/portal` and every other
  role to `/dashboard`. An operator role that opens a portal route is refused
  — 404, §13.10 — and a DRIVER on an operator route is refused as today
  (§6.8). A DRIVER whose sign-in has no roster row (`Driver.userId`) sees one
  sentence on every portal screen — "No driver record is linked to this
  sign-in; ask the office." — and nothing else: no row, no portal. The
  predicate is the driver's own roster row, `Driver.userId = session.userId
AND deletedAt IS NULL`, resolved once per request in `src/lib/portal.ts`
  and read by every portal surface; no page writes its own.
- **The money rules (rulings §4.2 and §4.3).** Settlements: **finalised
  only** — APPROVED or PAID — and only the driver's own; a DRAFT is absent
  from the portal, not shown with a word on it. Pay per load appears **only
  after the settlement that includes it is finalised**, read from the
  settlement line through that settlement — no projected pay, never
  `Load.driverPayCents` on its own, never the broker's rate. A load with no
  finalised settlement shows no money.
- **The write rules (rulings §4.4 and §4.5).** A driver's status change is
  **one forward step at a time**, the dispatch engine's own rule, on their
  own open load, recorded as a `LoadStatusEvent` with
  `source: DRIVER_PORTAL` and the user; no backwards step, no cancel, no
  billing axis, no `POD_RECEIVED`. A missed tap is the office's correction
  on the board, where the timeline shows who moved what. A **co-driver**
  (`Load.coDriverId`) sees the load on Load and Loads and may upload a
  document to it, and never sets its status — one driver of record per
  status change. _Built at step 4 (2026-11-12, v10.89), the mechanism: the
  driver's ladder is six rungs — DISPATCHED · AT_PICKUP · LOADED ·
  IN_TRANSIT · AT_DELIVERY · DELIVERED — BOOKED being dispatch's and
  POD_RECEIVED never a click (§7); Load's one primary action, 52 px, names
  the NEXT rung in words ("Set: At pickup") and nothing else is pressable;
  the write (`recordPortalStatus`, `src/lib/portal-status.ts`) re-reads the
  load and refuses in words a tap for any rung but the next from the status
  AT THAT MOMENT — the office moved it, or the first tap landed — never
  applying a jump, and goes through the engine (`transitionOperational`)
  with `source: DRIVER_PORTAL` and the driver's user, so the load's timeline
  on `/loads/[id]` prints "driver portal" beside the name. The co-driver's
  Load shows a sentence where the button would be, and the write refuses the
  second seat by name — a button not rendered is never the permission._
  _**The tap is the stop's check-in** (owner's ruling 2026-11-12 on the
  brief's flag 8, v10.90): At pickup stamps the pickup stop's arrival,
  Loaded its departure, At delivery and Delivered the delivery's pair — on
  the first stop of that type whose clock is still empty, in the same
  transaction as the status, under the driver's attribution, so the stop
  table's "who" names the driver; a clock the office already set is never
  overwritten, and the office's later edit on the board is its own audited
  write. In transit stamps nothing; intermediate stops are the office's._
- **The link (rulings §4.6 and §4.7).** `Driver.userId` is written by OWNER
  or ADMIN on the driver's record — a "Sign-in" picker on `/drivers/[id]`
  over users holding the DRIVER membership and no roster row yet — gated by
  `user:update`, which those two roles hold alone, decided in
  `permissions.ts` and nowhere else; never by the driver, never under
  `(portal)`. Setting `Driver.terminationDate` **deactivates the sign-in in
  the same write** (sessions revoked, as `setUserActive` does); a terminated
  row refuses the link; **reactivation is a new link by OWNER or ADMIN on
  the driver record**, and the audit row names who made it.
- **Onboarding (ruling §4.8).** The temporary password the Users screen
  mints, handed over by Telegram, is the first drivers' way in — as for the
  accountant; the verified sending domain for Forgot password is its own item
  and blocks no step.
- **Load's budget: TWO statements inside the tenant transaction.** One for
  the driver's own row (resolved once, reused by every portal predicate), one
  for the open load or loads the driver is on — either seat — with stops in
  sequence, each stop's location (gate code, notes) and the load's document
  types, in a single relation read under `relationJoins`; the next status is
  computed, not read. Beside them only what every request pays — the session
  read and `set_config`. Measured at step 2 against this number before the
  screen ships; a third statement is a flag, not a habit.

---

## 10. Words

Copy is design material. It follows the same review as spacing.

- **Sentence case everywhere.** No Title Case On Buttons.
- Name things as the user names them: _rate confirmation_, not _document upload_; _broker_, not _counterparty_; _POD_, not _proof-of-delivery record_.
- Buttons keep their verb through the whole flow. **Generate settlement** produces "Settlement generated."
- **Errors state what happened and what to do**, in the interface's voice. Not "An error occurred." Try: "Miles must be a whole number." / "This truck is already assigned to load 1042 on these dates."
- **Empty states are invitations**, with the action attached. Not "No loads found," but "No loads match these filters." + _Clear filters_. Not "No documents," but "No rate confirmation yet." + _Upload_.
- Never apologize. Never say "please."

---

## 11. Motion

Almost none.

- Transitions 120ms `ease-out`, and only on hover, focus, and popover entry.
- **Table rows never animate.** Not on insert, not on sort, not on filter. Content that moves while being read is content that gets misread.
- Charts draw once on mount with no stagger, or not at all.
- The status stripe never animates (§2).
- Everything above is disabled under `prefers-reduced-motion`.

The marketing site is where motion earns its keep. Here it is a cost.

---

## 12. Internationalization

**Two locales, English and Russian — Farsi removed 2026-11-17 by owner; Afghan drivers use Russian.** Keys from the first component, never retrofitted. The office and the driver portal carry the same two. _(v11.29: the `fa` dictionary, the `fa` locale, the right-to-left layout — `<html dir>`, the `rtl:` variants — and their tests are gone. It replaces "English, Russian, Farsi from day one" and the bullet "Farsi is right-to-left … test the driver portal in `dir="rtl"`". A stored or cookied `fa` is no longer a locale and reads as the default, English.)_

- **Russian runs roughly 30% longer than English.** No fixed-width buttons, labels, or table headers. Test every screen in Russian.
- Locale drives number and date formatting via `Intl`. **Timezone comes from the stop, not the locale** (rule 3).
- **Never translate:** load numbers, invoice numbers, VINs, MC/DOT numbers, status codes in CSV and Excel exports. Exports are machine-read downstream.
- **An identifier is `dir="ltr"` — whether it is typed or only read.** _(Kept
  after v11.29: with two left-to-right locales the attribute changes nothing on
  screen, and it is the one guard if a right-to-left value or locale returns.
  The history below is why it exists.)_ Not translating one is not enough: the bidi algorithm reorders the
  punctuation inside it. An invoice prefix of `INV-` renders as `-INV` in an RTL
  input, and a violation code of `393.75(a)(3)` reverses its brackets — the
  value is correct in the database and wrong on the screen, which is the worst
  of the two. Any Latin identifier — prefixes, codes, reference numbers, plates,
  VINs, gate codes, phone numbers — sets `dir="ltr"` so it reads the way it will
  be typed into somebody else's system, or dialled, or read out at a gate.

  Found in the Phase 4 RTL pass on an invoice-number INPUT, and stated for
  inputs only. The Phase 5 RTL pass found the same bug in read-only text: a
  gate code of `#4417` rendered as `4417#` in a facility panel, where nothing
  is typed at all. **The rule is about the VALUE, not the control** — a driver
  reads a gate code off a screen and punches it into a keypad, and the reversed
  one does not open the gate.

- Developer-facing API errors stay in English. _(carried from the portal)_

---

## 13. Accessibility floor

Built in, not announced.

- Body text 4.5:1 minimum. UI borders and icons 3:1.
- Visible focus ring: 2px `--z-accent`, 1px offset, on every interactive element. Never `outline: none` without a replacement.
- Tables are keyboard-operable: arrow keys move the row cursor, Enter opens, Space selects.
- `⌘/Ctrl + K` global search. `/` focuses the current table's filter.
- Every icon-only control carries an `aria-label`.
- Status is never color alone (rule 5).

---

## 14. Anti-patterns

Present in almost every dashboard template. None of them ship here.

- Full-width gradient hero cards on the dashboard
- Large corner radii (12px+) — reads consumer, not equipment
- Emoji as status indicators
- Icon-only navigation without labels
- 16px body text in tables
- Charts that animate on every render
- Dropdown menus where three chips would do
- Modals containing twenty fields
- "No data available" as an empty state
- Sidebars that collapse automatically at widths where the content still fits
- Skeleton loaders on a table that returns in 80ms — show the old rows dimmed instead

---

## 15. Amendment

Change this file in its own commit, with the reason in the message. When a rule is added, cite the incident that caused it — the carried-over rules exist because each one cost a working session on the portal.
