import type { LocalVaultSnapshotOptions } from './localVaultSnapshot'
import type { MobileNote, MobileWorkspaceSnapshot } from './mobileWorkspaceModel'
import { absoluteDate, relativeDate } from './localVaultPresentation'
import { serializeMobileVaultConfig } from './mobileVaultConfig'
import { mapWorkspaceItems } from './cooperativeWorkspaceItems'
import { readWorkspaceSnapshotEnvelope, writeWorkspaceSnapshotEnvelope, workspaceSnapshotCacheVersion,
  type WorkspaceSnapshotEnvelopeContext } from './workspaceSnapshotEnvelope'

export type SnapshotCacheStorage = {
  revision?: string
  digest: (text: string) => Promise<string>
  read: (key: string) => Promise<string | null>
  write: (key: string, value: string) => Promise<void>
}

type CacheSession = { snapshot: MobileWorkspaceSnapshot | null; save: (snapshot: MobileWorkspaceSnapshot) => Promise<void> }
const uncached: CacheSession = { snapshot: null, save: async () => {} }

export async function openWorkspaceSnapshotCache(options: LocalVaultSnapshotOptions, storage: SnapshotCacheStorage | null, signal?: AbortSignal) {
  if (!storage || options.files.length < 128 || !options.files.every(file => /^[a-f0-9]{64}$/u.test(file.contentDigest ?? ''))) return uncached
  let key: string, input: string
  try {
    key = await storage.digest(options.vaultPath)
    input = await storage.digest(snapshotInput(options, storage.revision))
  } catch { return uncached }
  const snapshot = await readCachedSnapshot(storage, { key, input }, options, signal).catch(() => null)
  return { snapshot, save: (next: MobileWorkspaceSnapshot) => saveCachedSnapshot(storage, { key, input, identity: options }, next) }
}

function snapshotInput(options: LocalVaultSnapshotOptions, revision?: string) {
  const files = options.files.map(file => [file.relativePath, file.fileKind, file.contentDigest,
    file.createdAt, file.modifiedAt, file.size])
  return JSON.stringify([workspaceSnapshotCacheVersion, revision, options.vaultPath, options.vaultLabel, options.vaultAlias,
    options.maxNotes, serializeMobileVaultConfig(options.vaultConfig ?? {}), options.folderPaths ?? [], files])
}

async function readCachedSnapshot(storage: SnapshotCacheStorage, target: Pick<WorkspaceSnapshotEnvelopeContext, 'key' | 'input'>,
  options: LocalVaultSnapshotOptions, signal?: AbortSignal) {
  const record = await readWorkspaceSnapshotEnvelope(storage, target.key, options, signal)
  if (!record || record.input !== target.input) return null
  const { snapshot } = record
  if (!validSnapshot(snapshot, options)) return null
  const notes = await mapWorkspaceItems(snapshot.notes, refreshDates, signal)
  const allNotes = snapshot.allNotes ? await mapWorkspaceItems(snapshot.allNotes, refreshDates, signal) : undefined
  return { ...snapshot, notes, allNotes }
}

function validSnapshot(snapshot: MobileWorkspaceSnapshot, options: LocalVaultSnapshotOptions) {
  const files = new Map(options.files.map(file => [file.relativePath, file]))
  const notes = [...snapshot.notes, ...snapshot.allNotes ?? []]
  if (!notes.every(note => sameEditableText(note, files))) return false
  if (!snapshot.notes.every(note => typeof note.rawContent === 'string')) return false
  return Object.values(snapshot.typeDefinitions ?? {}).every(type => sameTypeSource(type, files))
}

function sameTypeSource(type: { path?: string; rawContent?: string }, files: Map<string, { content: string }>) {
  return typeof type.path === 'string' && typeof type.rawContent === 'string' && files.get(type.path)?.content === type.rawContent
}

function sameEditableText(note: MobileNote, files: Map<string, { content: string }>) {
  return note.rawContent === undefined || files.get(note.path ?? note.id)?.content === note.rawContent
}

function refreshDates(note: MobileNote): MobileNote {
  return { ...note, created: relativeDate(note.createdAt), modified: relativeDate(note.modifiedAt), date: absoluteDate(note.modifiedAt) }
}

async function saveCachedSnapshot(storage: SnapshotCacheStorage, context: WorkspaceSnapshotEnvelopeContext, snapshot: MobileWorkspaceSnapshot) {
  try {
    await writeWorkspaceSnapshotEnvelope(storage, context, snapshot)
  } catch { /* Disposable cache failure must not fail authoritative workspace preparation. */ }
}
