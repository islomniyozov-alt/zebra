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
- No singleton Prisma client. Per-request instantiation, React `cache()` plus a
  Proxy — Workers I/O objects cannot cross request boundaries.
- Password hashing must run on workerd. Native bcrypt and `@node-rs/argon2` do
  not. Verify under `npm run preview`, not just `next dev`.
- Permission is decided in `src/lib/permissions.ts` and nowhere else. Routes
  call `requirePermission`; none of them decide inline.
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
- **Read the exit code before anything touches the output.** `cmd | tail` gives
  you `tail`'s exit code — a cheerful `0` over a failed command — and a filter
  that trims to the last lines will trim away the banner explaining what went
  wrong. Capture the status first, then filter for reading. The same session
  produced three false readings this way: a proof that "passed" because `$?`
  was `tail`'s, a `sed` that silently matched nothing after prettier reindented
  its target, and a `grep` that turned a refused run into a four-second
  mystery.
- **A guard that has never been watched failing is not known to work.** Break
  the thing on purpose, see the guard fire, put it back. Flag 47's lesson, and
  the reason `singleLoadRateCents`, the money-arithmetic patterns and the
  template freshness check each have both branches observed.
