import { useEffect, useRef, useState } from 'react'
import { APP_STORAGE_KEYS } from '../constants/appStorage'
import type { VaultEntry } from '../types'
import { notePathsMatch } from '../utils/notePathIdentity'
import { markStartupPhase } from '../lib/startupPerformance'

interface LastActiveNoteOptions {
  activeTabPath: string | null
  enabled: boolean
  entries: VaultEntry[]
  isVaultLoading: boolean
  openNote: (entry: VaultEntry) => Promise<void>
  /** Wins over the stored note when it names one, e.g. the note in a shared web URL. */
  preferredEntry?: (entries: VaultEntry[]) => VaultEntry | undefined
}

type CompleteRestoration = () => void

function loadLastActiveNotePath(): string | null {
  try {
    return localStorage.getItem(APP_STORAGE_KEYS.lastActiveNotePath)
  } catch {
    return null
  }
}

function saveLastActiveNotePath(path: string | null): void {
  try {
    if (path) {
      localStorage.setItem(APP_STORAGE_KEYS.lastActiveNotePath, path)
    } else {
      localStorage.removeItem(APP_STORAGE_KEYS.lastActiveNotePath)
    }
  } catch {
    // Ignore unavailable or restricted localStorage implementations.
  }
}

function findStoredEntry(entries: VaultEntry[], storedPath: string | null): VaultEntry | undefined {
  return storedPath ? entries.find((entry) => notePathsMatch(entry.path, storedPath)) : undefined
}

function restoreLastActiveNote(
  options: Pick<LastActiveNoteOptions, 'activeTabPath' | 'entries' | 'openNote' | 'preferredEntry'>,
  complete: CompleteRestoration,
): void {
  if (options.activeTabPath) {
    complete()
    return
  }

  const storedPath = loadLastActiveNotePath()
  const storedEntry = options.preferredEntry?.(options.entries) ?? findStoredEntry(options.entries, storedPath)
  if (!storedEntry) {
    if (storedPath) saveLastActiveNotePath(null)
    complete()
    return
  }

  markStartupPhase('last_active_note_restore_started')
  void options.openNote(storedEntry).then(() => {
    markStartupPhase('last_active_note_restored')
    complete()
  }, () => {
    saveLastActiveNotePath(null)
    complete()
  })
}

export function useLastActiveNote({
  activeTabPath,
  enabled,
  entries,
  isVaultLoading,
  openNote,
  preferredEntry,
}: LastActiveNoteOptions): boolean {
  const restoreAttemptedRef = useRef(!enabled)
  const [restorationComplete, setRestorationComplete] = useState(!enabled)

  useEffect(() => {
    if (!enabled || isVaultLoading || restoreAttemptedRef.current) return

    const timer = window.setTimeout(() => {
      restoreAttemptedRef.current = true
      restoreLastActiveNote(
        { activeTabPath, entries, openNote, preferredEntry },
        () => { setRestorationComplete(true); },
      )
    }, 0)

    return () => { window.clearTimeout(timer); }
  }, [activeTabPath, enabled, entries, isVaultLoading, openNote, preferredEntry])

  useEffect(() => {
    if (!enabled || !restorationComplete) return
    saveLastActiveNotePath(activeTabPath)
  }, [activeTabPath, enabled, restorationComplete])

  return restorationComplete
}
