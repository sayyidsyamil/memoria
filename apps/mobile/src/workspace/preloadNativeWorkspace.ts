import { optionalNativeWorkspaceAccessModule, type NativeWorkspaceAccessModule, type NativeWorkspaceIndex } from './nativeWorkspaceAccess'
import type { NativeWorkspaceSelection } from './nativeWorkspacePicker'

export async function preloadNativeWorkspace(
  selection: NativeWorkspaceSelection | null,
  module: Pick<NativeWorkspaceAccessModule, 'readWorkspaceIndex'> | null = optionalNativeWorkspaceAccessModule(),
): Promise<NativeWorkspaceSelection | null> {
  if (!selection || selection.index || !module?.readWorkspaceIndex) return selection
  const readIndex = module.readWorkspaceIndex
  const value: Partial<NativeWorkspaceIndex> = JSON.parse(await readIndex(selection.vaultRootUri))
  if (!Array.isArray(value.directories) || !Array.isArray(value.files)) throw new Error('invalidWorkspaceIndex')
  const index = { directories: value.directories, files: value.files }
  return { ...selection, index }
}
