import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'

// ---------------------------------------------------------------------------
// PROOF THAT THIS EXACT COMMIT PASSED THE INTEGRATION SUITE, RECENTLY, HERE.
//
// The suite costs 54 minutes on the owner's machine — measured, 405 tests,
// 3254 seconds. Running it twice to ship a commit it passed ten minutes ago is
// most of an hour spent proving something already known, and a gate that
// expensive is a gate people start reaching around.
//
// SO A RUN CAN LEAVE A RECEIPT, and `deploy:prod` will accept one instead of
// re-running. Four conditions, and each closes a specific way this could
// otherwise become a hole:
//
//   commit === HEAD    it cannot authorise code other than the code that ran
//   tree was clean     no "it passed, then I edited one file"
//   same endpoint      a receipt earned against another database is not proof
//   under an hour old  it cannot authorise a database that has since drifted
//
// WRITTEN WHEN THE SUITE FINISHES, not when it starts. The owner's constraint,
// and an obvious one once said out loud: timestamping the start of a
// 54-minute run against a 60-minute window leaves about six usable minutes.
//
// NOT COMMITTED. The file is gitignored, so a receipt cannot travel between
// machines, cannot be committed by accident, and cannot be reviewed into
// existence. It is evidence about one working copy at one moment.
//
// AND SKIPPING EARNS NOTHING. `--skip-integration` runs no suite and writes no
// receipt; there is deliberately no path from "I did not run it" to "it was
// run".
// ---------------------------------------------------------------------------

export const RECEIPT_PATH = '.integration-receipt.json'

/** An hour. Long enough to be useful, short enough that the world has not moved. */
export const RECEIPT_MAX_AGE_MS = 60 * 60 * 1000

const git = (...args) => execFileSync('git', args, { encoding: 'utf8' }).trim()

/** The commit and cleanliness of the working copy, right now. */
export function workingCopy() {
  return {
    commit: git('rev-parse', 'HEAD'),
    clean: git('status', '--porcelain').length === 0,
  }
}

/**
 * Record that the suite passed.
 *
 * `finishedAt` is stamped HERE — at the end of a successful run — for the
 * reason at the top of this file.
 */
export function writeReceipt({ endpoint, tests, files }) {
  const { commit, clean } = workingCopy()
  const receipt = {
    commit,
    clean,
    endpoint,
    finishedAt: new Date().toISOString(),
    tests: tests ?? null,
    files: files ?? null,
  }
  writeFileSync(RECEIPT_PATH, `${JSON.stringify(receipt, null, 2)}\n`)
  return receipt
}

export function readReceipt() {
  if (!existsSync(RECEIPT_PATH)) return null
  try {
    return JSON.parse(readFileSync(RECEIPT_PATH, 'utf8'))
  } catch {
    // A corrupt receipt is not a receipt. Treated as absent rather than as an
    // error, because the consequence is simply that the suite runs.
    return null
  }
}

/**
 * May this receipt stand in for a run?
 *
 * Pure, so every refusal below is a test rather than a belief — the same
 * reasoning `tests/db-target.ts` records about the guard that stayed silent.
 */
export function checkReceipt({ receipt, now, head, clean, endpoint }) {
  if (!receipt) {
    return {
      ok: false,
      reason: 'none',
      message: 'No receipt from a previous run.',
    }
  }

  // DIRTY FIRST, both sides. A receipt earned on a dirty tree describes code
  // that is not in any commit, so it can never be matched again; and a clean
  // receipt says nothing about a tree that has been edited since.
  if (receipt.clean !== true) {
    return {
      ok: false,
      reason: 'earned_dirty',
      message:
        'That run happened on a dirty tree, so it proves nothing about a commit.',
    }
  }
  if (!clean) {
    return {
      ok: false,
      reason: 'tree_dirty',
      message: 'The working tree has uncommitted changes since that run.',
    }
  }

  if (receipt.commit !== head) {
    return {
      ok: false,
      reason: 'wrong_commit',
      message: `That run was ${String(receipt.commit).slice(0, 7)}; HEAD is ${String(head).slice(0, 7)}.`,
    }
  }

  if (receipt.endpoint !== endpoint) {
    return {
      ok: false,
      reason: 'wrong_endpoint',
      message: `That run wrote to ${receipt.endpoint}; this deploy reads ${endpoint}.`,
    }
  }

  const age = now - Date.parse(receipt.finishedAt)
  if (!Number.isFinite(age)) {
    return {
      ok: false,
      reason: 'unreadable',
      message: 'The receipt has no usable timestamp.',
    }
  }
  if (age < 0) {
    // A receipt from the future is a clock that moved, and a clock that moved
    // is exactly the thing an age check cannot reason about.
    return {
      ok: false,
      reason: 'future',
      message: 'The receipt is dated in the future.',
    }
  }
  if (age > RECEIPT_MAX_AGE_MS) {
    return {
      ok: false,
      reason: 'stale',
      message: `That run finished ${Math.round(age / 60000)} minutes ago; the limit is ${RECEIPT_MAX_AGE_MS / 60000}.`,
    }
  }

  return { ok: true, ageMinutes: Math.round(age / 60000) }
}
