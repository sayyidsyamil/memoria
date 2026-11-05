import { beforeEach, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => {
  const values = { version: 1 }
  return { values, create: vi.fn((root: string) => ({
    promises: { readFile: async () => `${root}:${values.version}`, stat: async () => ({ size: values.version }) },
  })) }
})
vi.mock('./expoGitFileSystem', () => ({ createExpoGitFileSystem: state.create }))
vi.mock('expo-crypto', () => ({ randomUUID: () => 'unused' }))
vi.mock('./managedCatalogFile.native', () => ({ readManagedCatalogFile: vi.fn(), writeManagedCatalogFile: vi.fn() }))
vi.mock('expo-file-system', () => ({
  Paths: { document: 'file:///isolated-app' },
  Directory: class { uri: string; constructor(...parts: string[]) { this.uri = parts.join('/') } },
}))

let connection: typeof import('./managedGitStorage.native')['managedGitConnection']
beforeEach(async () => {
  vi.resetModules()
  state.create.mockClear()
  state.values.version = 1
  connection = (await import('./managedGitStorage.native')).managedGitConnection
})
const vault = (id: string) => ({ id, label: id, repositoryUrl: 'https://github.com/team/vault.git' })

it('reuses only the filesystem adapter while bytes and metadata stay fresh', async () => {
  const first = connection(vault('vault-a'))
  expect(await first.fs.promises.readFile('/vault/note.md')).toBe('file:///isolated-app/Git Vaults/vault-a:1')
  state.values.version = 2
  const next = connection(vault('vault-a'))
  expect(next.fs).toBe(first.fs)
  expect(state.create).toHaveBeenCalledTimes(1)
  expect(await next.fs.promises.readFile('/vault/note.md')).toBe('file:///isolated-app/Git Vaults/vault-a:2')
  expect(await next.fs.promises.stat('/vault/note.md')).toMatchObject({ size: 2 })
  expect(next.operationKey).toBe(first.operationKey)
  expect(next).not.toHaveProperty('cache')
  expect(next).not.toHaveProperty('token')
})

it('keeps different vault roots separate', async () => {
  const a = connection(vault('vault-a'))
  const b = connection(vault('vault-b'))
  expect(a.fs).not.toBe(b.fs)
  expect(a.operationKey).not.toBe(b.operationKey)
  expect(await b.fs.promises.readFile('/vault/note.md')).toBe('file:///isolated-app/Git Vaults/vault-b:1')
  expect(await a.fs.promises.readFile('/vault/note.md')).toBe('file:///isolated-app/Git Vaults/vault-a:1')
})

it('retains only the most recent root instead of pinning two large vaults', () => {
  const a = connection(vault('vault-a')).fs
  expect(connection(vault('vault-a')).fs).toBe(a)
  const b = connection(vault('vault-b')).fs
  expect(connection(vault('vault-b')).fs).toBe(b)
  expect(connection(vault('vault-a')).fs).not.toBe(a)
  expect(state.create).toHaveBeenCalledTimes(3)
})

it('does not retain a failed factory result or prevent retry', () => {
  state.create.mockImplementationOnce(() => { throw new Error('nativeUnavailable') })
  expect(() => connection(vault('vault-a'))).toThrow('nativeUnavailable')
  expect(connection(vault('vault-a')).fs).toBeDefined()
  expect(state.create).toHaveBeenCalledTimes(2)
})

it('preserves the working session if a different root cannot be opened', () => {
  const a = connection(vault('vault-a')).fs
  state.create.mockImplementationOnce(() => { throw new Error('nativeUnavailable') })
  expect(() => connection(vault('vault-b'))).toThrow('nativeUnavailable')
  expect(connection(vault('vault-a')).fs).toBe(a)
  expect(connection(vault('vault-b')).fs).not.toBe(a)
})
