import type { MobileNote, MobileWorkspaceSnapshot } from './mobileWorkspaceModel'
import { mapWorkspaceItems } from './cooperativeWorkspaceItems'
import { snapshotWithResolvedNotes } from './mobileWorkspaceSnapshotEdits'
import { requireWorkspaceWritePath } from './workspaceWriteValidation'
import { mergeReloadCollection, mergeReloadFolders, mergeReloadRecord } from './workspaceReloadCollections'

type ReloadSnapshots = { baseline: MobileWorkspaceSnapshot; current: MobileWorkspaceSnapshot; fresh: MobileWorkspaceSnapshot }
type ReloadAccess = {
  baseline: MobileWorkspaceSnapshot
  current: () => MobileWorkspaceSnapshot
  publish: (snapshot: MobileWorkspaceSnapshot) => void
  controller: AbortController
}

/** Only a read-only scan may use this boundary; checkout/replacement keeps its save barrier. */
export function createWorkspaceReloadCompletion(access: ReloadAccess) {
  let started = false
  const { controller } = access
  return {
    cancel: () => controller.abort(),
    complete: async (fresh: MobileWorkspaceSnapshot) => {
      if (started || controller.signal.aborted) return false
      started = true
      try {
        return await publishStableReload(access, fresh)
      } catch (error) {
        if (controller.signal.aborted) return false
        throw error
      } finally { controller.abort() }
    },
  }
}

async function publishStableReload(access: ReloadAccess, fresh: MobileWorkspaceSnapshot) {
  const { signal } = access.controller
  while (!signal.aborted) {
    const current = access.current()
    const merged = await reconcileWorkspaceReload({ baseline: access.baseline, current, fresh }, signal)
    if (signal.aborted) return false
    // Input during a yielded batch invalidates the candidate, not the user's edit.
    if (access.current() !== current) continue
    access.publish(merged)
    return true
  }
  return false
}

export async function reconcileWorkspaceReload(input: ReloadSnapshots, signal?: AbortSignal) {
  requireSameWorkspace(input)
  const baseline = await indexedNotes(input.baseline, signal)
  const current = await indexedNotes(input.current, signal)
  const fresh = await indexedNotes(input.fresh, signal)
  await requireNoCreationCollision({ baseline, current, fresh }, signal)
  const merged = await mergeReloadCollection({ baseline, current, fresh, changed: noteSourceChanged, signal })
  const allNotes = [...merged.values()]
  const visibleIds = new Set([...input.current.notes, ...input.fresh.notes].map(note => note.id))
  const selectedNoteId = merged.has(input.current.selectedNoteId ?? '') ? input.current.selectedNoteId : undefined
  if (selectedNoteId) visibleIds.add(selectedNoteId)
  const notes = allNotes.filter(note => visibleIds.has(note.id))
  const metadata = await reconciledMetadata(input, signal)
  const source = metadata.source ? { ...metadata.source, totalNotes: allNotes.length, visibleNotes: notes.length } : undefined
  return snapshotWithResolvedNotes({ ...metadata, allNotes, source, selectedNoteId }, notes, allNotes)
}

function requireSameWorkspace({ baseline, current, fresh }: ReloadSnapshots) {
  const identity = reloadIdentity(baseline)
  for (const snapshot of [baseline, current, fresh]) {
    if (reloadIdentity(snapshot) !== identity) throw new Error('workspaceReloadIdentityMismatch')
    requireEditableAuthority(snapshot)
  }
}

function reloadIdentity(snapshot: MobileWorkspaceSnapshot) {
  const source = snapshot.source
  if (source?.kind !== 'localVault') throw new Error('workspaceReloadIdentityMismatch')
  if (!source.vaultPath) throw new Error('workspaceReloadIdentityMismatch')
  return JSON.stringify([source.vaultPath, source.alias ?? null])
}

