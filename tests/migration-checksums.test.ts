import { createHash } from 'node:crypto'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { Pool } from '@neondatabase/serverless'

// ---------------------------------------------------------------------------
// AN APPLIED MIGRATION FILE IS CLOSED TO EDITS — INCLUDING ITS COMMENTS.
//
// `20260806023129_drop_pay_rule_expression` was applied on 6 August and its SQL
// comments were rewritten in the Step 7 polish commit, hours later. Nothing
// noticed. It surfaced the next time somebody ran `prisma migrate dev`, which
// refused to do anything and offered to RESET THE DEVELOPMENT DATABASE — and
// production had the same drift waiting, where `migrate deploy` would have
// refused mid-ritual with a migration half-applied and somebody guessing.
//
// The cost of finding it late is the whole point. A prose pass that sweeps the
// repository has no idea which files are closed; this does, and it fails
// `npm run check` in the same minute the edit is made rather than on the next
// production deploy.
//
// WHAT PRISMA COMPARES is the sha256 of the migration.sql BYTES. Not the
// statements, not the parse tree — the bytes. So a reformatted comment, a
// changed line ending and a rewritten SQL statement are all the same kind of
// failure here, and that is correct: the checksum is a claim that the file on
// disk is the file that ran.
//
// Read-only, and fast enough to belong in `check` next to structure.test.ts.
// ---------------------------------------------------------------------------

const pool = new Pool({ connectionString: process.env.DIRECT_DATABASE_URL })

afterAll(async () => {
  await pool.end()
})

const MIGRATIONS = join(process.cwd(), 'prisma', 'migrations')

/** Every migration directory on disk, in application order. */
function localMigrations(): string[] {
  return readdirSync(MIGRATIONS)
    .filter((entry) => /^\d{14}_/.test(entry))
    .sort()
}

/** What Prisma would compute for a file today. */
function checksumOf(name: string): string {
  return createHash('sha256')
    .update(readFileSync(join(MIGRATIONS, name, 'migration.sql')))
    .digest('hex')
}

describe('an applied migration still matches the file that ran', () => {
  it('has no migration whose recorded checksum has drifted', async () => {
    const { rows } = await pool.query<{
      migration_name: string
      checksum: string
    }>(
      `select migration_name, checksum from _prisma_migrations
        where finished_at is not null and rolled_back_at is null`,
    )

    // If this is ever zero the query is wrong, and a query that finds nothing
    // would otherwise report perfect agreement.
    expect(rows.length).toBeGreaterThan(10)

    const drifted = rows
      .map((row) => {
        let file: string
        try {
          file = checksumOf(row.migration_name)
        } catch {
          // Applied to this database and not present on disk. A different
          // failure — a branch behind, or a migration deleted — and worth its
          // own sentence rather than a mismatch nobody can act on.
          return `${row.migration_name}: applied but MISSING from prisma/migrations`
        }
        return file === row.checksum
          ? null
          : // The fix is printed, because the person reading this failure is
            // about to want it and the alternative is a reset.
            `${row.migration_name}: file ${file.slice(0, 12)}… recorded ${row.checksum.slice(0, 12)}…\n` +
              `      an applied migration is closed to edits. Either revert the file, or —\n` +
              `      if the change is provably cosmetic and the SQL is untouched —\n` +
              `      UPDATE _prisma_migrations SET checksum = '${file}'\n` +
              `       WHERE migration_name = '${row.migration_name}';\n` +
              `      and run the same statement against production before deploying.`
      })
      .filter((value): value is string => value !== null)

    expect(drifted, `\n    ${drifted.join('\n    ')}`).toEqual([])
  })

  it('and every local migration is one this database has applied', async () => {
    // The other direction. A migration on disk that the DEVELOPMENT database
    // has never run means somebody wrote one and did not apply it, so every
    // test below it is being asked about a schema that only exists in a file.
    //
    // Production is a separate question and has its own guard —
    // check-migration-gap.mjs, which refuses `deploy:prod` across the gap.
    const { rows } = await pool.query<{ migration_name: string }>(
      'select migration_name from _prisma_migrations where finished_at is not null',
    )
    const applied = new Set(rows.map((row) => row.migration_name))

    const unapplied = localMigrations().filter((name) => !applied.has(name))
    expect(unapplied, unapplied.join(', ')).toEqual([])
  })
})
