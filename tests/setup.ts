import 'dotenv/config'
import { neonConfig } from '@neondatabase/serverless'
import { assertSafeDbTarget } from './db-target'

// Node exposes a global WebSocket from 22 onwards, as does workerd. Matching
// src/lib/db.ts exactly: the tests must exercise the driver the app uses, not
// a more forgiving one.
neonConfig.webSocketConstructor ??= WebSocket
neonConfig.poolQueryViaFetch = false

// WHERE THIS IS ABOUT TO WRITE, checked against the connection strings rather
// than against a label. See tests/db-target.ts for the incident that made the
// old `NEON_BRANCH === 'production'` check insufficient — it was checking a
// sticker on the box while the box was addressed somewhere else.
//
// Printed, always. The whole incident was somebody not knowing which database
// their terminal pointed at, and one line of output is the cheapest cure.
// A WORKER DATABASE HERE MEANS THE ROUTING LEAKED OUT OF ITS PROJECT.
//
// `tests/setup-integration.ts` rewrites the connection strings to
// `zebra_w<slot>` and sets the marker below. This file is loaded by the NODE
// project as well, where no such rewrite should ever have happened — and when
// it did, the database tests in that project ran against an empty copy of the
// template and passed for that reason. Empty databases have no drift.
//
// Refused loudly rather than corrected, because the correction is a guess and
// the cause is always a config change somebody can fix in one line.
const database = new URL(
  process.env.DIRECT_DATABASE_URL ?? 'postgres://x/y',
).pathname.slice(1)
if (/^zebra_w\d+$/.test(database) && !process.env.ZEBRA_INTEGRATION_WORKER) {
  throw new Error(
    `This project is pointed at the per-worker database ${database}, which ` +
      'only the integration project may use. tests/setup-integration.ts is ' +
      'listed in a setupFiles it does not belong in, and these tests would ' +
      'run against an empty copy of the template and pass for that reason.',
  )
}

const endpoint = assertSafeDbTarget(process.env)
console.log(
  `[integration] writing to ${endpoint}` +
    (process.env.ZEBRA_INTEGRATION_WORKER ? ` db=${database}` : ''),
)
