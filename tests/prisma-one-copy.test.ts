import { readFileSync } from 'node:fs'
import { build } from 'esbuild'
import { describe, expect, it } from 'vitest'
import {
  copiesVerdict,
  countCopies,
  SCHEMA_MARK,
} from '../scripts/prisma-copies.mjs'
import {
  keepWasmModule,
  PACKAGE_NAME,
  packageJson,
  WASM,
} from '../scripts/prisma-workerd-package.mjs'

// ---------------------------------------------------------------------------
// ONE PRISMA CLIENT IN THE WORKER BUNDLE (owner's ruling 2026-11-16, GAPS 36 /
// 44). Five copies and two query-compiler `.wasm` at `bed6b3a`; one of each
// after the client became the server external `@zebra/prisma-workerd`. The
// build itself is not run here — the deploy counts the real bundle
// (`scripts/prisma-copies.mjs` in `scripts/deploy.mjs`); this holds the
// counting, the config that produces one copy, and the package's shape.
// ---------------------------------------------------------------------------

const meta = (inputs: string[], wasm: string[]) => ({
  outputs: {
    'handler.mjs': {
      inputs: Object.fromEntries(inputs.map((p) => [p, {}])),
      imports: wasm.map((path) => ({ path })),
    },
  },
})
const client = `config.inlineSchema = "// ${SCHEMA_MARK} \\u2014 DATABASE SCHEMA"`

describe('the count, from the metafile', () => {
  it('counts every input that embeds the schema, and every distinct .wasm', () => {
    const texts: Record<string, string> = {
      'chunks/a.js': client,
      'chunks/b.js': client,
      'chunks/c.js': 'nothing of the client',
    }
    const count = countCopies(
      meta(Object.keys(texts), ['/x/q.wasm?module', '/x/q.wasm', '/y/q.wasm']),
      (p: string) => texts[p] ?? null,
    )
    expect(count).toMatchObject({ copies: 2, wasm: ['/x/q.wasm', '/y/q.wasm'] })
    const verdict = copiesVerdict(count)
    expect(verdict.ok).toBe(false)
    expect(verdict.line).toMatch(/2 copy\(ies\), 2 query compiler\(s\).*NOT OK/)
  })

  it('one of each is OK; an esbuild virtual module is skipped, an unreadable file refuses', () => {
    const one = countCopies(
      meta(
        ['node_modules/@zebra/prisma-workerd/index.mjs', 'ns-plugin:/x'],
        ['/p/q.wasm?module'],
      ),
      (p: string) => (p.endsWith('index.mjs') ? client : null),
    )
    expect(copiesVerdict(one)).toMatchObject({ ok: true })

    const unreadable = countCopies(meta(['chunks/gone.js'], []), () => null)
    expect(copiesVerdict(unreadable)).toMatchObject({ ok: false })
    expect(copiesVerdict(unreadable).line).toMatch(/UNREADABLE/)
    // Zero copies is not one either — a bundle that lost the client.
    expect(
      copiesVerdict(countCopies(meta(['a.js'], ['/q.wasm']), () => '')).ok,
    ).toBe(false)
  })
})

describe('the config that makes one copy', () => {
  const config = readFileSync('next.config.ts', 'utf8')

  it('names the package a server external and aliases the client to the one import site, in the Workers build', () => {
    expect(config).toMatch(
      /serverExternalPackages:\s*forWorkers\s*\?\s*\['@zebra\/prisma-workerd'\]/,
    )
    expect(config).toMatch(
      /'@\/generated\/prisma\/client':\s*'\.\/src\/lib\/prisma-workerd-external\.mjs'/,
    )
    // The site asks by package name — Turbopack decides "external" by the
    // request, and `@/generated/...` is not one Node can resolve.
    expect(readFileSync('src/lib/prisma-workerd-external.mjs', 'utf8')).toMatch(
      /^export \* from '@zebra\/prisma-workerd'$/m,
    )
    // The .wasm stays out of the trace, or OpenNext lists a second copy.
    expect(config).toContain("'./node_modules/@zebra/prisma-workerd/*.wasm'")
  })

  it('builds the package before next build', () => {
    const pkg = JSON.parse(readFileSync('package.json', 'utf8'))
    expect(pkg.scripts.build).toBe(
      'node scripts/prisma-workerd-package.mjs && next build',
    )
  })
})

describe('the package', () => {
  it('is an ESM package by the name the config externalises', () => {
    expect(packageJson()).toMatchObject({
      name: PACKAGE_NAME,
      type: 'module',
      exports: { '.': './index.mjs' },
    })
    expect(PACKAGE_NAME).toBe('@zebra/prisma-workerd')
  })

  it('writes the compiler’s ?module import as the package’s own .wasm, by absolute path', async () => {
    // Absolute because which copy of index.mjs OpenNext bundles differs by
    // platform; CI's dry run failed on a relative one (run 43826422641).
    const at = 'C:\\repo\\node_modules\\@zebra\\prisma-workerd\\' + WASM
    const result = await build({
      stdin: {
        contents: `export const m = () => import("./internal/${WASM}?module")`,
        resolveDir: '.',
      },
      bundle: true,
      write: false,
      format: 'esm',
      plugins: [keepWasmModule(at)],
      logLevel: 'silent',
    })
    expect(result.outputFiles[0]?.text).toContain(
      `import("C:/repo/node_modules/@zebra/prisma-workerd/${WASM}?module")`,
    )
  })
})
