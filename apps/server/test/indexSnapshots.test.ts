import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { gunzipSync, gzipSync } from 'node:zlib'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { codeFingerprint, SnapshotSeededStore } from '../src/indexSnapshots.ts'
import { INDEX_KEY as SEARCH_INDEX_KEY, SearchIndex } from '../src/searchIndex.ts'
import { type BlobStore, LocalDiskStore } from '../src/store.ts'
import { Vault } from '../src/vault.ts'
import { INDEX_KEY as VAULT_INDEX_KEY, VaultIndex } from '../src/vaultIndex.ts'
import { createFixture, type Fixture, text } from './helpers.ts'

/** The remote end of the snapshots: a bucket in memory that counts what it is asked. */
class MemoryStore implements BlobStore {
  readonly objects = new Map<string, Uint8Array>()
  puts = 0
  failing = false

  async get(key: string): Promise<Uint8Array | null> {
    if (this.failing) throw new Error('bucket unavailable')
    return this.objects.get(key) ?? null
  }

  async put(key: string, bytes: Uint8Array): Promise<void> {
    if (this.failing) throw new Error('bucket unavailable')
    this.puts++
    this.objects.set(key, bytes)
  }

  async delete(key: string): Promise<void> {
    this.objects.delete(key)
  }

  async list(prefix: string): Promise<string[]> {
    return [...this.objects.keys()].filter((key) => key.startsWith(`${prefix}/`))
  }
}

const KEYS = [VAULT_INDEX_KEY, SEARCH_INDEX_KEY]
const PREFIX = 'vaults/test/abc'

/** Puts a snapshot into the remote store as the server would: gzipped, under `<key>.gz`. */
function setRemote(remote: MemoryStore, key: string, value: string): void {
  remote.objects.set(`${PREFIX}/${key}.gz`, gzipSync(value))
}

function getRemote(remote: MemoryStore, key: string): string {
  return gunzipSync(remote.objects.get(`${PREFIX}/${key}.gz`) as Uint8Array).toString()
}

describe('SnapshotSeededStore', () => {
  let fixture: Fixture
  let remote: MemoryStore
  let messages: string[]

  beforeEach(async () => {
    fixture = await createFixture()
    remote = new MemoryStore()
    messages = []
  })

  afterEach(() => fixture.cleanup())

  function seeded(name: string): { store: SnapshotSeededStore; local: LocalDiskStore } {
    const local = new LocalDiskStore(join(fixture.root, name, 'state'))
    const store = new SnapshotSeededStore({ local, remote, prefix: PREFIX, keys: KEYS, log: (m) => messages.push(m) })
    return { store, local }
  }

  it('seeds a key from the remote until the local store has its own', async () => {
    setRemote(remote, VAULT_INDEX_KEY, 'remote')
    const { store, local } = seeded('a')
    expect(Buffer.from((await store.get(VAULT_INDEX_KEY)) as Uint8Array).toString()).toBe('remote')
    expect(await store.get(SEARCH_INDEX_KEY)).toBeNull()

    await store.put(VAULT_INDEX_KEY, text('local'))
    expect(Buffer.from((await store.get(VAULT_INDEX_KEY)) as Uint8Array).toString()).toBe('local')
    expect(Buffer.from((await local.get(VAULT_INDEX_KEY)) as Uint8Array).toString()).toBe('local')
    expect(remote.puts).toBe(0)
  })

  it('keeps every other key local, and never seeds it', async () => {
    setRemote(remote, 'doc-index.json', 'remote')
    const { store } = seeded('a')
    expect(await store.get('doc-index.json')).toBeNull()
    await store.put('docs/one', text('1'))
    expect(await store.list('docs')).toEqual(['docs/one'])
    await store.delete('docs/one')
    expect(await store.list('docs')).toEqual([])
    await store.publish()
    expect(remote.puts).toBe(0)
  })

  it('publishes only what differs from the remote copy', async () => {
    setRemote(remote, VAULT_INDEX_KEY, 'same')
    const { store } = seeded('a')
    await store.get(VAULT_INDEX_KEY)
    await store.put(VAULT_INDEX_KEY, text('same'))
    await store.publish()
    expect(remote.puts).toBe(0)

    await store.put(VAULT_INDEX_KEY, text('newer'))
    await store.put(SEARCH_INDEX_KEY, text('search'))
    await store.publish()
    await store.publish()
    expect(remote.puts).toBe(2)
    expect(getRemote(remote, SEARCH_INDEX_KEY)).toBe('search')
  })

  it('starts without snapshots and never fails when the remote does', async () => {
    remote.failing = true
    const { store } = seeded('a')
    expect(await store.get(VAULT_INDEX_KEY)).toBeNull()
    await store.put(VAULT_INDEX_KEY, text('local'))
    await expect(store.publish()).resolves.toBeUndefined()
    expect(messages.join('\n')).toMatch(/vault-index.json not fetched: bucket unavailable/)
    expect(messages.join('\n')).toMatch(/vault-index.json not published: bucket unavailable/)
  })

  it('ignores a remote copy that is not gzip', async () => {
    remote.objects.set(`${PREFIX}/${VAULT_INDEX_KEY}.gz`, text('plain'))
    const { store } = seeded('a')
    expect(await store.get(VAULT_INDEX_KEY)).toBeNull()
    expect(messages.join('\n')).toMatch(/vault-index.json not fetched: incorrect header check/)
  })

  it('fingerprints code by its content', () => {
    expect(codeFingerprint(text('a'))).toMatch(/^[0-9a-f]{16}$/)
    expect(codeFingerprint(text('a'))).toBe(codeFingerprint(text('a')))
    expect(codeFingerprint(text('a'))).not.toBe(codeFingerprint(text('b')))
  })
})

