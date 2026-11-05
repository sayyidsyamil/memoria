import { randomUUID } from 'node:crypto'
import type { FileEntry } from '../../../packages/protocol/src/index.ts'
import type { VaultChange } from './gitSync.ts'
import { isNote, type VaultPath, vaultPath } from './paths.ts'
import type { BlobStore } from './store.ts'

const INDEX_KEY = 'doc-index.json'
const INDEX_VERSION = 1

/** Id of a note's collaborative document: a random UUID. */
export type DocId = string

interface StoredIndex {
  version: number
  docs: [path: VaultPath, docId: DocId][]
}

function malformed(reason: string): Error {
  return new Error(`doc index is malformed: ${reason}`)
}

function parseJson(bytes: Uint8Array): unknown {
  try {
    return JSON.parse(Buffer.from(bytes).toString('utf8'))
  } catch {
    throw malformed('not valid JSON')
  }
}

function storedPath(value: unknown): VaultPath {
  try {
    return vaultPath(value)
  } catch {
    throw malformed('an entry does not name a vault path')
  }
}

function storedEntry(value: unknown): [VaultPath, DocId] {
  if (!Array.isArray(value) || value.length !== 2) throw malformed('an entry is not a [path, docId] pair')
  const [path, docId] = value as unknown[]
  if (typeof docId !== 'string' || docId === '') throw malformed('an entry has no doc id')
  return [storedPath(path), docId]
}

function storedFields(value: unknown): Partial<Record<keyof StoredIndex, unknown>> {
  if (value instanceof Object && 'version' in value) return value
  throw malformed('not an index object')
}

/** The index is server state read back from storage: nothing in it is trusted unchecked. */
function parseIndex(bytes: Uint8Array | null): Map<VaultPath, DocId> {
  if (!bytes) return new Map()
  const { version, docs } = storedFields(parseJson(bytes))
  if (version !== INDEX_VERSION) throw new Error(`unsupported doc index version: ${String(version)}`)
  if (!Array.isArray(docs)) throw malformed('no list of documents')
  return new Map(docs.map(storedEntry))
}

/**
 * Gives every note a stable id for its collaborative document. The id follows the note
 * through renames, including renames that arrive from the git remote, and is server state:
 * nothing is written into the note itself.
 */
export class DocIndex {
  private readonly store: BlobStore
  private readonly docs: Map<VaultPath, DocId>
  private dirty = false

  private constructor(store: BlobStore, docs: Map<VaultPath, DocId>) {
    this.store = store
    this.docs = docs
  }

  static async open(store: BlobStore): Promise<DocIndex> {
    return new DocIndex(store, parseIndex(await store.get(INDEX_KEY)))
  }

  docId(path: string): DocId | undefined {
    return this.docs.get(path as VaultPath)
  }

  /** The note a document belongs to, wherever renames have taken it. */
  pathOf(docId: DocId): VaultPath | undefined {
    for (const [path, id] of this.docs) {
      if (id === docId) return path
    }
    return undefined
  }

  withDocIds(files: FileEntry[]): FileEntry[] {
    return files.map((file) => this.withDocId(file))
  }

  private withDocId(file: FileEntry): FileEntry {
    const docId = this.docId(file.path)
    if (!docId) return file
    return { ...file, docId }
  }

  /** Aligns the index with the notes that exist: new notes get an id, vanished ones lose it. */
  async reconcile(paths: VaultPath[]): Promise<void> {
    const present = new Set(paths)
    for (const path of [...this.docs.keys()]) {
      if (!present.has(path)) this.forget(path)
    }
    for (const path of paths) this.ensure(path)
    await this.save()
  }

  async apply(changes: VaultChange[]): Promise<void> {
    for (const change of changes) this.applyOne(change)
    await this.save()
  }

  private applyOne(change: VaultChange): void {
    if (change.kind === 'upsert') this.ensure(change.path)
    else if (change.kind === 'delete') this.forget(change.path)
    else this.move(change.from, change.to)
  }

  private ensure(path: VaultPath): void {
    if (!isNote(path) || this.docs.has(path)) return
    this.docs.set(path, randomUUID())
    this.dirty = true
  }

  private forget(path: VaultPath): void {
    if (this.docs.delete(path)) this.dirty = true
  }

  private move(from: VaultPath, to: VaultPath): void {
    const docId = this.docs.get(from)
    this.forget(from)
    if (docId && isNote(to)) {
      this.docs.set(to, docId)
      this.dirty = true
    } else {
      this.ensure(to)
    }
  }

  private async save(): Promise<void> {
    if (!this.dirty) return
    const stored: StoredIndex = { version: INDEX_VERSION, docs: [...this.docs] }
    await this.store.put(INDEX_KEY, Buffer.from(JSON.stringify(stored)))
    this.dirty = false
  }
}
