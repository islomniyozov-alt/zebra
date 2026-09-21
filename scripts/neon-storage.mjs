// ---------------------------------------------------------------------------
// WHAT THE NEON PROJECT IS STORING, AND WHAT CI LEFT BEHIND.
//
// The free tier's storage limit was hit on 2026-09-21. Every CI run forks a
// branch from dev and deletes it in an `if: always()` step — but a cancelled
// run, or one killed between the fork and the delete, leaves the branch there,
// and a Neon branch bills for everything it has diverged from its parent by.
// Nothing was counting them.
//
// ── IT REFUSES TO DELETE ANYTHING IT WAS NOT ASKED FOR ───────────────────
//
// Two fences, both of which must pass: the name starts `ci-`, and the id is
// not the parent branch the secret names. A sweeper that could delete dev is
// a sweeper nobody should run, and this one runs on a button.
//
// A branch with children is left alone too. Deleting a parent out from under
// a fork is not a thing to do on a schedule.
//
// ── AND THE RUN THAT OWNS IT MUST BE FINISHED ────────────────────────────
//
// THE FIRST REPORT CAUGHT THIS. The only `ci-` branch in the project was
// `ci-35653672010` — the fork belonging to a run that was still going, from
// the very push that added this file. A sweeper that treats every `ci-`
// branch as rubbish would have deleted a live database out from under a job
// mid-suite, and the failure would have arrived as an unrelated connection
// error four minutes later.
//
// The run id is in the name, so it can simply be asked. When GitHub cannot
// be asked at all, age is the fallback: a run takes about eight minutes, so
// anything younger than two hours is assumed to be alive rather than
// assumed to be rubbish. The safe assumption is the one that keeps a
// branch.
// ---------------------------------------------------------------------------

const key = process.env.NEON_API_KEY
const project = process.env.NEON_PROJECT_ID
const parent = process.env.NEON_PARENT_BRANCH
const sweeping = (process.env.MODE ?? '').trim().toLowerCase() === 'delete'

/** Two hours. Longer than any run has ever taken, by a wide margin. */
const ASSUME_ALIVE_MS = 2 * 60 * 60 * 1000

/**
 * Is the CI run that forked this branch still going?
 *
 * Unknown counts as ALIVE. The cost of keeping a dead branch is a few
 * megabytes until the next sweep; the cost of deleting a live one is a
 * broken run and a confusing error.
 */
async function runIsFinished(branch) {
  const id = /^ci-(?:prod-)?(\d+)$/.exec(String(branch.name))?.[1]
  const repo = process.env.GITHUB_REPOSITORY
  const token = process.env.GITHUB_TOKEN

  if (id && repo && token) {
    try {
      const response = await fetch(
        `https://api.github.com/repos/${repo}/actions/runs/${id}`,
        { headers: { Authorization: `Bearer ${token}` } },
      )
      if (response.ok) {
        const run = await response.json()
        return run.status === 'completed'
      }
      // A 404 means the run is long gone, which is the one case where the
      // branch is definitely rubbish.
      if (response.status === 404) return true
    } catch {
      // fall through to age
    }
  }

  const created = Date.parse(String(branch.created_at))
  if (Number.isNaN(created)) return false
  return Date.now() - created > ASSUME_ALIVE_MS
}

if (!key || !project) {
  console.log('[neon] NEON_API_KEY and NEON_PROJECT_ID are both required.')
  process.exit(1)
}

const api = async (path, init = {}) => {
  const response = await fetch(
    `https://console.neon.tech/api/v2/projects/${project}${path}`,
    {
      ...init,
      headers: {
        Authorization: `Bearer ${key}`,
        'Content-Type': 'application/json',
        ...(init.headers ?? {}),
      },
    },
  )
  if (!response.ok) {
    throw new Error(`Neon answered ${response.status} for ${path}`)
  }
  return response.status === 204 ? null : response.json()
}

const mb = (bytes) => `${(Number(bytes ?? 0) / 1024 / 1024).toFixed(1)} MB`

const { branches } = await api('/branches')

console.log(`[neon] ${branches.length} branch(es) in the project\n`)
console.log(
  `    ${'name'.padEnd(26)} ${'id'.padEnd(10)} ${'logical'.padStart(10)}  created`,
)

let total = 0
const leftovers = []
for (const branch of [...branches].sort((a, b) =>
  String(a.name).localeCompare(String(b.name)),
)) {
  const size = Number(branch.logical_size ?? 0)
  total += size
  const isParent = branch.id === parent
  const isCi = /^ci-/.test(String(branch.name))
  const mark = isParent ? ' <- parent' : isCi ? ' <- leftover CI branch' : ''
  console.log(
    `    ${String(branch.name).padEnd(26)} ...${String(branch.id).slice(-6)} ${mb(size).padStart(10)}  ${String(branch.created_at).slice(0, 16)}${mark}`,
  )
  if (isCi && !isParent) leftovers.push(branch)
}

console.log(`\n[neon] total logical size ${mb(total)}`)

if (leftovers.length === 0) {
  console.log('[neon] no leftover ci-* branches. Nothing to sweep.')
  process.exit(0)
}

console.log(
  `\n[neon] ${leftovers.length} leftover ci-* branch(es), ${mb(
    leftovers.reduce((sum, b) => sum + Number(b.logical_size ?? 0), 0),
  )} between them`,
)

if (!sweeping) {
  console.log('[neon] MODE is not "delete" — reporting only, nothing removed.')
  process.exit(0)
}

for (const branch of leftovers) {
  // THE SECOND FENCE, CHECKED AGAIN AT THE MOMENT OF DELETION rather than
  // trusted from the loop above. Cheap, and the failure it prevents is the
  // one that cannot be undone.
  if (branch.id === parent || !/^ci-/.test(String(branch.name))) {
    console.log(`[neon] refusing to delete ${branch.name}`)
    continue
  }

  // THE THIRD FENCE: the run that forked it has to be over.
  if (!(await runIsFinished(branch))) {
    console.log(`[neon] leaving ${branch.name} — its run has not finished`)
    continue
  }
  try {
    await api(`/branches/${branch.id}`, { method: 'DELETE' })
    console.log(`[neon] deleted ${branch.name} (${mb(branch.logical_size)})`)
  } catch (error) {
    console.log(`[neon] could not delete ${branch.name}: ${error.message}`)
  }
}

const after = await api('/branches')
console.log(
  `\n[neon] ${after.branches.length} branch(es) remain, ${mb(
    after.branches.reduce((sum, b) => sum + Number(b.logical_size ?? 0), 0),
  )} total`,
)
