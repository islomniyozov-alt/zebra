import 'dotenv/config'
import { neonConfig } from '@neondatabase/serverless'

// Node exposes a global WebSocket from 22 onwards, as does workerd. Matching
// src/lib/db.ts exactly: the tests must exercise the driver the app uses, not
// a more forgiving one.
neonConfig.webSocketConstructor ??= WebSocket
neonConfig.poolQueryViaFetch = false

if (!process.env.DATABASE_URL || !process.env.DIRECT_DATABASE_URL) {
  throw new Error(
    'Tests need DATABASE_URL and DIRECT_DATABASE_URL. Copy .env.example to .env.',
  )
}

if (process.env.NEON_BRANCH === 'production') {
  throw new Error('Refusing to run tests against the production branch.')
}
