import type { MobileWorkspaceEditResult } from './mobileWorkspaceEditing'
import type {
  MobilePropertyDisplayMode,
  MobileWorkspaceSnapshot,
} from './mobileWorkspaceModel'
import { mobileVaultConfigWithPropertyDisplayMode } from './mobileVaultConfig'

export type MobilePropertyDisplayModeEdit = {
  key: string
  mode: MobilePropertyDisplayMode | null
}

export function applyMobilePropertyDisplayModeEdit(
  snapshot: MobileWorkspaceSnapshot,
  edit: MobilePropertyDisplayModeEdit,
): MobileWorkspaceEditResult {
  const vaultConfig = mobileVaultConfigWithPropertyDisplayMode(snapshot.vaultConfig, edit.key, edit.mode)
  const previousMode = snapshot.vaultConfig?.propertyDisplayModes?.[edit.key] ?? null
  const nextMode = vaultConfig.propertyDisplayModes?.[edit.key] ?? null
  if (previousMode === nextMode) return { snapshot, writes: [] }

  return {
    snapshot: {
      ...snapshot,
      vaultConfig,
    },
    writes: [{ config: vaultConfig, kind: 'saveVaultConfig' }],
  }
}
