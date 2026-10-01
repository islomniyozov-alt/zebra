import { createHash } from 'node:crypto'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

// ---------------------------------------------------------------------------
// WHAT A HUMAN RUNS ON PRODUCTION FOR ONE MIGRATION, PRINTED EXACTLY.
//
//   npx tsx scripts/print-production-migration.ts --name 20261001010000_migration_61
//   npx tsx scripts/print-production-migration.ts --gap
//
// ── WHY A SCRIPT AND NOT A PARAGRAPH IN A HANDOVER ────────────────────────
//
// The owner applies production migrations by hand, from the Neon console,
// because the production connection string deliberately does not live on the
// machine that deploys (`check-migration-gap.mjs` says why). So the hand-off is
// SQL somebody retypes or pastes — and a checksum retyped by hand is a checksum
// entered wrong, after which `tests/migration-checksums.test.ts` fails on every
// CI run and the cause is four characters nobody can see.
//
// This prints the bytes. Nothing is computed twice, nothing is transcribed.
//
// ── IT TOUCHES NO DATABASE, NOT EVEN TO READ ─────────────────────────────
//
// On purpose, and it is the difference between this and
// `repair-migration-checksum.ts`: that one reads production to compare a
// recorded checksum against the file, and needs a connection to do it. This one
// has nothing to compare — the migration has never been applied there — so a
// connection would buy nothing and would be one more place a production url
// could end up. It reads the repository and prints.
//
// THE CHECKSUM IS OF THE LF BYTES. A migration applied from a Windows working
// tree with carriage returns is what put dev's recorded checksum out of step
// with the repository and left CI red for three pushes on 2026-09-24. The file
// is normalised here before hashing, and the script says so when the file on
// disk differs — because a CRLF file in the repository is its own problem and
// hiding it behind a correct hash would be the comfortable version of wrong.
// ---------------------------------------------------------------------------

const MARKER = 'prisma/production-migrations.json'

const args = process.argv.slice(2)
const nameAt = args.indexOf('--name')
const NAME = nameAt === -1 ? null : (args[nameAt + 1] ?? null)
const GAP = args.includes('--gap')

if (!NAME && !GAP) {
  console.error('usage: --name <migration_directory> | --gap')
  process.exit(1)
}

const sha = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex')

const localMigrations = () =>
  readdirSync('prisma/migrations')
    .filter((entry) => /^\d{14}_/.test(entry))
    .sort()

const marker = JSON.parse(readFileSync(MARKER, 'utf8')) as {
  applied: string[]
  recordedAt: string
  verified: boolean
}

// ── --gap: WHICH MIGRATIONS PRODUCTION HAS NOT SEEN ──────────────────────
//
// SETS, NOT A HIGH-WATER MARK, which is `migrationGap`'s own reason: a
// migration inserted out of order by a merge slips through "everything after
// the last one" and not through this.
if (GAP) {
  const applied = new Set(marker.applied)
  const gap = localMigrations().filter((name) => !applied.has(name))
  console.log(`marker    ${MARKER}`)
  console.log(`recorded  ${marker.recordedAt}`)
  console.log(`verified  ${String(marker.verified)}`)
  console.log(`local     ${String(localMigrations().length)} migrations`)
  console.log(
    `applied   ${String(marker.applied.length)} recorded on production`,
  )
  if (gap.length === 0) {
    console.log('\nNO GAP. Production has every local migration recorded.')
  } else {
    console.log(`\nGAP — ${String(gap.length)} NOT recorded on production:`)
    for (const name of gap) console.log(`  ${name}`)
    console.log(
      '\nThe marker is a RECORDED CLAIM and can be stale. Read ' +
        '`_prisma_migrations`\non the production branch if the answer matters.',
    )
  }
  process.exit(0)
}

const dir = join('prisma', 'migrations', NAME!)
const raw = readFileSync(join(dir, 'migration.sql'))
const lf = Buffer.from(raw.toString('utf8').replace(/\r\n/g, '\n'), 'utf8')
const hash = sha(lf)

console.log(`migration ${NAME!}`)
console.log(`file      ${join(dir, 'migration.sql')}`)
console.log(
  `bytes     ${String(raw.length)} on disk, ${String(lf.length)} as LF`,
)
console.log(`checksum  ${hash}`)
if (raw.length !== lf.length) {
  console.log(
    '\nWARNING: the file on disk has CARRIAGE RETURNS. The checksum above is\n' +
      'of the LF bytes, which is what Prisma records — but the repository file\n' +
      'should be LF. Fix the file, do not work around it here.',
  )
}
if (marker.applied.includes(NAME!)) {
  console.log(
    `\nALREADY RECORDED as applied to production in ${MARKER}.\n` +
      'Nothing to run. If that is wrong, the marker is stale.',
  )
  process.exit(0)
}

console.log(`
────────────────────────────────────────────────────────────────────────
  RUN ON THE PRODUCTION BRANCH, IN THIS ORDER
────────────────────────────────────────────────────────────────────────

STEP 1 — the migration itself. Paste the whole of:

    ${join(dir, 'migration.sql')}

  IN ONE TRANSACTION, except the final ALTER TYPE if there is one: Postgres
  will not let a new enum value be USED in the transaction that adds it, and
  the file puts it last for that reason. Running the file as written is
  correct; splitting it is what goes wrong.

STEP 2 — record it, so Prisma does not try to apply it again. ONE LINE:

INSERT INTO _prisma_migrations (id, checksum, finished_at, migration_name, logs, rolled_back_at, started_at, applied_steps_count) VALUES (gen_random_uuid(), '${hash}', now(), '${NAME!}', NULL, NULL, now(), 1);

STEP 3 — THE READ-BACK. Do not trust step 2's "INSERT 0 1":

SELECT migration_name, finished_at IS NOT NULL AS finished, checksum = '${hash}' AS checksum_ok FROM _prisma_migrations WHERE migration_name = '${NAME!}';

  Both columns must be t. A false \`checksum_ok\` means the string was
  mistyped, and the symptom is \`tests/migration-checksums.test.ts\` failing
  on every CI run afterwards.

STEP 4 — tell this repository. Add "${NAME!}" to \`applied\` in
  ${MARKER}, set \`recordedAt\` to today and \`verified\` to true ONLY if you
  ran step 3 and saw two t's. \`deploy:prod\` refuses until this is done —
  that refusal is the thing standing between code and a column that does not
  exist yet.
`)
