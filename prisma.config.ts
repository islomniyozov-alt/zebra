import 'dotenv/config'
import { defineConfig } from 'prisma/config'
import { assertProductionWrite } from './prisma/production-gate'
import {
  readLatestMigrationNumber,
  readPersistedScopes,
} from './prisma/gate-readers'

// ---------------------------------------------------------------------------
// Prisma 7 moved the connection string out of schema.prisma. The schema engine
// connects natively via `datasource.url` here; the Neon WebSocket driver
// adapter is a RUNTIME concern and goes on the PrismaClient constructor, not
// in this file. `adapter` is not a valid key in @prisma/config 7.9.x.
//
// TWO URLS, TWO JOBS:
//   DATABASE_URL         pooled (-pooler host) — app runtime on Workers
//   DIRECT_DATABASE_URL  direct (NO -pooler)   — migrations, DDL, seeds
// Migrations through the pooler hang with no error message.
//
// THE GUARD: Neon connection strings identify the endpoint (ep-xxx-123456),
// NOT the branch — and this project's default branch is literally named
// "production", which never appears in the string. The target is declared
// explicitly, and a missing declaration fails closed.
// ---------------------------------------------------------------------------

const url = process.env.DIRECT_DATABASE_URL

// ── THE PRODUCTION GATE, FROM THE ONE PLACE IT LIVES ──────────────────────
//
// These were three `if`s here, which no test could reach without running the
// Prisma CLI — and that is how `prisma/seed.ts` came to have a weaker rule than
// this file for months: nothing could ask either of them what it would do. The
// checks are unchanged in effect; they are now also asked by the seed, and
// `tests/production-gate.test.ts` watches every branch of them.
//
// IT COVERS `migrate`, `db push`, `db execute`, `migrate reset` AND the seed,
// because every one of them loads this file first.
// THE TWO READINGS THE GATE WILL NOT TAKE ITSELF (owner's ruling 2026-10-05):
// which migration is being applied, so the override names it and expires with
// it, and whether either variable is sitting in a persistent Windows scope,
// where it would outlive the terminal and leave the gate permanently open.
assertProductionWrite(process.env, 'migration', {
  expected: readLatestMigrationNumber(),
  persisted: readPersistedScopes(),
})

if (!url) {
  throw new Error('DIRECT_DATABASE_URL is not set.')
}

if (url.includes('-pooler')) {
  throw new Error(
    'DIRECT_DATABASE_URL points at the pooled endpoint. Migrations must use ' +
      'the direct host — remove "-pooler" from the hostname. Left unfixed, ' +
      'the first migration hangs with no error.',
  )
}

export default defineConfig({
  schema: 'prisma/schema.prisma',

  datasource: { url },

  migrations: {
    path: 'prisma/migrations',
    // Seeds the organization, the two known authorities, and the owner user.
    seed: 'tsx prisma/seed.ts',
  },
})
