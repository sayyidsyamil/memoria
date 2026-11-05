import { expect, it, vi } from 'vitest'
import { readWorkspaceSnapshotPreview } from './workspaceSnapshotPreview'

it('does not start private cache IO after an obsolete digest operation completes', async () => {
  let finishDigest: (value: string) => void = () => undefined
  const digest = new Promise<string>(resolve => { finishDigest = resolve })
  const storage = { revision: 'qa', digest: () => digest, read: vi.fn(async () => null), write: vi.fn() }
  const controller = new AbortController()
  const loading = readWorkspaceSnapshotPreview({ vaultPath: 'file:///qa', vaultLabel: 'QA' }, storage, controller.signal)
  controller.abort()
  finishDigest('a'.repeat(64))
  expect(await loading).toBeNull()
  expect(storage.read).not.toHaveBeenCalled()
  expect(storage.write).not.toHaveBeenCalled()
})
