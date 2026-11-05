import { createHash } from 'node:crypto'
import { expect, it, vi } from 'vitest'
import { buildLocalVaultWorkspaceSnapshot } from './localVaultSnapshot'
import { readWorkspaceSnapshotEnvelope, writeWorkspaceSnapshotEnvelope } from './workspaceSnapshotEnvelope'
import { readWorkspaceSnapshotPreview } from './workspaceSnapshotPreview'

it('does not begin cache IO for an already cancelled envelope read', async () => {
  const f = await fixture()
  f.controller.abort()
  await expect(readWorkspaceSnapshotEnvelope(f.disk, 'key', f.identity, f.controller.signal)).resolves.toBeNull()
  expect(f.disk.read).not.toHaveBeenCalled()
})

it('discards a late cache read before decoding or checksumming it', async () => {
  const f = await fixture()
  const reading = deferred<string>()
  f.disk.read.mockReturnValue(reading.promise)
  const result = readWorkspaceSnapshotEnvelope(f.disk, 'key', f.identity, f.controller.signal)
  f.controller.abort()
  reading.resolve('{not valid JSON')
  await expect(result).resolves.toBeNull()
  expect(f.disk.digest).not.toHaveBeenCalled()
})

it('discards a cancelled checksum completion instead of decoding the snapshot payload', async () => {
  const f = await fixture()
  const checking = deferred<string>()
  f.disk.digest.mockReturnValue(checking.promise)
  const result = readWorkspaceSnapshotEnvelope(f.disk, 'key', f.identity, f.controller.signal)
  await vi.waitFor(() => expect(f.disk.digest).toHaveBeenCalledOnce())
  f.controller.abort()
  checking.resolve(JSON.parse(f.record).checksum)
  await expect(result).resolves.toBeNull()
})

it('propagates preview cancellation into the envelope IO boundary', async () => {
  const f = await fixture()
  const reading = deferred<string>()
  f.disk.read.mockReturnValue(reading.promise)
  const result = readWorkspaceSnapshotPreview(f.identity, f.disk, f.controller.signal)
  await vi.waitFor(() => expect(f.disk.read).toHaveBeenCalledOnce())
  expect(f.disk.digest).toHaveBeenCalledOnce()
  f.controller.abort()
  reading.resolve(f.record)
  await expect(result).resolves.toBeNull()
  expect(f.disk.digest).toHaveBeenCalledOnce()
})

async function fixture() {
  const identity = { vaultPath: 'file:///cancel-qa', vaultLabel: 'Cancel QA' }
  const snapshot = buildLocalVaultWorkspaceSnapshot({ ...identity, files: [] })
  let record = ''
  const disk = {
    digest: vi.fn(async (text: string) => createHash('sha256').update(text).digest('hex')),
    read: vi.fn(async () => record),
    write: async (_key: string, text: string) => { record = text },
  }
  await writeWorkspaceSnapshotEnvelope(disk, { key: 'key', input: 'a'.repeat(64), identity }, snapshot)
  disk.digest.mockClear()
  return { identity, disk, record, controller: new AbortController() }
}

function deferred<Value>() {
  let resolve: (value: Value) => void = () => undefined
  const promise = new Promise<Value>(done => { resolve = done })
  return { promise, resolve }
}
