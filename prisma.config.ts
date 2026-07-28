import 'dotenv/config'
import { defineConfig } from 'prisma/config'

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

const target = process.env.NEON_BRANCH // 'dev' | 'production'
const isProd = process.env.NODE_ENV === 'production'
const url = process.env.DIRECT_DATABASE_URL

if (!target) {
  throw new Error(
    'NEON_BRANCH is not set. Declare it as "dev" or "production" in .env — ' +
      'this file refuses to guess which database it points at.',
  )
}

if (target === 'production' && !isProd) {
  throw new Error(
    'Refusing to run: NEON_BRANCH=production while NODE_ENV is not production. ' +
      'Set NEON_BRANCH=dev.',
  )
}

if (target === 'production' && !process.env.ALLOW_PROD_MIGRATION) {
  throw new Error(
    'Production migrations require ALLOW_PROD_MIGRATION=1 on that command only. ' +
      'Never put it in .env.',
  )
}

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
