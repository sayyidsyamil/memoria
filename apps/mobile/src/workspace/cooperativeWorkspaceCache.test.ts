import { createHash } from 'node:crypto'
import { afterEach, expect, it, vi } from 'vitest'
import { buildCooperativeWorkspaceSnapshot } from './cooperativeWorkspaceSnapshot'
import { readWorkspaceSnapshotPreview } from './workspaceSnapshotPreview'

afterEach(() => vi.restoreAllMocks())

async function largeCachedVault() {
  vi.spyOn(Date, 'now').mockReturnValue(1_792_000_000_000)
  const hash = (text: string) => createHash('sha256').update(text).digest('hex')
  const records = new Map<string, string>()
  const storage = { digest: async (text: string) => hash(text), read: async (key: string) => records.get(key) ?? null,
    write: vi.fn(async (key: string, value: string) => { records.set(key, value) }) }
  const files = Array.from({ length: 6000 }, (_, index) => {
    const content = `---\ntype: Note\ncustom: keep\n---\n# Entry ${index}\n\nUnchanged source.\n`
    return { relativePath: `entry-${index}.md`, absolutePath: `file:///owned-cache/entry-${index}.md`,
      content, contentDigest: hash(content), createdAt: 1, modifiedAt: 2, size: content.length }
  })
  const input = { files, folderPaths: [], maxNotes: 20, vaultLabel: 'Owned cache', vaultPath: 'file:///owned-cache' }
  const snapshot = await buildCooperativeWorkspaceSnapshot(input, undefined, { storage })
  storage.write.mockClear()
  let time = 0
  vi.spyOn(performance, 'now').mockImplementation(() => { time += 0.25; return time })
  return { input, storage, snapshot }
}

it('lets an input task run before a 6000-note warm cache finishes without changing sources', async () => {
  const { input, storage, snapshot } = await largeCachedVault()
  let finished = false
  const pulse = new Promise<void>(resolve => setTimeout(resolve, 0))
  const loading = buildCooperativeWorkspaceSnapshot(input, undefined, { storage }).then(value => {
    finished = true
    return value
  })
  await pulse
  expect(finished).toBe(false)
  expect(await loading).toEqual(snapshot)
  expect(input.files[0].content).toContain('custom: keep')
  expect(storage.write).not.toHaveBeenCalled()
})

it('lets input run while converting a large source-free startup preview', async () => {
  const { input, storage } = await largeCachedVault()
  let finished = false
  const pulse = new Promise<void>(resolve => setTimeout(resolve, 0))
  const loading = readWorkspaceSnapshotPreview(input, storage).then(value => { finished = true; return value })
  await pulse
  expect(finished).toBe(false)
  const preview = await loading
  expect(preview?.allNotes).toHaveLength(6000)
  expect(preview?.notes[0]).not.toHaveProperty('rawContent')
  expect(preview?.allNotes[0]).not.toHaveProperty('editorBlocks')
  expect(storage.write).not.toHaveBeenCalled()
})

it('cancels warm-cache conversion at an input boundary without publishing or saving', async () => {
  const { input, storage } = await largeCachedVault()
  const cancellation = new AbortController()
  const pulse = new Promise<void>(resolve => setTimeout(resolve, 0))
  const loading = buildCooperativeWorkspaceSnapshot(input, cancellation.signal, { storage })
  await pulse
  cancellation.abort()
  await expect(loading).rejects.toThrow('workspaceLoadCancelled')
  expect(storage.write).not.toHaveBeenCalled()
})

it('discards a preview cancelled during cooperative metadata conversion', async () => {
  const { input, storage } = await largeCachedVault()
  const cancellation = new AbortController()
  const pulse = new Promise<void>(resolve => setTimeout(resolve, 0))
  const loading = readWorkspaceSnapshotPreview(input, storage, cancellation.signal)
  await pulse
  cancellation.abort()
  expect(await loading).toBeNull()
  expect(storage.write).not.toHaveBeenCalled()
})
