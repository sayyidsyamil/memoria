import type { NativeWorkspaceSelection } from '../nativeWorkspacePicker'
import { readManagedGitCatalog } from './managedGitStorage'
import type { ManagedLocalVault } from './managedLocalVaults'

export const initializeLocalVaultCatalog = readManagedGitCatalog
export async function rememberLocalVault(selection: NativeWorkspaceSelection): Promise<ManagedLocalVault> { void selection; throw new Error('nativeOnly') }
export async function activateManagedLocalVault(vault: ManagedLocalVault): Promise<NativeWorkspaceSelection> { void vault; throw new Error('nativeOnly') }
export const managedLocalSelection = activateManagedLocalVault
