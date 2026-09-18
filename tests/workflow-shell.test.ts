import { execFileSync } from 'node:child_process'
import { mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
// A NAMED IMPORT, and `@types/js-yaml` is deliberately not installed. js-yaml
// 5 is ESM with no default export and ships its own declarations; the
// DefinitelyTyped package still describes version 4, so with it present `tsc`
// was perfectly happy with `yaml.load` while the runtime had no `yaml` to load
// from — types agreeing with a package that is not the installed one is the
// same shape of lie as a guard that has never been watched failing.
import { load } from 'js-yaml'
import { describe, expect, it } from 'vitest'

// ---------------------------------------------------------------------------
// EVERY SHELL BLOCK IN A WORKFLOW PARSES, HERE RATHER THAN ON A RUNNER.
//
// ── WHY, COUNTED ─────────────────────────────────────────────────────────
//
// A GitHub workflow's `run:` is shell that nothing on this machine ever reads.
// The only thing that has been checking it is a runner, four minutes and one
// Neon branch into a job, and this session spent five runs learning things a
// parser knew for free.
//
// The specific one this is about: a backslash line continuation was eaten in
// transit, turning
//
//     export A="$a" \
//       B="$b"
//
// into one joined line. THAT IS STILL VALID SHELL and still does the right
// thing, which is precisely how it survived review — the same silent no-op as
// `sed` matching nothing and `tail` supplying its own exit code. When the
// mangling lands somewhere less forgiving, the error arrives on a runner.
//
// ── WHAT THIS DOES AND DOES NOT CLAIM ────────────────────────────────────
//
// `bash -n` parses without executing. It catches an unbalanced `if`, a `case`
// with no `esac`, a heredoc whose terminator went missing — the whole class
// that costs a round trip to GitHub to discover.
//
// IT CATCHES LESS THAN IT SOUNDS LIKE, and the break harness is how that was
// learned rather than assumed. Deleting the closing quote from
//
//     echo "::add-mask::$app_password"
//
// did NOT fail this test. An unbalanced quote is only a syntax error if it
// reaches the end of the file unclosed, and the next quote further down the
// block closes it — the string is then wildly wrong and perfectly well-formed.
// THE BREAK DID NOT FIRE, so it is recorded here instead of being believed.
//
// It says nothing at all about whether the commands are right, either.
// `psql -c "... :'pw'"` parses perfectly and run 35309258353 still answered
// `syntax error at or near ":"`, because psql does not interpolate variables
// into a `-c` string. A green result here means the shell is well-formed, and
// that is the whole of the claim.
// ---------------------------------------------------------------------------

interface Step {
  name?: string
  run?: unknown
  shell?: string
}

function runBlocks(): { where: string; script: string }[] {
  const found: { where: string; script: string }[] = []
  const dir = '.github/workflows'
  for (const file of readdirSync(dir)) {
    if (!/\.ya?ml$/.test(file)) continue
    const parsed = load(readFileSync(join(dir, file), 'utf8')) as {
      jobs?: Record<string, { steps?: Step[] }>
    }
    for (const [jobName, job] of Object.entries(parsed.jobs ?? {})) {
      for (const step of job.steps ?? []) {
        if (typeof step.run !== 'string') continue
        // Only the default shell. A `shell: python` block is not bash and
        // handing it to bash would invent a failure.
        if (step.shell && !/^bash|^sh$/.test(step.shell)) continue
        found.push({
          where: `${file} / ${jobName} / ${step.name ?? '(unnamed step)'}`,
          script: step.run,
        })
      }
    }
  }
  return found
}

describe('the shell inside the workflows', () => {
  const blocks = runBlocks()

  it('is actually there, so a pass cannot mean an empty list', () => {
    // FLAG 88: an instrument that finds nothing reports success. The two
    // workflows carry a Neon branch, an .env, a gate and a deploy between
    // them; if this ever drops to a handful, the reader moved, not the risk.
    expect(blocks.length).toBeGreaterThan(15)
    expect(blocks.map((block) => block.where).join('\n')).toContain(
      'create a Neon branch for this run',
    )
  })

  it('parses, every block of it', () => {
    const scratch = mkdtempSync(join(tmpdir(), 'workflow-shell-'))
    const broken: string[] = []

    blocks.forEach((block, index) => {
      const file = join(scratch, `block-${index}.sh`)
      writeFileSync(file, block.script)
      try {
        execFileSync('bash', ['-n', file], { stdio: 'pipe' })
      } catch (error) {
        const failure = error as { stderr?: Buffer; message?: string }
        const detail = failure.stderr?.toString() ?? failure.message ?? ''
        broken.push(`${block.where}\n${detail.trim()}`)
      }
    })

    expect(broken, `bash refused ${broken.length} block(s)`).toEqual([])
  })
})
