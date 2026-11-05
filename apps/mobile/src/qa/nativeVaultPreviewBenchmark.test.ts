import { beforeEach, expect, it, vi } from 'vitest'
import { buildLocalVaultWorkspaceSnapshot } from '../workspace/localVaultSnapshot'
import { nativeVaultReadBenchmark } from './nativeVaultReadBenchmark'

const state = vi.hoisted(() => ({ preview: vi.fn(), index: vi.fn(), snapshot: vi.fn(), events: [] as string[] }))
vi.mock('../workspace/workspaceSnapshotPreview', () => ({ readWorkspaceSnapshotPreview: state.preview }))
vi.mock('../workspace/preloadNativeWorkspace', () => ({ preloadNativeWorkspace: state.index }))
vi.mock('../workspace/cooperativeWorkspaceSnapshot', () => ({ buildCooperativeWorkspaceSnapshot: state.snapshot }))
const root = 'file:///owned-preview-benchmark'
const preview = () => ({ kind: 'provisional', notes: [], allNotes: [], typeDefinitions: {} })

beforeEach(() => {
  vi.resetAllMocks()
  state.events.length = 0
  state.preview.mockImplementation(async () => { state.events.push('preview'); return null })
  state.index.mockImplementation(async () => {
    state.events.push('index')
    return { vaultRootUri: root, vaultLabel: 'Native QA', index: { directories: [], files: [] } }
  })
  state.snapshot.mockImplementation(async () => {
    state.events.push('snapshot')
    return buildLocalVaultWorkspaceSnapshot({ vaultPath: root, vaultLabel: 'Native QA', files: [] })
  })
})

it('measures the private preview separately, before each fresh native index', async () => {
  state.preview.mockImplementationOnce(async () => { state.events.push('preview'); return null })
    .mockImplementationOnce(async () => { state.events.push('preview'); return preview() })
  const result = await nativeVaultReadBenchmark(root)
  expect(state.events).toEqual(['preview', 'index', 'snapshot', 'preview', 'index', 'snapshot'])
  expect(result).toMatchObject({ previewHit: false, previewMs: expect.any(Number),
    repeatedLoad: { previewHit: true, previewMs: expect.any(Number) } })
  expect(state.preview.mock.calls.every(([identity]) => identity.vaultPath === root && !('files' in identity))).toBe(true)
  expect(JSON.stringify(result)).not.toContain(root)
})

it('still rejects an authoritative index failure when presentation metadata exists', async () => {
  state.preview.mockResolvedValue(preview())
  state.index.mockRejectedValue(new Error('Native recovery failed'))
  await expect(nativeVaultReadBenchmark(root)).rejects.toThrow('Native recovery failed')
  expect(state.snapshot).not.toHaveBeenCalled()
})

it('does not substitute a preview for an unsupported native index', async () => {
  state.preview.mockResolvedValue(preview())
  state.index.mockResolvedValue(null)
  expect(await nativeVaultReadBenchmark(root)).toBeNull()
  expect(state.snapshot).not.toHaveBeenCalled()
})

it('fails if the second authoritative read becomes unavailable', async () => {
  state.index.mockResolvedValueOnce({ vaultRootUri: root, vaultLabel: 'Native QA', index: { directories: [], files: [] } })
    .mockResolvedValueOnce(null)
  await expect(nativeVaultReadBenchmark(root)).rejects.toThrow('nativeBenchmarkIndexUnavailable')
})

it.each([
  { ...preview(), sync: { kind: 'synced' } },
  { ...preview(), notes: [{ rawContent: '# Stale source' }] },
  { ...preview(), typeDefinitions: { Note: { template: '# Stale template' } } },
])('rejects a preview that accidentally contains editable authority', async invalid => {
  state.preview.mockResolvedValue(invalid)
  await expect(nativeVaultReadBenchmark(root)).rejects.toThrow('nativeBenchmarkEditablePreview')
  expect(state.index).not.toHaveBeenCalled()
})
