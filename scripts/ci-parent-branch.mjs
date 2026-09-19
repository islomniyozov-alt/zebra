import { pathToFileURL } from 'node:url'

// ---------------------------------------------------------------------------
// THE BRANCH CI FORKS MUST BE THE ONE WE THINK IT IS.
//
// ── WHAT THIS COST BEFORE IT EXISTED ─────────────────────────────────────
//
// `NEON_PARENT_BRANCH` is an opaque id in a secret. Nothing in the run ever
// said which branch it named, so when it pointed somewhere two migrations
// behind dev, CI did not say "the parent is wrong" — it said
//
//     20260918070000_team_driving_co_driver,
//     20260918200000_settlement_team_with: expected [ …(2) ] to deeply equal []
//
// and then a Prisma error about a column that was not there. Two red runs,
// both reported as a failing gate, and the actual fact — this branch is not
// dev — appeared nowhere in either log.
//
// An id cannot be eyeballed. A NAME can, so the name is fetched and checked
// before anything is built on top of it.
//
// ── IT REFUSES RATHER THAN WARNS ─────────────────────────────────────────
//
// Forking the wrong branch does not produce a wrong answer; it produces a
// confusing one, several minutes later, about something else. That is the
// `cmd | tail` shape again — a failure wearing a different name — and the
// cure is the same: fail at the step that knows.
// ---------------------------------------------------------------------------

/** The branch every CI run is required to fork. */
export const REQUIRED_PARENT = 'dev'

/**
 * May CI fork this branch?
 *
 * Pure, so the decision can be tested without a Neon account — the fetch
 * around it is four lines and the judgement is the part worth guarding.
 *
 * @param {string | null | undefined} name what the API called the branch
 * @param {string} expected
 * @returns {{ ok: boolean, lines: string[] }}
 */
export function parentBranchVerdict(name, expected = REQUIRED_PARENT) {
  const found = (name ?? '').trim()

  if (found === '') {
    return {
      ok: false,
      lines: [
        '[ci] Neon did not name the parent branch.',
        '[ci] NEON_PARENT_BRANCH may be an id that no longer exists.',
        `[ci] Refusing to fork a branch that cannot be identified.`,
      ],
    }
  }

  if (found !== expected) {
    return {
      ok: false,
      lines: [
        `[ci] NEON_PARENT_BRANCH names "${found}", not "${expected}".`,
        '[ci]',
        '[ci] Every CI run forks this branch and runs the suite against the',
        '[ci] copy. Forking the wrong one does not fail here — it fails four',
        '[ci] minutes later as missing migrations and absent columns, which is',
        '[ci] what runs 35321964790 and 35415706396 reported instead of this.',
        '[ci]',
        `[ci] Repoint the secret at ${expected}, or apply the migrations to`,
        `[ci] "${found}" if that is genuinely the branch you meant.`,
      ],
    }
  }

  return {
    ok: true,
    lines: [`[ci] parent branch is "${found}" — as required.`],
  }
}

// ── the four lines around it ─────────────────────────────────────────────

async function main() {
  const project = process.env.NEON_PROJECT_ID
  const parent = process.env.NEON_PARENT_BRANCH
  const key = process.env.NEON_API_KEY

  if (!project || !parent || !key) {
    console.log('[ci] NEON_PROJECT_ID, NEON_PARENT_BRANCH and NEON_API_KEY are')
    console.log('[ci] all required to identify the parent branch. Refusing.')
    process.exit(1)
  }

  const url = `https://console.neon.tech/api/v2/projects/${project}/branches/${parent}`
  let name = null
  try {
    const response = await fetch(url, {
      headers: { Authorization: `Bearer ${key}` },
    })
    if (!response.ok) {
      console.log(
        `[ci] Neon answered ${response.status} for the parent branch.`,
      )
      console.log('[ci] Refusing to fork a branch that cannot be identified.')
      process.exit(1)
    }
    const body = await response.json()
    name = body?.branch?.name ?? null
  } catch (error) {
    console.log(
      `[ci] could not ask Neon which branch that is: ${error instanceof Error ? error.message : String(error)}`,
    )
    process.exit(1)
  }

  const verdict = parentBranchVerdict(name)
  for (const line of verdict.lines) console.log(line)

  // ── ON REFUSAL, NAME THE ALTERNATIVES ────────────────────────────────
  //
  // Twice now a secret has been reported as changed and had not been: the
  // run just says "production" again and nothing distinguishes "the edit did
  // not save" from "the id I pasted is the wrong branch". The id itself
  // cannot be printed — GitHub masks the secret's exact value — but a SUFFIX
  // is not the secret, and the other branches are not secret at all.
  //
  // So a refusal ends with the list to copy from, and the next attempt is a
  // paste rather than another round trip.
  if (!verdict.ok) {
    console.log(`[ci] the id in the secret ends "...${parent.slice(-6)}"`)
    try {
      const all = await fetch(
        `https://console.neon.tech/api/v2/projects/${project}/branches`,
        { headers: { Authorization: `Bearer ${key}` } },
      )
      if (all.ok) {
        const body = await all.json()
        console.log('[ci] branches in this project:')
        for (const branch of body?.branches ?? []) {
          const mark = branch.name === REQUIRED_PARENT ? ' <- use this one' : ''
          console.log(
            `[ci]   ${String(branch.name).padEnd(24)} ...${String(branch.id).slice(-6)}${mark}`,
          )
        }
      }
    } catch {
      // Diagnostics only. The refusal above already stands on its own.
    }
  }

  process.exit(verdict.ok ? 0 : 1)
}

const entry = process.argv[1] ? pathToFileURL(process.argv[1]).href : null
if (entry === import.meta.url) await main()
