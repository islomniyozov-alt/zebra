/**
 * Join class names, dropping anything falsy.
 *
 * Deliberately not clsx or tailwind-merge. Nothing here needs conflict
 * resolution — components own their classes and callers append rather than
 * override — and a dependency that silently reorders Tailwind classes is a
 * dependency that can silently change a colour.
 */
export function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(' ')
}