function requireEditableAuthority(snapshot: MobileWorkspaceSnapshot) {
  if (snapshot.sync.kind === 'noVault') throw new Error('workspaceReloadAuthorityRequired')
  if (snapshot.sync.kind === 'readOnly') throw new Error('workspaceReloadAuthorityRequired')
}

async function indexedNotes(snapshot: MobileWorkspaceSnapshot, signal?: AbortSignal) {
  const result = new Map<string, MobileNote>()
  await mapWorkspaceItems(snapshot.allNotes ?? snapshot.notes, note => addSummaryNote(result, note), signal)
  if (snapshot.allNotes) await mapWorkspaceItems(snapshot.notes, note => addDetailedNote(result, note), signal)
  await requireDistinctPaths([...result.values()], signal)
  return result
}

function addSummaryNote(notes: Map<string, MobileNote>, note: MobileNote) {
  if (notes.has(note.id)) throw new Error('workspaceReloadDuplicateNote')
  notes.set(note.id, note)
}

function addDetailedNote(notes: Map<string, MobileNote>, note: MobileNote) {
  const summary = notes.get(note.id)
  if (summary && notePath(summary) !== notePath(note)) throw new Error('workspaceReloadDuplicateNote')
  notes.set(note.id, note)
}

async function requireDistinctPaths(notes: MobileNote[], signal?: AbortSignal) {
  const paths = new Set<string>()
  await mapWorkspaceItems(notes, note => {
    const path = notePath(note)
    if (paths.has(path)) throw new Error('workspaceReloadDuplicateNote')
    paths.add(path)
  }, signal)
}

function notePath(note: MobileNote) {
  return requireWorkspaceWritePath(note.path ?? note.id).normalize('NFC').toLowerCase()
}

function noteSourceChanged(before: MobileNote, after: MobileNote) {
  return before.rawContent !== after.rawContent || before.path !== after.path
}

async function requireNoCreationCollision(input: {
  baseline: Map<string, MobileNote>; current: Map<string, MobileNote>; fresh: Map<string, MobileNote>
}, signal?: AbortSignal) {
  const freshByPath = new Map<string, MobileNote>()
  await mapWorkspaceItems([...input.fresh.values()], note => { freshByPath.set(notePath(note), note) }, signal)
  await mapWorkspaceItems([...input.current.values()], note => {
    if (input.baseline.has(note.id)) return
    const scanned = freshByPath.get(notePath(note))
    if (scanned && !sameCreatedSource(note, scanned)) throw new Error('workspaceReloadConflict')
  }, signal)
}

function sameCreatedSource(note: MobileNote, scanned: MobileNote) {
  if (scanned.id !== note.id) return false
  if (note.rawContent === undefined) return false
  return scanned.rawContent === note.rawContent
}

async function reconciledMetadata({ baseline, current, fresh }: ReloadSnapshots, signal?: AbortSignal): Promise<MobileWorkspaceSnapshot> {
  const views = await mergeReloadCollection({
    baseline: new Map(baseline.views?.map(view => [view.id, view])),
    current: new Map(current.views?.map(view => [view.id, view])),
    fresh: new Map(fresh.views?.map(view => [view.id, view])),
    signal,
  })
  return {
    ...fresh,
    searchQuery: current.searchQuery,
    sync: current.sync.kind === 'synced' ? fresh.sync : current.sync,
    views: [...views.values()],
    vaultConfig: current.vaultConfig !== baseline.vaultConfig ? current.vaultConfig : fresh.vaultConfig,
    noteListPropertyOverrides: current.noteListPropertyOverrides !== baseline.noteListPropertyOverrides
      ? current.noteListPropertyOverrides : fresh.noteListPropertyOverrides,
    folderPaths: mergeReloadFolders({ baseline: baseline.folderPaths, current: current.folderPaths, fresh: fresh.folderPaths }),
    typeDefinitions: await mergeReloadRecord({ baseline: baseline.typeDefinitions, current: current.typeDefinitions, fresh: fresh.typeDefinitions, signal }),
  }
}
