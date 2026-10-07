<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.

<!-- END:nextjs-agent-rules -->

# Zebra

Current phase: **Phase 5 — smart load creation.** Read `PHASE-5-BRIEF.md`
first; §7 lists what has been flagged against it. Phase 4 is closed — its §7
records how each acceptance box was met and §8 what this phase inherits.

Phases 1, 2, 3 and 4 are closed and all still binding: Phase 1 for the
mechanisms in its §6–§10, Phase 2 for its engine patterns, Phase 3 for money,
Phase 4 for fleet and safety. Each brief's flag section is the list of what was
argued with rather than obeyed — `PHASE-2-BRIEF.md` §16, `PHASE-3-BRIEF.md` §9,
`PHASE-4-BRIEF.md` §6, `PHASE-5-BRIEF.md` §7.

A decision in a brief's §2 and a box in its §4 do not add up to a step in its
§3. Phase 4 §6 flag 19 is what that costs: the dispatch-time compliance warning
was decided, was an acceptance criterion, and had no step behind it — the
acceptance run found it, in the last session of the phase.

**A new table that carries `organizationId` needs a row in
`tests/integration/fixtures.ts`, in the same commit.** Row-level security being
enabled is not proof that it hides anything: "sees no rows from the other
organization" is true of a table with nothing in it, which is the most
comfortable way to be wrong. `tests/isolation-coverage.test.ts` fails by name in
`npm run check` for any tenant model the fixture never seeds — it was written
after five Phase 4 tables went two phases with a policy and no proof.

Read `prisma/schema.prisma` and `TMS-DESIGN-SYSTEM.md` before writing anything,
plus the brief for whatever is being built. Where a brief disagrees with those
two, the two win and the contradiction gets flagged rather than silently
resolved.

Briefs get transcribed into the repository. Phase 3's had to be excavated from
a session transcript at Step 7 to run its own acceptance criteria against; a
rule that lives only in a chat log cannot be cited in review, and a criterion
that lives only in a chat log cannot be checked.

Rules that are cheap to state and expensive to rediscover:

- Neon **WebSocket** adapter only. The HTTP driver cannot run interactive
  transactions, and the RLS session variable needs one per request.
- Prisma 7 syntax. The datasource block has no `url` on purpose and
  `driverAdapters` is no longer a preview feature. Do not "fix" either back.
- **`relationJoins` is ON, deliberately, and it is app-wide.** With that
  preview enabled, every Postgres relation read in the application defaults to
  a lateral join instead of one query per included relation. It was turned on
  for the Tuesday screen on 2026-09-18 and the blast radius is the whole app,
  so it is written here rather than left as a line in a schema file.

  MEASURED BEFORE AND AFTER, on the money screen: 25 statements to 17, and
  4427ms to 2822ms. `werner` fell from three statements to one, `recent` from
  two to one, and the settlement engine's `Load` read from four to one.

  THE EVIDENCE THAT IT IS SAFE IS THE SUITE, because there is no narrower
  proof available for a change this wide: `npm run check` green at 1923, and
  the full integration project at 564 of 565 — the single failure a dropped
  Neon socket, which is the environment and not the strategy.

  Reverting is one line in `prisma/schema.prisma` and costs eight statements
  back on that page. Do not revert it casually, and do not widen it silently
  either: a per-query `relationLoadStrategy` override is available if some
  future query is better off with separate reads.

- No singleton Prisma client. Per-request instantiation, React `cache()` plus a
  Proxy — Workers I/O objects cannot cross request boundaries.
- Password hashing must run on workerd. Native bcrypt and `@node-rs/argon2` do
  not. Verify under `npm run preview`, not just `next dev`.
- Permission is decided in `src/lib/permissions.ts` and nowhere else. Routes
  call `requirePermission`; none of them decide inline.
