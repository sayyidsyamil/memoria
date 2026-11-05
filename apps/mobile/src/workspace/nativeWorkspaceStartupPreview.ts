import type { NativeWorkspaceSelection } from './nativeWorkspacePicker'
import { optionalNativeWorkspaceAccessModule } from './nativeWorkspaceAccess'
import { expoWorkspaceFileSystem } from './expoWorkspaceFileSystem'
import { withWorkspaceOperation } from './git/workspaceOperationQueue'
import type { WorkspaceSnapshotIdentity } from './workspaceSnapshotEnvelope'
import { readWorkspaceSnapshotPreview, type WorkspaceSnapshotPreview } from './workspaceSnapshotPreview'
import type { MobileVaultConfig } from './mobileWorkspaceModel'

type PreviewAccess = {
  recover: (root: string) => void
  readConfig: (root: string) => MobileVaultConfig | null
  readPreview: (identity: WorkspaceSnapshotIdentity, signal?: AbortSignal) => Promise<WorkspaceSnapshotPreview | null>
}

const nativeAccess: PreviewAccess = {
  recover: root => {
    if (!optionalNativeWorkspaceAccessModule()?.recoverWorkspaceText) throw new Error('nativeTextRecoveryUnavailable')
    expoWorkspaceFileSystem.recoverPendingWrites?.(root)
  },
  readConfig: root => expoWorkspaceFileSystem.readVaultConfig?.(root) ?? null,
  readPreview: (identity, signal) => readWorkspaceSnapshotPreview(identity, undefined, signal),
}

/** Best-effort presentation before indexing; its deadline never cancels authoritative work. */
export function readNativeWorkspaceStartupPreview(selection: NativeWorkspaceSelection | null,
  signal?: AbortSignal, access: PreviewAccess = nativeAccess, prioritizeCache = false): Promise<WorkspaceSnapshotPreview | null> {
  if (!selection || signal?.aborted) return Promise.resolve(null)
  return new Promise(resolve => {
    const completion = previewCompletion(resolve, signal, prioritizeCache)
    void readAuthorizedPreview(selection, completion.signal, access).then(completion.finish, completion.abort)
  })
}

function previewCompletion(resolve: (preview: WorkspaceSnapshotPreview | null) => void, signal?: AbortSignal, prioritizeCache = false) {
  const controller = new AbortController()
  let finished = false
  const finish = (preview: WorkspaceSnapshotPreview | null) => {
    if (finished) return
    finished = true
    clearTimeout(timer)
    signal?.removeEventListener('abort', abort)
    controller.abort()
    resolve(preview)
  }
  const abort = () => finish(null)
  const timer = prioritizeCache ? undefined : setTimeout(abort, 250)
  signal?.addEventListener('abort', abort, { once: true })
  return { signal: controller.signal, finish, abort }
}

async function readAuthorizedPreview(selection: NativeWorkspaceSelection, signal: AbortSignal, access: PreviewAccess) {
  try {
    requireActivePreview(signal)
    const identity = await startupPreviewIdentity(selection, access, signal)
    requireActivePreview(signal)
    const preview = await access.readPreview(identity, signal)
    requireActivePreview(signal)
    return preview
  } catch { return null }
}

function startupPreviewIdentity(selection: NativeWorkspaceSelection, access: PreviewAccess, signal?: AbortSignal) {
  return withWorkspaceOperation(selection.vaultRootUri, async () => {
    requireActivePreview(signal)
    access.recover(selection.vaultRootUri)
    return { vaultPath: selection.vaultRootUri, vaultAlias: selection.vaultAlias, vaultLabel: selection.vaultLabel,
      vaultConfig: access.readConfig(selection.vaultRootUri) }
  })
}

function requireActivePreview(signal?: AbortSignal) {
  if (signal?.aborted) throw new Error('workspaceLoadCancelled')
}
