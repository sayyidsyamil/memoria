import { optionalNativeWorkspaceAccessModule } from './nativeWorkspaceAccess'
import { runNativeWorkspaceMutation } from './nativeWorkspaceMutation'

type EntryChange = { path: string; toPath?: string; directory: boolean }
type NativeEntryRecovery = {
  createWorkspaceOperationId?: () => string
  changeWorkspaceEntry?: (root: string, path: string, toPath: string | null, directory: boolean, identifier: string) => Promise<void>
}

export function changeNativeWorkspaceEntry(
  root: string, change: EntryChange,
  module: NativeEntryRecovery | null = optionalNativeWorkspaceAccessModule(),
): Promise<void> | null {
  if (!module) return null
  if (!module.changeWorkspaceEntry || !module.createWorkspaceOperationId) throw new Error('nativeEntryRecoveryUnavailable')
  const key = JSON.stringify(['entry', root, change.path, change.toPath ?? null, change.directory])
  const perform = module.changeWorkspaceEntry
  return runNativeWorkspaceMutation(module, key, module.createWorkspaceOperationId,
    (identifier) => perform(root, change.path, change.toPath ?? null, change.directory, identifier))
}