- **Domain logic lives in `src/lib/`. A `'use server'` action reads the form,
  calls one function, and revalidates.** Not a style preference: an action body
  runs behind `withCurrentOrg`, so testing the rule inside it means standing up
  the whole auth context, which nobody does — the rule ships on a reading
  instead. Three times the inline placement was the actual reason something
  went unverified, and three times the fix was the same move. See
  `PHASE-6-BRIEF.md` flag 97.
- Never send a field to the client that the role cannot see. Leave it out of
  the payload — hiding it in CSS is the same bug as not checking at all.
- **`zebra_session` carries NO `Domain`, and that is the setting, not an
  omission.** A cookie with no `Domain` is host-only: the browser sends it back
  to the exact origin that set it and nowhere else. So the session is correct
  per origin for free — `zebra-dev`, `zebra`, and `zebratms.com` when it lands,
  each hold their own, and moving to the custom domain costs one fresh sign-in
  and leaks nothing.

  ADDING A `Domain` IS THE FAILURE MODE, and it will look like a convenience:
  `Domain=zebratms.com` sends the operator session to every subdomain that name
  ever acquires, including whatever a marketing page or a staging box is served
  from. `tests/auth-cookie.test.ts` fails by name if the attribute appears.

  The rest of the attributes are fixed too — `HttpOnly`, `SameSite=Lax`,
  `Path=/`, `Max-Age` from `SESSION_TTL_MS` — and `Secure` is keyed to
  `NODE_ENV` rather than to the host, which is right: it is off only where the
  origin is `http://localhost`.

- Money is an integer of cents, percentages are integer basis points.
- Logical CSS properties only — `margin-inline-start`, never `margin-left`.
- No hex colour outside the token block. Grep before deleting a token.
- Amend `TMS-DESIGN-SYSTEM.md` in its own commit, with the reason, _before_
  changing code to match it.

Rules about instruments, which are the ones that cost whole sessions:

- **Never supply the baseline you are testing.** Asking
  `git rev-list --count 6fc6f60..HEAD` how far production is behind, when
  `6fc6f60` is your own belief about production, gets you your belief back with
  a number attached. Read the baseline from the thing being measured —
  `check:drift` queries Cloudflare — and only then compute against it. On
  2026-08-20 production had moved three deploys past a reading carried forward
  from two days earlier, and every report in between repeated it.
- **Run anything whose failure matters under `scripts/run-status.mjs`, and read
  the status from the file it writes. Not from the shell.**

      node scripts/run-status.mjs deploy-dev -- npm run deploy:dev
      node scripts/run-status.mjs --check deploy-dev

  `cmd | tail` gives you `tail`'s exit code — a cheerful `0` over a failed
  command — and a filter that trims to the last lines will trim away the banner
  explaining what went wrong. One session produced three false readings that
  way: a proof that "passed" because `$?` was `tail`'s, a `sed` that silently
  matched nothing after prettier reindented its target, and a `grep` that
  turned a refused run into a four-second mystery.

  THIS RULE USED TO SAY "capture the status first, then filter for reading" AND
  THAT WAS NOT ENOUGH. It asked for care, and on 2026-09-09 care failed twice
  in one session on this exact hazard — both times
  `npm run deploy:dev > log 2>&1; echo "exit=$?"; tail -6 log`, both times a
  deploy that REFUSED because the integration suite was red, both times
  reported as a completed deploy because the status belonged to `tail` and the
  six lines it chose did not include the refusal. The second one was written by
  somebody who had just quoted this rule.

  So the rule names a mechanism rather than a disposition, which is flag 86's
  lesson applied a second time: the wrapper writes the wrapped command's real
  exit code to `.run-status/<name>.json` before it exits, `--check` reads that
  file and nothing else, and it fails closed — a missing file, a run still in
  flight, or a wrapper that was killed all report NOT OK rather than silence.
  The verdict prints in capitals with the number repeated, so a `tail -1` of it
  is still unambiguous. That is the one hostile reading the whole thing exists
  to defeat.

  AND THE WRAPPER'S OWN EXIT CODE IS NOT THE WRAPPED COMMAND'S, WHEREVER YOU
  READ IT FROM. On 2026-09-24 the integration gate was run under the wrapper
  and backgrounded:

      node scripts/run-status.mjs integ-full -- npm run test:integration

  The harness announced it "completed (exit code 0)". Meanwhile
  `.run-status/integ-full.json` said EXIT CODE 1, 0.44 seconds in, because the
  gate had REFUSED to start on a dirty tree. Both numbers were true about
  different processes, and nothing was green.

  That is `tail`'s exit code again, arriving through a channel this rule did
  not name: not a pipe this time but a completion notice, which is harder to
  distrust because it sounds like the answer. So the rule is not "don't pipe
  to `tail`" — it is that ONE file is the verdict and everything else is
  hearsay, including a notification, a zero from `$?`, and the wrapper's own
  status. Run `--check` and read what it prints. A wrapper that cannot even
  start its command still exits cleanly, having done its job.

