import { useWorkspaceAutoSync, type WorkspaceAutoSyncOptions } from '../useWorkspaceAutoSync'

export function useMobileAutoGit(options: WorkspaceAutoSyncOptions) {
  useWorkspaceAutoSync(options, 30_000, 120_000)
}
