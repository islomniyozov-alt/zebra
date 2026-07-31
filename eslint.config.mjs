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

  // ---------------------------------------------------------------------
  // An asset's authority is a PERIOD, not a column you overwrite.
  //
  // `Truck.companyId` and the open `AssetAssignment` are two representations
  // of one fact, and nothing in the schema makes them agree. One stray
  // `update({ data: { companyId } })` desynchronises them with no error and no
  // trace — and the damage only surfaces months later, when somebody has to
  // answer under whose MC number a truck was running on the day of an
  // accident and finds two different answers.
  //
  // So the write is banned everywhere and permitted in exactly one file,
  // where it happens alongside closing one period and opening the next. The
  // selector matches `update`/`updateMany` only: `create` legitimately sets
  // companyId on a dozen models, and creating an asset is not moving one.
  //
  // The backstop under this is `findAuthorityDrift`, which asks the database
  // the same question and must return nothing — see tests/integrity.test.ts.
  // A lint rule catches the code you wrote; the assertion catches the row
  // somebody wrote by hand.
  // ---------------------------------------------------------------------
  {
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          selector:
            "CallExpression[callee.property.name=/^update(Many)?$/] > ObjectExpression > Property[key.name='data'] > ObjectExpression > Property[key.name='companyId']",
          message:
            "An asset's authority is a period, not a column. Use transferAsset from @/lib/asset-transfer — it closes the open AssetAssignment and opens the next one, which is the only reason changing companyId is ever safe.",
        },
      ],
    },
  },
  {
    // The single exemption. Small on purpose: everything in it is about
    // periods, so there is nowhere here for an unrelated companyId write to
    // hide.
    files: ['src/lib/asset-transfer.ts'],
    rules: { 'no-restricted-syntax': 'off' },
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
