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
const endpoint = assertSafeDbTarget(process.env)
console.log(`[integration] writing to ${endpoint}`)
