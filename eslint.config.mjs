import { defineConfig, globalIgnores } from 'eslint/config'
import nextVitals from 'eslint-config-next/core-web-vitals'
import nextTs from 'eslint-config-next/typescript'
import prettier from 'eslint-config-prettier/flat'

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,

  {
    rules: {
      // Acceptance criterion: no `any` in application code.
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
    },
  },

  // ---------------------------------------------------------------------
  // Routes take the front door.
  //
  // `withCurrentOrg` resolves three things together: the tenant, the
  // permission check, and who is acting. Reaching past it for `withOrg`,
  // `runInOrg` or the bare client gets you the tenancy guarantee and quietly
  // drops the other two — code that looks right, behaves wrong, and says
  // nothing. §7 requires every route to call `can()`; this makes forgetting
  // it a build error rather than a review catch.
  //
  // src/lib is where the primitives live and is deliberately exempt.
  // ---------------------------------------------------------------------
  {
    files: ['src/app/**/*.{ts,tsx}'],
    rules: {
      // Patterns rather than paths, so the alias and a relative specifier are
      // both caught — and only once each, which keeps the error readable.
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['**/lib/tenancy'],
              importNames: ['withOrg', 'runInOrg', 'runAsUser'],
              message:
                'Routes use withCurrentOrg from @/lib/auth-context — it checks the permission AND attributes the write to the session. withOrg does neither, silently.',
            },
            {
              group: ['**/lib/db'],
              importNames: ['prisma', 'createPrismaClient'],
              message:
                'Routes never touch the client directly. A query outside withCurrentOrg has no tenant set, so row-level security returns nothing and any write is unattributed.',
            },
          ],
        },
      ],
    },
  },

  // Formatting is Prettier's job. Must stay last so it wins.
  prettier,

  globalIgnores([
    // Default ignores of eslint-config-next:
    '.next/**',
    'out/**',
    'build/**',
    'next-env.d.ts',
    // Zebra additions:
    '.open-next/**',
    '.wrangler/**',
    'src/generated/**',
    'cloudflare-env.d.ts',
  ]),
])

export default eslintConfig