- **A GATE THAT DIES BETWEEN t+500s AND t+640s IS THE SOCKET, NOT THE CODE —
  observed four times on 2026-10-02 and recorded rather than fixed.** Owner
  measurement, logged here because the next person to meet it will otherwise
  spend an afternoon reading a diff.

      14:17  clean
      16:25  dropped Neon sockets, t+500..640s
      17:25  dropped Neon sockets, t+500..640s
      18:11  dropped Neon sockets, t+500..640s

  THREE EVENING RUNS, ONE CLEAN AFTERNOON RUN, NO CODE CHANGE BETWEEN THEM.
  The window is narrow and repeatable, which is what makes it a property of
  the connection rather than of the suite: a real failure does not wait for
  the same eight-minute mark three times running, and does not skip the run
  that happened at lunchtime.

  SO THE READING IS: re-run it, and read the status file. What this does NOT
  license is treating any red gate as the socket. `tests/socket-rename.test.ts`,
  `tests/socket-crash-guard.test.ts` and
  `tests/integration/socket-retry.test.ts` exist because the retry path is code
  with real bugs, and a dropped socket inside a TRANSACTION still loses the
  work. The claim is about the gate dying mid-run at a known elapsed time, not
  about failures in general.

  NOT FIXED, AND NOT TO BE FIXED BY RETRY HERE. A gate that retried until it
  passed would be a gate that reports green for a tree nobody tested — the
  exact thing the receipt mechanism exists to prevent. If this needs solving
  it is solved at the connection, not at the verdict.

