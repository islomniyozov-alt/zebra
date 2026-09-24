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

- **The deploy order is: fix, dispatch production, THEN push the next
  migration.** Owner’s ruling, 2026-09-22, and it replaces the shorter
  version it grew out of ("dispatch production before pushing the next
  migration to main"), which did not say what to do when the tree was
  already broken.

  Four steps, and each one is there because skipping it cost a run:
  1. FIX whatever is red. A dispatch runs the same gate and the same
     integration suite as CI, so a broken tree cannot deploy anywhere — it
     can only fail twice.
  2. RUN THE FULL INTEGRATION PROJECT LOCALLY, not the file you edited.
     `npm run check` does not include it. On 2026-09-21 and again on
     2026-09-22 a change to `driverWarnings` passed `check` and every node
     test and broke a fixture in `tests/integration/warnings.test.ts` — the
     second time AFTER saying the habit was fixed. Ten minutes; run it.
  3. DISPATCH PRODUCTION and read the drift from Cloudflare.
  4. ONLY THEN push the next migration.

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
