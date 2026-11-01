import { useCallback, useLayoutEffect, useRef } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { isTauri, mockInvoke } from '../mock-tauri'
import type { VaultEntry, WorkspaceIdentity } from '../types'
import { slugify } from './useNoteCreation'
import {
  findByNotePath,
  normalizeVaultRelativePath,
  notePathsMatch,
} from '../utils/notePathIdentity'
import { vaultPathForEntry } from '../utils/workspaces'
import { createVaultBackend, type VaultRenameRequest } from '../lib/vaultBackend'
import { buildFilenameRenamedEntry, buildRenamedEntry, buildWorkspaceMovedEntry, workspaceMoveReplacementTarget } from './noteRenameEntries'
import { moveNoteErrorMessage, moveToastMessage, moveWorkspaceToastMessage, renameErrorMessage, renameToastMessage } from './noteRenameMessages'

interface RenameResult {
  new_path: string
  updated_files: number
  failed_updates?: number
}

export { buildFilenameRenamedEntry, buildRenamedEntry, buildWorkspaceMovedEntry, renameToastMessage, slugify, workspaceMoveReplacementTarget }

interface RenameRequest {
  path: string
  newTitle: string
  vaultPath: string
  oldTitle?: string
}

interface FilenameRenameRequest {
  path: string
  newFilenameStem: string
  vaultPath: string
}

interface FolderMoveRequest {
  path: string
  folderPath: string
  vaultPath: string
}

interface WorkspaceMoveRequest {
  path: string
  sourceVaultPath: string
  destinationVaultPath: string
  replacementTarget?: string
}

interface LoadNoteContentRequest {
  path: string
}

interface ReloadTabsAfterRenameRequest {
  tabPaths: string[]
  updateTabContent: (path: string, content: string) => void
}

type RenameCommand = 'move_note_to_workspace'

/** Check if a note's filename doesn't match the slug of its current title. */
export function needsRenameOnSave(title: string, filename: string): boolean {
  if (!filename.toLowerCase().endsWith('.md')) return false
  return `${slugify(title)}.md` !== filename
}

/** Renames through the vault's backend: Tauri on desktop, the server on a Memoria remote, mock data otherwise. */
async function renameThroughBackend(vaultPath: string, request: VaultRenameRequest): Promise<RenameResult> {
  const { newPath, updatedFiles, failedUpdates } = await createVaultBackend(vaultPath).files.rename(request)
  return { new_path: newPath, updated_files: updatedFiles, failed_updates: failedUpdates }
}

export async function performRename({ path, newTitle, vaultPath, oldTitle }: RenameRequest): Promise<RenameResult> {
  return renameThroughBackend(vaultPath, { path, newTitle, oldTitle })
}

function invokeRenameCommand(params: {
    command: RenameCommand
    tauriArgs: Record<string, unknown>
    mockArgs: Record<string, unknown>
}): Promise<RenameResult> {
  return isTauri()
    ? invoke<RenameResult>(params.command, params.tauriArgs)
    : mockInvoke<RenameResult>(params.command, params.mockArgs)
}

export async function performFilenameRename({
  path,
  newFilenameStem,
  vaultPath,
}: FilenameRenameRequest): Promise<RenameResult> {
  return renameThroughBackend(vaultPath, { path, newFilenameStem })
}

export async function performMoveNoteToFolder({
  path,
  folderPath,
  vaultPath,
}: FolderMoveRequest): Promise<RenameResult> {
  return renameThroughBackend(vaultPath, { path, folderPath })
}

export async function performMoveNoteToWorkspace({
  path,
  sourceVaultPath,
  destinationVaultPath,
  replacementTarget,
}: WorkspaceMoveRequest): Promise<RenameResult> {
  const tauriReplacementTarget = replacementTarget ?? null
  return invokeRenameCommand({
    command: 'move_note_to_workspace',
    tauriArgs: {
      args: {
        sourceVaultPath,
        destinationVaultPath,
        oldPath: path,
        replacementTarget: tauriReplacementTarget,
      },
    },
    mockArgs: {
      source_vault_path: sourceVaultPath,
      destination_vault_path: destinationVaultPath,
      old_path: path,
      replacement_target: tauriReplacementTarget,
    },
  })
}