- **The deploy order is: fix, dispatch DEV, dispatch PRODUCTION, THEN push
  the next migration.** Owner’s rulings, 2026-09-22 and 2026-10-04. It
  replaces two shorter versions: "dispatch production before pushing the next
  migration to main", which did not say what to do when the tree was already
  broken, and the four-step list that named production alone — which is how
  production ended up a deploy ahead of dev.

  Five steps, and each one is there because skipping it cost a run:
  1. FIX whatever is red. A dispatch runs the same gate and the same
     integration suite as CI, so a broken tree cannot deploy anywhere — it
     can only fail twice.
  2. RUN THE FULL INTEGRATION PROJECT LOCALLY, not the file you edited.
     `npm run check` does not include it. On 2026-09-21 and again on
     2026-09-22 a change to `driverWarnings` passed `check` and every node
     test and broke a fixture in `tests/integration/warnings.test.ts` — the
     second time AFTER saying the habit was fixed. Ten minutes; run it.

     COMMIT FIRST: the gate refuses a dirty tree, because its receipt is tied
     to a commit and a receipt from a tree nobody can reconstruct would be
     rejected anyway. So the order inside this step is commit, then run, then
     amend or add a commit if it comes back red — not run, then commit. On
     2026-09-24 this step was attempted on a dirty tree, refused in 0.44
     seconds, and the refusal was nearly read as a pass because the wrapper
     exited 0 around it.

  3. DISPATCH DEV, and read its receipt. Owner's ruling, 2026-10-04: the
     ritual always goes DEV → PROD, never prod alone.
  4. DISPATCH PRODUCTION, on dev's receipt, and read the drift from
     Cloudflare for BOTH workers.
  5. ONLY THEN push the next migration.

  **A REPORT THAT ENDS WITH DEV BEHIND IS INCOMPLETE.** Owner's ruling, and it
  is a ruling because the previous version of this list said "dispatch
  production" and nothing about dev — so on 2026-10-03 production went to
  `b221c8c` while dev sat six commits back at `b4f994d`, and the report said so
  as a footnote rather than treating it as unfinished work.

  WHY THE ORDER IS DEV FIRST AND NOT EITHER. Dev is the worker that can be
  wrong for free. It runs the same build, the same bundle and the same
  `opennextjs-cloudflare` output as production against a database nobody
  invoices from, so a build that is going to fail on workerd fails there — and
  a deploy that dies half way through uploading assets has done it to the
  worker that carries no freight. Dispatching production first spends the real
  worker to learn what the free one would have told you.

  AND DEV BEHIND IS NOT A COSMETIC PROBLEM. Every screenshot, every "it works
  on dev", and every `verify:response` run reads a worker that is not the code
  under discussion; `check:drift` prints the gap for exactly this reason, and a
  gap nobody closes is a measurement nobody trusts.

  AND FROM THE MOMENT A MIGRATION IS APPLIED TO DEV, DEV AND `main`
  DISAGREE — so nothing may run CI until its file is pushed. Not a push of
  something else, not a production dispatch, nothing. CI forks its database
  from dev, so a migration applied there and absent from the repository
  makes `tests/migration-checksums.test.ts` fail on every run — "applied but
  MISSING from prisma/migrations" — and the production dispatch refuses
  before it reaches the deploy step. That is what happened on 2026-09-21
  and it is why production sat five commits behind for an afternoon.

  THE EARLIER VERSION OF THIS SAID "DO NOT APPLY TO DEV BEFORE THE FILE IS
  PUSHED", WHICH IS NOT FOLLOWABLE. You cannot build against tables that do
  not exist, so the apply has to come first; what must not happen is a CI
  run in the window it opens. Written as a prohibition on the apply, the
  rule gets broken the first time somebody needs the tables — which is what
  happened on 2026-09-22, four minutes after it was written, by the person
  who wrote it. The dispatch in flight had forked dev before the apply, so
  nothing broke; that is luck, and a rule that depends on luck is not a
  rule.

