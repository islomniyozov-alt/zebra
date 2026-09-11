import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'

// ---------------------------------------------------------------------------
// BREAK IT ON PURPOSE, AND PROVE THE GUARD FIRED.
//
//   node scripts/watch-guard.mjs breaks.json
//
// AGENTS.md: "a guard that has never been watched failing is not known to
// work." That rule asked for a disposition, and on 2026-09-10 the disposition
// failed the way every other one has.
//
// ── WHAT WENT WRONG, EXACTLY ─────────────────────────────────────────────
//
// Four guards were broken in a shell loop that counted failing test lines. The
// third reported ZERO failures, and zero was read as "that guard does not
// work" — a true-looking finding about the wrong thing. The guard was fine.
// The LOOP was broken: its edit helper had silently not applied the break, so
// the suite ran against unmodified source and passed, and a passing suite is
// exactly what a working guard looks like when nobody checks that the break
// landed. Run directly, the guard fired on the first try.
//
// That is the same shape as the exit-code trap and the sed trap: a silent
// no-op indistinguishable from success. Twice before, the fix was to stop
// asking for care and name a mechanism. This is the third.
//
// ── SO ZERO FAILURES IS ITSELF A FAILURE ─────────────────────────────────
//
// The contract this enforces, per break:
//
//   1. The anchor occurs EXACTLY ONCE. Zero means the source moved under the
//      spec — prettier reformats, a rename lands — and a break that cannot be
//      applied must never be silently skipped. More than one means the spec
//      is ambiguous about what it is breaking.
//   2. The file on disk actually CHANGED after the write. A replacement equal
//      to the anchor is a no-op wearing a break's clothes.
//   3. The command then FAILS. A deliberate break that leaves the suite green
//      is reported as NOT OK, because it means nothing was watching.
//   4. Where `expect` is given, the failure output NAMES it. A suite that
//      fails for an unrelated reason — a typo in the replacement, a flaky
//      database — is not evidence about this guard.
//   5. The file is restored, and the restoration is verified by HASH against
//      the bytes read before the break. Every exit path, including a throw.
//
// Any of those failing prints NOT OK in capitals and exits non-zero. There is
// no arrangement of output-trimming that turns that into good news.
// ---------------------------------------------------------------------------

const specPath = process.argv[2]
if (!specPath) {
  console.error('Usage: node scripts/watch-guard.mjs <spec.json>')
  console.error(
    '  { "command": ["npx","vitest","run","..."], "breaks": [ { "name": …,',
  )
  console.error(
    '    "file": …, "find": …, "replace": …, "expect": … } ] }  (expect optional)',
  )
  process.exit(2)
}

const spec = JSON.parse(readFileSync(specPath, 'utf8'))
const command = spec.command
if (!Array.isArray(command) || command.length === 0) {
  console.error('watch-guard: the spec needs a "command" array.')
  process.exit(2)
}
if (!Array.isArray(spec.breaks) || spec.breaks.length === 0) {
  console.error('watch-guard: the spec needs at least one break.')
  process.exit(2)
}

const hash = (text) => createHash('sha256').update(text).digest('hex')

/**
 * Failing test names, from the runner's own output.
 *
 * READ FROM THE OUTPUT, not counted from a grep in a shell — the counting grep
 * is what produced the false zero this file exists to prevent. Vitest marks a
 * failure with U+00D7; `FAIL` catches the runners that do not.
 */
const failuresIn = (output) => {
  // Vitest prints each failure TWICE — once in the run tree as the bare test
  // name with a duration, once in the summary as `|project| file > suite >
  // test`. Both are kept for matching, because an `expect` may reasonably name
  // a suite; only the leaf is printed, deduplicated, so a break that takes out
  // six tests reads as six lines rather than twelve.
  const matchable = new Set()
  const leaves = new Set()
  for (const line of output.split(/\r?\n/)) {
    const mark = /^\s*(?:×|FAIL)\s+(.*\S)\s*$/.exec(line)
    if (!mark) continue
    const name = mark[1].replace(/\s+\d+(?:\.\d+)?m?s$/, '')
    matchable.add(name)
    leaves.add(name.split(' > ').at(-1))
  }
  return { matchable: [...matchable], leaves: [...leaves] }
}

