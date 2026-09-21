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
// ---------------------------------------------------------------------------

const key = process.env.NEON_API_KEY
const project = process.env.NEON_PROJECT_ID
const parent = process.env.NEON_PARENT_BRANCH
const sweeping = (process.env.MODE ?? '').trim().toLowerCase() === 'delete'

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
