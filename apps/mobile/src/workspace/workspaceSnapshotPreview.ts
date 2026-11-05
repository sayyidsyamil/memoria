import type { MobileNote, MobileTypeDefinition, MobileWorkspaceSnapshot } from './mobileWorkspaceModel'
import { absoluteDate, relativeDate } from './localVaultPresentation'
import type { SnapshotCacheStorage } from './workspaceSnapshotCache'
import { readWorkspacePresentationEnvelope, type WorkspaceSnapshotIdentity } from './workspaceSnapshotEnvelope'
import { workspaceSnapshotStorage } from './workspaceSnapshotStorage'
import { mapWorkspaceItems } from './cooperativeWorkspaceItems'
import { normalizeMobileVaultConfig } from './mobileVaultConfig'

type PreviewNote = Omit<MobileNote, 'rawContent' | 'editorBlocks' | 'editorBullets'>
type PreviewType = Omit<MobileTypeDefinition, 'rawContent' | 'template'>
export type WorkspaceSnapshotPreview = Omit<MobileWorkspaceSnapshot,
  'sync' | 'notes' | 'allNotes' | 'editorBlocks' | 'editorBullets' | 'typeDefinitions'> & {
    kind: 'provisional'; notes: PreviewNote[]; allNotes: PreviewNote[]; typeDefinitions: Record<string, PreviewType>
  }

/** Presentation only: this value is intentionally not an editable workspace snapshot. */
export async function readWorkspaceSnapshotPreview(identity: WorkspaceSnapshotIdentity,
  storage: SnapshotCacheStorage | null = workspaceSnapshotStorage, signal?: AbortSignal): Promise<WorkspaceSnapshotPreview | null> {
  if (!storage || signal?.aborted) return null
  try {
    const key = await storage.digest(identity.vaultPath)
    requireActivePreview(signal)
    const record = await readWorkspacePresentationEnvelope(storage, key, identity, signal)
    requireActivePreview(signal)
    return record ? await previewMetadata({ ...record.snapshot, vaultConfig: normalizeMobileVaultConfig(identity.vaultConfig) }, signal) : null
  } catch { return null }
}

function requireActivePreview(signal?: AbortSignal) {
  if (signal?.aborted) throw new Error('workspaceLoadCancelled')
}

async function previewMetadata(snapshot: MobileWorkspaceSnapshot, signal?: AbortSignal): Promise<WorkspaceSnapshotPreview> {
  const notes = await mapWorkspaceItems(snapshot.notes, previewNote, signal)
  const allNotes = await mapWorkspaceItems(snapshot.allNotes ?? [], previewNote, signal)
  return {
    kind: 'provisional', source: snapshot.source,
    notes, allNotes,
    sidebarSections: snapshot.sidebarSections, folderPaths: snapshot.folderPaths,
    noteListSubtitle: snapshot.noteListSubtitle, noteListPropertyOverrides: snapshot.noteListPropertyOverrides,
    selectedNoteId: snapshot.selectedNoteId, searchQuery: snapshot.searchQuery, views: snapshot.views,
    vaultConfig: snapshot.vaultConfig,
    typeDefinitions: Object.fromEntries(Object.entries(snapshot.typeDefinitions ?? {}).map(([key, value]) => [key, previewType(value)])),
  }
}

function previewNote(note: MobileNote): PreviewNote {
  const value = { ...note, created: relativeDate(note.createdAt), modified: relativeDate(note.modifiedAt), date: absoluteDate(note.modifiedAt) }
  delete value.rawContent
  delete value.editorBlocks
  delete value.editorBullets
  return value
}

function previewType(type: MobileTypeDefinition): PreviewType {
  const value = { ...type }
  delete value.rawContent
  delete value.template
  return value
}
