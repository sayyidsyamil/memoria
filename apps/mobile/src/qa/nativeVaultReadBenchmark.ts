import { noteListFilterCountsForSelection, notesForSidebarSelection } from '../screens/tabletWorkspaceNavigation'
import { buildCooperativeWorkspaceSnapshot } from '../workspace/cooperativeWorkspaceSnapshot'
import { applyMobileWorkspaceEditWithWrites } from '../workspace/mobileWorkspaceEditing'
import type { MobileWorkspaceSnapshot } from '../workspace/mobileWorkspaceModel'
import { preloadNativeWorkspace } from '../workspace/preloadNativeWorkspace'
import { readWorkspaceSnapshotPreview, type WorkspaceSnapshotPreview } from '../workspace/workspaceSnapshotPreview'

const fixtureMarkerName = '.memoria-mobile-qa-fixture.json'

type LargeVaultFixtureWriter = {
  createDirectory: (path: string) => void
  writeText: (path: string, content: string) => void | Promise<void>
}

type LargeVaultFixtureOptions = { batchSize?: number; noteCount?: number; yieldToInput?: () => Promise<void> }

export async function createNativeLargeVaultFixture(rootUri: string, writer: LargeVaultFixtureWriter,
  { batchSize = 16, noteCount = 6000, yieldToInput = yieldToNextTask }: LargeVaultFixtureOptions = {}) {
  if (!Number.isInteger(noteCount) || noteCount < 0 || !Number.isInteger(batchSize) || batchSize < 1) {
    throw new Error('invalidLargeVaultFixtureSize')
  }
  const root = rootUri.replace(/\/$/u, '')
  writer.createDirectory(rootUri)
  for (let index = 0; index < noteCount; index += 1) {
    const sequence = String(index + 1).padStart(4, '0')
    await writer.writeText(`${root}/note-${sequence}.md`, `---\ntype: Note\n---\n# Generated note ${index + 1}\n\nDisposable sync responsiveness fixture.\n`)
    if ((index + 1) % batchSize === 0) await yieldToInput()
  }
  const markerPath = `${root}/${fixtureMarkerName}`
  const marker = { fixture: 'memoria-mobile-large-vault', schemaVersion: 1, noteCount }
  await writer.writeText(markerPath, JSON.stringify(marker))
  return { marker, markerPath, noteCount }
}

/** Read-only timing on an explicit disposable fixture; reports no note data. */
export async function nativeVaultReadBenchmark(vaultRootUri: string) {
  const first = await measureSnapshot(vaultRootUri)
  if (!first) return null
  const repeated = await measureSnapshot(vaultRootUri)
  if (!repeated) throw new Error('nativeBenchmarkIndexUnavailable')
  return { fileCount: first.fileCount, noteCount: first.snapshot.allNotes?.length ?? first.snapshot.notes.length,
    ...first.timings, repeatedLoad: repeated.timings, interactions: measureReadOnlyInteractions(first.snapshot) }
}

function yieldToNextTask() {
  return new Promise<void>(resolve => setTimeout(resolve, 0))
}

async function measureSnapshot(vaultRootUri: string) {
  const started = performance.now()
  const preview = await readWorkspaceSnapshotPreview({ vaultPath: vaultRootUri, vaultLabel: 'Native QA' })
  const previewFinished = performance.now()
  if (preview && !sourceFreePreview(preview)) throw new Error('nativeBenchmarkEditablePreview')
  const readStarted = performance.now()
  const workspace = await preloadNativeWorkspace({ vaultAlias: null, vaultLabel: 'Native QA', vaultRootUri })
  if (!workspace?.index) return null
  const readFinished = performance.now()
  let cacheHit = false
  const snapshot = await buildCooperativeWorkspaceSnapshot({
    files: workspace.index.files,
    folderPaths: workspace.index.directories,
    vaultLabel: workspace.vaultLabel,
    vaultPath: workspace.vaultRootUri,
  }, undefined, { onCache: hit => { cacheHit = hit } })
  const snapshotMs = Math.round(performance.now() - readFinished)
  return {
    fileCount: workspace.index.files.length,
    snapshot,
    timings: { previewHit: preview !== null, previewMs: Math.round(previewFinished - started),
      previewNoteCount: preview?.allNotes.length ?? 0, previewSourceFree: true,
      cacheHit, nativeReadMs: Math.round(readFinished - readStarted), snapshotMs },
  }
}

function sourceFreePreview(preview: WorkspaceSnapshotPreview) {
  if (['sync', 'editorBlocks', 'editorBullets', 'input'].some(key => key in preview)) return false
  const sourceKeys = ['rawContent', 'editorBlocks', 'editorBullets']
  const notes = preview.notes.concat(preview.allNotes)
  return notes.every(note => sourceKeys.every(key => !(key in note)))
    && Object.values(preview.typeDefinitions).every(type => !('rawContent' in type) && !('template' in type))
}

function measureReadOnlyInteractions(snapshot: MobileWorkspaceSnapshot) {
  const note = snapshot.notes.find((candidate) => candidate.rawContent !== undefined)
  if (!note || note.rawContent === undefined) return null
  const start = performance.now()
  // Compute a throwaway edit result only. Never persist benchmark changes.
  applyMobileWorkspaceEditWithWrites(snapshot, { type: 'toggleFavorite', noteId: note.id })
  const favoriteMs = performance.now() - start
  const hydrateStart = performance.now()
  applyMobileWorkspaceEditWithWrites(snapshot, { type: 'hydrateNoteContent', noteId: note.id, rawContent: note.rawContent })
  const hydrateMs = Math.round(performance.now() - hydrateStart)
  const selection = { kind: 'item', sectionId: 'types', id: 'benchmark', label: note.type, typeName: note.type } as const
  const selectStart = performance.now()
  const notes = notesForSidebarSelection(snapshot, selection)
  noteListFilterCountsForSelection(snapshot, selection)
  return { favoriteMs: Math.round(favoriteMs), hydrateMs, typeSelectionMs: Math.round(performance.now() - selectStart), matchedCount: notes.length }
}
