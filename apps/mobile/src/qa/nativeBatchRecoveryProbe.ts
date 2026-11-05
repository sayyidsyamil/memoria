import { requireOptionalNativeModule } from 'expo'
import { createFileSystemWorkspaceRepository } from '../workspace/fileSystemWorkspaceRepository'
import { expoWorkspaceFileSystem } from '../workspace/expoWorkspaceFileSystem'
import { withSavedWorkspace } from '../workspace/git/workspaceWriteQueue'

type NativePhase = 'batch-prepare' | 'batch-prepare-conflict' | 'inspect' | 'cleanup'
type Inspection = {
  rootUri: string; content: string; secondContent: string; completedMembers: number
  pending: boolean; privateJournal: boolean
}
type ProbeModule = { runTextRecoveryProbe: (phase: NativePhase) => Promise<Inspection> }
const recoveredFirst = '---\ncustom: retained\n---\n# Recovered\n'
const recoveredSecond = '---\ncustom: second\n---\n# Second recovered\n'

/** The native fixture intentionally stops after the first member is replaced. */
export async function nativeBatchRecoveryChecks(phase: string): Promise<Record<string, boolean>> {
  const module = requireOptionalNativeModule<ProbeModule>('MemoriaWorkspaceAccess')
  if (!module?.runTextRecoveryProbe) throw new Error('nativeTextRecoveryUnavailable')
  return runBatchPhase(module, phase)
}

async function runBatchPhase(module: ProbeModule, phase: string): Promise<Record<string, boolean>> {
  if (phase === 'batch-prepare' || phase === 'batch-prepare-conflict') {
    return prepareBatchRecovery(module, phase)
  }
  const before = await module.runTextRecoveryProbe('inspect')
  if (!before.pending) throw new Error('missingCrossLaunchBatchRecord')
  if (phase === 'batch-recover') return verifyBatchRecovery(module, before)
  if (phase === 'batch-conflict') return verifyBatchConflict(module, before)
  throw new Error('invalidBatchRecoveryPhase')
}

async function prepareBatchRecovery(module: ProbeModule, phase: 'batch-prepare' | 'batch-prepare-conflict') {
  const prepared = await module.runTextRecoveryProbe(phase)
  return {
    journalPublished: prepared.pending, privateJournal: prepared.privateJournal,
    firstReplaced: prepared.content === recoveredFirst,
    secondNotReplaced: prepared.secondContent === (phase === 'batch-prepare' ? '# Second before\n' : '# External edit\n'),
  }
}

async function verifyBatchRecovery(module: ProbeModule, before: Inspection) {
  const repository = createFileSystemWorkspaceRepository(expoWorkspaceFileSystem)
  const request = { source: 'native' as const, vaultRootUri: before.rootUri,
    workspaceIndex: { directories: [], files: [] } }
  const snapshot = repository.readSnapshot(request)
  const recovered = await module.runTextRecoveryProbe('inspect')
  await repository.persistWrites([
    { kind: 'saveNote', path: 'note.md', content: `${recoveredFirst}\nNext\n` },
    { kind: 'saveNote', path: 'second.md', content: `${recoveredSecond}\nNext\n` },
  ], request)
  const saved = await module.runTextRecoveryProbe('inspect')
  const checks = {
    staleIndexDiscarded: snapshot.notes.length === 2,
    allFrontmatterRecovered: recovered.content === recoveredFirst && recovered.secondContent === recoveredSecond,
    recoveredWholePlan: !recovered.pending && recovered.completedMembers === 2,
    repositoryUsesBatch: !saved.pending && saved.completedMembers === 2,
    repositorySavedAll: saved.content === `${recoveredFirst}\nNext\n` && saved.secondContent === `${recoveredSecond}\nNext\n`,
  }
  await module.runTextRecoveryProbe('cleanup')
  return checks
}

async function verifyBatchConflict(module: ProbeModule, before: Inspection) {
  const repository = createFileSystemWorkspaceRepository(expoWorkspaceFileSystem)
  const readRejected = await rejects(() => repository.readSnapshot({ source: 'native', vaultRootUri: before.rootUri }))
  const writer = expoWorkspaceFileSystem.writeTextBatch
  if (!writer) throw new Error('nativeBatchCapabilityMissing')
  const writeRejected = await rejects(() => writer(before.rootUri, [{ path: 'other.md', content: 'must not save' }]))
  let gitRan = false
  const syncRejected = await rejects(() => withSavedWorkspace(before.rootUri, async () => { gitRan = true }))
  const after = await module.runTextRecoveryProbe('inspect')
  const checks = {
    readRejected, writeRejected, syncRejected, gitBlocked: !gitRan,
    firstRetained: after.content === recoveredFirst,
    externalEditPreserved: after.secondContent === '# External edit\n', wholePlanRetained: after.pending,
  }
  await module.runTextRecoveryProbe('cleanup')
  return checks
}

async function rejects(action: () => unknown) {
  try { await action(); return false } catch { return true }
}
