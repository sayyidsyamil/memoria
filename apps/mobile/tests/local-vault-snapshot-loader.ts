import type { Page } from '@playwright/test'
import { access, readdir, readFile, stat } from 'node:fs/promises'
import { basename, join, relative } from 'node:path'
import { performance } from 'node:perf_hooks'
import { buildLocalVaultWorkspaceSnapshot, mobileFileKindForPath, type LocalVaultFile } from '../src/workspace/localVaultSnapshot'
import type { MobileNote, MobileSidebarFolder, MobileWorkspaceSnapshot } from '../src/workspace/mobileWorkspaceModel'
import {
  HOST_WORKSPACE_NOTE_CONTENTS_GLOBAL_KEY,
  HOST_WORKSPACE_SNAPSHOT_GLOBAL_KEY,
  HOST_WORKSPACE_SNAPSHOT_STORAGE_KEY,
} from '../src/workspace/readOnlyWorkspaceRepository'

export type LocalVaultSnapshotState = {
  buildDurationMs: number
  fileCount: number
  noteContents: Record<string, string>
  readDurationMs: number
  snapshot: MobileWorkspaceSnapshot
  totalDurationMs: number
  vaultPath: VaultPath
}

type AbsolutePath = string
type DirectoryName = string
type RelativePath = string
type VaultPath = string

const defaultLocalVaultPath = '/Users/luca/Laputa'
export const localVaultPath = process.env.MOBILE_QA_VAULT_PATH ?? defaultLocalVaultPath

let localVaultSnapshotPromise: Promise<LocalVaultSnapshotState | null> | null = null

export async function installLocalVaultSnapshot(page: Page): Promise<LocalVaultSnapshotState | null> {
  const state = await localVaultSnapshotState()
  if (!state) return null

  await page.addInitScript(
    ({ contentKey, globalKey, key, noteContents, snapshot, value }) => {
      Reflect.set(window, globalKey, snapshot)
      Reflect.set(window, contentKey, noteContents)
      try {
        window.localStorage.setItem(key, value)
      } catch {
        window.localStorage.removeItem(key)
      }
    },
    {
      contentKey: HOST_WORKSPACE_NOTE_CONTENTS_GLOBAL_KEY,
      globalKey: HOST_WORKSPACE_SNAPSHOT_GLOBAL_KEY,
      key: HOST_WORKSPACE_SNAPSHOT_STORAGE_KEY,
      noteContents: state.noteContents,
      snapshot: state.snapshot,
      value: JSON.stringify(state.snapshot),
    },
  )

  return state
}

export async function localVaultSnapshotState(): Promise<LocalVaultSnapshotState | null> {
  localVaultSnapshotPromise ??= buildLocalVaultSnapshotState()
  return localVaultSnapshotPromise
}

export function firstSidebarFolder(snapshot: MobileWorkspaceSnapshot): MobileSidebarFolder | null {
  const folders = snapshot.sidebarSections.find((section) => section.id === 'folders')?.folders ?? []
  return firstNoteBackedFolder(folders, snapshotNoteFolderPaths(snapshot)) ?? firstFolder(folders)
}

function firstFolder(folders: MobileSidebarFolder[]): MobileSidebarFolder | null {
  for (const folder of folders) {
    if (folder.name) return folder
    const child = firstFolder(folder.children)
    if (child) return child
  }

  return null
}

function firstNoteBackedFolder(
  folders: MobileSidebarFolder[],
  noteFolderPaths: Set<string>,
): MobileSidebarFolder | null {
  for (const folder of folders) {
    if (noteFolderPaths.has(folder.id)) return folder

    const child = firstNoteBackedFolder(folder.children, noteFolderPaths)
    if (child) return child
  }

  return null
}

function snapshotNoteFolderPaths(snapshot: MobileWorkspaceSnapshot): Set<string> {
  return new Set((snapshot.allNotes ?? snapshot.notes).flatMap(noteAncestorFolderPaths))
}

function noteAncestorFolderPaths(note: MobileNote): string[] {
  const path = note.path || note.id
  const folderParts = path.split('/').slice(0, -1)
  return folderParts.map((_, index) => folderParts.slice(0, index + 1).join('/'))
}

