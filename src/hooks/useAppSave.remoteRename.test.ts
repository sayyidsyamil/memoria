import { act, renderHook } from '@testing-library/react'
import type { SetStateAction } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { reportLiveNoteTitle } from '../lib/liveNoteTitle'
import { autoRenameRemoteNote } from '../lib/remoteNotes'
import type { VaultEntry } from '../types'
import { useAppSave } from './useAppSave'

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn().mockResolvedValue(undefined) }))
vi.mock('../mock-tauri', () => ({
  isTauri: vi.fn(() => false),
  mockInvoke: vi.fn().mockResolvedValue(undefined),
  updateMockContent: vi.fn(),
}))
vi.mock('../lib/remoteNotes', () => ({
  hasRemoteVault: vi.fn(() => true),
  autoRenameRemoteNote: vi.fn(),
}))

const OLD_PATH = 'untitled-note-1792790000.md'
const NEW_PATH = 'fresh-title.md'
const RENAME_DEBOUNCE_MS = 2500

function entry(path: string, title: string): VaultEntry {
  return { path, title, filename: path, outgoingLinks: [], snippet: '', wordCount: 0, isA: 'Note', status: null } as unknown as VaultEntry
}

function renderRemoteSave(overrides: Record<string, unknown> = {}) {
  let tabs = [{ entry: entry(OLD_PATH, 'Untitled Note'), content: '# \n' }]
  const deps = {
    updateEntry: vi.fn(),
    setTabs: vi.fn((update: SetStateAction<typeof tabs>) => {
      tabs = typeof update === 'function' ? update(tabs) : update
    }),
    handleSwitchTab: vi.fn(),
    setToastMessage: vi.fn(),
    loadModifiedFiles: vi.fn(),
    clearUnsaved: vi.fn(),
    unsavedPaths: new Set<string>(),
    tabs,
    activeTabPath: OLD_PATH,
    handleRenameNote: vi.fn(),
    handleRenameFilename: vi.fn(),
    replaceEntry: vi.fn(),
    resolvedPath: '/Users/mock/demo-vault-v2',
    initialH1AutoRenameEnabled: true,
    ...overrides,
  }
  const { unmount } = renderHook(() => useAppSave(deps))
  return { deps, tabs: () => tabs, unmount }
}

async function typeTitle(path: string, title: string | null) {
  act(() => reportLiveNoteTitle(path, title))
  await act(async () => {
    await vi.advanceTimersByTimeAsync(RENAME_DEBOUNCE_MS)
  })
}

describe('untitled rename of a note edited as a live document', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.mocked(autoRenameRemoteNote).mockReset()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('renames the note on the remote after its heading once typing pauses', async () => {
    vi.mocked(autoRenameRemoteNote).mockResolvedValue({
      newPath: NEW_PATH,
      entry: { path: NEW_PATH, filename: NEW_PATH, title: 'Fresh Title' },
    })
    const { deps, tabs } = renderRemoteSave()

    act(() => reportLiveNoteTitle(OLD_PATH, 'Fresh'))
    await act(async () => {
      await vi.advanceTimersByTimeAsync(RENAME_DEBOUNCE_MS / 2)
    })
    await typeTitle(OLD_PATH, 'Fresh Title')

    expect(autoRenameRemoteNote).toHaveBeenCalledTimes(1)
    expect(autoRenameRemoteNote).toHaveBeenCalledWith(OLD_PATH, 'Fresh Title')
    expect(deps.replaceEntry).toHaveBeenCalledWith(
      OLD_PATH,
      { path: NEW_PATH, filename: NEW_PATH, title: 'Fresh Title' },
      '# \n',
    )
    expect(deps.handleSwitchTab).toHaveBeenCalledWith(NEW_PATH)
    expect(tabs()[0].entry).toMatchObject({ path: NEW_PATH, title: 'Fresh Title', isA: 'Note' })
  })

  it('leaves notes alone that have no heading, a real name, or the setting off', async () => {
    const first = renderRemoteSave()
    await typeTitle(OLD_PATH, null)
    await typeTitle('ideas.md', 'Ideas')
    first.unmount()

    renderRemoteSave({ initialH1AutoRenameEnabled: false })
    await typeTitle(OLD_PATH, 'Fresh Title')

    expect(autoRenameRemoteNote).not.toHaveBeenCalled()
  })

  it('keeps the note where it is when the name already fits or the rename fails', async () => {
    vi.mocked(autoRenameRemoteNote).mockResolvedValueOnce(null).mockRejectedValueOnce(new Error('offline'))
    const { deps } = renderRemoteSave()

    await typeTitle(OLD_PATH, 'Fresh Title')
    await typeTitle(OLD_PATH, 'Fresh Title again')

    expect(autoRenameRemoteNote).toHaveBeenCalledTimes(2)
    expect(deps.replaceEntry).not.toHaveBeenCalled()
  })
})
