import type { NextConfig } from 'next'
import { initOpenNextCloudflareForDev } from '@opennextjs/cloudflare'

// The production bundle runs on workerd, which forbids compiling WASM from
// bytes at runtime — and that is exactly what Prisma's default client does with
// its query compiler. The `runtime = "workerd"` client imports the WASM as a
// module instead, so the bundler compiles it ahead of time.
//
// Only the production bundle gets swapped. `next dev`, the tests and the seed
// all run on Node, where the workerd client's `?module` import is not valid
// JavaScript. One import specifier in the source, resolved per target.
const forWorkers = process.env.NODE_ENV === 'production'

const nextConfig: NextConfig = {
  typescript: {
    // A build that ships type errors is a build that lies.
    ignoreBuildErrors: false,
  },
  // Next 16 dropped the `eslint` config key along with `next lint`. Linting is
  // a separate gate now — `npm run check`.
  turbopack: {
    resolveAlias: forWorkers
      ? {
          '@/generated/prisma/client':
            './src/generated/prisma-workerd/client.ts',
        }
      : {},
  },
}

export default nextConfig

// Makes Cloudflare bindings (ASSETS, and anything added later) reachable from
// `getCloudflareContext()` while running `next dev`. No-op in production.
void initOpenNextCloudflareForDev()
