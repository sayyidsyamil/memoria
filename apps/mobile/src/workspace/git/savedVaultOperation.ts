import type { createWorkspaceSyncEditors } from '../workspaceSyncEditors'
import { withSavedWorkspace } from './workspaceWriteQueue'

type SavedVaultOperation = {
  editors: ReturnType<typeof createWorkspaceSyncEditors>
  rootUri?: string
  // Unchanged permits Git metadata writes, but guarantees note files are intact.
  run: () => Promise<undefined | 'cancelled' | 'unchanged'>
  refresh: (selectedNoteId?: string) => void | Promise<void>
  deferWhileFocused?: () => boolean
}

export async function runSavedVaultOperation({ editors, rootUri, run, refresh, deferWhileFocused }: SavedVaultOperation) {
  const selectedNoteId = editors.selectedNoteId()
  const resume = await editors.prepare(deferWhileFocused?.())
  let saved = false
  let cancelled = false
  let recovered = false
  let cancelReplacement = () => {}
  try {
    if (rootUri) recovered = await withSavedWorkspace(rootUri, async changed => changed)
    saved = true
    cancelReplacement = editors.beginReplacement()
    const result = await run()
    cancelled = !recovered && (result === 'cancelled' || result === 'unchanged')
  } finally {
    if (cancelled) cancelReplacement()
    // Changed or possibly changed files require fresh editors, even after failure.
    if (saved && !cancelled) await refresh(selectedNoteId)
    else resume()
  }
}