const results = []

for (const [index, entry] of spec.breaks.entries()) {
  const label = entry.name ?? `break ${String(index + 1)}`
  const file = entry.file
  console.log(`\n── ${label}`)
  console.log(`   file     ${file}`)

  const original = readFileSync(file, 'utf8')
  const before = hash(original)

  // 1. THE ANCHOR, EXACTLY ONCE.
  const occurrences = original.split(entry.find).length - 1
  if (occurrences !== 1) {
    console.log(
      `   ANCHOR FOUND ${String(occurrences)} TIMES, NEEDED EXACTLY 1 — NOT OK.`,
    )
    console.log(`   anchor   ${JSON.stringify(entry.find)}`)
    results.push({ label, ok: false, why: 'anchor' })
    continue
  }

  const broken = original.replace(entry.find, entry.replace)

  // 2. AND THE BREAK MUST BE A CHANGE.
  if (broken === original) {
    console.log('   THE REPLACEMENT CHANGES NOTHING — NOT OK.')
    results.push({ label, ok: false, why: 'no-op' })
    continue
  }

  let outcome
  try {
    writeFileSync(file, broken)
    // Read it back: a write that did not land is the original failure mode.
    if (hash(readFileSync(file, 'utf8')) === before) {
      console.log('   THE FILE ON DISK DID NOT CHANGE — NOT OK.')
      results.push({ label, ok: false, why: 'not-written' })
      continue
    }

    const run = spawnSync(command[0], command.slice(1), {
      encoding: 'utf8',
      shell: process.platform === 'win32',
      maxBuffer: 64 * 1024 * 1024,
    })
    outcome = {
      status: run.status,
      output: `${run.stdout ?? ''}\n${run.stderr ?? ''}`,
    }
  } finally {
    // 5. RESTORED ON EVERY PATH, AND THE RESTORATION IS CHECKED.
    writeFileSync(file, original)
    if (hash(readFileSync(file, 'utf8')) !== before) {
      console.log(`   COULD NOT RESTORE ${file} — NOT OK. FIX THIS BY HAND.`)
      results.push({ label, ok: false, why: 'not-restored' })
      continue
    }
  }

  const failed = failuresIn(outcome.output)
  console.log(`   exit     ${String(outcome.status)}`)
  console.log(
    `   failing  ${failed.leaves.length === 0 ? '(none)' : failed.leaves.join('\n            ')}`,
  )

  // 3. ZERO FAILURES IS A FAILURE.
  if (outcome.status === 0 || failed.leaves.length === 0) {
    console.log('   THE BREAK DID NOT FIRE — NOT OK. Nothing was watching.')
    results.push({ label, ok: false, why: 'did-not-fire' })
    continue
  }

  // 4. AND IT MUST BE THE RIGHT FAILURE.
  if (
    entry.expect &&
    !failed.matchable.some((name) => name.includes(entry.expect))
  ) {
    console.log(`   FIRED, BUT NOT ON "${entry.expect}" — NOT OK.`)
    results.push({ label, ok: false, why: 'wrong-test' })
    continue
  }

  console.log('   WATCHED FAILING — OK.')
  results.push({ label, ok: true })
}

console.log('\n──────────────────────────────────────────────')
for (const result of results) {
  console.log(`  ${result.ok ? 'OK      ' : 'NOT OK  '} ${result.label}`)
}

const bad = results.filter((result) => !result.ok).length
if (bad === 0) {
  console.log(
    `\nALL ${String(results.length)} BREAKS WATCHED FAILING — OK. NOT OK COUNT: 0.`,
  )
  process.exit(0)
}
console.log(
  `\n${String(bad)} OF ${String(results.length)} BREAKS DID NOT PROVE ANYTHING — NOT OK. NOT OK COUNT: ${String(bad)}.`,
)
process.exit(1)
