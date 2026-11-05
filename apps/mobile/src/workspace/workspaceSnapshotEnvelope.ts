import type { LocalVaultSnapshotOptions } from './localVaultSnapshot'
import type { MobileNote, MobileWorkspaceSnapshot } from './mobileWorkspaceModel'
import { serializeMobileVaultConfig } from './mobileVaultConfig'
import type { SnapshotCacheStorage } from './workspaceSnapshotCache'

export type WorkspaceSnapshotIdentity = Omit<LocalVaultSnapshotOptions, 'files' | 'folderPaths'>
export type WorkspaceSnapshotEnvelopeContext = { key: string; input: string; identity: WorkspaceSnapshotIdentity }
// Bump whenever parser or persisted-envelope semantics change.
export const workspaceSnapshotCacheVersion = 3
const maxPayloadCharacters = 8 * 1024 * 1024
type CacheRecord = { version: number; identity: string; input: string; payload: string; checksum: string }

function presentationIdentity(options: WorkspaceSnapshotIdentity, revision?: string) {
  return JSON.stringify([workspaceSnapshotCacheVersion, revision, options.vaultPath, options.vaultLabel,
    options.vaultAlias, options.maxNotes, serializeMobileVaultConfig(options.vaultConfig ?? {})])
}

export function readWorkspaceSnapshotEnvelope(storage: SnapshotCacheStorage, key: string,
  options: WorkspaceSnapshotIdentity, signal?: AbortSignal) {
  return readEnvelope(storage, key, { identity: options, signal })
}

/** Presentation only; callers must strip sources before exposing this record. */
export function readWorkspacePresentationEnvelope(storage: SnapshotCacheStorage, key: string,
  options: WorkspaceSnapshotIdentity, signal?: AbortSignal) {
  return readEnvelope(storage, key, { identity: options, signal, presentationOnly: true })
}

async function readEnvelope(storage: SnapshotCacheStorage, key: string,
  options: { identity: WorkspaceSnapshotIdentity; signal?: AbortSignal; presentationOnly?: boolean }) {
  const { identity, signal, presentationOnly = false } = options
  const record = await readRecord(storage, key, signal)
  if (!validRecord(record, presentationIdentity(identity, storage.revision), presentationOnly)) return null
  if (!await matchesChecksum(storage, record, signal)) return null
  const snapshot: MobileWorkspaceSnapshot = JSON.parse(record.payload)
  if (!validSnapshot(snapshot, identity)) return null
  return { input: record.input, snapshot }
}

async function readRecord(storage: SnapshotCacheStorage, key: string, signal?: AbortSignal): Promise<CacheRecord | null> {
  if (signal?.aborted) return null
  const text = await storage.read(key)
  if (signal?.aborted || !text || text.length > maxPayloadCharacters * 2 + 65536) return null
  return JSON.parse(text)
}

async function matchesChecksum(storage: SnapshotCacheStorage, record: CacheRecord, signal?: AbortSignal) {
  const checksum = await storage.digest(checksumInput(record))
  return !signal?.aborted && checksum === record.checksum
}

export async function writeWorkspaceSnapshotEnvelope(storage: SnapshotCacheStorage,
  context: WorkspaceSnapshotEnvelopeContext, snapshot: MobileWorkspaceSnapshot) {
  const payload = JSON.stringify(snapshot, (_key, value: unknown) => {
    if (typeof value === 'number' && !Number.isFinite(value)) throw new Error('unsupportedSnapshotCacheValue')
    return value
  })
  if (payload.length > maxPayloadCharacters) return
  const record = { version: workspaceSnapshotCacheVersion, identity: presentationIdentity(context.identity, storage.revision), input: context.input, payload }
  await storage.write(context.key, JSON.stringify({ ...record, checksum: await storage.digest(checksumInput(record)) }))
}

function checksumInput(record: Omit<CacheRecord, 'checksum'>) {
  return JSON.stringify([record.version, record.identity, record.input, record.payload])
}

function validRecord(record: CacheRecord | null, identity: string, presentationOnly: boolean): record is CacheRecord {
  if (!record || record.version !== workspaceSnapshotCacheVersion || !matchesIdentity(record.identity, identity, presentationOnly)) return false
  return typeof record.payload === 'string' && record.payload.length <= maxPayloadCharacters
    && validDigest(record.input) && validDigest(record.checksum)
}

function matchesIdentity(recorded: string, expected: string, presentationOnly: boolean) {
  if (!presentationOnly) return recorded === expected
  const previous: unknown = JSON.parse(recorded)
  const current: unknown[] = JSON.parse(expected)
  return Array.isArray(previous) && previous.length === current.length && typeof previous.at(-1) === 'string'
    && previous.slice(0, -1).every((field, index) => field === current[index])
}

function validDigest(value: unknown) { return typeof value === 'string' && /^[a-f0-9]{64}$/u.test(value) }

function validSnapshot(snapshot: MobileWorkspaceSnapshot | null, options: WorkspaceSnapshotIdentity): snapshot is MobileWorkspaceSnapshot {
  if (!snapshot || !sameSource(snapshot.source, options) || !hasSnapshotCollections(snapshot)) return false
  return [...snapshot.notes, ...snapshot.allNotes ?? []].every(validNote)
}

function sameSource(source: MobileWorkspaceSnapshot['source'], options: WorkspaceSnapshotIdentity) {
  return source?.kind === 'localVault' && source.vaultPath === options.vaultPath && source.label === options.vaultLabel
}

function hasSnapshotCollections(snapshot: MobileWorkspaceSnapshot) {
  const arrays = ['notes', 'allNotes', 'views', 'sidebarSections', 'editorBlocks', 'editorBullets'] as const
  return arrays.every(key => Array.isArray(snapshot[key])) && Boolean(snapshot.typeDefinitions) && Boolean(snapshot.vaultConfig)
}

function validNote(note: MobileNote | null) {
  if (!note) return false
  const strings = ['id', 'title', 'type', 'snippet', 'status', 'typeTone', 'workspace', 'created', 'modified', 'date'] as const
  const arrays = ['relationships', 'tags'] as const
  return strings.every(key => typeof note[key] === 'string') && arrays.every(key => Array.isArray(note[key]))
    && typeof note.favorite === 'boolean' && Number.isFinite(note.links)
}
