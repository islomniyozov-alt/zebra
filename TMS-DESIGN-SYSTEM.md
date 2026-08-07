# TMS-DESIGN-SYSTEM.md

**Project:** Zebra — Transportation Management System
**Status:** v4 — §5.1 amended 2026-08-01 (density moves the cell padding); §8 amended 2026-07-31 (midnight-local bare dates); §6.3 amended 2026-07-29 (company switcher → company filter)
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

- The stripe reflects **operational** status on load surfaces, **billing** status on invoice and AR surfaces, and **compliance urgency** on fleet and driver surfaces. One meaning per screen, stated in the screen's header.
- The stripe is never the only indicator (rule 5). The status word sits in the row.
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

### 6.2 Navigation groups

The spec lists seventeen destinations. Seventeen flat items is a wall. Group them, with the group label at 11px `--z-ink-3`, uppercase, `0.06em` tracking:

- **Operations** — Dashboard, Dispatch, Loads, Calendar
- **Fleet** — Trucks, Trailers, Drivers, Maintenance
- **Money** — Invoices, Receivables, Payments, Settlements, Expenses, Fuel
- **Records** — Brokers, Documents, Reports
- **Admin** — Users, Settings

Groups render only where the user's role grants at least one child. A dispatcher without financial permission never sees an empty **Money** heading.

Active item: `--z-accent-soft` fill, `--z-accent` text, 2px accent bar on the leading edge. Icons at 16px, always paired with a label. Icon-only navigation is forbidden except in the collapsed rail, which shows tooltips.

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
- The whole row is clickable via a stretched-link `::after` on a real anchor — middle-click and keyboard both work. Interactive controls inside the row raise `z-index` as dead zones. _(pattern proven on the admin board)_

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

### 7.5 Forms

Label above input, 12px `--z-ink-2`. Mark required fields, not optional ones. Validate on blur, never on keystroke. Errors sit under the field in `--z-danger`, 12px, and say what to do — see §10.

**Modals hold six fields at most.** Anything larger is a full page. The Add Load form is a full page.

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

---

## 8. Data display

**Money.** `$` prefix, thousands separators, always two decimals, right-aligned, mono, tabular. Negative figures take a leading minus and `--z-danger` — not parentheses. Dispatchers are not accountants and parentheses read as a footnote.

**Rate per mile.** Two decimals, no dollar sign in table columns headed `RPM`.

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
- **An identifier field is `dir="ltr"`, even in Farsi.** Not translating one is not
  enough: the bidi algorithm reorders the punctuation inside it. An invoice
  prefix of `INV-` renders as `-INV` in an RTL input, and a violation code of
  `393.75(a)(3)` reverses its brackets — the value is correct in the database
  and wrong on the screen, which is the worst of the two. Any input whose value
  is a Latin identifier — prefixes, codes, reference numbers, plates, VINs —
  sets `dir="ltr"` so it reads the way it will be typed into somebody else's
  system. Found in the Phase 4 RTL pass, on the one field that lands in an
  invoice number people read down a phone.
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
