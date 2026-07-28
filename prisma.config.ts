import 'dotenv/config'
import { defineConfig, env } from 'prisma/config'

// ---------------------------------------------------------------------------
// Prisma 7 moved the connection string out of schema.prisma. Migrations read
// it from here; the runtime client gets an adapter instance instead.
//
// NOTE (changed from the file as supplied): as of Prisma 7.9 `defineConfig`
// has no `adapter` key — it was removed from @prisma/config entirely. The
// schema engine connects natively and takes `datasource.url`. Driver adapters
// are now a RUNTIME concern only: the Neon WebSocket adapter is passed to the
// PrismaClient constructor (Step 2), not to this file.
//
// TWO URLS, TWO JOBS:
//   DATABASE_URL         pooled   (-pooler host) — app runtime on Workers
//   DIRECT_DATABASE_URL  direct   (no -pooler)   — migrations, DDL, seeds
// Running migrations through the pooler hangs with no error message.
//
// THE GUARD: Neon connection strings identify the endpoint (ep-xxx-123456),
// NOT the branch, so the target cannot be inferred from the URL — and this
// project's default branch is literally named "production", which never
// appears in the string. The target is declared explicitly instead, and a
// missing declaration fails closed rather than defaulting to convenient.
// ---------------------------------------------------------------------------

const target = process.env.NEON_BRANCH // 'dev' | 'production'
const isProd = process.env.NODE_ENV === 'production'

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

export default defineConfig({
  schema: 'prisma/schema.prisma',

  migrations: {
    path: 'prisma/migrations',
    // Seeds the two carriers and your cross-company membership.
    seed: 'tsx prisma/seed.ts',
  },

  // Migrations and seeds always use the DIRECT connection.
  datasource: {
    url: env('DIRECT_DATABASE_URL'),
  },
})
