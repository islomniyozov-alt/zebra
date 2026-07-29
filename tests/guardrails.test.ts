import { describe, expect, it } from 'vitest'
import { ESLint } from 'eslint'

// ---------------------------------------------------------------------------
// The guardrails that stop a route from looking correct while being wrong.
//
// Two of them exist, and this file tests the *enforcement*, not the config
// text — a lint rule nobody has watched fail is a lint rule that might be
// misconfigured. The type-level half (attribution being required) is enforced
// by `npm run typecheck` and needs no test; it cannot compile.
//
// Why the pair, rather than trusting review:
//
//   withCurrentOrg resolves the tenant, the permission check, and who is
//   acting. Reaching past it for withOrg gets you the first and silently
//   drops the other two — code that reads fine, commits fine, and attributes
//   the write to nobody. That is the same failure signature as the lazy
//   PrismaPromise bug: quiet, plausible, invisible until someone goes looking.
// ---------------------------------------------------------------------------

const eslint = new ESLint({ cwd: process.cwd() })

const lint = async (filePath: string, code: string) => {
  const [result] = await eslint.lintText(code, { filePath, warnIgnored: false })
  return result?.messages ?? []
}

type LintMessage = Awaited<ReturnType<typeof lint>>[number]

const restricted = (messages: LintMessage[]) =>
  messages.filter((message) => message.ruleId === 'no-restricted-imports')

describe('routes cannot reach past withCurrentOrg', () => {
  it.each([
    [
      'withOrg',
      `import { withOrg } from '@/lib/tenancy'\nexport const x = withOrg`,
    ],
    [
      'runInOrg',
      `import { runInOrg } from '@/lib/tenancy'\nexport const x = runInOrg`,
    ],
    [
      'runAsUser',
      `import { runAsUser } from '@/lib/tenancy'\nexport const x = runAsUser`,
    ],
    ['prisma', `import { prisma } from '@/lib/db'\nexport const x = prisma`],
    [
      'createPrismaClient',
      `import { createPrismaClient } from '@/lib/db'\nexport const x = createPrismaClient`,
    ],
  ])('refuses %s under src/app', async (_name, code) => {
    const messages = await lint('src/app/loads/page.tsx', code)
    expect(restricted(messages)).toHaveLength(1)
    expect(restricted(messages)[0]).toBeDefined()
  })

  it('names the alternative in the error, so the fix is obvious', async () => {
    const messages = await lint(
      'src/app/loads/page.tsx',
      `import { withOrg } from '@/lib/tenancy'\nexport const x = withOrg`,
    )
    expect(restricted(messages)[0]?.message).toContain('withCurrentOrg')
  })

  it('catches a relative import too, not only the alias', async () => {
    const messages = await lint(
      'src/app/loads/page.tsx',
      `import { withOrg } from '../../lib/tenancy'\nexport const x = withOrg`,
    )
    expect(restricted(messages)).toHaveLength(1)
  })

  it('allows withCurrentOrg, which is the front door', async () => {
    const messages = await lint(
      'src/app/loads/page.tsx',
      `import { withCurrentOrg } from '@/lib/auth-context'\nexport const x = withCurrentOrg`,
    )
    expect(restricted(messages)).toEqual([])
  })

  it('leaves src/lib alone, where the primitives live', async () => {
    const messages = await lint(
      'src/lib/loads.ts',
      `import { withOrg } from '@/lib/tenancy'\nexport const x = withOrg`,
    )
    expect(restricted(messages)).toEqual([])
  })

  it('leaves tests alone', async () => {
    const messages = await lint(
      'tests/integration/something.test.ts',
      `import { runInOrg } from '@/lib/tenancy'\nexport const x = runInOrg`,
    )
    expect(restricted(messages)).toEqual([])
  })
})
