import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { mockInvoke } from '../mock-tauri'
import type { VaultEntry } from '../types'
import { useNoteRename } from './useNoteRename'

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }))
vi.mock('../mock-tauri', () => ({
  isTauri: vi.fn(() => false),
  mockInvoke: vi.fn(),
}))

const NOTE_PATH = '/vault/notes/plan.md'

function renderRename(setToastMessage: (message: string | null) => void) {
  const entry = { path: NOTE_PATH, filename: 'plan.md', title: 'Plan' } as VaultEntry
  return renderHook(() => useNoteRename(
    { entries: [entry], setToastMessage },
    {
      tabs: [],
      setTabs: vi.fn(),
      activeTabPathRef: { current: null },
      handleSwitchTab: vi.fn(),
      updateTabContent: vi.fn(),
    },
  ))
}

describe('rename and move failure toasts', () => {
  const setToastMessage = vi.fn()

  beforeEach(() => {
    setToastMessage.mockReset()
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  it('shows a known rename error the desktop rejects with as plain text', async () => {
    vi.mocked(mockInvoke).mockRejectedValueOnce('  Invalid filename  ')
    const { result } = renderRename(setToastMessage)

    await act(async () => {
      await result.current.handleRenameFilename(NOTE_PATH, 'bad/name', '/vault', vi.fn())
    })

    expect(setToastMessage).toHaveBeenCalledWith('Invalid filename')
  })

  it('shows why a move failed', async () => {
    vi.mocked(mockInvoke).mockRejectedValueOnce(new Error(' Folder is read-only '))
    const { result } = renderRename(setToastMessage)

    await act(async () => {
      await result.current.handleMoveNoteToFolder(NOTE_PATH, 'archive', '/vault', vi.fn())
    })

    expect(setToastMessage).toHaveBeenCalledWith('Folder is read-only')
  })

  it('falls back to a generic message when a move fails without one', async () => {
    vi.mocked(mockInvoke).mockRejectedValueOnce({ code: 5 })
    const { result } = renderRename(setToastMessage)

    await act(async () => {
      await result.current.handleMoveNoteToFolder(NOTE_PATH, 'archive', '/vault', vi.fn())
    })

    expect(setToastMessage).toHaveBeenCalledWith('Failed to move note')
  })
})