describe('indexes on a fresh disk', () => {
  let fixture: Fixture
  let remote: MemoryStore
  let messages: string[]
  let servers = 0

  beforeEach(async () => {
    fixture = await createFixture()
    remote = new MemoryStore()
    messages = []
  })

  afterEach(() => fixture.cleanup())

  /** A server that starts on an empty disk: a new clone and an empty local store. */
  async function freshServer(): Promise<{ vault: Vault; store: SnapshotSeededStore; reads: () => number }> {
    const dir = join(fixture.root, `server-${++servers}`)
    const vault = await Vault.open({ dir: join(dir, 'vault'), remoteUrl: fixture.remote, pushDebounceMs: 0, fetchIntervalMs: 0 })
    const local = new LocalDiskStore(join(dir, 'state'))
    const store = new SnapshotSeededStore({ local, remote, prefix: PREFIX, keys: KEYS })
    const read = vi.spyOn(vault, 'read')
    return { vault, store, reads: () => read.mock.calls.length }
  }

  async function openBoth(server: { vault: Vault; store: BlobStore }): Promise<{ index: VaultIndex; search: SearchIndex }> {
    const log = (m: string): void => {
      messages.push(m)
    }
    return { index: await VaultIndex.open(server.vault, server.store, log), search: await SearchIndex.open(server.vault, server.store, log) }
  }

  it('loads the published snapshots instead of reading every file', async () => {
    const first = await freshServer()
    const built = await openBoth(first)
    expect(first.reads()).toBeGreaterThan(0)
    await first.store.publish()
    expect(remote.puts).toBe(2)

    const second = await freshServer()
    const loaded = await openBoth(second)
    expect(second.reads()).toBe(0)
    expect(loaded.index.getAll()).toEqual(built.index.getAll())
    expect(await loaded.search.search('heron', 10)).toEqual(await built.search.search('heron', 10))
    expect((await loaded.search.search('heron', 10)).results.map((result) => result.path)).toEqual(['projects/alpha.md'])
    // Nothing changed, so there is nothing new to publish.
    await second.store.publish()
    expect(remote.puts).toBe(2)
  })

  it('catches a stale snapshot up with the files changed since, then publishes it', async () => {
    const first = await freshServer()
    await openBoth(first)
    await first.store.publish()
    const before = (await openBoth(first)).index.getAll().entries.map((entry) => entry.path)

    await fixture.desktop.commit('fresh.md', '# Fresh\n\nwritten on the desktop with quokka\n')
    await fixture.desktop.commit(before[0], null)

    const second = await freshServer()
    const { index, search } = await openBoth(second)
    // One file changed, for each of the two indexes; the deleted one is not read.
    expect(second.reads()).toBe(2)
    expect(messages).toContain('vault index caught up with 2 changed file(s)')
    expect(messages).toContain('search index caught up with 2 changed file(s)')
    const { head, entries } = index.getAll()
    expect(head).toBe((await second.vault.info()).head)
    expect(entries.map((entry) => entry.path)).toContain('fresh.md')
    expect(entries.map((entry) => entry.path)).not.toContain(before[0])
    expect((await search.search('quokka', 10)).results.map((result) => result.path)).toEqual(['fresh.md'])

    await second.store.publish()
    expect(remote.puts).toBe(4)
  })

  it('catches up across commits that leave the files as they were', async () => {
    const first = await freshServer()
    await openBoth(first)
    await first.store.publish()
    await fixture.desktop.run(['pull', '-q', '--ff-only'])
    await fixture.desktop.run(['commit', '-q', '--allow-empty', '-m', 'nothing'])
    await fixture.desktop.run(['push', '-q', 'hub', 'HEAD:refs/heads/main'])

    const second = await freshServer()
    const { index } = await openBoth(second)
    expect(second.reads()).toBe(0)
    expect(index.getAll().head).toBe((await second.vault.info()).head)
    expect(messages).toContain('vault index caught up with 0 changed file(s)')
  })

  it('rebuilds when too much changed since the snapshot', async () => {
    const first = await freshServer()
    await openBoth(first)
    await first.store.publish()
    await fixture.desktop.run(['pull', '-q', '--ff-only'])
    await mkdir(join(fixture.desktop.dir, 'bulk'))
    for (let i = 0; i < 501; i++) await writeFile(join(fixture.desktop.dir, 'bulk', `n${i}.md`), `# Note ${i}\n`)
    await fixture.desktop.run(['add', '-A'])
    await fixture.desktop.run(['commit', '-q', '-m', 'bulk import'])
    await fixture.desktop.run(['push', '-q', 'hub', 'HEAD:refs/heads/main'])

    const second = await freshServer()
    const { index } = await openBoth(second)
    expect(messages.filter((m) => m.includes('caught up'))).toEqual([])
    expect(index.getAll().entries.filter((entry) => entry.path.startsWith('bulk/'))).toHaveLength(501)
  })

  it.each([
    ['a head this clone does not have', (stored: Record<string, unknown>) => ({ ...stored, head: 'f'.repeat(40) }), null],
    ['a head that is no commit id', (stored: Record<string, unknown>) => ({ ...stored, head: 'HEAD~1' }), null],
    ['another format version', (stored: Record<string, unknown>) => ({ ...stored, version: 99 }), /unsupported (vault|search) index version: 99/],
    ['no index object', () => [], /index is malformed: not an index object/],
  ])('rebuilds from the files over a snapshot with %s', async (_case, mutate, logged) => {
    const first = await freshServer()
    await openBoth(first)
    await first.store.publish()
    for (const key of KEYS) {
      const stored = JSON.parse(getRemote(remote, key)) as Record<string, unknown>
      setRemote(remote, key, JSON.stringify(mutate(stored)))
    }

    const second = await freshServer()
    const { index, search } = await openBoth(second)
    expect(second.reads()).toBeGreaterThan(0)
    expect(index.getAll().head).toBe((await second.vault.info()).head)
    expect((await search.search('heron', 10)).results.length).toBeGreaterThan(0)
    if (logged) expect(messages.join('\n')).toMatch(logged)
  })

  it('rebuilds over a snapshot that is not JSON', async () => {
    for (const key of KEYS) setRemote(remote, key, '{not json')
    const server = await freshServer()
    const { index } = await openBoth(server)
    expect(index.getAll().entries.length).toBeGreaterThan(0)
    expect(messages).toContain('rebuilding the vault index: vault index is malformed: not valid JSON')
    expect(messages).toContain('rebuilding the search index: search index is malformed: not valid JSON')
  })

  it('saves a freshly built index, so a restart on the same disk reads no file', async () => {
    const vault = await fixture.openVault({ fetchIntervalMs: 0 })
    const store = new LocalDiskStore(join(fixture.root, 'state'))
    await openBoth({ vault, store })
    expect(await store.get(VAULT_INDEX_KEY)).not.toBeNull()
    expect(await store.get(SEARCH_INDEX_KEY)).not.toBeNull()

    const read = vi.spyOn(vault, 'read')
    await openBoth({ vault, store })
    expect(read).not.toHaveBeenCalled()
  })
})
