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

  // The bare domain has to land somewhere. A redirect rather than a page: `/`
  // sat in the sidebar as "Dashboard" for two phases and silently landed on
  // Loads, which read as the sidebar losing its place.
  //
  // IT POINTS AT THE DASHBOARD NOW, which exists as of Step B. `/dashboard`
  // itself redirects to `/login` without a session, so this is the entry point
  // in both states. Still `permanent: false` — a 308 would be cached by every
  // browser that ever saw it, and the destination has already moved once.
  // THE MONEY SECTION MOVED TO ACCOUNTING (§6.2, amended 2026-09-28) and every
  // old path still resolves. Not politeness: `/money/this-week` is in bookmarks,
  // in four commit messages, in session notes and in the sidebar of any tab left
  // open over the weekend, and a 404 on a money screen reads as data loss rather
  // than as a moved page.
  //
  // `permanent: false` THROUGHOUT. A 308 is cached by every browser that ever
  // saw it, and this section has now moved once — which is the argument the `/`
  // redirect above already makes about its own destination.
  //
  // `/settlements/:id` AND `/invoices/:id` ARE NOT REDIRECTED. The detail pages
  // did not move: a settlement is the document a driver is handed and Payroll
  // links to it, so only the LIST paths are here.
  async redirects() {
    return [
      { source: '/', destination: '/dashboard', permanent: false },
      {
        source: '/money/this-week',
        destination: '/payroll/batches',
        permanent: false,
      },
      {
        source: '/money/by-company',
        destination: '/accounting/reports?cut=company',
        permanent: false,
      },
      {
        source: '/money',
        destination: '/payroll/batches',
        permanent: false,
      },
      {
        source: '/invoices',
        destination: '/accounting/invoices',
        permanent: false,
      },
      {
        source: '/payments',
        destination: '/accounting/payments',
        permanent: false,
      },
      // Receivables folded into Invoices as an age chip. The factoring screen
      // did NOT fold in — it is money owed by the factor rather than by a broker
      // — so it keeps its own path and is not redirected.
      {
        source: '/receivables',
        destination: '/accounting/invoices',
        permanent: false,
      },
      {
        source: '/settlements',
        destination: '/payroll/batches',
        permanent: false,
      },
      {
        source: '/settlements/batches',
        destination: '/payroll/batches',
        permanent: false,
      },
      // ── AND THE ACCOUNTING PATHS THAT MOVED WITH THE SPLIT ──────────────
      //
      // §6.2 split Accounting from Payroll on 2026-09-28, a few hours after the
      // first set of these was written. `/accounting/payroll` and
      // `/accounting/charges` existed for exactly that long — long enough to be
      // in a screenshot run, a commit message and this session's own notes, which
      // is long enough to be worth a redirect.
      {
        source: '/accounting/payroll',
        destination: '/payroll/batches',
        permanent: false,
      },
      {
        source: '/accounting/charges',
        destination: '/payroll/charges',
        permanent: false,
      },
    ]
  },
  turbopack: {
    resolveAlias: forWorkers
      ? {
          '@/generated/prisma/client':
            './src/generated/prisma-workerd/client.ts',
        }
      : {},
  },
  // `pg`'s Workers socket shim, CARRIED BY NAME (§6.10, GAPS 33). `pg` loads
  // `pg-cloudflare` only on workerd, behind a runtime check, and Next's file
  // tracing decides by platform whether to follow that require: the Windows
  // trace copied it into the server function and the Linux trace in CI did
  // not, so CI's bundle step died on "Could not resolve pg-cloudflare" while
  // every local build passed. Naming it here makes the copy unconditional.
  outputFileTracingIncludes: {
    '/**': ['./node_modules/pg-cloudflare/**/*'],
  },
}

export default nextConfig

// Starts wrangler's local platform proxy so Cloudflare bindings (ASSETS, the
// Hyperdrive binding, anything added later) are reachable from
// `getCloudflareContext()` under `next dev` — and ONLY there. It does not run
// when NODE_ENV is production, which is `next build`, the Workers build: the
// proxy refuses to start without a local Postgres string for the Hyperdrive
// binding (§6.10, GAPS 33), so running it at build time killed the build.
// `forWorkers` is the same NODE_ENV test the Workers build uses above. Under
// `next dev` the proxy needs CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_
// HYPERDRIVE set in the shell (see the binding in wrangler.jsonc).
if (!forWorkers) void initOpenNextCloudflareForDev()
