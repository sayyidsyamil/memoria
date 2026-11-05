import { afterEach, describe, expect, it, vi } from 'vitest'
import type { VaultEntry } from '../../protocol/src/index.ts'
import { clearCache, entriesCacheKey, readCache, writeCache } from '../src/entriesCache.ts'
import { prefetchCache, takeCache } from '../src/entriesCachePrefetch.ts'

function fakeIndexedDb() {
  const records = new Map<string, unknown>()
  const database = {
    objectStoreNames: { contains: () => records.has('__store__') },
    createObjectStore: () => records.set('__store__', true),
    close: () => {},
    transaction: () => {
      const transaction: { oncomplete?: () => void; onerror?: () => void; error?: Error; objectStore?: () => unknown } = {}
      transaction.objectStore = () => ({
          get: (key: string) => request((req) => { req.result = records.get(key) }),
          put: (value: unknown, key: string) => request((req) => {
            records.set(key, value)
            req.result = key
            queueMicrotask(() => transaction.oncomplete?.())
          }),
          delete: (key: string) => request(() => {
            records.delete(key)
            queueMicrotask(() => transaction.oncomplete?.())
          }),
          clear: () => request(() => {
            for (const key of [...records.keys()]) if (key !== '__store__') records.delete(key)
            queueMicrotask(() => transaction.oncomplete?.())
          }),
        })
      return transaction
    },
  }

  return {
    records,
    factory: {
      open: () => {
        const req: Record<string, unknown> = {}
        queueMicrotask(() => {
          req.result = database
          ;(req.onupgradeneeded as ((event: unknown) => void) | undefined)?.({ target: { result: database } })
          ;(req.onsuccess as (() => void) | undefined)?.()
        })
        return req
      },
    } as unknown as IDBFactory,
  }
}

function request(run: (request: Record<string, unknown>) => void) {
  const req: Record<string, unknown> = {}
  queueMicrotask(() => {
    run(req)
    ;(req.onsuccess as (() => void) | undefined)?.()
  })
  return req
}

function entry(path: string): VaultEntry {
  return {
    path,
    filename: path.split('/').at(-1) ?? path,
    title: path,
    fileSize: 1,
    snippet: '',
    wordCount: 0,
    hasH1: false,
    fileKind: 'markdown',
  }
}

afterEach(() => vi.unstubAllGlobals())

describe('web entries cache', () => {
  it('is a no-op when IndexedDB is unavailable', async () => {
    vi.stubGlobal('indexedDB', undefined)
    await expect(readCache()).resolves.toBeNull()
    await expect(writeCache('head', [])).resolves.toBeUndefined()
    await expect(clearCache()).resolves.toBeUndefined()
  })

  it('round-trips and clears the cached snapshot', async () => {
    const indexedDb = fakeIndexedDb()
    vi.stubGlobal('indexedDB', indexedDb.factory)

    await writeCache('head-1', [entry('notes/one.md')])
    const snapshot = await readCache()

    expect(snapshot).toMatchObject({ head: 'head-1', entries: [{ path: 'notes/one.md' }] })
    expect(snapshot?.cachedAt).toEqual(expect.any(Number))
    await clearCache()
    await expect(readCache()).resolves.toBeNull()
  })

  it('treats a blocked database open as an unavailable cache', async () => {
    vi.stubGlobal('indexedDB', { open: () => {
      const req: Record<string, unknown> = { error: new Error('blocked') }
      queueMicrotask(() => (req.onerror as (() => void) | undefined)?.())
      return req
    } })

    await expect(readCache()).resolves.toBeNull()
    await expect(writeCache('head', [])).resolves.toBeUndefined()
    await expect(clearCache()).resolves.toBeUndefined()
  })

  it('returns cached entries immediately and persists background deltas in chunks', async () => {
    const indexedDb = fakeIndexedDb()
    vi.stubGlobal('indexedDB', indexedDb.factory)
    const cachedEntries = [...Array.from({ length: 51 }, (_, i) => entry(`old/${i}.md`)), entry('keep.md')]
    await writeCache('head-old', cachedEntries)
    vi.resetModules()
    const { createRemoteVaultBackend } = await import('../src/remoteVaultBackend.ts')
    const changed = Array.from({ length: 51 }, (_, i) => entry(`new/${i}.md`))
    let deltaRequests = 0
    const backend = createRemoteVaultBackend({
      baseUrl: 'https://vault.invalid',
      token: 'test-token',
      fetch: async (input) => {
        expect(String(input)).toContain('?since=head-old')
        deltaRequests += 1
        return new Response(JSON.stringify({ head: 'head-new', changed, deleted: cachedEntries.slice(0, 51).map(({ path }) => path) }))
      },
    })

    const immediate = await backend.files.list()
    expect(immediate).toHaveLength(52)
    expect(immediate.some(({ path }) => path === 'old/0.md')).toBe(true)

    await vi.waitFor(async () => {
      expect((await readCache())?.head).toBe('head-new')
    })
    const updated = await readCache()
    expect(deltaRequests).toBe(1)
    expect(updated?.entries).toHaveLength(52)
    expect(updated?.entries.some(({ path }) => path === 'old/0.md')).toBe(false)
    expect(updated?.entries.some(({ path }) => path === 'new/50.md')).toBe(true)
    expect(updated?.entries.some(({ path }) => path === 'keep.md')).toBe(true)
  })

  it('keeps the own vault under its old key and each shared vault under one of its own', () => {
    expect(entriesCacheKey('')).toBe('snapshot')
    expect(entriesCacheKey('https://memoria.example')).toBe('snapshot')
    expect(entriesCacheKey('https://memoria.example/vaults/v_1')).toBe('snapshot:/vaults/v_1')
  })

  it('keeps the snapshots of two vaults apart, and clears them all', async () => {
    const indexedDb = fakeIndexedDb()
    vi.stubGlobal('indexedDB', indexedDb.factory)
    const shared = entriesCacheKey('https://memoria.example/vaults/v_1')

    await writeCache('own-head', [entry('own.md')])
    await writeCache('shared-head', [entry('shared.md')], shared)

    expect((await readCache())?.head).toBe('own-head')
    expect((await readCache(shared))?.head).toBe('shared-head')
    await clearCache()
    await expect(readCache()).resolves.toBeNull()
    await expect(readCache(shared)).resolves.toBeNull()
  })

  it('hands a prefetched read only to the vault it was started for', async () => {
    const indexedDb = fakeIndexedDb()
    vi.stubGlobal('indexedDB', indexedDb.factory)
    const shared = entriesCacheKey('https://memoria.example/vaults/v_1')
    await writeCache('own-head', [entry('own.md')])
    await writeCache('shared-head', [entry('shared.md')], shared)

    prefetchCache()
    expect((await takeCache(shared))?.head).toBe('shared-head')
    prefetchCache(shared)
    expect((await takeCache(shared))?.head).toBe('shared-head')
  })
})
