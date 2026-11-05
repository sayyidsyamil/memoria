import { createHash } from 'node:crypto'
import { promisify } from 'node:util'
import { gunzip as gunzipCallback, gzip as gzipCallback } from 'node:zlib'
import type { BlobStore } from './store.ts'

// zlib's thread pool, so compressing a snapshot never blocks requests.
const gzip = promisify(gzipCallback)
const gunzip = promisify(gunzipCallback)

/**
 * Snapshots of the server's indexes in a remote store, so a server on a fresh disk (a container
 * that slept, or moved) loads them instead of rebuilding them from every file of the vault.
 *
 * Reads go to the local store first; a key that is not there yet is seeded from the remote
 * copy, which is fetched as soon as the store is created so it downloads while the vault
 * clones. Writes stay local. `publish()` uploads what changed since the last upload or seed.
 * Remote copies are gzipped: the search index holds every note's text and shrinks about 10×.
 * A snapshot only saves time: it carries its own head commit and format version, and an index
 * that cannot use it (unknown commit, other version, unreadable) rebuilds as before.
 */
export class SnapshotSeededStore implements BlobStore {
  private readonly local: BlobStore
  private readonly remote: BlobStore
  private readonly prefix: string
  private readonly log: (message: string) => void
  private readonly seeds = new Map<string, Promise<Uint8Array | null>>()
  /** Digest of what the remote holds for each key, as far as this process knows. */
  private readonly published = new Map<string, string>()

  constructor(options: { local: BlobStore; remote: BlobStore; prefix: string; keys: string[]; log?: (message: string) => void }) {
    this.local = options.local
    this.remote = options.remote
    this.prefix = options.prefix
    this.log = options.log ?? (() => {})
    for (const key of options.keys) this.seeds.set(key, this.fetchSeed(key))
  }

  async get(key: string): Promise<Uint8Array | null> {
    const stored = await this.local.get(key)
    if (stored) return stored
    return (await this.seeds.get(key)) ?? null
  }

  put(key: string, bytes: Uint8Array): Promise<void> {
    return this.local.put(key, bytes)
  }

  delete(key: string): Promise<void> {
    return this.local.delete(key)
  }

  list(prefix: string): Promise<string[]> {
    return this.local.list(prefix)
  }

  /** Uploads every snapshot key whose local value differs from the remote one. Never throws. */
  async publish(): Promise<void> {
    for (const key of this.seeds.keys()) {
      try {
        const bytes = await this.local.get(key)
        if (!bytes) continue
        const digest = sha256(bytes)
        if (this.published.get(key) === digest) continue
        const started = performance.now()
        const packed = await gzip(bytes)
        await this.remote.put(this.remoteKey(key), packed)
        this.published.set(key, digest)
        this.log(`index snapshot ${key} published (${packed.length} bytes gzipped, ${Math.round(performance.now() - started)} ms)`)
      } catch (error) {
        this.log(`index snapshot ${key} not published: ${message(error)}`)
      }
    }
  }

  private async fetchSeed(key: string): Promise<Uint8Array | null> {
    const started = performance.now()
    try {
      const packed = await this.remote.get(this.remoteKey(key))
      if (!packed) {
        this.log(`index snapshot ${key}: none yet (${Math.round(performance.now() - started)} ms)`)
        return null
      }
      const bytes = new Uint8Array(await gunzip(packed))
      this.published.set(key, sha256(bytes))
      this.log(`index snapshot ${key} fetched (${packed.length} bytes gzipped, ${Math.round(performance.now() - started)} ms)`)
      return bytes
    } catch (error) {
      this.log(`index snapshot ${key} not fetched: ${message(error)}`)
      return null
    }
  }

  private remoteKey(key: string): string {
    return `${this.prefix}/${key}.gz`
  }
}

function sha256(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex')
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/**
 * A short digest of the server's code, from the bundle it runs. Part of the snapshot prefix,
 * so a server never loads a snapshot that other code wrote: an index format that changes
 * without a version bump is still never misread.
 */
export function codeFingerprint(code: Uint8Array): string {
  return createHash('sha256').update(code).digest('hex').slice(0, 16)
}
