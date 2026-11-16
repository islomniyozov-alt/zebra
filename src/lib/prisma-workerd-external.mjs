// THE ONE IMPORT SITE OF THE WORKERD PRISMA CLIENT (owner's ruling
// 2026-11-16, GAPS 36 / 44). `next.config.ts` aliases
// `@/generated/prisma/client` here in the Workers build, and this file asks
// for the client by its package name. Turbopack decides "external" by the
// REQUEST, not by the alias's target: aliased straight to the package, the
// request was still `@/generated/prisma/client`, which Node cannot resolve,
// and the build warned "Package @ can't be external" and bundled five copies
// again. From here the request is `@zebra/prisma-workerd`, which Node
// resolves (`scripts/prisma-workerd-package.mjs` writes it), so it stays a
// `require` and OpenNext's esbuild bundles it once. JavaScript, not
// TypeScript: the package carries no types, and every importer is typed
// against `src/generated/prisma` already.
export * from '@zebra/prisma-workerd'
