import { beforeEach, expect, it, vi } from 'vitest'
import type { ManagedGitVaultCatalog } from './managedGitVaults'
import { activateManagedGitVault, forgetManagedVault } from './managedGitStorage.native'
import { activateManagedLocalVault, initializeLocalVaultCatalog, managedLocalSelection, rememberLocalVault } from './managedLocalStorage.native'

const disk = vi.hoisted(() => ({
  catalog: { vaults: [], activeId: null } as ManagedGitVaultCatalog,
  directories: new Set<string>(), copies: [] as string[], counter: 0, legacy: true,
}))
vi.mock('expo-crypto', () => ({ randomUUID: () => `test-${++disk.counter}` }))
vi.mock('./expoGitFileSystem', () => ({ createExpoGitFileSystem: () => ({}) }))
vi.mock('./managedCatalogFile.native', () => ({
  readManagedCatalogFile: async () => structuredClone(disk.catalog),
  writeManagedCatalogFile: async (catalog: ManagedGitVaultCatalog) => { disk.catalog = structuredClone(catalog) },
}))
vi.mock('../nativeWorkspacePicker', () => ({
  restoreNativeWorkspaceDirectory: async () => disk.legacy ? { vaultLabel: 'Legacy', vaultRootUri: 'file:///documents/Memoria%20Vault/' } : null,
}))
vi.mock('expo-file-system', () => ({
  Paths: { document: { uri: 'file:///documents/' } },
  Directory: class {
    uri: string
    constructor(...parts: (string | { uri: string })[]) {
      this.uri = parts.map(part => typeof part === 'string' ? part : part.uri).map(part => part.replace(/\/$/u, '')).join('/')
    }
    get exists() { return disk.directories.has(this.uri) }
    get parentDirectory() { return { create: () => {} } }
    copy(destination: { uri: string }) { disk.copies.push(destination.uri); disk.directories.add(destination.uri) }
  },
}))

beforeEach(() => {
  disk.catalog = { vaults: [], activeId: null }
  disk.directories = new Set(['file:///documents/Memoria Vault'])
  disk.copies = []; disk.counter = 0; disk.legacy = true
})

it('registers the legacy import in place once and does not resurrect a forgotten vault', async () => {
  const migrated = await initializeLocalVaultCatalog()
  expect(migrated.activeLocalId).toBe('local-legacy')
  expect(disk.copies).toEqual([])
  await forgetManagedVault('local-legacy')
  expect((await initializeLocalVaultCatalog()).localVaults).toEqual([])
  expect(disk.directories.has('file:///documents/Memoria Vault')).toBe(true)
})

it('remembers independent local copies and switches without overwriting or deleting files', async () => {
  await initializeLocalVaultCatalog()
  const imported = await rememberLocalVault({ vaultAlias: null, vaultLabel: 'Second', vaultRootUri: 'content://provider/second' })
  expect(imported.directory).toBe('Local Vaults/local-test-1')
  const directories = [...disk.directories]
  expect((await managedLocalSelection(imported)).vaultLabel).toBe('Second')
  const legacy = disk.catalog.localVaults?.[0]
  if (!legacy) throw new Error('Legacy import missing')
  await activateManagedLocalVault(legacy)
  expect(disk.catalog.activeLocalId).toBe(legacy.id)
  await activateManagedLocalVault(imported)
  expect(disk.catalog.activeLocalId).toBe(imported.id)
  await forgetManagedVault(imported.id)
  expect(disk.catalog.activeLocalId).toBeNull()
  expect([...disk.directories]).toEqual(directories)
})

it('keeps Git active during migration and clears the other active pointer when switching', async () => {
  disk.catalog = { vaults: [{ id: 'git-one', label: 'Git', repositoryUrl: 'https://github.com/team/notes.git' }], activeId: 'git-one' }
  const migrated = await initializeLocalVaultCatalog()
  expect(migrated.activeId).toBe('git-one')
  expect(migrated.activeLocalId).toBeNull()
  const local = migrated.localVaults?.[0]
  if (!local) throw new Error('Local missing')
  await activateManagedLocalVault(local)
  expect(disk.catalog.activeId).toBeNull()
  await activateManagedGitVault('git-one')
  expect(disk.catalog.activeLocalId).toBeNull()
  await forgetManagedVault('git-one')
  expect(disk.catalog.activeId).toBeNull()
  expect(disk.catalog.localVaults).toHaveLength(1)
})

it('refuses a missing local directory without replacing the active selection', async () => {
  await initializeLocalVaultCatalog()
  const before = structuredClone(disk.catalog)
  await expect(activateManagedLocalVault({ id: 'missing', label: 'Missing', directory: 'Local Vaults/missing' })).rejects.toThrow('vaultNotFound')
  expect(disk.catalog).toEqual(before)
})
