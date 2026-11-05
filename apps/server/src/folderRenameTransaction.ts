import { notFound, VaultError } from './errors.ts'
import type { GitRepo } from './gitRepo.ts'
import type { VaultChange } from './gitSync.ts'
import type { VaultPath } from './paths.ts'
import { folderLinkRewrites } from './renameLinks.ts'
import { isMarkdownNote, stageRewrites } from './stagedRewrites.ts'

/**
 * One folder rename as one commit: every tracked file under `from` moves to `to`, and on
 * request the wikilinks that reach a moved note by its path (`[[from/note]]`) follow it to
 * `[[to/note]]` in every note, the moved ones included. Links by title or bare file name
 * still resolve after the move and are left alone. Runs with the vault lock held, after the
 * pull; it stages the changes and the caller commits them.
 */

export interface FolderRenameRequest {
  from: VaultPath
  to: VaultPath
  rewriteLinks?: boolean
}

/** One file the folder rename moved. */
export interface FolderMove {
  from: VaultPath
  to: VaultPath
}

/** What a staged folder rename changed, for the commit, the listeners and the client. */
export interface StagedFolderRename {
  message: string
  changes: VaultChange[]
  moved: FolderMove[]
  rewritten: VaultPath[]
}

function isInside(path: string, folder: string): boolean {
  return path.startsWith(`${folder}/`)
}

export class FolderRenameTransaction {
  private readonly repo: GitRepo
  private readonly request: FolderRenameRequest

  constructor(repo: GitRepo, request: FolderRenameRequest) {
    this.repo = repo
    this.request = request
  }

  /** Stages the rename. `files` are the vault's tracked files before it. */
  async stage(files: readonly VaultPath[]): Promise<StagedFolderRename> {
    const moved = this.moves(files)
    this.checkDestination()
    await this.repo.makeParent(this.request.to)
    await this.repo.run(['mv', '--', this.request.from, this.request.to])
    const changes: VaultChange[] = moved.map(({ from, to }) => ({ kind: 'rename', from, to }))
    const rewritten = this.request.rewriteLinks ? await this.rewriteAll(files, moved) : []
    const links = folderLinkRewrites(moved)
    for (const path of rewritten) changes.push({ kind: 'upsert', path, links })
    return { message: `Rename folder ${this.request.from} to ${this.request.to}`, changes, moved, rewritten }
  }

  /** Where each tracked file under `from` goes. A folder without any is not found. */
  private moves(files: readonly VaultPath[]): FolderMove[] {
    const { from, to } = this.request
    if (to === from || isInside(to, from)) throw new VaultError(400, 'invalid_request', `${to} is inside ${from}`)
    const moved = files
      .filter((path) => isInside(path, from))
      .map((path) => ({ from: path, to: `${to}${path.slice(from.length)}` as VaultPath }))
    if (moved.length === 0) throw notFound(from)
    return moved
  }

  private checkDestination(): void {
    const { to } = this.request
    if (this.repo.exists(to)) throw new VaultError(409, 'destination_exists', `${to} already exists`)
  }

  /** Every note after the move, rewritten with the path links of every moved note. */
  private rewriteAll(files: readonly VaultPath[], moved: readonly FolderMove[]): Promise<VaultPath[]> {
    const destinations = new Map(moved.map(({ from, to }) => [from, to]))
    const notes = files.map((path) => destinations.get(path) ?? path).filter(isMarkdownNote)
    return stageRewrites(this.repo, notes, folderLinkRewrites(moved))
  }
}
