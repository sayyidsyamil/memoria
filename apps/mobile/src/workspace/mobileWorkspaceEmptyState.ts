import type { MobileWorkspaceSnapshot } from './mobileWorkspaceModel'

export function mobileWorkspaceHasNoVault(snapshot: MobileWorkspaceSnapshot): boolean {
  return snapshot.sync.kind === 'noVault'
}
