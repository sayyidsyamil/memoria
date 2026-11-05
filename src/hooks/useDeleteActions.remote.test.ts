import { act, renderHook } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { deleteRemoteNotes } from '../lib/remoteNotes'
import { mockInvoke } from '../mock-tauri'
import { useDeleteActions } from './useDeleteActions'

vi.mock('../mock-tauri', () => ({ isTauri: () => false, mockInvoke: vi.fn() }))
vi.mock('../lib/remoteNotes', () => ({
  hasRemoteVault: () => true,
  deleteRemoteNotes: vi.fn(async (paths: string[]) => paths),
}))

describe('deleting notes from a remote vault', () => {
  it('deletes them on the server, not in the mock store', async () => {
    const removeEntries = vi.fn()
    const setToastMessage = vi.fn()
    const { result } = renderHook(() =>
      useDeleteActions({
        onDeselectNote: vi.fn(),
        removeEntry: vi.fn(),
        removeEntries,
        resolveVaultPathForPath: () => '/Users/mock/demo-vault-v2',
        refreshModifiedFiles: vi.fn(),
        reloadVault: vi.fn(),
        setToastMessage,
      }),
    )

    await act(async () => {
      expect(await result.current.deleteNoteFromDisk('ideas/big-idea.md')).toBe(true)
    })

    expect(deleteRemoteNotes).toHaveBeenCalledWith(['ideas/big-idea.md'])
    expect(mockInvoke).not.toHaveBeenCalled()
    expect(removeEntries).toHaveBeenCalledWith(['ideas/big-idea.md'])
    expect(setToastMessage).toHaveBeenLastCalledWith('Note permanently deleted')
  })
})
