import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { neonConfig } from '@neondatabase/serverless'
import { createPrismaClient } from '@/lib/db'

// ---------------------------------------------------------------------------
// ONE MIGRATION'S RECORDED CHECKSUM, REPAIRED — AND ONLY FOR LINE ENDINGS.
//
//   npx tsx -r dotenv/config scripts/repair-migration-checksum.ts \
//     --name 20260924230000_driver_kind_referral_payee [--apply]
//
// ── WHAT WENT WRONG, SO THE NEXT PERSON DOES NOT REDISCOVER IT ────────────
//
// `.gitattributes` normalises the repository to LF. This Windows checkout had
// `core.autocrlf=true` and ONE migration file sitting in the working tree with
// CRLF endings. It was applied to dev FROM THAT WORKING TREE, so
// `_prisma_migrations` recorded the hash of the CRLF bytes — while the commit,
// and therefore every Linux checkout including CI's, holds the LF bytes.
//
// CI forks its database from dev, reads the LF file, compares it to dev's CRLF
// hash and correctly reports drift. `tests/migration-checksums.test.ts` has
// been failing on every push since 2026-09-24 and each failure blocked the
// deploy behind it.
//
// ── WHY THIS IS SAFE, AND WHERE THE PROOF IS ──────────────────────────────
//
// The guard is not "I looked and it seemed cosmetic". The script recomputes
// the CRLF VARIANT of the file on disk and REFUSES unless that hash is exactly
// what the database recorded. If it matches, the only possible difference
// between what ran and what is committed is carriage returns — which no SQL
// parser reads as anything. Any other edit produces a different hash and this
// script declines and says so.
//
// It is `--apply` or nothing: the default prints the comparison and writes
// nothing, because the one thing a migration-bookkeeping repair must not be is
// a script somebody runs to "have a look".
//
// SELECT PLUS ONE UPDATE, ON DEV. The host is printed and checked; production
// is refused outright and needs the owner (see the note this prints at the
// end).
// ---------------------------------------------------------------------------

neonConfig.webSocketConstructor ??= WebSocket

const args = process.argv.slice(2)
const nameAt = args.indexOf('--name')
const NAME = nameAt === -1 ? null : args[nameAt + 1]
const APPLY = args.includes('--apply')

if (!NAME) {
  console.error('usage: --name <migration_directory> [--apply]')
  process.exit(1)
}

const sha = (bytes: Buffer | string) =>
  createHash('sha256').update(bytes).digest('hex')

const file = readFileSync(
  join(process.cwd(), 'prisma', 'migrations', NAME, 'migration.sql'),
)
const lf = Buffer.from(file.toString('utf8').replace(/\r\n/g, '\n'), 'utf8')
const crlf = Buffer.from(lf.toString('utf8').replace(/\n/g, '\r\n'), 'utf8')

// DIRECT, NOT POOLED: this is DDL bookkeeping and the direct url is what
// every other migration-touching script here uses.
const url = process.env.DIRECT_DATABASE_URL
if (!url) throw new Error('No DIRECT_DATABASE_URL. Refusing to guess one.')
if (/production/i.test(url)) {
  throw new Error('That url looks like production. This script is dev-only.')
}
const db = createPrismaClient(url)

const rows = await db.$queryRawUnsafe<
  { migration_name: string; checksum: string; finished_at: Date | null }[]
>(
  'SELECT migration_name, checksum, finished_at FROM _prisma_migrations WHERE migration_name = $1',
  NAME,
)

const host = url.split('@')[1]?.split('/')[0] ?? '?'
console.log(`database  ${host}`)
console.log(`migration ${NAME}`)

if (rows.length === 0) {
  console.error('NOT APPLIED to this database. Nothing to repair.')
  await db.$disconnect()
  process.exit(1)
}

const recorded = rows[0]?.checksum ?? ''
console.log(`recorded  ${recorded}`)
console.log(`file (LF) ${sha(lf)}`)
console.log(`file CRLF ${sha(crlf)}`)

if (recorded === sha(lf)) {
  console.log('\nALREADY CORRECT — the recorded checksum is the LF file. OK.')
  await db.$disconnect()
  process.exit(0)
}

// THE ONE CHECK THIS SCRIPT EXISTS FOR.
if (recorded !== sha(crlf)) {
  console.error(
    '\nREFUSED. The recorded checksum is neither the LF file nor its CRLF\n' +
      'variant, so the difference is NOT line endings and this is not a\n' +
      'cosmetic repair. Something edited an applied migration. Revert the\n' +
      'file or take it to the owner.',
  )
  await db.$disconnect()
  process.exit(1)
}

console.log(
  '\nPROVEN COSMETIC: the recorded hash is exactly this file with CRLF\n' +
    'endings, so the SQL bytes are untouched.',
)

if (!APPLY) {
  console.log('\nDRY RUN. Re-run with --apply to write.')
  await db.$disconnect()
  process.exit(0)
}

await db.$executeRawUnsafe(
  'UPDATE _prisma_migrations SET checksum = $1 WHERE migration_name = $2',
  sha(lf),
  NAME,
)

const after = await db.$queryRawUnsafe<{ checksum: string }[]>(
  'SELECT checksum FROM _prisma_migrations WHERE migration_name = $1',
  NAME,
)
console.log(`\nwritten   ${after[0]?.checksum}`)
console.log(
  after[0]?.checksum === sha(lf)
    ? 'VERIFIED — OK.'
    : 'READ BACK WRONG — NOT OK.',
)
console.log(
  '\nPRODUCTION NEEDS THE SAME STATEMENT before its next deploy, if this\n' +
    "migration has been applied there. It is the owner's to run:\n" +
    `  UPDATE _prisma_migrations SET checksum = '${sha(lf)}'\n` +
    `   WHERE migration_name = '${NAME}';`,
)

await db.$disconnect()
