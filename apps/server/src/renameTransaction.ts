import { notFound, stale, VaultError } from './errors.ts'
import type { GitRepo } from './gitRepo.ts'
import type { VaultChange } from './gitSync.ts'
import { blobEtag, type VaultPath } from './paths.ts'
import { noteTitle } from './noteTitle.ts'
import { renameLinkRewrite, withTitle } from './renameLinks.ts'
import { isMarkdownNote, noteText, stageFile, stageRewrites } from './stagedRewrites.ts'

/**
 * One rename as one commit: the file moves, its `title` property follows a title rename, and
 * on request every other note's wikilinks to it are rewritten, as the desktop's `rename_note`
 * and `rename_note_filename` do. Runs with the vault lock held, after the pull; it stages the
 * changes and the caller commits them.
 */

export interface RenameOptions {
  /** Etag of `from` the client last saw; omitted renames whatever is there. */
  ifMatch?: string
  rewriteLinks?: boolean
  /** The new title: written to the `title` property when it differs from the old one. */
  title?: string
  /** The title links use; read from the note when omitted. */
  oldTitle?: string
}

export interface RenameRequest extends RenameOptions {
  from: VaultPath
  to: VaultPath
}

/** What a staged rename changed, for the commit, the listeners and the client. */
export interface StagedRename {
  etag: string
  message: string
  changes: VaultChange[]
  rewritten: VaultPath[]
}

interface SourceNote {
  etag: string
  /** Null for a file that is not a UTF-8 markdown note: it moves, but nothing in it changes. */
  content: string | null
  oldTitle: string
}

/** A note other than the renamed one. */
function linksMayChange(path: VaultPath, request: RenameRequest): boolean {
  return isMarkdownNote(path) && path !== request.from && path !== request.to
}

function trimmedTitle(title: string | undefined): string | undefined {
  if (title === undefined) return undefined
  const trimmed = title.trim()
  if (trimmed) return trimmed
  throw new VaultError(400, 'invalid_request', 'title must not be empty')
}

function commitMessage({ from, to }: RenameRequest): string {
  return from === to ? `Retitle ${from}` : `Rename ${from} to ${to}`
}

export class RenameTransaction {
  private readonly repo: GitRepo
  private readonly request: RenameRequest
  private readonly title: string | undefined

  constructor(repo: GitRepo, request: RenameRequest) {
    this.repo = repo
    this.request = request
    this.title = trimmedTitle(request.title)
  }

  /** Stages the rename. `notes` are the vault's tracked files before it. */
  async stage(notes: readonly VaultPath[]): Promise<StagedRename> {
    const source = await this.source()
    const { from, to } = this.request
    const changes: VaultChange[] = []
    if (from !== to) {
      await this.move()
      changes.push({ kind: 'rename', from, to })
    }
    if (await this.retitle(source)) changes.push({ kind: 'upsert', path: to })
    const rewritten = this.request.rewriteLinks && from !== to ? await this.rewriteAll(notes, source.oldTitle) : []
    const links = renameLinkRewrite({ from, to, oldTitle: source.oldTitle })
    for (const path of rewritten) changes.push({ kind: 'upsert', path, links })
    return { etag: source.etag, message: commitMessage(this.request), changes, rewritten }
  }

  private async source(): Promise<SourceNote> {
    const { from, to, oldTitle } = this.request
    const bytes = await this.repo.readIfExists(from)
    if (!bytes) throw notFound(from)
    const etag = this.checkedEtag(bytes)
    this.checkDestination()
    const content = isMarkdownNote(to) ? noteText(bytes) : null
    return { etag, content, oldTitle: oldTitle ?? noteTitle(content ?? '', from) }
  }

  /** The etag of `from`, which must be the revision the client saw when it sent one. */
  private checkedEtag(bytes: Uint8Array): string {
    const { from, ifMatch } = this.request
    const etag = blobEtag(bytes)
    if (ifMatch && ifMatch !== etag) throw stale(from, etag)
    return etag
  }

  /** `to` must be free, unless this only retitles the note in place. */
  private checkDestination(): void {
    const { from, to } = this.request
    const retitleInPlace = from === to && this.title !== undefined
    if (!retitleInPlace && this.repo.exists(to)) throw new VaultError(409, 'destination_exists', `${to} already exists`)
  }

  private async move(): Promise<void> {
    const { from, to } = this.request
    await this.repo.makeParent(to)
    await this.repo.run(['mv', '--', from, to])
  }

  /** `rename_note` writes the new title only when it differs from the one the note had. */
  private async retitle(source: SourceNote): Promise<boolean> {
    if (this.title === undefined || this.title === source.oldTitle || source.content === null) return false
    const content = withTitle(source.content, this.title)
    if (content === source.content) return false
    await stageFile(this.repo, this.request.to, content)
    return true
  }

  private rewriteAll(notes: readonly VaultPath[], oldTitle: string): Promise<VaultPath[]> {
    const rewrite = renameLinkRewrite({ from: this.request.from, to: this.request.to, oldTitle })
    return stageRewrites(this.repo, notes.filter((path) => linksMayChange(path, this.request)), rewrite)
  }
}