- **FROM THE MOMENT THE INTEGRATION GATE STARTS UNTIL THE RITUAL'S LAST STEP
  REPORTS: NO EDIT, NO COMMIT, NO WATCHER, NO DRY RUN. The working directory
  is UNTOUCHED. Queue the change; start it after.** Owner's rulings,
  2026-10-05 and 2026-10-06.

  The receipt is tied to a commit AND a tree. The gate withholds it the moment
  either moves — "The working tree MOVED during the run: started at 5ab4c5e,
  finished at 02bb83c. No receipt written." — and it is right to: a receipt from
  a tree the suite did not run against would vouch for code nobody tested. Every
  case was green all three times this happened on 2026-10-05, and all three
  receipts were correctly refused, so the twelve minutes were spent learning
  nothing. THAT COST IS PAID BY PRODUCTION'S WAITING, not by the person who
  moved the tree.

  THREE WAYS IT WAS BROKEN IN ONE DAY, so none of them reads as the exception:
  1. A COMMIT mid-run. "I'll just commit this test while the suite runs."
  2. An EDIT mid-run. The tree was dirty when the dev dispatch read it, so the
     receipt did not match and the dispatch re-ran the suite — which then
     refused to start on the dirty tree.
  3. A WATCHER mid-chain. `scripts/watch-guard.mjs` breaks a source file and
     restores it by hash — that is an edit twice over, and the hash check
     proves the file came back, not that nothing saw it changed.
  4. A "DRY RUN" mid-gate, 2026-10-06. A patch script was rehearsed against
     the tree by replacing the body of its `write` with a no-op through
     `str.replace` — the pattern had been mangled by a heredoc, the replace
     matched nothing and handed the script back unchanged, and the "dry run"
     wrote 28 files into a tree whose gate had started three minutes earlier.
     The same silent no-op this file names for `sed`, arriving as a rehearsal.
     The tree was restored within two minutes and the receipt survived; that
     is luck, and the rule does not depend on it.
  5. A REHEARSAL "AGAINST A MIRROR" THAT WAS NOT, 2026-10-07. Four patch
     scripts were given a root override through an environment variable by
     a patch that died on a syntax error — so no script read the variable,
     every one took its default, and the default was the live tree. They
     wrote four files 37 seconds into the PRODUCTION dispatch. The compile
     had finished 22 seconds before the first write (the build output's
     mtimes, not a belief), the restore took 14 seconds, and the bundle on
     production is the committed tree's. That is luck a third time.

     THE FIX IS IN THE SCRIPTS, NOT IN THE PERSON: the root is a strict
     ARGUMENT (an unknown argument fails; an environment variable nobody
     reads cannot), and a script asked to write into the live tree first
     reads `.run-status/*.json` and REFUSES while any of them says
     `running`. Both refusals were watched firing before the scripts were
     trusted again. A rehearsal that DEFAULTS to the live tree is the hazard;
     the mirror has to be the thing you cannot forget to name.

  "THE RITUAL'S LAST STEP" IS THE LAST THING IN THE CHAIN — the drift read,
  or the sweep when one is chained after the dispatches — and not "the deploy
  finished". A chain is one run until its final verdict prints.

  THE MECHANISM IS A PLACE TO PUT THE WORK. The rule is followable only
  because the scratchpad exists outside the repository: write the change you
  want there — the patch script, the commit message, the breaks file — and
  apply it when the chain reports. The first entry made under this rule was
  this rule, written to the scratchpad while a chain ran and applied after.

  AND A REHEARSAL IS NOT EXEMPT BECAUSE IT INTENDS TO WRITE NOTHING. Rehearse
  in the scratchpad or in a worktree, never in the tree a gate is reading; a
  dry-run mode belongs INSIDE the script as a flag that makes `write` a no-op,
  not in a harness that edits the script's text. Owner's ruling, 2026-10-06:
  "Freeze means the working directory is untouched, dry runs included."

- **A MIGRATION THAT REMOVES A DEFAULT, A CONSTRAINT OR AN INDEX CARRIES THE
  GREP THAT PROVES EVERY WRITER SETS THE COLUMN — QUOTED IN THE MIGRATION'S
  COMMENT, NOT ASSERTED.** Owner's ruling, 2026-10-06.

  Migration 63 dropped the empty-array defaults on `Settlement.teamWith` and
  `referralWith` on one sentence in its own comment: "the application has always
  written both columns explicitly." The person who wrote it had not looked.
  `settlements.ts` omits them, every test fixture omits them, and Prisma sends
  NOTHING for an omitted scalar list — so the database default was the contract,
  and the first integration run against 63 failed 23 cases across 11 files, every
  one a "Null constraint violation" on `settlement.create`. 63 was already on
  production. **64 was its cost:** a second production migration for the owner
  to run, and a window in which any settlement created outside `refreshDraft`
  failed.

  THE GREP IS THE EVIDENCE, AND IT GOES IN THE FILE. For a default: every
  `<model>.create(` and `createMany(` site, with whether each names the column.
  For a constraint: every write the constraint used to refuse. For an index:
  every read that used it. Run the command, paste the command AND its output
  into the migration's comment above the statement, and let the reader check it
  against the tree. An assertion in a comment is a belief with a timestamp.

      $ grep -rln "settlement.create(" src/lib tests/integration/fixtures.ts
      src/lib/settlement-batch.ts     mentions teamWith: 2
      src/lib/settlements.ts          mentions teamWith: 0   <- the default was load-bearing
      tests/integration/fixtures.ts   mentions teamWith: 0

  That output, written into 63 before the apply, would have stopped it. It was
  produced AFTER the suite failed, which is the order this rule exists to invert.

  AND IT IS A GREP OF THE WRITERS, NOT OF THE SCHEMA. Flag 88's twin: the schema
  file is what the code believes about the column, and a scalar list without
  `@default` in Prisma looks exactly like one every writer sets. Build the
  instrument from the artefact — the call sites — not from the declaration.

