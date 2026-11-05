import type { ActiveVault } from './useManagedVaultCatalog'
import { hasPreparedWorkspaceSnapshot } from '../preparedWorkspaceSnapshot'

export function refreshedVault(next: ActiveVault, previous: ActiveVault, selectedNoteId?: string): ActiveVault {
  if (!next.selection) return next
  const index = hasPreparedWorkspaceSnapshot(next.selection.index) ? next.selection.index : undefined
  const selection = { ...next.selection, index }
  if (selection.vaultRootUri === previous.selection?.vaultRootUri) selection.selectedNoteId = selectedNoteId
  return { ...next, selection }
}
