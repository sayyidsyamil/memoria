import type { GitRepo } from './gitRepo.ts'
import type { VaultPath } from './paths.ts'
import { type LinkRewrites, rewriteLinks } from './renameLinks.ts'

/**
 * Staging the wikilink rewrite of a rename in the notes that link to what moved, shared by
 * `RenameTransaction` (one note) and `FolderRenameTransaction` (every note in a folder).
 * Runs with the vault lock held; the caller commits what is staged.
 */

const utf8 = new TextDecoder('utf-8', { fatal: true })

/** The text of a note, or null for bytes that are not UTF-8: the desktop skips those too. */
export function noteText(bytes: Uint8Array): string | null {
  try {
    return utf8.decode(bytes)
  } catch {
    return null
  }
}

/** Notes are what the desktop renames and rewrites (`is_replaceable_md_file`); other files only move. */
export function isMarkdownNote(path: VaultPath): boolean {
  return path.endsWith('.md')
}

export async function stageFile(repo: GitRepo, path: VaultPath, content: string): Promise<void> {
  await repo.writeAtomic(path, Buffer.from(content))
  await repo.run(['add', '-f', '--', path])
}

async function stageRewrite(repo: GitRepo, path: VaultPath, rewrite: LinkRewrites): Promise<boolean> {
  const bytes = await repo.readIfExists(path)
  const content = bytes && noteText(bytes)
  if (!content) return false
  const next = rewriteLinks(content, rewrite)
  if (next === content) return false
  await stageFile(repo, path, next)
  return true
}

/** Rewrites the links in each of `notes` and stages the ones that changed, which it returns. */
export async function stageRewrites(repo: GitRepo, notes: readonly VaultPath[], rewrite: LinkRewrites): Promise<VaultPath[]> {
  const rewritten: VaultPath[] = []
  for (const path of notes) {
    if (await stageRewrite(repo, path, rewrite)) rewritten.push(path)
  }
  return rewritten
}
