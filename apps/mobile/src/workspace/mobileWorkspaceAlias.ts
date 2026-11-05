export type MobileWorkspaceAliasInput = {
  alias?: string | null
  label?: string | null
  path?: string | null
}

export function mobileWorkspaceAlias({
  alias,
  label,
  path,
}: MobileWorkspaceAliasInput): string | null {
  return slugifyMobileWorkspaceAlias(alias)
    ?? slugifyMobileWorkspaceAlias(label)
    ?? slugifyMobileWorkspaceAlias(lastPathSegment(path))
}

export function slugifyMobileWorkspaceAlias(value: unknown): string | null {
  const slug = stringValue(value)
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, '-')
    .replace(/^-+|-+$/gu, '')

  return slug || null
}

function lastPathSegment(path: unknown): string {
  return stringValue(path).replace(/\/+$/u, '').split('/').filter(Boolean).at(-1) ?? ''
}

function stringValue(value: unknown): string {
  return typeof value === 'string' ? value : ''
}