export async function loadNoteContent({ path }: LoadNoteContentRequest): Promise<string> {
  return (await createVaultBackend().files.read(path)).content
}

export async function reloadVaultAfterRename(reloadVault?: () => Promise<unknown>): Promise<void> {
  if (!reloadVault) return
  try {
    await reloadVault()
  } catch (err) {
    console.warn('Failed to reload vault after rename:', err)
  }
}

/** Reload content for open tabs whose wikilinks may have changed after a rename. */
export async function reloadTabsAfterRename({
  tabPaths,
  updateTabContent,
}: ReloadTabsAfterRenameRequest): Promise<void> {
  for (const tabPath of tabPaths) {
    try {
      updateTabContent(tabPath, await loadNoteContent({ path: tabPath }))
    } catch {
      /* skip tabs that fail to reload */
    }
  }
}

interface Tab {
  entry: VaultEntry
  content: string
}

function findRenameEntry(entries: VaultEntry[], tabs: Tab[], path: string): VaultEntry | undefined {
  return findByNotePath(entries, path) ?? tabs.find((tab) => notePathsMatch(tab.entry.path, path))?.entry
}

function resolveRenameVaultPath(entry: VaultEntry | undefined, fallbackVaultPath: string): string {
  return entry ? vaultPathForEntry(entry, fallbackVaultPath) : fallbackVaultPath
}

export interface NoteRenameConfig {
  entries: VaultEntry[]
  setToastMessage: (msg: string | null) => void
  reloadVault?: () => Promise<unknown>
  onPathRenamed?: (oldPath: string, newPath: string) => void
}

interface RenameTabDeps {
  tabs: Tab[]
  setTabs: React.Dispatch<React.SetStateAction<Tab[]>>
  activeTabPathRef: React.MutableRefObject<string | null>
  handleSwitchTab: (path: string) => void
  updateTabContent: (path: string, content: string) => void
}

interface ApplyRenameOptions {
  successMessage?: (result: RenameResult) => string
}

function useRenameResultApplier(config: NoteRenameConfig, tabDeps: RenameTabDeps) {
  const { entries, setToastMessage, reloadVault, onPathRenamed } = config
  const { setTabs, activeTabPathRef, handleSwitchTab, updateTabContent } = tabDeps

  const tabsRef = useRef(tabDeps.tabs)
  useLayoutEffect(() => {
    tabsRef.current = tabDeps.tabs
  }, [tabDeps.tabs])

  const applyRenameResult = useCallback(
    async (
    oldPath: string,
    result: RenameResult,
    buildEntry: (entry: VaultEntry | undefined, newPath: string) => VaultEntry,
    onEntryRenamed: (oldPath: string, newEntry: Partial<VaultEntry> & { path: string }, newContent: string) => void,
    options?: ApplyRenameOptions,
  ) => {
    const currentTabs = tabsRef.current
    const entry = findRenameEntry(entries, currentTabs, oldPath)
    const newContent = await loadNoteContent({ path: result.new_path })
    const newEntry = buildEntry(entry, result.new_path)
    const otherTabPaths = currentTabs
      .filter((tab) => !notePathsMatch(tab.entry.path, oldPath) && !notePathsMatch(tab.entry.path, result.new_path))
      .map((tab) => tab.entry.path)
    if (!notePathsMatch(oldPath, result.new_path)) onPathRenamed?.(oldPath, result.new_path)
      setTabs((prev) =>
        prev.map((tab) => (notePathsMatch(tab.entry.path, oldPath) ? { entry: newEntry, content: newContent } : tab)),
      )
    if (notePathsMatch(activeTabPathRef.current, oldPath)) handleSwitchTab(result.new_path)
    onEntryRenamed(oldPath, newEntry, newContent)
      await reloadTabsAfterRename({
        tabPaths: otherTabPaths,
        updateTabContent,
      })
    await reloadVaultAfterRename(reloadVault)
    const successMessage = options?.successMessage
      ? options.successMessage(result)
      : renameToastMessage(result.updated_files, result.failed_updates ?? 0)
    setToastMessage(successMessage)
    return result
    },
    [
      entries,
      setTabs,
      activeTabPathRef,
      handleSwitchTab,
      updateTabContent,
      reloadVault,
      setToastMessage,
      onPathRenamed,
    ],
  )

  return {
    tabsRef,
    applyRenameResult,
  }
}

