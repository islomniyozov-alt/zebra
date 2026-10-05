# TMS-DESIGN-SYSTEM.md

**Project:** Zebra — Transportation Management System
**Status:** v10.27 — §6.2.10 added 2026-10-05: payroll takes Datatruck's shape from Islom's walkthrough, and the owner's rulings on the three places it met the existing design — `SettlementBatch.companyId` is NULLABLE with null meaning the whole organization, so the 2026-09-11 one-run ruling stays the default and a named company scopes its own standing charges and `recentWeeks`; THE WEEK IS NOT REVERSED, a batch is still a settlement week by construction and the from/to fields merely SHOW it; and the tick is an EXCLUSION SET rather than a picked set, persisted per batch with who and when, so a refresh can only ever ADD freight and never un-excludes — because a picked set cannot tell "not chosen" from "arrived after they chose", and its failure mode is a trip silently dropping out of somebody's pay. v10.26 — §6.1.2 added 2026-10-05: every worker that is not production says which database it is looking at, in the topbar that already exists rather than a band of its own (standing rule 1), decided by `NEON_BRANCH` because it names THE DATA — not `NODE_ENV`, which is `production` in dev's built worker too, and not the hostname, which breaks the day zebratms.com lands; anything that is not the production label is marked and the ribbon NAMES the branch it found, while production renders nothing at all, because an element that could print the wrong label on production is worse than no ribbon. v10.25 — §7.1.7 amended 2026-10-04, hours after it was written, because the same probe found a THIRD grid over the cap: `/payroll/batches`, taken from eight columns to eleven by §6.2.9 earlier the same day, with a chooser already on the page — which is what proves a chooser alone is not the fix, since a user with no stored preference gets every column back. THE CAP NOW LIVES IN `readGridColumns`, the one function every grid calls, rather than in each page; a page names which columns go first and the function bounds the count. v10.24 — §7.1.7 added 2026-10-04 (found by the UAT live check): the two OPERATIONAL lists run past §7.1's cap and therefore 500 — `/trucks` for every organization and `/loads` for any carrier with more than one authority — so both adopt §7.1.4's chooser, which already exists; the cap is a SLICE in code rather than a convention because a stored preference outlives every deploy, and the warnings column is never default-hidden because an absent warnings column reads as "nothing wrong"; v10.23 — §6.2.9 added 2026-10-04 (accounting polish part 3): /payroll/batches gains a pipeline strip of draft / final / paid money AS OF TODAY with each figure linking to that status, the batch list gains per-batch gross / net / deductions out of the statement that already groups them — and the doc says the three are NOT an equation because reimbursements and other pay are added back — /payroll/statements gains a per-driver net-pay sparkline over the last thirteen settlement weeks REGARDLESS of the picker, which is the only deliberate exception in the product to the chips-and-period rule and is written down as one; v10.22 — §6.2.8 amended 2026-10-04 (owner ruling, resolving flag 49): the strip carries TWO KINDS OF FIGURE with two labels and never mixes them — a BALANCE (open, overdue, factored, unapplied) is as of today with no date bound and links to a list with no period filter via `?period=all`, and a FLOW (invoiced in window, received in window) carries the picker; a balance was windowed before, which hid the five-month-old unpaid invoice on the screen whose job is to show what is owed; `?period=all` is a URL state and not a fifth preset, and the chip counts stay windowed because they describe the list; v10.21 — §6.2.8 added 2026-10-04 (accounting polish part 2): Invoices and Payments gain a four-figure summary strip where every figure is a LINK to the list it summarises and ties to the cent to it, FACTORED is never inside OPEN and overdue is a stated subset, every chip and tab count becomes a COUNT(\*) rather than a length over a capped list reader, the rolling picker and authority chips replace the from/to range here as on Reports, and the strip answers FOR THE WINDOW — which hides old open paper and says so, pointing at the unwindowed aging bar on Reports (flag 49); v10.20 — §7.5.1 and §7.11 added 2026-10-04 (the login bug): every refusal names itself IN WORDS on the form, the closed failure set includes the row everybody forgets — the request was fine and the system was not — one silent retry before words, NOTHING FALLIBLE after the credential is accepted, and src/app/error.tsx is one worded page with a try-again link that carries its own three sentences because a client boundary cannot ask the server for words; v10.19 — §6.2.7 added 2026-10-03 (accounting polish part 1): /accounting/reports gains four charted sections on §6.1.1's contract, the rolling picker and authority chips become ONE shared pair of components rather than a copy, the from/to range and the weekly/monthly toggle are REMOVED because v10.17 makes grain a property of the preset, factored paper is its own series and never inside collected, the four deduction categories are assembled with SOURCE BEATING LABEL since the schema stores no category, and every figure ties to the cent to the screen it summarises — with the list caps named as the limit of that claim; v10.18 — dashboard part 3 fills the Fleet, Cash and Compliance panels 2026-10-02: top drivers credits BOTH crew seats, receivables aging is invoiced-unpaid-non-factored only, Cash is money-roles-only, and the 30/60/90 compliance counts are a DIFFERENT question from the Needs-you warn-days row rather than a second expression of it; v10.17 — owner ruling 2026-10-02: CALENDAR WINDOWS ARE OUT, the picker becomes Last 7 days / Last 4 weeks / Last 13 weeks / Last 52 weeks, each ending with the current settlement week with the partial week drawn as far as today AND MARKED, grain is a property of the preset rather than the span, default Last 13 weeks; v10.16 — owner review of the charts on dev 2026-10-02: the period picker drives EVERY chart and the two-window permission is REVOKED, default period becomes This quarter, every chart carries a worded legend, every bar its value and label with gridlines and a visible CSS tooltip, every KPI a sparkline, and an empty period keeps its axis and legend; bars and sparklines become HTML/CSS while rings stay SVG; v10.15 — §6.1.1 gains the chart contract 2026-10-02: server-rendered inline SVG with no library and nothing that could animate, hover detail as a <title>, the palette an ACCENT RAMP rather than the status hues §3.3 fixes to meanings, and the same figures as a visually hidden table under every chart; v10.14 — §6.1.1 added 2026-10-01 (dashboard redesign part 1): chips and period govern the whole page, "after driver pay" is an em dash for any period Zebra was not settling, closed history counts in totals and appears in no queue, Needs-you becomes a right rail. _The brief for this said "Design system v10.2"; the file was already at v10.13, so this is v10.14 and the discrepancy is flagged rather than resolved — see `PHASE-5-BRIEF.md` §7 flag 42._ v10.13 — §7.10 added 2026-10-01: a record's history is ONE activity timeline, six kinds of entry that do not dress alike, a document's upload read from the `Document` row rather than its audit row, and adding a note is its own control; v10.12 — §6.2.1’s batches row reworded 2026-10-01: the bar is `checkbox selection · Finalise · Mark paid`, not a control called Change status; v10.11 — migration 61 lands 2026-10-01: §6.2.4 standing charges built and the Charges tab table goes to four, §6.2.3's deduct side built with the fuel mode frozen per statement, and the scope offered is the schema's three ownership types rather than the two §6.2.4 first named; v10.10 — §6.2.6 the statements grid 2026-10-01: Deductions is every net-reducing line, status and batch filters, bulk Post and Mark paid; v10.9 — §6.2.5 applying a payment 2026-09-30, and §7.5’s six-field cap applied against a brief asking for a modal; v10.8 — §6.2: Invoices gains a Factored tab, a status filter and bulk Mark sent 2026-09-30; v10.7 — §6.2.4 standing charges specified and held for migration 61, 2026-09-30; v10.6 — §6.2.2: the Trip column is the broker’s reference and Add trips is unconditional 2026-09-30; v10.5 — §6.2.2: every statement exports, a draft’s PDF is watermarked 2026-09-30 (owner’s ruling, reversing the same day’s refusal); v10.4 — §8’s heading rule decides by an allowlist of issued series 2026-09-30; v10.3 — §8 forbids an internal id in a heading and §6.2.2 gives the statement its title rule 2026-09-30 (owner’s ruling); v10.2 — §6.2.2’s trips grid corrected to nine columns behind a chooser 2026-09-29 (it named eleven and §7.1 throws above nine); §6.2.2 (the settlement workbench) and §6.2.3 (fuel and tolls) added 2026-09-29, with eleven more rows in §6.2.1, against `ST-005562.pdf` and six workbench screenshots; §2's stripe gloss removed from page headers 2026-09-29; §6.2 split into Accounting and Payroll 2026-09-28 (the artefact’s shape, owner’s ruling); §6.2.1 added and §7.1.2/§7.1.3's footer scope corrected from the artefact 2026-09-28; §7.1.3–§7.1.6 added 2026-09-28 (the grid contract: columns chooser, export, tabs over one grid); §6.2, §7.1, §7.4 amended 2026-09-28 (the Accounting section; sort, totals row, date range, company filter on financial lists); §5.1 amended 2026-08-01 (density moves the cell padding); §8 amended 2026-07-31 (midnight-local bare dates); §6.3 amended 2026-07-29 (company switcher → company filter)
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
6. **Logical CSS properties only** — `margin-inline-start`, never `margin-left`. The driver portal ships in Farsi, which is right-to-left.
7. **Every surface declares its own background.** No inheriting from `body`. _(carried from v2)_
8. **Inventory standalone CSS before restyling anything.** _(carried from v2)_
9. **Grep before deleting a token.** _(carried from v2)_
10. **No inner scroll container in the app shell** except designated table bodies and the notification drawer. _(carried from v2 §11 — this bug cost a session on the marketing site)_
11. **Destructive actions are never accent-colored.** Danger or ghost only.
12. **Nothing from the marketing design system enters the app shell** without being re-specified at application density. The two systems share brand color and nothing else.

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
--z-neutral: #64748b;
--z-neutral-soft: #f1f5f9; /* available, draft, uninvoiced */
--z-progress: #0e7490;
--z-progress-soft: #ecfeff; /* dispatched, in transit, sent */
--z-success: #15803d;
--z-success-soft: #f0fdf4; /* delivered, POD received, paid */
--z-warning: #b45309;
--z-warning-soft: #fffbeb; /* POD missing, due soon, partially paid */
--z-danger: #b91c1c;
--z-danger-soft: #fef2f2; /* overdue, disputed, out of service */
--z-muted: #94a3b8;
--z-muted-soft: #f8fafc; /* cancelled, inactive, void */
```

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

The dispatch board runs on a wall screen across a room. It is the only dark surface in the system.

```css
--z-wall-bg: #0d1014;
--z-wall-surface: #171a20;
--z-wall-border: #2a2f38;
--z-wall-ink: #e8eaed;
--z-wall-ink-2: #9aa2ae;
```

Status hues lighten for dark ground: raise lightness ~18%, drop saturation ~8%. Define as a separate token set; do not filter at runtime.

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

| Element            | Value                                    |
| ------------------ | ---------------------------------------- |
| Sidebar            | 224px, collapsed 56px                    |
| Topbar             | 48px                                     |
| Page gutter        | 20px desktop · 16px tablet · 12px phone  |
| Card padding       | 16px                                     |
| Table cell padding | 8px 12px                                 |
| Control height     | 32px default · 28px compact · 36px large |
| Input height       | 32px                                     |

### 5.1 Row density

A user preference persisted per user, defaulting to Standard.

| Mode        | Row height | Body size | Cell padding |
| ----------- | ---------- | --------- | ------------ |
| Compact     | 32px       | 12px      | 4px 12px     |
| Standard    | 36px       | 12px      | 8px 12px     |
| Comfortable | 44px       | 13px      | 12px 12px    |

**Row height is a MINIMUM, and the vertical cell padding is what moves.**

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

**The 30/60/90 counts are NOT the Needs-you compliance row and must not be
confused with it.** That row asks the authority's own `complianceWarnDays`
horizon through `complianceQueue`, which builds rows and costs three statements;
these are three fixed horizons and a different question. Two questions, two
readers — not one rule expressed twice.

**Every panel obeys the part-2b chart rules**: a legend in words, a value on
every bar, the same figures as a visually hidden table, and an empty state that
keeps the axis and the legend.

**Charts carry no charting library and no client JavaScript.** §14 forbids
charts that animate on every render, and the cheapest way to obey that is to
have nothing capable of it.

**BARS AND SPARKLINES ARE HTML AND CSS; RINGS ARE SVG.** _Amended 2026-10-02 —
this said inline SVG for everything._ A bar chart that must carry a value above
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

**Every chart carries the same figures as a visually hidden table** (§13). A
`role="img"` with a summary sentence tells a screen-reader user what they cannot
inspect; a table lets them read it. The SVG is `aria-hidden` because it is a
second rendering of that table, not the content.

### 6.2 Navigation groups

The spec lists seventeen destinations. Seventeen flat items is a wall. Group them, with the group label at 11px `--z-ink-3`, uppercase, `0.06em` tracking:

- **Operations** — Dashboard, Dispatch, Loads, Calendar
- **Fleet** — Trucks, Trailers, Drivers, Maintenance
- **Accounting** — Invoices, Payments, Payroll, Charges, Reports _(amended 2026-09-28; was **Money** — Invoices, Receivables, Payments, Settlements, Expenses, Fuel)_
- **Records** — Brokers, Documents
- **Admin** — Users, Settings

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

| Group          | Destination | The question                                   |
| -------------- | ----------- | ---------------------------------------------- |
| **Accounting** | Invoices    | who owes us, and how old is it                 |
|                | Payments    | what came in, and what it paid for             |
|                | Reports     | the same money cut by company, week or driver  |
| **Payroll**    | Batches     | what pay runs exist, and what state each is in |
|                | Statements  | what one driver was paid for one week          |
|                | Charges     | what comes off cheques, standing and one-off   |

_**Each destination is tabs over one grid** (§7.1.6):_

| Destination | Tabs                                                    |
| ----------- | ------------------------------------------------------- |
| Invoices    | Invoices · Ready to invoice · Factored · Direct-settled |
| Payments    | Payments · Unapplied                                    |
| Batches     | Batches · Balances                                      |
| Statements  | Driver statements                                       |
| Charges     | Scheduled · Standing · One-time · This week             |
| Reports     | By authority · By week · By driver                      |

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

| Row | Fields                                                                                  |
| --- | --------------------------------------------------------------------------------------- |
| 1   | Settlement no. `‹ ›` · Driver, period `‹ ›` · Driver type · Payment tariff              |
| 2   | Total pay · Earnings · Other pay / Reimbursements · Deductions / Advances · Trips count |
| 3   | Total gross · Net pay · Balances · Fuel & toll expenses · Attachments & notes           |

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

| Default                                                                                                  | Behind the chooser |
| -------------------------------------------------------------------------------------------------------- | ------------------ |
| Trip · Total pay · Driver gross · Status · Delivery date · Pickup date · Pickup · Delivery · Total miles | Load number · Unit |

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
`company drivers / owner-operators / all` leaves `LEASED` reachable by nothing
but `ALL`, because `Driver.employmentType` is an `OwnershipType` and that enum
has three members. A charge aimed at company drivers would silently skip every
leased driver. The schema's vocabulary wins (`AGENTS.md`) and the divergence is
recorded in `PHASE-5-BRIEF.md` §7 rather than resolved in this file.

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
  arbitrary windows would unmake all four.
- **The basis selector offers "Delivery time" and nothing else.** It is the
  office's basis. It is a selector rather than a label because Datatruck has one
  and the screens must read alike, and it is honest about having one option rather
  than implying others exist.
- **Columns:** ID · payee · driver type · load ref · status · load pay · pickup ·
  delivery · locations. Nine, which is §7.1's cap exactly, so a tenth goes behind
  §7.1.4's chooser (§7.1.7).

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

**3 — Batch status: DRAFT → PARTIAL → FINAL → PAID.** `PARTIAL` is some
statements final and some not, which is the state the office works in and the one
the enum could not express. Finalising is per statement; the change-status bar
acts on the selected ones (§6.2.1, v10.12).

**4 — Transactions report.** Every pay line in a window, by driver, exportable:
trip pay, deduction, advance, adjustment. The vocabulary exists —
`SettlementLineType` carries `LOAD_PAY`, `ACCESSORIAL_PAY`, `BONUS`,
`REIMBURSEMENT` and seven `DEDUCTION_*` — and "adjustment" has no type of its own
today, which this part has to name rather than improvise.

**5 — Salary report.** Totals per driver per period — gross / deductions / net —
by company, exportable. `reports.driver` is the half that exists (driver, weeks,
gross, deductions, net, with CSV); per-period rows and the company cut are what it
is missing.

**6 — Driver type on the record, on trip rows, on statements.** Company driver or
owner-operator. `Driver.employmentType` already holds
`OWNED ǀ LEASED ǀ OWNER_OPERATOR` — an ASSET ownership enum on a person, where
"company driver" is spelled `OWNED`, which is why it appears nowhere a reader
would look for it. A person's employment is not a truck's title, and the two
reading alike is the reason this needs saying.

**Agreement tests, both to the cent:** the trips left ticked sum to the batch's
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
- Bulk selection raises a floating action bar over the table foot, showing the count and only the actions valid for the whole selection.
- Every table has a written empty state (§10).

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
- The whole row is clickable via a stretched-link `::after` on a real anchor — middle-click and keyboard both work. Interactive controls inside the row raise `z-index` as dead zones. _(pattern proven on the admin board)_

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
  described on the phone.
- **The warnings column is never default-hidden**, on either list. §7.1.4 says
  hiding a column does not change the totals; the same sentence on an
  operational list is sharper — an absent warnings column reads as "nothing
  wrong", which is the one thing a hidden column must not be able to say.
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

### 7.3 KPI card

`--z-surface`, 6px radius, 1px `--z-border`, 16px padding. Label 11px `--z-ink-2` uppercase, value 24px weight 600 mono, delta 12px in success or danger with an explicit comparison period ("vs last week" — never a bare arrow).

No gradients. No sparkline unless the trend changes a decision. No icons in KPI cards.

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

### 7.6 Add Load — the hot path

The most-used form in the product. It gets its own rules:

- Single column, keyboard-first. Tab order follows the workflow exactly: broker → truck → driver → pickup → delivery → dates → miles → rate → rate confirmation → save.
- Rate per mile, driver pay, estimated fuel and estimated profit compute live under the rate field as read-only text. Never in a separate panel the dispatcher has to look for.
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
- Camera-first upload: **Take photo** is the primary control, file picker secondary. Compress client-side before upload and combine multi-page captures into a single PDF on the device.
- Status updates and uploads queue when offline and sync on reconnect, with an explicit pending indicator. Truck stops have bad signal; a silent failure loses a POD.
- Higher contrast than the operator app: body text against surface at 7:1 minimum for sunlight legibility.
- **A driver sees their own loads, their own documents, and their own settlement. Nothing else.** No company totals, no other drivers, no broker rates beyond their own load. This is a design rule as much as a permissions rule — do not build the component and hide it.

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

English, Russian, Farsi from day one — keys from the first component, never retrofitted.

- **Farsi is right-to-left.** Logical properties only (rule 6). No `left`/`right` in any stylesheet. Test the driver portal in `dir="rtl"` before shipping any screen.
- **Russian runs roughly 30% longer than English.** No fixed-width buttons, labels, or table headers. Test every screen in Russian.
- Locale drives number and date formatting via `Intl`. **Timezone comes from the stop, not the locale** (rule 3).
- **Never translate:** load numbers, invoice numbers, VINs, MC/DOT numbers, status codes in CSV and Excel exports. Exports are machine-read downstream.
- **An identifier is `dir="ltr"`, even in Farsi — whether it is typed or only
  read.** Not translating one is not enough: the bidi algorithm reorders the
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
