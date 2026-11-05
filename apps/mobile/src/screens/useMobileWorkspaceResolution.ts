import { useMemo } from 'react'
import { resolveMobileUiWorkspace } from './mobileUiLabWorkspaceResolution'

export function useMobileWorkspaceResolution(
  input: Parameters<typeof resolveMobileUiWorkspace>[0],
  revision?: object | null,
) {
  const { scenarioId, source: requestSource, vaultAlias, vaultLabel, vaultRootUri, workspaceIndex } = input.repositoryRequest
  const repositoryRequest = useMemo(() => ({
    scenarioId, source: requestSource, vaultAlias, vaultLabel, vaultRootUri, workspaceIndex,
  }), [scenarioId, requestSource, vaultAlias, vaultLabel, vaultRootUri, workspaceIndex])
  const { devVaultState, persistenceProbeEnabled, probeRepository, source } = input
  return useMemo(() => ({
    ...resolveMobileUiWorkspace({ devVaultState, persistenceProbeEnabled, probeRepository, repositoryRequest, source }),
    repositoryRequest,
    revision,
  }), [devVaultState, persistenceProbeEnabled, probeRepository, repositoryRequest, source, revision])
}
