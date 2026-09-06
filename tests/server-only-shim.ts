// `server-only` throws on import outside a server bundler, by design: it is
// how a client component importing a server module becomes a build error.
//
// Under vitest that made every route handler in this application unimportable,
// so no test could walk one — which is how a server-action body limit reached
// production inside `/drivers/new`. The alias in `vitest.node.config.ts` points
// the specifier here so the module graph resolves.
//
// IT DOES NOT WEAKEN THE MARKER. The build still uses the real package; this
// affects the node test project alone, where there is no client/server boundary
// to protect and the only thing the throw protects is the test from running.
export {}
