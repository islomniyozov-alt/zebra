import { spawn } from 'node:child_process'
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

// ---------------------------------------------------------------------------
// A COMMAND'S REAL EXIT CODE, WRITTEN DOWN WHERE NO FILTER CAN REACH IT.
//
//   node scripts/run-status.mjs deploy-dev -- npm run deploy:dev
//   node scripts/run-status.mjs --check deploy-dev
//
// ── WHY THIS EXISTS, AND WHY THE RULE ALONE WAS NOT ENOUGH ───────────────
//
// AGENTS.md has said "read the exit code before anything touches the output"
// since the session that earned it. On 2026-09-09 the trap fired TWICE anyway,
// both times the same way:
//
//   npm run deploy:dev > log 2>&1; echo "exit=$?"; tail -6 log
//
// The deploy REFUSED — the integration suite was red — and exited 1. But the
// last command in that line is `tail`, so the status the surrounding machinery
// reported was `tail`'s cheerful 0, and the six lines `tail` chose did not
// happen to include the refusal. A refused deploy was reported as a completed
// one, twice, by somebody who had just quoted the rule forbidding it.
//
// So this file is that rule turned into a mechanism, exactly as the
// sed-versus-Edit rule was: it stopped asking for care and named a tool that
// cannot be careless. Care had already failed twice.
//
// ── THE STATUS COMES FROM THE FILE, NEVER FROM THE SHELL ─────────────────
//
// The wrapped command's exit code is written to `.run-status/<name>.json` by
// the wrapper itself, before the wrapper exits. `--check` reads THAT and
// nothing else. There is no arrangement of pipes, redirections, backgrounding
// or line-trimming that can put a different number in front of a reader,
// because the number was never in the stream.
//
// AND IT FAILS CLOSED. A missing status file, a run still in flight, or a
// wrapper killed before it could finish all report NOT OK — never silence and
// never zero. "No news" is the shape the original bug wore.
//
// ── THE PRINTED LINE IS WRITTEN TO SURVIVE BEING TRIMMED ─────────────────
//
// `--check` prints the verdict in capitals on its own line and repeats the
// number. A `tail -1` of it is still unambiguous, which is the one hostile
// reading this whole file exists to defeat.
// ---------------------------------------------------------------------------

const HOME = '.run-status'

const statusPath = (name) => join(HOME, `${name.replace(/[^\w.-]/g, '_')}.json`)

// ── WHAT THE COMMAND SAW, BESIDE WHAT IT RETURNED ────────────────────────
//
// The child gets `RUN_STATUS_DETAIL`, a path it may write JSON to, and the
// wrapper folds that file into the verdict as `detail`. The sweep writes its
// server errors there (§6.8, owner's ruling 2026-10-11: a 500 is recorded with
// its ray, role, body and Worker log in the verdict file). The exit code is
// still the verdict; the detail is what it was about.
const detailPathFor = (name) =>
  join(HOME, `${name.replace(/[^\w.-]/g, '_')}.detail.json`)

const readDetail = (name) => {
  try {
    return JSON.parse(readFileSync(detailPathFor(name), 'utf8'))
  } catch {
    return null
  }
}

const write = (name, payload) => {
  const path = statusPath(name)
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, JSON.stringify(payload, null, 2))
  return path
}

const read = (name) => {
  try {
    return JSON.parse(readFileSync(statusPath(name), 'utf8'))
  } catch {
    return null
  }
}

// ── --check ──────────────────────────────────────────────────────────────
if (process.argv[2] === '--check') {
  const name = process.argv[3]
  if (!name) {
    console.error('Usage: node scripts/run-status.mjs --check <name>')
    process.exit(2)
  }

  const status = read(name)
  console.log(`run-status: ${name}`)

  if (!status) {
    console.log(`  file      ${statusPath(name)}`)
    console.log('  NO STATUS FILE — NOT OK. Nothing has run under this name.')
    process.exit(2)
  }

  console.log(`  command   ${status.command}`)
  console.log(`  started   ${status.startedAt}`)

  if (status.state !== 'finished') {
    console.log('  STILL RUNNING — NO EXIT CODE YET. NOT OK.')
    process.exit(2)
  }

  console.log(`  finished  ${status.finishedAt}`)

  const serverErrors = status.detail?.serverErrors
  if (Array.isArray(serverErrors) && serverErrors.length > 0) {
    console.log(`  recorded  ${serverErrors.length} server error(s):`)
    for (const row of serverErrors) {
      const said =
        row.worker?.exceptions?.[0]?.message ??
        row.worker?.logs?.find((entry) => entry.level === 'error')?.message ??
        row.workerNote ??
        '(no worker log line)'
      console.log(
        `    ${row.role} ${row.route} ${row.status} ray ${row.ray ?? '(none)'} — ${String(said).slice(0, 200)}`,
      )
    }
  }

  if (status.signal) {
    console.log(`  KILLED BY ${status.signal} — NOT OK. EXIT CODE: none.`)
    process.exit(1)
  }

  if (status.exitCode === 0) {
    console.log('  EXIT CODE 0 — OK.')
    process.exit(0)
  }

  console.log(`  EXIT CODE ${status.exitCode} — FAILED. NOT OK.`)
  process.exit(1)
}

// ── running something ────────────────────────────────────────────────────
const separator = process.argv.indexOf('--')
const name = process.argv[2]
const command = separator === -1 ? [] : process.argv.slice(separator + 1)

if (!name || name.startsWith('--') || command.length === 0) {
  console.error(
    'Usage: node scripts/run-status.mjs <name> -- <command> [args...]',
  )
  console.error('       node scripts/run-status.mjs --check <name>')
  process.exit(2)
}

const startedAt = new Date().toISOString()
const path = write(name, {
  state: 'running',
  command: command.join(' '),
  startedAt,
})
console.log(`run-status: ${name} -> ${path}`)

// STDIO INHERITED, so the wrapped command's output still goes wherever the
// caller sent it. This wrapper adds a record; it does not stand between
// anybody and the log.
// A detail file from an earlier run under this name is not this run's.
rmSync(detailPathFor(name), { force: true })

const child = spawn(command[0], command.slice(1), {
  stdio: 'inherit',
  shell: process.platform === 'win32',
  env: { ...process.env, RUN_STATUS_DETAIL: detailPathFor(name) },
})

const finish = (exitCode, signal) => {
  const detail = readDetail(name)
  write(name, {
    state: 'finished',
    command: command.join(' '),
    startedAt,
    finishedAt: new Date().toISOString(),
    exitCode,
    signal: signal ?? null,
    ...(detail ? { detail } : {}),
  })
  // AND THE WRAPPER EXITS WITH THE SAME CODE. Belt and braces: the file is the
  // record, this is so a caller that DOES read the status still gets the truth.
  process.exit(signal ? 1 : (exitCode ?? 1))
}

// A SPAWN THAT NEVER STARTED IS A FAILURE, not a missing record. Without this
// the status file would sit at `running` forever and `--check` would say
// STILL RUNNING about a process that does not exist.
child.on('error', (error) => {
  console.error(`run-status: could not start the command — ${error.message}`)
  finish(127, null)
})

child.on('close', (code, signal) => finish(code, signal))