async function runRenameAction(options: {
  path: string
  perform: () => Promise<RenameResult>
  applyRenameResult: (
    oldPath: string,
    result: RenameResult,
    buildEntry: (entry: VaultEntry | undefined, newPath: string) => VaultEntry,
    onEntryRenamed: (oldPath: string, newEntry: Partial<VaultEntry> & { path: string }, newContent: string) => void,
    options?: ApplyRenameOptions,
  ) => Promise<RenameResult>
  buildEntry: (entry: VaultEntry | undefined, newPath: string) => VaultEntry
  onEntryRenamed: (oldPath: string, newEntry: Partial<VaultEntry> & { path: string }, newContent: string) => void
  setToastMessage: (message: string | null) => void
  errorMessage: (err: unknown) => string
  logLabel: string
  successMessage?: (result: RenameResult) => string
  allowUnchangedResult?: boolean
}): Promise<RenameResult | null> {
  const { path, perform, applyRenameResult, buildEntry, onEntryRenamed, setToastMessage, errorMessage, logLabel, successMessage, allowUnchangedResult = false } = options
  try {
    const result = await perform()
    if (allowUnchangedResult && notePathsMatch(result.new_path, path)) return result
    await applyRenameResult(path, result, buildEntry, onEntryRenamed, {
      successMessage,
    })
    return result
  } catch (err) {
    console.error(`${logLabel}:`, err)
    setToastMessage(errorMessage(err))
    return null
  }
}

type ApplyRenameResult = ReturnType<typeof useRenameResultApplier>['applyRenameResult']

function useWorkspaceMoveHandler({
  applyRenameResult,
  entries,
  setToastMessage,
  tabsRef,
}: {
  applyRenameResult: ApplyRenameResult
  entries: VaultEntry[]
  setToastMessage: (message: string | null) => void
  tabsRef: React.MutableRefObject<Tab[]>
}) {
  return useCallback(
    async (
    path: string,
    destinationWorkspace: WorkspaceIdentity,
    vaultPath: string,
    onEntryRenamed: (oldPath: string, newEntry: Partial<VaultEntry> & { path: string }, newContent: string) => void,
  ) => {
    const entry = findRenameEntry(entries, tabsRef.current, path)
    if (!entry) {
      setToastMessage('Failed to move note: note not found')
      return null
    }

    const sourceVaultPath = resolveRenameVaultPath(entry, vaultPath)
    if (sourceVaultPath === destinationWorkspace.path) {
      return { new_path: path, updated_files: 0, failed_updates: 0 }
    }

    return runRenameAction({
      path,
        perform: () =>
          performMoveNoteToWorkspace({
        path,
        sourceVaultPath,
        destinationVaultPath: destinationWorkspace.path,
            replacementTarget: workspaceMoveReplacementTarget({
              entry,
              sourceVaultPath,
              destinationWorkspace,
            }),
      }),
      applyRenameResult,
        buildEntry: (currentEntry, newPath) =>
          buildWorkspaceMovedEntry(currentEntry ?? entry, newPath, destinationWorkspace),
      onEntryRenamed,
      setToastMessage,
      errorMessage: moveNoteErrorMessage,
      logLabel: 'Failed to move note to workspace',
        successMessage: (result) =>
          moveWorkspaceToastMessage(destinationWorkspace.label, result.updated_files, result.failed_updates ?? 0),
      allowUnchangedResult: true,
    })
    },
    [applyRenameResult, entries, setToastMessage, tabsRef],
  )
}