async function buildLocalVaultSnapshotState(): Promise<LocalVaultSnapshotState | null> {
  if (!localVaultPath) return null

  try {
    await access(localVaultPath)
  } catch {
    return null
  }

  const startedAt = performance.now()
  const files = await readLocalVaultFiles(localVaultPath)
  const folderPaths = await readLocalVaultDirectories(localVaultPath)
  const readAt = performance.now()
  const snapshot = buildLocalVaultWorkspaceSnapshot({
    files,
    folderPaths,
    vaultLabel: basename(localVaultPath),
    vaultPath: localVaultPath,
  })
  const endedAt = performance.now()

  return {
    buildDurationMs: endedAt - readAt,
    fileCount: files.length,
    noteContents: noteContentMap(files),
    readDurationMs: readAt - startedAt,
    snapshot,
    totalDurationMs: endedAt - startedAt,
    vaultPath: localVaultPath,
  }
}

function noteContentMap(files: LocalVaultFile[]): Record<string, string> {
  return Object.fromEntries(
    files
      .filter((file) => file.relativePath.endsWith('.md'))
      .map((file) => [file.relativePath, file.content]),
  )
}

async function readLocalVaultFiles(vaultPath: VaultPath): Promise<LocalVaultFile[]> {
  const markdownPaths = await listWorkspaceFiles(vaultPath)
  const files: LocalVaultFile[] = []

  for (let index = 0; index < markdownPaths.length; index += 64) {
    const chunk = markdownPaths.slice(index, index + 64)
    files.push(...await Promise.all(chunk.map((absolutePath) => readLocalVaultFile(vaultPath, absolutePath))))
  }

  return files
}

async function readLocalVaultDirectories(vaultPath: VaultPath): Promise<RelativePath[]> {
  return listWorkspaceDirectories(vaultPath)
}

async function listWorkspaceFiles(vaultPath: VaultPath, currentPath: AbsolutePath = vaultPath): Promise<AbsolutePath[]> {
  const entries = await readdir(currentPath, { withFileTypes: true })
  const files: AbsolutePath[] = []

  for (const entry of entries) {
    const absolutePath = join(currentPath, entry.name)
    if (entry.isDirectory() && shouldReadDirectory(entry.name)) {
      files.push(...await listWorkspaceFiles(vaultPath, absolutePath))
    } else if (entry.isFile() && shouldReadFile(relative(vaultPath, absolutePath).replaceAll('\\', '/'))) {
      files.push(absolutePath)
    }
  }

  return files
}

async function listWorkspaceDirectories(vaultPath: VaultPath, currentPath: AbsolutePath = vaultPath): Promise<RelativePath[]> {
  const entries = await readdir(currentPath, { withFileTypes: true })
  const directories: RelativePath[] = []

  for (const entry of entries) {
    if (!entry.isDirectory() || !shouldReadDirectory(entry.name)) continue

    const absolutePath = join(currentPath, entry.name)
    directories.push(relative(vaultPath, absolutePath).replaceAll('\\', '/'))
    directories.push(...await listWorkspaceDirectories(vaultPath, absolutePath))
  }

  return directories
}

function shouldReadFile(relativePath: RelativePath): boolean {
  return Boolean(relativePath.split('/').at(-1))
}

function shouldReadDirectory(name: DirectoryName): boolean {
  return !name.startsWith('.') && name !== 'node_modules'
}

async function readLocalVaultFile(vaultPath: VaultPath, absolutePath: AbsolutePath): Promise<LocalVaultFile> {
  const relativePath = relative(vaultPath, absolutePath).replaceAll('\\', '/')
  const fileKind = mobileFileKindForPath(relativePath)
  const [content, metadata] = await Promise.all([
    fileKind === 'binary' ? Promise.resolve('') : readTextFile(absolutePath),
    stat(absolutePath),
  ])

  return {
    absolutePath,
    content,
    createdAt: metadata.birthtimeMs,
    fileKind,
    modifiedAt: metadata.mtimeMs,
    relativePath,
    size: metadata.size,
  }
}

async function readTextFile(absolutePath: AbsolutePath): Promise<string> {
  try {
    return await readFile(absolutePath, 'utf8')
  } catch {
    return ''
  }
}
