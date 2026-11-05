import type { NativeWorkspaceSelection } from '../workspace/nativeWorkspacePicker'
import { readOnlyWorkspaceRepository, type ReadOnlyWorkspaceRequest } from '../workspace/readOnlyWorkspaceRepository'
import { nativeWorkspacePersistenceProbeRepository, nativeWorkspacePersistenceProbeRequest } from '../qa/nativeWorkspacePersistenceProbeRepository'
import { nativeWysiwygPersistenceProbeRepository, nativeWysiwygPersistenceProbeRequest } from '../qa/nativeWysiwygPersistenceProbeRepository'
import { mobileUiRequestedWorkspaceSource } from './mobileUiLabWorkspaceResolution'

type PersistenceProbes = { workspacePersistenceProbe: boolean; wysiwygPersistenceProbe: boolean }

export function mobileUiWorkspaceSourceRequest(searchParams: URLSearchParams, nativeWorkspace: NativeWorkspaceSelection | null) {
  const devVaultUrl = searchParams.get('devVaultUrl') || envValue('EXPO_PUBLIC_MEMORIA_DEV_VAULT_URL')
  const source = mobileUiRequestedWorkspaceSource({
    hasDevVaultUrl: devVaultUrl !== null,
    hasNativeWorkspace: nativeWorkspace !== null,
    requestedSource: searchParams.get('source') ?? envValue('EXPO_PUBLIC_MEMORIA_WORKSPACE_SOURCE'),
    searchParams,
  })
  const request = {
    scenarioId: searchParams.get('scenario') || envValue('EXPO_PUBLIC_MEMORIA_SCENARIO'),
    source,
    vaultAlias: nativeWorkspace ? nativeWorkspace.vaultAlias : queryOrEnv(searchParams, 'vaultAlias', 'EXPO_PUBLIC_MEMORIA_NATIVE_VAULT_ALIAS'),
    vaultLabel: nativeWorkspace ? nativeWorkspace.vaultLabel : queryOrEnv(searchParams, 'vaultLabel', 'EXPO_PUBLIC_MEMORIA_NATIVE_VAULT_LABEL'),
    vaultRootUri: nativeWorkspace ? nativeWorkspace.vaultRootUri : queryOrEnv(searchParams, 'vaultUri', 'EXPO_PUBLIC_MEMORIA_NATIVE_VAULT_URI'),
    workspaceIndex: nativeWorkspace?.index,
  }
  return { devVaultUrl, request }
}

export function mobileRepositoryForProbes({ workspacePersistenceProbe, wysiwygPersistenceProbe }: PersistenceProbes) {
  if (workspacePersistenceProbe) return nativeWorkspacePersistenceProbeRepository(readOnlyWorkspaceRepository)
  if (wysiwygPersistenceProbe) return nativeWysiwygPersistenceProbeRepository(readOnlyWorkspaceRepository)
  return readOnlyWorkspaceRepository
}

export function mobileRepositoryRequestForProbes(request: ReadOnlyWorkspaceRequest,
  { workspacePersistenceProbe, wysiwygPersistenceProbe }: PersistenceProbes) {
  if (workspacePersistenceProbe) return nativeWorkspacePersistenceProbeRequest(request)
  if (wysiwygPersistenceProbe) return nativeWysiwygPersistenceProbeRequest(request)
  return request
}

function queryOrEnv(searchParams: URLSearchParams, query: string, env: string) {
  return searchParams.get(query) || envValue(env)
}

function envValue(name: string) {
  const processGlobal = globalThis as { process?: { env?: Record<string, string | undefined> } }
  return processGlobal.process?.env?.[name] ?? null
}
