import { localVaultWorkspaceSnapshotSteps, type LocalVaultSnapshotOptions } from './localVaultSnapshot'
import { createGitTaskRunner } from './git/gitTaskRunner'
import { openWorkspaceSnapshotCache, type SnapshotCacheStorage } from './workspaceSnapshotCache'
import { workspaceSnapshotStorage } from './workspaceSnapshotStorage'

type SnapshotPreparation = { storage?: SnapshotCacheStorage | null; onCache?: (hit: boolean) => void }

/** Reuse the existing task budget without changing the synchronous parser's results. */
export async function buildCooperativeWorkspaceSnapshot(options: LocalVaultSnapshotOptions, signal?: AbortSignal, preparation: SnapshotPreparation = {}) {
  requireActiveSnapshotLoad(signal)
  const cache = await openWorkspaceSnapshotCache(options, preparation.storage === undefined ? workspaceSnapshotStorage : preparation.storage, signal)
  requireActiveSnapshotLoad(signal)
  preparation.onCache?.(cache.snapshot !== null)
  if (cache.snapshot) return cache.snapshot
  const work = localVaultWorkspaceSnapshotSteps(options)
  const { run } = createGitTaskRunner()
  for (;;) {
    const step = await run(() => {
      requireActiveSnapshotLoad(signal)
      return work.next()
    })
    if (step.done) {
      requireActiveSnapshotLoad(signal)
      await cache.save(step.value)
      requireActiveSnapshotLoad(signal)
      return step.value
    }
  }
}

function requireActiveSnapshotLoad(signal?: AbortSignal) {
  if (signal?.aborted) throw new Error('workspaceLoadCancelled')
}
