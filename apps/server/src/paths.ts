import { createHash } from 'node:crypto'
import { posix } from 'node:path'
import { VaultError } from './errors.ts'

const MAX_PATH_BYTES = 1024
const MAX_COPY_ATTEMPTS = 1000
const BACKSLASH = '\\'
const EMPTY_OR_DOT_SEGMENTS = new Set(['', '.', '..'])

declare const validated: unique symbol
/** A vault-relative path that passed `vaultPath`, or that git reported for a tracked file. */
export type VaultPath = string & { readonly [validated]: true }

function invalid(message: string): VaultError {
  return new VaultError(400, 'invalid_path', message)
}

function hasForbiddenCharacter(path: string): boolean {
  if (path.includes(BACKSLASH)) return true
  for (const character of path) {
    const code = character.charCodeAt(0)
    if (code < 0x20 || code === 0x7f) return true
  }
  return false
}

function checkSegment(segment: string): void {
  if (EMPTY_OR_DOT_SEGMENTS.has(segment)) {
    throw invalid("path must be relative, without empty, '.' or '..' segments")
  }
  if (segment.toLowerCase().startsWith('.git')) throw invalid('git files are not addressable')
}

/**
 * Validates a client-supplied vault-relative path and returns it unchanged.
 * Anything that could leave the vault or reach git's own files is rejected.
 */
export function vaultPath(raw: unknown): VaultPath {
  const path = typeof raw === 'string' ? raw : ''
  if (path.length === 0) throw invalid('path is required')
  if (Buffer.byteLength(path) > MAX_PATH_BYTES) throw invalid('path is too long')
  if (hasForbiddenCharacter(path)) throw invalid('path contains forbidden characters')
  path.split('/').forEach(checkSegment)
  return path as VaultPath
}

/** `2026-10-10 1903` in UTC, the stamp inside a conflict copy's name. */
function conflictStamp(now: Date): string {
  const iso = now.toISOString()
  return `${iso.slice(0, 10)} ${iso.slice(11, 13)}${iso.slice(14, 16)}`
}

/** `notes/a.md` -> `notes/a (conflict 2026-10-10 1903).md`, made unique via `exists`. */
export function conflictCopyPath(
  path: VaultPath,
  now: Date,
  exists: (candidate: VaultPath) => boolean,
): VaultPath {
  const { dir, name, ext } = posix.parse(path)
  const stamp = conflictStamp(now)
  for (let attempt = 1; attempt <= MAX_COPY_ATTEMPTS; attempt++) {
    const suffix = attempt === 1 ? '' : ` ${attempt}`
    const candidate = posix.join(dir, `${name} (conflict ${stamp}${suffix})${ext}`) as VaultPath
    if (!exists(candidate)) return candidate
  }
  throw new Error(`no free conflict copy name for ${path}`)
}

/** The etag of a file is its git blob id, so any client or self-host can recompute it. */
export function blobEtag(bytes: Uint8Array): string {
  // SHA-1 is what git names blobs with; it identifies content here and protects nothing.
  return createHash('sha1').update(`blob ${bytes.byteLength}\0`).update(bytes).digest('hex')
}

export function isNote(path: string): boolean {
  return path.toLowerCase().endsWith('.md')
}
