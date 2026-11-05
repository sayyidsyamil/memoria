import { useCallback, useEffect, useRef, type MutableRefObject } from 'react'
import { createVaultBackend } from '../lib/vaultBackend'
import type { VaultEntry } from '../types'
import { isActiveElementInsideEditorSurface } from '../utils/appOrchestration'
import { refreshNoteWindowVaultChanges } from '../utils/noteWindowVaultRefresh'
import { notePathsMatch } from '../utils/notePathIdentity'
import type { NoteWindowParams } from '../utils/windowMode'
import { refreshPulledVaultState } from '../utils/pulledVaultRefresh'
import { vaultPathForEntry } from '../utils/workspaces'
import type { Tab } from './useTabManagement'
import type { useVaultLoader } from './useVaultLoader'

type RefreshableVault = Pick<
  ReturnType<typeof useVaultLoader>,
  'addEntry' | 'reloadFolders' | 'reloadVault' | 'reloadViews' | 'unsavedPaths' | 'updateEntry'
>

interface VaultRefreshHandlersOptions {
  closeAllTabs: () => void
  handleReplaceActiveTab: (entry: VaultEntry) => Promise<void>
  noteActiveTabPath: string | null
  noteActiveTabPathRef: MutableRefObject<string | null>
  noteWindowParams: NoteWindowParams | null
  refreshGitModifiedFiles: () => Promise<unknown>
  resolvedPath: string
  tabs: Tab[]
  vault: RefreshableVault
  visibleEntries: VaultEntry[]
}

function refocusActiveEditor(path: string) {
  window.dispatchEvent(new CustomEvent('laputa:focus-editor', { detail: { path } }))
}

function useActiveTabContentCheck(tabs: Tab[], resolvedPath: string) {
  const noteTabsRef = useRef(tabs)
  useEffect(() => {
    noteTabsRef.current = tabs
  }, [tabs])
  return useCallback(async (path: string) => {
    const activeTab = noteTabsRef.current.find((tab) => notePathsMatch(tab.entry.path, path))
    if (!activeTab) return false

    const vaultPath = vaultPathForEntry(activeTab.entry, resolvedPath)

    try {
      const backend = createVaultBackend(vaultPath)
      const { content } = await backend.files.read(activeTab.entry.path)
      return content === activeTab.content
    } catch (error) {
      console.warn('Failed to compare active tab content before vault refresh:', error)
      return false
    }
  }, [resolvedPath])
}

interface VaultUpdateDeps extends VaultRefreshHandlersOptions {
  isActiveTabContentCurrent: (path: string) => Promise<boolean>
}

function useFullVaultUpdate(deps: VaultUpdateDeps) {
  const {
    closeAllTabs,
    handleReplaceActiveTab,
    isActiveTabContentCurrent,
    noteActiveTabPath,
    noteActiveTabPathRef,
    refreshGitModifiedFiles,
    resolvedPath,
    vault,
  } = deps
  return useCallback(async (
    updatedFiles: string[],
    options: { vaultPath?: string } = {},
  ) => {
    const updateVaultPath = options.vaultPath ?? resolvedPath
    const entries = await refreshPulledVaultState({
      activeTabPath: noteActiveTabPath,
      closeAllTabs,
      getActiveTabPath: () => noteActiveTabPathRef.current,
      hasUnsavedChanges: (path) => vault.unsavedPaths.has(path),
      isActiveTabContentCurrent,
      reloadFolders: vault.reloadFolders,
      reloadVault: vault.reloadVault,
      reloadViews: vault.reloadViews,
      replaceActiveTab: handleReplaceActiveTab,
      refocusActiveEditor,
      shouldRefocusActiveEditor: isActiveElementInsideEditorSurface,
      updatedFiles,
      vaultPath: updateVaultPath,
    })
    await refreshGitModifiedFiles()
    return entries
  }, [
    closeAllTabs,
    handleReplaceActiveTab,
    isActiveTabContentCurrent,
    noteActiveTabPath,
    noteActiveTabPathRef,
    refreshGitModifiedFiles,
    resolvedPath,
    vault.reloadFolders,
    vault.reloadVault,
    vault.reloadViews,
    vault.unsavedPaths,
  ])
}

function useFocusedVaultUpdate(
  deps: VaultUpdateDeps,
  handleVaultUpdate: (updatedFiles: string[]) => Promise<VaultEntry[]>,
) {
  const {
    closeAllTabs,
    handleReplaceActiveTab,
    isActiveTabContentCurrent,
    noteActiveTabPath,
    noteActiveTabPathRef,
    noteWindowParams,
    resolvedPath,
    vault,
    visibleEntries,
  } = deps
  return useCallback(async (updatedFiles: string[]) => {
    if (!noteWindowParams) {
      await handleVaultUpdate(updatedFiles)
      return
    }

    await refreshNoteWindowVaultChanges({
      activeTabPath: noteActiveTabPath,
      applyEntry: (entry) => {
        if (visibleEntries.some((current) => notePathsMatch(current.path, entry.path))) {
          vault.updateEntry(entry.path, entry)
        } else {
          vault.addEntry(entry)
        }
      },
      closeAllTabs,
      currentEntries: visibleEntries,
      getActiveTabPath: () => noteActiveTabPathRef.current,
      hasUnsavedChanges: (path) => vault.unsavedPaths.has(path),
      isActiveTabContentCurrent,
      paths: updatedFiles,
      refreshFullVault: handleVaultUpdate,
      reloadEntry: async (path) => {
        const backend = createVaultBackend(resolvedPath)
        return backend.files.reloadEntry(path)
      },
      replaceActiveTab: handleReplaceActiveTab,
      refocusActiveEditor,
      shouldRefocusActiveEditor: isActiveElementInsideEditorSurface,
      vaultPath: resolvedPath,
    })
  }, [
    closeAllTabs,
    handleReplaceActiveTab,
    handleVaultUpdate,
    isActiveTabContentCurrent,
    noteActiveTabPath,
    noteActiveTabPathRef,
    noteWindowParams,
    resolvedPath,
    vault,
    visibleEntries,
  ])
}

/** Refreshes vault state and the active tab after pulls, watcher events and note-window changes. */
export function useVaultRefreshHandlers(options: VaultRefreshHandlersOptions) {
  const isActiveTabContentCurrent = useActiveTabContentCheck(options.tabs, options.resolvedPath)
  const deps = { ...options, isActiveTabContentCurrent }
  const handleVaultUpdate = useFullVaultUpdate(deps)
  const handlePulledVaultUpdate = useCallback(async (updatedFiles: string[], vaultPath: string) => {
    await handleVaultUpdate(updatedFiles, { vaultPath })
  }, [handleVaultUpdate])
  const handleFocusedVaultUpdate = useFocusedVaultUpdate(deps, handleVaultUpdate)

  return { handleFocusedVaultUpdate, handlePulledVaultUpdate, refocusActiveEditor }
}
