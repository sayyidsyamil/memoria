import { describe, expect, it, vi, beforeEach } from 'vitest'
import { loadProbeTarget } from './editorMemoryProbeRuntime'
import { createVaultBackend } from '../lib/vaultBackend'
import type { VaultEntry } from '../types'

vi.mock('../lib/vaultBackend', () => ({
  createVaultBackend: vi.fn(),
}))

function makeEntry(overrides: Partial<VaultEntry> = {}): VaultEntry {
  return {
    path: '/vault/note.md',
    title: 'Note',
    filename: 'note.md',
    content: '',
    outgoingLinks: [],
    snippet: '',
    wordCount: 0,
    isA: 'Note',
    status: null,
    createdAt: null,
    modifiedAt: null,
    icon: null,
    tags: [],
    workspace: null,
    ...overrides,
  } as VaultEntry
}

describe('editorMemoryProbeRuntime backend integration', () => {
  const mockRead = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(createVaultBackend).mockReturnValue({
      files: { read: mockRead },
    } as never)
  })

  it('loads probe target using backend', async () => {
    const entry = makeEntry({ path: '/vault/test.md', title: 'Test' })
    mockRead.mockResolvedValue({
      content: '# Test content',
      path: '/vault/test.md',
      revision: 'rev1',
    })

    const target = await loadProbeTarget(entry, '/vault')

    expect(createVaultBackend).toHaveBeenCalledWith('/vault')
    expect(mockRead).toHaveBeenCalledWith('/vault/test.md')
    expect(target).toEqual({
      entry,
      content: '# Test content',
    })
  })

  it('loads multiple probe targets', async () => {
    const entries = [
      makeEntry({ path: '/vault/note1.md', title: 'Note 1' }),
      makeEntry({ path: '/vault/note2.md', title: 'Note 2' }),
    ]

    mockRead
      .mockResolvedValueOnce({ content: 'content 1', path: '/vault/note1.md', revision: 'rev1' })
      .mockResolvedValueOnce({ content: 'content 2', path: '/vault/note2.md', revision: 'rev2' })

    const targets = await Promise.all(entries.map(entry => loadProbeTarget(entry, '/vault')))

    expect(mockRead).toHaveBeenCalledTimes(2)
    expect(targets).toEqual([
      { entry: entries[0], content: 'content 1' },
      { entry: entries[1], content: 'content 2' },
    ])
  })

  it('propagates read errors', async () => {
    const entry = makeEntry({ path: '/vault/missing.md' })
    mockRead.mockRejectedValue(new Error('File not found'))

    await expect(loadProbeTarget(entry, '/vault')).rejects.toThrow('File not found')
  })
})
