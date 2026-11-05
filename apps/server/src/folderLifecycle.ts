import { FOLDER_KEEP_FILE } from '../../../packages/protocol/src/index.ts'
import { notFound, VaultError } from './errors.ts'
import type { GitRepo } from './gitRepo.ts'
import type { VaultChange } from './gitSync.ts'
import type { VaultPath } from './paths.ts'

/**
 * Creating and deleting a folder, one commit each (protocol 1.8). Git keeps no empty folder,
 * so a new folder holds an empty `.keep` file, which the desktop's vault scan hides like every
 * dot file. A delete removes every tracked file under the folder, as the desktop's
 * `delete_vault_folder` removes the folder with everything in it. Both run with the vault lock
 * held, after the pull; they stage the change and the caller commits it.
 */

/** What a staged folder change does, for the commit and the listeners. */
export interface StagedFolderChange {
  message: string
  changes: VaultChange[]
}

export interface StagedFolderDelete extends StagedFolderChange {
  deleted: VaultPath[]
}

function isInside(path: string, folder: string): boolean {
  return path.startsWith(`${folder}/`)
}

/** Stages a new, empty folder at `path`. `files` are the vault's tracked files. */
export async function stageFolderCreate(repo: GitRepo, files: readonly VaultPath[], path: VaultPath): Promise<StagedFolderChange> {
  const taken = files.some((file) => file === path || isInside(file, path))
  if (taken || repo.exists(path)) throw new VaultError(409, 'destination_exists', `${path} already exists`)
  const keep = `${path}/${FOLDER_KEEP_FILE}` as VaultPath
  await repo.writeAtomic(keep, new Uint8Array())
  await repo.run(['add', '-f', '--', keep])
  return { message: `Create folder ${path}`, changes: [{ kind: 'upsert', path: keep }] }
}

/** Stages the deletion of every tracked file under `path`. A folder without any is not found. */
export async function stageFolderDelete(repo: GitRepo, files: readonly VaultPath[], path: VaultPath): Promise<StagedFolderDelete> {
  const deleted = files.filter((file) => isInside(file, path))
  if (deleted.length === 0) throw notFound(path)
  await repo.run(['rm', '-q', '-r', '--', path])
  const changes: VaultChange[] = deleted.map((file) => ({ kind: 'delete', path: file }))
  return { message: `Delete folder ${path}`, changes, deleted }
}
