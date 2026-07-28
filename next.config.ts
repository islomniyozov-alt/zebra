import type { NextConfig } from 'next'
import { initOpenNextCloudflareForDev } from '@opennextjs/cloudflare'

const nextConfig: NextConfig = {
  typescript: {
    // A build that ships type errors is a build that lies.
    ignoreBuildErrors: false,
  },
  // Next 16 dropped the `eslint` config key along with `next lint`. Linting is
  // a separate gate now — `npm run check`.
}

export default nextConfig

// Makes Cloudflare bindings (ASSETS, and anything added later) reachable from
// `getCloudflareContext()` while running `next dev`. No-op in production.
void initOpenNextCloudflareForDev()
