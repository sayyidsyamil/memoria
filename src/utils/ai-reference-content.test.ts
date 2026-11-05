import { describe, expect, it, vi, beforeEach } from 'vitest'
import { hydrateNoteReferences } from './ai-reference-content'
import { createVaultBackend } from '../lib/vaultBackend'

vi.mock('../lib/vaultBackend', () => ({
  createVaultBackend: vi.fn(),
}))

describe('hydrateNoteReferences', () => {
  const mockRead = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(createVaultBackend).mockReturnValue({
      files: { read: mockRead },
    } as never)
  })

  it('returns undefined when references is undefined', async () => {
    await expect(hydrateNoteReferences(undefined, '/vault')).resolves.toBeUndefined()
    expect(createVaultBackend).not.toHaveBeenCalled()
  })

  it('returns empty array when references is empty', async () => {
    await expect(hydrateNoteReferences([], '/vault')).resolves.toEqual([])
    expect(createVaultBackend).not.toHaveBeenCalled()
  })

  it('returns references unchanged when vaultPath is missing', async () => {
    const refs = [{ path: '/vault/note.md', title: 'Note' }]
    await expect(hydrateNoteReferences(refs, undefined)).resolves.toBe(refs)
    expect(createVaultBackend).not.toHaveBeenCalled()
  })

  it('hydrates references without content by reading from backend', async () => {
    mockRead.mockResolvedValue({ content: '# Note content', path: '/vault/note.md', revision: 'rev1' })
    const refs = [{ path: '/vault/note.md', title: 'Note' }]

    const result = await hydrateNoteReferences(refs, '/vault')

    expect(createVaultBackend).toHaveBeenCalledWith('/vault')
    expect(mockRead).toHaveBeenCalledWith('/vault/note.md')
    expect(result).toEqual([{ path: '/vault/note.md', title: 'Note', content: '# Note content' }])
  })

  it('preserves existing content in references', async () => {
    const refs = [{ path: '/vault/note.md', title: 'Note', content: 'existing' }]

    const result = await hydrateNoteReferences(refs, '/vault')

    expect(createVaultBackend).not.toHaveBeenCalled()
    expect(mockRead).not.toHaveBeenCalled()
    expect(result).toEqual(refs)
  })

  it('handles read errors by keeping reference unchanged', async () => {
    mockRead.mockRejectedValue(new Error('File not found'))
    const refs = [{ path: '/vault/note.md', title: 'Note' }]

    const result = await hydrateNoteReferences(refs, '/vault')

    expect(createVaultBackend).toHaveBeenCalledWith('/vault')
    expect(mockRead).toHaveBeenCalledWith('/vault/note.md')
    expect(result).toEqual([{ path: '/vault/note.md', title: 'Note' }])
  })

  it('hydrates multiple references', async () => {
    mockRead
      .mockResolvedValueOnce({ content: 'content 1', path: '/vault/note1.md', revision: 'rev1' })
      .mockResolvedValueOnce({ content: 'content 2', path: '/vault/note2.md', revision: 'rev2' })

    const refs = [
      { path: '/vault/note1.md', title: 'Note 1' },
      { path: '/vault/note2.md', title: 'Note 2' },
    ]

    const result = await hydrateNoteReferences(refs, '/vault')

    expect(mockRead).toHaveBeenCalledTimes(2)
    expect(result).toEqual([
      { path: '/vault/note1.md', title: 'Note 1', content: 'content 1' },
      { path: '/vault/note2.md', title: 'Note 2', content: 'content 2' },
    ])
  })

  it('hydrates only references without content in mixed list', async () => {
    mockRead.mockResolvedValue({ content: 'hydrated', path: '/vault/note2.md', revision: 'rev2' })

    const refs = [
      { path: '/vault/note1.md', title: 'Note 1', content: 'existing' },
      { path: '/vault/note2.md', title: 'Note 2' },
    ]

    const result = await hydrateNoteReferences(refs, '/vault')

    expect(mockRead).toHaveBeenCalledTimes(1)
    expect(mockRead).toHaveBeenCalledWith('/vault/note2.md')
    expect(result).toEqual([
      { path: '/vault/note1.md', title: 'Note 1', content: 'existing' },
      { path: '/vault/note2.md', title: 'Note 2', content: 'hydrated' },
    ])
  })
})
