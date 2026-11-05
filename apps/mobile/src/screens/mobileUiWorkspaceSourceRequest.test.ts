import { afterEach, expect, it, vi } from 'vitest'
import { mobileRepositoryForProbes, mobileRepositoryRequestForProbes, mobileUiWorkspaceSourceRequest } from './mobileUiWorkspaceSourceRequest'
import { readOnlyWorkspaceRepository } from '../workspace/readOnlyWorkspaceRepository'

afterEach(() => vi.unstubAllEnvs())

it('takes the active native vault identity and index instead of stale deep-link values', () => {
  const index = { directories: ['notes'], files: [] }
  const selection = { index, vaultAlias: 'active', vaultLabel: 'Active', vaultRootUri: 'file:///active' }
  const { request } = mobileUiWorkspaceSourceRequest(new URLSearchParams('vaultUri=file:///old&vaultAlias=old&vaultLabel=Old'), selection)
  expect(request).toEqual({ scenarioId: null, source: 'native', vaultAlias: 'active', vaultLabel: 'Active',
    vaultRootUri: 'file:///active', workspaceIndex: index })
})

it('preserves explicit development bridge and identity query parameters', () => {
  const params = new URLSearchParams('source=dev-vault&scenario=empty&devVaultUrl=http://localhost:9010&vaultUri=file:///dev&vaultLabel=Dev&vaultAlias=dev')
  expect(mobileUiWorkspaceSourceRequest(params, null)).toEqual({ devVaultUrl: 'http://localhost:9010', request: {
    scenarioId: 'empty', source: 'dev', vaultAlias: 'dev', vaultLabel: 'Dev', vaultRootUri: 'file:///dev', workspaceIndex: undefined,
  } })
})

it('retains environment fallbacks without overriding active vault selection', () => {
  vi.stubEnv('EXPO_PUBLIC_MEMORIA_SCENARIO', 'empty')
  vi.stubEnv('EXPO_PUBLIC_MEMORIA_WORKSPACE_SOURCE', 'dev-vault')
  vi.stubEnv('EXPO_PUBLIC_MEMORIA_DEV_VAULT_URL', 'http://localhost:9011')
  vi.stubEnv('EXPO_PUBLIC_MEMORIA_NATIVE_VAULT_URI', 'file:///environment')
  vi.stubEnv('EXPO_PUBLIC_MEMORIA_NATIVE_VAULT_LABEL', 'Environment')
  vi.stubEnv('EXPO_PUBLIC_MEMORIA_NATIVE_VAULT_ALIAS', 'env')
  expect(mobileUiWorkspaceSourceRequest(new URLSearchParams(), null)).toEqual({ devVaultUrl: 'http://localhost:9011', request: {
    scenarioId: 'empty', source: 'dev', vaultAlias: 'env', vaultLabel: 'Environment', vaultRootUri: 'file:///environment', workspaceIndex: undefined,
  } })
  const active = { vaultAlias: null, vaultLabel: 'Active', vaultRootUri: 'file:///active' }
  expect(mobileUiWorkspaceSourceRequest(new URLSearchParams(), active).request.vaultRootUri).toBe('file:///active')
})

it('does not let an absent development bridge replace a remembered native vault', () => {
  const active = { vaultAlias: null, vaultLabel: 'Active', vaultRootUri: 'file:///active' }
  expect(mobileUiWorkspaceSourceRequest(new URLSearchParams('source=dev-vault'), active).request.source).toBe('native')
})

it('preserves the ordinary repository and request when no persistence probe is active', () => {
  const probes = { workspacePersistenceProbe: false, wysiwygPersistenceProbe: false }
  const request = { source: 'native' as const, vaultRootUri: 'file:///ordinary' }
  expect(mobileRepositoryForProbes(probes)).toBe(readOnlyWorkspaceRepository)
  expect(mobileRepositoryRequestForProbes(request, probes)).toBe(request)
})

it.each([
  { workspacePersistenceProbe: true, wysiwygPersistenceProbe: false },
  { workspacePersistenceProbe: false, wysiwygPersistenceProbe: true },
])('keeps persistence QA in its own repository and identity: %j', probes => {
  const request = { source: 'host' as const, vaultRootUri: 'file:///fallback', vaultLabel: 'Ordinary' }
  const result = mobileRepositoryRequestForProbes(request, probes)
  expect(result.source).toBe('native')
  expect(result.vaultRootUri).toBeNull()
  expect(result.vaultLabel).not.toBe('Ordinary')
  expect(mobileRepositoryForProbes(probes)).not.toBe(readOnlyWorkspaceRepository)
  expect(request.source).toBe('host')
})
