import { beforeEach, expect, it, vi } from 'vitest'

const disk = vi.hoisted(() => ({
  available: true, entries: new Map<string, { text: string; size: number; modified: number; directory?: boolean }>(),
  read: vi.fn(), write: vi.fn(), info: vi.fn(), list: vi.fn(), remove: vi.fn(), mkdir: vi.fn(), digest: vi.fn(),
}))
const root = 'file:///application/Cache/memoria-workspace-snapshots/'
const key = (index: number) => index.toString(16).padStart(64, '0')
vi.mock('expo-crypto', () => ({ CryptoDigestAlgorithm: { SHA256: 'SHA-256' }, digestStringAsync: disk.digest }))
vi.mock('expo-application', () => ({ nativeApplicationVersion: '1.0', nativeBuildVersion: '123' }))
vi.mock('expo-file-system/legacy', () => ({
  get cacheDirectory() { return disk.available ? 'file:///application/Cache/' : null },
  getInfoAsync: disk.info, readAsStringAsync: disk.read, writeAsStringAsync: disk.write,
  makeDirectoryAsync: disk.mkdir, readDirectoryAsync: disk.list, deleteAsync: disk.remove,
}))

beforeEach(() => {
  vi.resetModules()
  vi.clearAllMocks()
  disk.available = true
  disk.entries.clear()
  disk.digest.mockResolvedValue('a'.repeat(64))
  disk.read.mockImplementation(async uri => disk.entries.get(uri)?.text)
  disk.write.mockImplementation(async (uri, text) => {
    disk.entries.set(uri, { text, size: text.length, modified: 100 })
  })
  disk.info.mockImplementation(async uri => {
    const entry = disk.entries.get(uri)
    return entry ? { exists: true, isDirectory: Boolean(entry.directory), size: entry.size, modificationTime: entry.modified } : { exists: false }
  })
  disk.list.mockImplementation(async directory => [...disk.entries.keys()].filter(uri => uri.startsWith(directory)).map(uri => uri.slice(directory.length)))
  disk.remove.mockImplementation(async uri => { disk.entries.delete(uri) })
})

it('uses SHA-256 and only its private disposable cache directory', async () => {
  const { workspaceSnapshotStorage: storage } = await import('./workspaceSnapshotStorage.native')
  expect(storage.revision).toBe('1.0:123')
  expect(await storage.digest('input')).toBe('a'.repeat(64))
  expect(disk.digest).toHaveBeenCalledWith('SHA-256', 'input')
  expect(await storage.read(key(1))).toBeNull()
  await storage.write(key(1), 'snapshot')
  expect(await storage.read(key(1))).toBe('snapshot')
  expect(disk.mkdir).toHaveBeenCalledWith(root, { intermediates: true })
  expect(disk.write).toHaveBeenCalledWith(`${root}${key(1)}.json`, 'snapshot')
})

it.each(['../vault', 'file:///vault/note.md', 'A'.repeat(64), 'a'.repeat(63)])('rejects an invalid cache key: %s', async invalid => {
  const { workspaceSnapshotStorage: storage } = await import('./workspaceSnapshotStorage.native')
  await expect(storage.read(invalid)).rejects.toThrow('invalidSnapshotCacheKey')
  await expect(storage.write(invalid, 'snapshot')).rejects.toThrow('invalidSnapshotCacheKey')
  expect(disk.read).not.toHaveBeenCalled()
  expect(disk.write).not.toHaveBeenCalled()
})

it('checks size and file kind before loading a cache string', async () => {
  const { workspaceSnapshotStorage: storage } = await import('./workspaceSnapshotStorage.native')
  disk.entries.set(`${root}${key(1)}.json`, { text: '', size: 33 * 1024 * 1024, modified: 1 })
  disk.entries.set(`${root}${key(2)}.json`, { text: '', size: 0, modified: 1, directory: true })
  expect(await storage.read(key(1))).toBeNull()
  expect(await storage.read(key(2))).toBeNull()
  expect(disk.read).not.toHaveBeenCalled()
})

it('keeps at most three recent recognized cache files without touching unknown entries or vault files', async () => {
  const { workspaceSnapshotStorage: storage } = await import('./workspaceSnapshotStorage.native')
  for (let i = 1; i <= 5; i++) disk.entries.set(`${root}${key(i)}.json`, { text: 'old', size: 3, modified: i })
  disk.entries.set(`${root}unknown.json`, { text: 'unknown', size: 7, modified: 1 })
  disk.entries.set(`${root}${key(9)}.json`, { text: '', size: 0, modified: 1, directory: true })
  disk.entries.set('file:///vault/note.md', { text: '# Original', size: 10, modified: 1 })
  await storage.write(key(1), 'current')
  for (const i of [1, 4, 5]) expect(disk.entries.has(`${root}${key(i)}.json`)).toBe(true)
  for (const i of [2, 3]) expect(disk.entries.has(`${root}${key(i)}.json`)).toBe(false)
  expect(disk.entries.has(`${root}unknown.json`)).toBe(true)
  expect(disk.entries.has(`${root}${key(9)}.json`)).toBe(true)
  expect(disk.entries.get('file:///vault/note.md')?.text).toBe('# Original')
  expect(disk.remove.mock.calls.every(([uri]) => uri.startsWith(root))).toBe(true)
})

it('also bounds the aggregate recognized cache bytes', async () => {
  const { workspaceSnapshotStorage: storage } = await import('./workspaceSnapshotStorage.native')
  for (let i = 1; i <= 4; i++) disk.entries.set(`${root}${key(i)}.json`, { text: 'old', size: 20 * 1024 * 1024, modified: i })
  await storage.write(key(1), 'current')
  expect([...disk.entries.values()].reduce((total, entry) => total + entry.size, 0)).toBeLessThanOrEqual(32 * 1024 * 1024)
  expect(disk.entries.has(`${root}${key(1)}.json`)).toBe(true)
})

it('declines oversized writes before making a directory or encoding the payload', async () => {
  const { workspaceSnapshotStorage: storage } = await import('./workspaceSnapshotStorage.native')
  await storage.write(key(1), 'x'.repeat(Math.ceil(32 * 1024 * 1024 / 3) + 1))
  expect(disk.mkdir).not.toHaveBeenCalled()
  expect(disk.write).not.toHaveBeenCalled()
})

it('does not choose an arbitrary filesystem location if the cache directory is unavailable', async () => {
  disk.available = false
  const { workspaceSnapshotStorage: storage } = await import('./workspaceSnapshotStorage.native')
  await expect(storage.read(key(1))).rejects.toThrow('invalidSnapshotCacheKey')
  await expect(storage.write(key(1), 'snapshot')).rejects.toThrow('invalidSnapshotCacheKey')
  expect(disk.read).not.toHaveBeenCalled()
  expect(disk.write).not.toHaveBeenCalled()
})
