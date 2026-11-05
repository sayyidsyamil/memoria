import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createRemoteNote } from '../lib/remoteNotes'
import { mockInvoke } from '../mock-tauri'
import { useNoteCreation } from './useNoteCreation'

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }))
vi.mock('../mock-tauri', () => ({
  isTauri: vi.fn(() => false),
  addMockEntry: vi.fn(),
  updateMockContent: vi.fn(),
  trackMockChange: vi.fn(),
  mockInvoke: vi.fn().mockResolvedValue(''),
}))
vi.mock('../lib/vaultBackend', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../lib/vaultBackend')>()),
  hasRemoteVault: () => true,
}))
vi.mock('../lib/remoteNotes', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../lib/remoteNotes')>()),
  createRemoteNote: vi.fn(),
}))

const UNTITLED = /^untitled-note-\d+\.md$/

describe('creating a note in a remote vault', () => {
  const addEntry = vi.fn()
  const openTabWithContent = vi.fn()
  const onNewNotePersisted = vi.fn()

  function create() {
    const config = {
      addEntry,
      removeEntry: vi.fn(),
      entries: [],
      setToastMessage: vi.fn(),
      vaultPath: '/Users/mock/demo-vault-v2',
      onNewNotePersisted,
    }
    const { result } = renderHook(() => useNoteCreation(config, { openTabWithContent }))
    act(() => {
      result.current.handleCreateNoteImmediate()
    })
  }

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('creates it on the server at a vault-relative path before opening it', async () => {
    vi.mocked(createRemoteNote).mockImplementation(async (path) => path)

    create()
    await waitFor(() => expect(openTabWithContent).toHaveBeenCalledOnce())

    expect(createRemoteNote).toHaveBeenCalledWith(expect.stringMatching(UNTITLED), expect.stringContaining('type: Note'))
    expect(mockInvoke).not.toHaveBeenCalledWith('save_note_content', expect.anything())
    expect(openTabWithContent.mock.calls[0][0].path).toMatch(UNTITLED)
    expect(onNewNotePersisted).toHaveBeenCalledWith(expect.stringMatching(UNTITLED))
  })

  it('opens the conflict copy when another device created the same path first', async () => {
    const copy = 'untitled-note-1 (conflict 2026-10-23 2130).md'
    vi.mocked(createRemoteNote).mockResolvedValue(copy)

    create()
    await waitFor(() => expect(openTabWithContent).toHaveBeenCalledOnce())

    expect(openTabWithContent.mock.calls[0][0]).toMatchObject({ path: copy, filename: copy })
    expect(addEntry).toHaveBeenCalledWith(expect.objectContaining({ path: copy }))
    expect(onNewNotePersisted).toHaveBeenCalledWith(copy)
  })
})
