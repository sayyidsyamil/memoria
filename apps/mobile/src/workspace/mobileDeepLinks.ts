import type { MobileNote, MobileWorkspaceSource } from './mobileWorkspaceModel'

export const MEMORIA_MOBILE_DEEP_LINK_SCHEME = 'memoria'

export type MobileDeepLinkBuildError = 'missing_note' | 'missing_vault' | 'unsafe_path'

export type MobileDeepLinkBuildResult =
  | { ok: true; url: string }
  | { error: MobileDeepLinkBuildError; ok: false }

export type MobileDeepLinkBuildInput = {
  note: MobileNote | null
  source?: MobileWorkspaceSource
  vaultRootUri?: string | null
}

export function buildMobileDeepLinkForNote({
  note,
  source,
  vaultRootUri,
}: MobileDeepLinkBuildInput): MobileDeepLinkBuildResult {
  if (!note) return { error: 'missing_note', ok: false }

  const relativePath = mobileNoteDeepLinkPath(note)
  if (!relativePath) return { error: 'unsafe_path', ok: false }

  const slug = activeVaultSlug({ note, source, vaultRootUri })
  if (!slug) return { error: 'missing_vault', ok: false }

  return {
    ok: true,
    url: `${MEMORIA_MOBILE_DEEP_LINK_SCHEME}://${slug}/${encodeRelativePath(relativePath)}`,
  }
}

function activeVaultSlug(input: MobileDeepLinkBuildInput & { note: MobileNote }): string {
  const labelSlug = slugifyWorkspaceAlias(activeVaultLabel(input))
  if (labelSlug) return labelSlug

  return slugifyWorkspaceAlias(labelFromWorkspacePath(activeVaultPath(input)))
}

function activeVaultLabel({
  note,
  source,
}: MobileDeepLinkBuildInput & { note: MobileNote }): string {
  const label = sourceValue(source?.label)
  if (label) return label

  return note.workspace
}

function activeVaultPath({
  source,
  vaultRootUri,
}: MobileDeepLinkBuildInput): string {
  const sourcePath = sourceValue(source?.vaultPath)
  if (sourcePath) return sourcePath

  return sourceValue(vaultRootUri)
}

function mobileNoteDeepLinkPath(note: MobileNote): string | null {
  const explicitPath = safeRelativeNotePath(note.path)
  if (explicitPath) return explicitPath

  return safeRelativeNotePath(note.id)
}

function labelFromWorkspacePath(path: unknown): string {
  return stringValue(path).split(/[\\/]/u).filter(Boolean).at(-1) ?? ''
}

function slugifyWorkspaceAlias(label: unknown): string {
  return stringValue(label)
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, '-')
    .replace(/^-+|-+$/gu, '')
}

function safeRelativeNotePath(path: unknown): string | null {
  const normalized = stringValue(path).replaceAll('\\', '/').trim().replace(/^\/+|\/+$/gu, '')
  if (!normalized || normalized.includes('://')) return null

  const segments = normalized.split('/')
  if (segments.some((segment) => !isSafePathSegment(segment))) return null
  return normalized
}

function isSafePathSegment(segment: string): boolean {
  return segment.length > 0
    && segment !== '.'
    && segment !== '..'
    && !segment.includes('\\')
}

function encodeRelativePath(path: string): string {
  return path
    .split('/')
    .map((segment) => encodeURIComponent(segment))
    .join('/')
}

function stringValue(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

function sourceValue(value: unknown): string {
  return stringValue(value).trim()
}
