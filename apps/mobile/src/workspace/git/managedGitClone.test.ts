import { beforeEach, expect, it, vi } from 'vitest'
import { cloneManagedGitVault } from './managedGitStorage.native'

const state = vi.hoisted(() => ({ clone: vi.fn(), publish: vi.fn(), removed: vi.fn(), directories: new Set<string>() }))
vi.mock('expo-crypto', () => ({ randomUUID: () => 'new-clone' }))
vi.mock('./expoGitFileSystem', () => ({ createExpoGitFileSystem: () => ({}) }))
vi.mock('./gitRemote', () => ({ cloneGitVault: state.clone }))
vi.mock('./managedCatalogFile.native', () => ({
  readManagedCatalogFile: async () => ({ vaults: [], activeId: null }), writeManagedCatalogFile: state.publish,
}))
vi.mock('expo-file-system', () => ({
  Paths: { document: 'file:///isolated-app' },
  Directory: class {
    uri: string
    constructor(...parts: string[]) { this.uri = parts.join('/') }
    get exists() { return state.directories.has(this.uri) }
    get parentDirectory() { return { create: () => {} } }
    create() { state.directories.add(this.uri) }
    delete() { state.directories.delete(this.uri); state.removed(this.uri) }
  },
}))
beforeEach(() => { vi.clearAllMocks(); state.directories.clear(); state.clone.mockReset(); state.publish.mockReset() })
const url = 'https://github.com/team/vault'
const http = { request: vi.fn() }

it('discards only the unregistered new clone when it is cancelled', async () => {
  const controller = new AbortController()
  state.clone.mockImplementation(async options => {
    expect(options.signal).toBe(controller.signal)
    throw new Error('syncDeferred')
  })
  await expect(cloneManagedGitVault(url, http, undefined, { signal: controller.signal })).rejects.toThrow('syncDeferred')
  expect(state.publish).not.toHaveBeenCalled()
  expect(state.removed).toHaveBeenCalledExactlyOnceWith('file:///isolated-app/Git Vaults/vault-new-clone')
})

it('keeps a completed clone if catalog publication fails, for recovery', async () => {
  state.publish.mockRejectedValue(new Error('catalogUnavailable'))
  await expect(cloneManagedGitVault(url, http)).rejects.toThrow('catalogUnavailable')
  expect(state.removed).not.toHaveBeenCalled()
  expect(state.directories.size).toBe(1)
})

it('forwards progress and publishes the vault only after successful clone', async () => {
  const onProgress = vi.fn()
  const onPublish = vi.fn()
  state.clone.mockImplementation(async options => {
    expect(state.publish).not.toHaveBeenCalled()
    expect(onPublish).not.toHaveBeenCalled()
    options.onProgress({ phase: 'Updating workdir', loaded: 1, total: 1 })
  })
  state.publish.mockImplementation(async () => { expect(onPublish).toHaveBeenCalledOnce() })
  const vault = await cloneManagedGitVault(url, http, undefined, { onProgress, onPublish })
  expect(onProgress).toHaveBeenCalledWith({ phase: 'Updating workdir', loaded: 1, total: 1 })
  expect(state.publish).toHaveBeenCalledWith({ vaults: [vault], activeId: null })
  expect(state.removed).not.toHaveBeenCalled()
})
