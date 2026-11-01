import { requireOptionalNativeModule } from 'expo'
import { expoWorkspaceFileSystem } from '../workspace/expoWorkspaceFileSystem'
import { createFileSystemWorkspaceRepository } from '../workspace/fileSystemWorkspaceRepository'
import { withSavedWorkspace } from '../workspace/git/workspaceWriteQueue'

type NativePhase = 'entry-prepare-move' | 'entry-prepare-delete' | 'entry-prepare-conflict' | 'inspect' | 'cleanup'
type EntryInspection = {
  rootUri: string; pending: boolean; sourceExists: boolean; destinationExists: boolean
  binaryPreserved: boolean; frontmatterPreserved: boolean
}
type ProbeModule = { runEntryRecoveryProbe: (phase: NativePhase) => Promise<EntryInspection> }

export async function nativeEntryRecoveryChecks(phase: string): Promise<Record<string, boolean>> {
  const module = requireOptionalNativeModule<ProbeModule>('MemoriaWorkspaceAccess')
  if (!module?.runEntryRecoveryProbe) throw new Error('nativeEntryRecoveryUnavailable')
  return runEntryPhase(module, phase)
}

function isPreparePhase(phase: string): phase is Exclude<NativePhase, 'inspect' | 'cleanup'> {
  return phase === 'entry-prepare-move' || phase === 'entry-prepare-delete' || phase === 'entry-prepare-conflict'
}

async function runEntryPhase(module: ProbeModule, phase: string) {
  if (isPreparePhase(phase)) {
    const before = await module.runEntryRecoveryProbe(phase)
    return { journalPublished: before.pending }
  }
  if (phase === 'entry-conflict') return verifyEntryConflict(module)
  if (phase === 'entry-move' || phase === 'entry-delete') return verifyEntryReplay(module, phase === 'entry-move')
  throw new Error('invalidEntryRecoveryPhase')
}

async function verifyEntryReplay(module: ProbeModule, moved: boolean) {
  const before = await module.runEntryRecoveryProbe('inspect')
  if (!before.pending) throw new Error('missingEntryRecoveryRecord')
  const repository = createFileSystemWorkspaceRepository(expoWorkspaceFileSystem)
  const snapshot = repository.readSnapshot({ source: 'native', vaultRootUri: before.rootUri })
  const after = await module.runEntryRecoveryProbe('inspect')
  const checks = {
    journalCleared: !after.pending,
    sourceRemoved: !after.sourceExists,
    destinationCorrect: after.destinationExists === moved,
    binaryPreserved: !moved || after.binaryPreserved,
    frontmatterPreserved: !moved || after.frontmatterPreserved,
    indexCorrect: moved ? snapshot.notes.some((note) => note.path === 'target/nested/note.md') : snapshot.notes.length === 0,
  }
  await module.runEntryRecoveryProbe('cleanup')
  return checks
}

async function verifyEntryConflict(module: ProbeModule) {
  const before = await module.runEntryRecoveryProbe('inspect')
  const repository = createFileSystemWorkspaceRepository(expoWorkspaceFileSystem)
  const readRejected = await rejects(() => repository.readSnapshot({ source: 'native', vaultRootUri: before.rootUri }))
  let gitRan = false
  const syncRejected = await rejects(() => withSavedWorkspace(before.rootUri, async () => { gitRan = true }))
  const after = await module.runEntryRecoveryProbe('inspect')
  const checks = {
    readRejected, syncRejected, gitBlocked: !gitRan,
    sourceRetained: after.sourceExists, destinationUntouched: !after.destinationExists, journalRetained: after.pending,
  }
  await module.runEntryRecoveryProbe('cleanup')
  return checks
}

async function rejects(action: () => unknown) {
  try { await action(); return false } catch { return true }
}
