import { describe, expect, it } from 'vitest'
import { appendFileSync } from 'node:fs'
import { retryingClient } from '../retrying-client'
import { workerDatabase } from '../worker-db'

// ---------------------------------------------------------------------------
// THE WORKER IS WHERE IT THINKS IT IS.
//
// Parallelism here rests entirely on each worker owning a database. If that
// routing ever silently falls back — a missing pool id, a connection string
// rewritten in one place and not the other — every worker lands in the shared
// database and the suite goes GREEN while reproducing the exact failure it was
// built to prevent: one worker's cleanup deleting another's rows mid-write.
//
// SO THE ROUTING IS ASSERTED, NOT ASSUMED, and asserted against the SERVER's
// answer rather than against the string we sent it. `current_database()` is
// what the connection actually reached; the URL is only what we asked for.
// ---------------------------------------------------------------------------

const poolId = process.env.VITEST_POOL_ID

describe('this worker has its own database', () => {
  it('is connected to the database its pool slot names', async () => {
    expect(
      poolId,
      'VITEST_POOL_ID is unset — routing cannot have happened',
    ).toBeDefined()

    const owner = retryingClient(process.env.DIRECT_DATABASE_URL!)
    try {
      const [row] = await owner.$queryRawUnsafe<{ db: string; usr: string }[]>(
        'select current_database()::text as db, current_user::text as usr',
      )

      expect(row!.db).toBe(workerDatabase(poolId!))
      // The shared database is the thing being escaped; naming it makes the
      // failure read as "it fell back" rather than "it is somewhere else".
      expect(row!.db).not.toBe('neondb')

      // For the cross-worker comparison, collected outside the suite.
      if (process.env.ZEBRA_DB_PROBE) {
        appendFileSync(
          process.env.ZEBRA_DB_PROBE,
          `pool=${poolId} database=${row!.db} user=${row!.usr}\n`,
        )
      }
    } finally {
      await owner.$disconnect()
    }
  })

  // §6 OF THE RULING, AND src/lib/db.ts:73. Rewriting the connection string
  // must change the DATABASE and nothing else — a per-worker URL that lost the
  // role would either bypass row-level security or be refused by the app, and
  // both are worth failing here rather than discovering downstream.
  it('still authenticates the app as zebra_app', async () => {
    expect(process.env.DATABASE_URL).toContain('zebra_app')

    const app = retryingClient(process.env.DATABASE_URL!)
    try {
      const [row] = await app.$queryRawUnsafe<{ db: string; usr: string }[]>(
        'select current_database()::text as db, current_user::text as usr',
      )
      expect(row!.usr).toBe('zebra_app')
      expect(row!.db).toBe(workerDatabase(poolId!))
    } finally {
      await app.$disconnect()
    }
  })
})