- **Edit source with the tool that refuses a missed anchor. Not `sed`.**
  `str.replace` returns the original string when it matches nothing, `sed`
  exits 0, and a filter that matches nothing prints nothing — so a silent
  no-op is indistinguishable from a successful edit, and a `tail -n +$EMPTY`
  appends a whole file to itself. The Edit tool fails loudly on both.

  THIS RULE USED TO SAY "assert the anchor" AND THAT WAS NOT ENOUGH. It asked
  for care, and care failed three times in one session on this exact hazard —
  each time because prettier had reformatted the line between reading it and
  matching it. Then, told to be careful, the next attempt reached for line
  numbers, which is the same vigilance wearing a different hat.

  So the rule names a mechanism rather than a disposition, which is flag 87's
  lesson turned on the hands doing the work: the exit-code rule was written
  and broken the same day, and what fixed it was capturing to a file, not
  remembering harder. Reserve shell splicing for files no editor tool can
  reach, and say why at the call site. See `PHASE-6-BRIEF.md` flag 86.

- **A rename has one destination. A split has one per importer. So the unit of
  work is the importer, not the string.** Both look like find-and-replace and
  only one of them is. Splitting `extraction-shape.ts` into an envelope and a
  rate-con shape, a single sweep over every occurrence sent `Confidence`,
  `Field` and `Maybe` to the module that had just stopped exporting them — and
  `parse.ts` wanted both halves, which no uniform rewrite can express. Open
  each importing file and ask what IT imports. The compiler will name the ones
  you get wrong, which is luck rather than method: a split among values that
  are not type-checked, or among strings, has no such backstop.

- **Count the thing you are claiming, not a superset of it.** A corpus-wide
  count of "stops carrying an arrival" returned 1,002 of 1,285 and was used to
  retract a correct diagnosis. The claim was about one pair on one stop in one
  file; the measurement was of a 1,600-file archive that predated the defect,
  where the survivors carry the count. The row settled it in one query. Twin of
  "check the thing that acts", and it applies to fixtures too: a corpus that
  stops where the archive stops records what USED to arrive. Flag 88.
  All three instruments that missed it had inherited the belief they were meant
  to test — the aggregate the archive's date, the corpus the sweep's end, the
  test the parser's column name. Build the instrument from the artefact, not
  from what the code believes about it.
- **A guard that has never been watched failing is not known to work. Break it
  under `scripts/watch-guard.mjs`, which treats zero failures as a failure.**

      node scripts/watch-guard.mjs breaks.json

  Break the thing on purpose, see the guard fire, put it back. Flag 47's
  lesson, and the reason `singleLoadRateCents`, the money-arithmetic patterns
  and the template freshness check each have both branches observed.

  THIS RULE USED TO END AT "put it back" AND THAT WAS NOT ENOUGH. On
  2026-09-10 four guards were broken in a shell loop that counted failing test
  lines. The third reported ZERO failures, and zero was read as a finding
  about the guard. The guard was fine; the loop's edit helper had silently not
  applied the break, so the suite ran against unmodified source and passed —
  and a passing suite is exactly what a working guard looks like when nobody
  checks that the break landed. Run directly, it fired on the first try.

  That is the same silent no-op as the `sed` trap and the `tail` trap, which
  is why the answer is the same one for the third time: a mechanism, not more
  care. The wrapper requires the anchor to occur exactly once, requires the
  bytes on disk to change, requires the command to FAIL, optionally requires
  the named test to be among the failures, and restores the file on every path
  including a throw — verifying the restoration by hash. Zero failures prints
  THE BREAK DID NOT FIRE — NOT OK.
