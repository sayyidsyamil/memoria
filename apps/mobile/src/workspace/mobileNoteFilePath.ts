import type { MobileNote } from './mobileWorkspaceModel'

export type MobileNoteFilePathResult =
  | { ok: true; path: string }
  | { error: 'missing_note' | 'unsafe_path'; ok: false }

export type MobileRelativeFilePathResult =
  | { ok: true; path: string }
  | { error: 'missing_path' | 'unsafe_path'; ok: false }

export function buildMobileFilePathForNote({
  note,
  vaultRootUri,
}: {
  note: MobileNote | null
  vaultRootUri?: string | null
}): MobileNoteFilePathResult {
  if (!note) return { error: 'missing_note', ok: false }

  const path = safeRelativeNotePath(note.path) ?? safeRelativeNotePath(note.id)
  return mobileFilePathResult(path, vaultRootUri)
}

export function buildMobileFilePathForRelativePath({
  path,
  vaultRootUri,
}: {
  path: string | null | undefined
  vaultRootUri?: string | null
}): MobileRelativeFilePathResult {
  if (!stringValue(path).trim()) return { error: 'missing_path', ok: false }

  const safePath = safeRelativeNotePath(path)
  return mobileFilePathResult(safePath, vaultRootUri)
}

function mobileFilePathResult(
  safePath: string | null,
  vaultRootUri?: string | null,
): { ok: true; path: string } | { error: 'unsafe_path'; ok: false } {
  if (!safePath) return { error: 'unsafe_path', ok: false }
  return {
    ok: true,
    path: vaultRootUri?.trim() ? joinVaultUri(vaultRootUri, safePath) : safePath,
  }
}

function safeRelativeNotePath(value: unknown): string | null {
  const normalized = stringValue(value).replaceAll('\\', '/').trim().replace(/^\/+|\/+$/gu, '')
  if (!normalized || normalized.includes('://')) return null

  const segments = normalized.split('/')
  return segments.every(isSafePathSegment) ? normalized : null
}

function isSafePathSegment(segment: string) {
  return segment.length > 0
    && segment !== '.'
    && segment !== '..'
    && !segment.includes('\0')
}

function joinVaultUri(rootUri: string, path: string) {
  const encodedPath = path.split('/').map(encodeURIComponent).join('/')
  return `${ensureTrailingSlash(rootUri.trim())}${encodedPath}`
}

function ensureTrailingSlash(value: string) {
  return value.endsWith('/') ? value : `${value}/`
}

function stringValue(value: unknown) {
  return typeof value === 'string' ? value : ''
}
