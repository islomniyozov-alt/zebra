import { defineCloudflareConfig } from '@opennextjs/cloudflare'

// No incremental cache override. Zebra is an authenticated, per-request
// application — every page is dynamic and there is nothing to cache at the
// edge. Adding the R2 incremental cache would mean a bucket that exists only
// to stay empty. Revisit if a public or ISR surface is ever introduced.
export default defineCloudflareConfig()