interface LocalRenameHandlerContext {
  applyRenameResult: ReturnType<typeof useRenameResultApplier>['applyRenameResult']
  entries: VaultEntry[]
  setToastMessage: NoteRenameConfig['setToastMessage']
  tabsRef: ReturnType<typeof useRenameResultApplier>['tabsRef']
}

function useLocalRenameHandler(context: LocalRenameHandlerContext, mode: 'title' | 'filename') {
  const { applyRenameResult, entries, setToastMessage, tabsRef } = context
  return useCallback(
    async (
      path: string,
      value: string,
      vaultPath: string,
      onEntryRenamed: (oldPath: string, newEntry: Partial<VaultEntry> & { path: string }, newContent: string) => void,
    ) => {
      const entry = findRenameEntry(entries, tabsRef.current, path)
      const renameVaultPath = resolveRenameVaultPath(entry, vaultPath)
      const perform = mode === 'title'
        ? () => performRename({ path, newTitle: value, vaultPath: renameVaultPath, oldTitle: entry?.title })
        : () => performFilenameRename({ path, newFilenameStem: value, vaultPath: renameVaultPath })
      const buildEntry = mode === 'title'
        ? (currentEntry: VaultEntry | undefined, newPath: string) => buildRenamedEntry(currentEntry ?? ({} as VaultEntry), value, newPath)
        : (currentEntry: VaultEntry | undefined, newPath: string) => buildFilenameRenamedEntry(currentEntry ?? ({} as VaultEntry), newPath)
      await runRenameAction({
        path,
        perform,
        applyRenameResult,
        buildEntry,
        onEntryRenamed,
        setToastMessage,
        errorMessage: renameErrorMessage,
        logLabel: mode === 'title' ? 'Failed to rename note' : 'Failed to rename note filename',
      })
    },
    [applyRenameResult, entries, mode, setToastMessage, tabsRef],
  )
}

export function useNoteRename(config: NoteRenameConfig, tabDeps: RenameTabDeps) {
  const { entries, setToastMessage } = config
  const { tabsRef, applyRenameResult } = useRenameResultApplier(config, tabDeps)
  const handlerContext = { applyRenameResult, entries, setToastMessage, tabsRef }
  const handleRenameNote = useLocalRenameHandler(handlerContext, 'title')
  const handleRenameFilename = useLocalRenameHandler(handlerContext, 'filename')

  const handleMoveNoteToFolder = useCallback(
    async (
      path: string,
      folderPath: string,
      vaultPath: string,
      onEntryRenamed: (oldPath: string, newEntry: Partial<VaultEntry> & { path: string }, newContent: string) => void,
    ) => {
    const normalizedFolderPath = normalizeVaultRelativePath(folderPath)
    const entry = findRenameEntry(entries, tabsRef.current, path)
    const moveVaultPath = resolveRenameVaultPath(entry, vaultPath)
    return runRenameAction({
      path,
        perform: () =>
          performMoveNoteToFolder({
            path,
            folderPath: normalizedFolderPath,
            vaultPath: moveVaultPath,
          }),
      applyRenameResult,
      buildEntry: (currentEntry, newPath) => buildFilenameRenamedEntry(currentEntry ?? ({} as VaultEntry), newPath),
      onEntryRenamed,
      setToastMessage,
      errorMessage: moveNoteErrorMessage,
      logLabel: 'Failed to move note to folder',
        successMessage: (result) =>
          moveToastMessage(normalizedFolderPath, result.updated_files, result.failed_updates ?? 0),
      allowUnchangedResult: true,
    })
    },
    [entries, tabsRef, applyRenameResult, setToastMessage],
  )

  const handleMoveNoteToWorkspace = useWorkspaceMoveHandler({
    applyRenameResult,
    entries,
    setToastMessage,
    tabsRef,
  })

  return {
    handleRenameNote,
    handleRenameFilename,
    handleMoveNoteToFolder,
    handleMoveNoteToWorkspace,
    tabsRef,
  }
}
