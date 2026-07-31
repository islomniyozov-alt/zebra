<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.

<!-- END:nextjs-agent-rules -->

# Zebra

Current phase: **Phase 2** — read `PHASE-2-BRIEF.md` first; §16 lists what has
been flagged against it. `PHASE-1-BRIEF.md` is closed but still binding for the
mechanisms in its §6–§10.

Read `PHASE-2-BRIEF.md`, `prisma/schema.prisma` and `TMS-DESIGN-SYSTEM.md` before
writing anything. Where the brief disagrees with the other two, the other two win
and the contradiction gets flagged rather than silently resolved.

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
