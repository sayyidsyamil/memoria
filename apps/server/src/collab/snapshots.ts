import type { DocId } from '../docIndex.ts'
import type { BlobStore } from '../store.ts'

/**
 * A live document outlives a restart as a snapshot: the Yjs state, plus the file version it
 * was in step with. Keeping the Yjs state (instead of rebuilding from markdown) matters for
 * clients that reconnect: their copy and the server's must share one history to merge.
 */
export interface Snapshot {
  state: Uint8Array
  /** The markdown file the document was last in step with, and its etag. */
  base: { markdown: string; revision: string }
}

const SNAPSHOT_VERSION = 1

function stateKey(docId: DocId): string {
  return `collab/${docId}/state.bin`
}

function baseKey(docId: DocId): string {
  return `collab/${docId}/base.json`
}

function parseBase(bytes: Uint8Array): Snapshot['base'] | null {
  try {
    const { version, markdown, revision } = JSON.parse(Buffer.from(bytes).toString('utf8')) as Record<string, unknown>
    if (version !== SNAPSHOT_VERSION || typeof markdown !== 'string' || typeof revision !== 'string') return null
    return { markdown, revision }
  } catch {
    return null
  }
}

export class SnapshotStore {
  private readonly store: BlobStore

  constructor(store: BlobStore) {
    this.store = store
  }

  /** The stored snapshot, or null when there is none or it cannot be read: rebuild from the file. */
  async load(docId: DocId): Promise<Snapshot | null> {
    const [state, base] = await Promise.all([this.store.get(stateKey(docId)), this.store.get(baseKey(docId))])
    const parsed = base ? parseBase(base) : null
    return state && parsed ? { state, base: parsed } : null
  }

  async save(docId: DocId, { state, base }: Snapshot): Promise<void> {
    await this.store.put(baseKey(docId), Buffer.from(JSON.stringify({ version: SNAPSHOT_VERSION, ...base })))
    await this.store.put(stateKey(docId), state)
  }

  async delete(docId: DocId): Promise<void> {
    await Promise.all([this.store.delete(stateKey(docId)), this.store.delete(baseKey(docId))])
  }
}
