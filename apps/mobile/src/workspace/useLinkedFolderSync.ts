import { useWorkspaceAutoSync, type WorkspaceAutoSyncOptions } from './useWorkspaceAutoSync'

export function useLinkedFolderSync({ root, ...options }: Omit<WorkspaceAutoSyncOptions, 'enabled' | 'rootUri'> & { root?: string }) {
  useWorkspaceAutoSync({ ...options, rootUri: root, enabled: Boolean(root) }, 5_000, 60_000)
}
