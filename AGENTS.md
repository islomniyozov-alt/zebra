<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.

<!-- END:nextjs-agent-rules -->

# Zebra

**Phase 3 is closed.** Phases 1, 2 and 3 are all closed and all still binding:
Phase 1 for the mechanisms in its §6–§10, Phase 2 for its engine patterns,
Phase 3 for money. Each brief's flag section is the list of what was argued
with rather than obeyed — `PHASE-2-BRIEF.md` §16, `PHASE-3-BRIEF.md` §9 — and
`PHASE-3-BRIEF.md` §11 is what the next phase inherits.

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
