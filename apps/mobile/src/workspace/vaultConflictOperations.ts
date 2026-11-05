import type { ActiveVault } from './git/useManagedVaultCatalog'
import { managedGitConnection } from './git/managedGitStorage'
import { createGitVault, type GitAuthor } from './git/gitVault'
import { inspectGitConflicts, resolveGitConflicts, type GitConflictReview } from './git/gitConflictResolution'
import { inspectLinkedConflicts, resolveLinkedConflicts, type LinkedConflictReview } from './linkedConflictReview'
import { withSavedWorkspace } from './git/workspaceWriteQueue'
import type { SyncConflictChoices } from './syncConflictModel'

export type VaultConflictReview = { kind: 'git'; value: GitConflictReview } | { kind: 'folder'; value: LinkedConflictReview }

export async function inspectVaultConflicts(active: ActiveVault, author: GitAuthor, checkpoint: boolean): Promise<VaultConflictReview> {
  if (!active.selection) throw new Error('syncConflictInvalid')
  const root = active.selection.vaultRootUri
  return withSavedWorkspace(root, async () => {
    if (!active.git) return { kind: 'folder', value: await inspectLinkedConflicts(root) }
    const connection = managedGitConnection(active.git)
    if (checkpoint) await createGitVault(connection).checkpoint(author)
    return { kind: 'git', value: await inspectGitConflicts(connection) }
  })
}

export async function resolveVaultConflicts(active: ActiveVault, review: VaultConflictReview, choices: SyncConflictChoices, author: GitAuthor) {
  if (!active.selection) throw new Error('syncConflictInvalid')
  const root = active.selection.vaultRootUri
  return withSavedWorkspace(root, async () => {
    if (review.kind === 'git') {
      if (!active.git) throw new Error('syncConflictStale')
      return resolveGitConflicts(managedGitConnection(active.git), review.value, choices, author)
    }
    await resolveLinkedConflicts(root, review.value, choices)
    return null
  })
}
