import { useEffect, useRef, useState } from 'react'
import { renderHook, act } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { SidebarSelection, VaultEntry } from '../types'
import { useFolderActions } from './useFolderActions'

vi.mock('../mock-tauri', () => ({
  isTauri: () => false,
  mockInvoke: vi.fn(),
}))

const { mockInvoke } = await import('../mock-tauri')
const mockInvokeFn = mockInvoke as ReturnType<typeof vi.fn>

const folderEntry: VaultEntry = {
  path: '/vault/projects/note.md',
  filename: 'note.md',
  title: 'Note',
  isA: 'Note',
  aliases: [],
  belongsTo: [],
  relatedTo: [],
  status: null,
  archived: false,
  modifiedAt: null,
  createdAt: null,
  fileSize: 10,
  snippet: '',
  wordCount: 0,
  relationships: {},
  icon: null,
  color: null,
  order: null,
  sidebarLabel: null,
  template: null,
  sort: null,
  view: null,
  visible: null,
  organized: false,
  favorite: false,
  favoriteIndex: null,
  listPropertiesDisplay: [],
  outgoingLinks: [],
  properties: {},
  hasH1: true,
}

function renderFolderActions({
  initialSelection,
  initialTabs = [{ entry: folderEntry, content: '# Note' }],
  reloadVault,
  reloadFolders,
  setToastMessage,
}: {
  initialSelection: SidebarSelection
  initialTabs?: Array<{ entry: VaultEntry; content: string }>
  reloadVault: ReturnType<typeof vi.fn>
  reloadFolders: ReturnType<typeof vi.fn>
  setToastMessage: ReturnType<typeof vi.fn>
}) {
  return renderHook(() => {
    const [selection, setSelection] = useState<SidebarSelection>(initialSelection)
    const [tabs, setTabs] = useState(initialTabs)
    const [activeTabPath, setActiveTabPath] = useState<string | null>(initialTabs[0]?.entry.path ?? null)
    const activeTabPathRef = useRef(activeTabPath)

    useEffect(() => {
      activeTabPathRef.current = activeTabPath
    }, [activeTabPath])

    const actions = useFolderActions({
      vaultPath: '/vault',
      selection,
      setSelection,
      setTabs,
      activeTabPathRef,
      handleSwitchTab: setActiveTabPath,
      closeAllTabs: () => {
        setTabs([])
        setActiveTabPath(null)
      },
      reloadVault,
      reloadFolders,
      setToastMessage,
    })

    return { actions, selection, tabs, activeTabPath }
  })
}

describe('useFolderActions', () => {
  let reloadVault: ReturnType<typeof vi.fn>
  let reloadFolders: ReturnType<typeof vi.fn>
  let setToastMessage: ReturnType<typeof vi.fn>

  beforeEach(() => {
    mockInvokeFn.mockReset()
    reloadVault = vi.fn()
    reloadFolders = vi.fn().mockResolvedValue([])
    setToastMessage = vi.fn()
  })

  it('renames a selected folder and updates selection plus active tab path', async () => {
    const renamedEntry = { ...folderEntry, path: '/vault/work/note.md' }
    reloadVault.mockResolvedValue([renamedEntry])
    mockInvokeFn.mockResolvedValue({ old_path: 'projects', new_path: 'work' })

    const { result } = renderFolderActions({
      initialSelection: { kind: 'folder', path: 'projects' },
      reloadVault,
      reloadFolders,
      setToastMessage,
    })

    await act(async () => {
      await result.current.actions.renameFolder('projects', 'work')
    })

    expect(result.current.selection).toEqual({ kind: 'folder', path: 'work' })
    expect(result.current.tabs[0]?.entry.path).toBe('/vault/work/note.md')
    expect(result.current.activeTabPath).toBe('/vault/work/note.md')
    expect(setToastMessage).toHaveBeenCalledWith('Renamed folder to "work"')
  })

  it('deletes a selected folder and clears the active note gracefully', async () => {
    reloadVault.mockResolvedValue([])
    mockInvokeFn.mockResolvedValue('projects')

    const { result } = renderFolderActions({
      initialSelection: { kind: 'folder', path: 'projects' },
      reloadVault,
      reloadFolders,
      setToastMessage,
    })

    act(() => {
      result.current.actions.requestDeleteFolder('projects')
    })

    await act(async () => {
      await result.current.actions.confirmDeleteSelectedFolder()
    })

    expect(result.current.selection).toEqual({ kind: 'filter', filter: 'all' })
    expect(result.current.tabs).toEqual([])
    expect(result.current.activeTabPath).toBeNull()
    expect(setToastMessage).toHaveBeenCalledWith('Deleted folder "projects"')
  })
  describe('on a Memoria remote (TOL-233)', () => {
    const remoteEntry = { ...folderEntry, path: 'projects/note.md' }
    let sent: Array<{ url: string; body: unknown }>
    let answer: () => Response

    beforeEach(() => {
      sent = []
      answer = () => Response.json({ path: 'projects', commit: 'c', pushed: true, deleted: ['projects/note.md'] })
      Object.assign(window, { MEMORIA_REMOTE_URL: 'https://vault.test', MEMORIA_REMOTE_TOKEN: 'token' })
      vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
        sent.push({ url, body: JSON.parse(String(init?.body)) })
        return answer()
      }))
    })

    afterEach(() => {
      vi.unstubAllGlobals()
      Object.assign(window, { MEMORIA_REMOTE_URL: undefined, MEMORIA_REMOTE_TOKEN: undefined })
    })

    function renderRemote(initialSelection: SidebarSelection) {
      return renderFolderActions({
        initialSelection,
        initialTabs: [{ entry: remoteEntry, content: '# Note' }],
        reloadVault: reloadVault.mockResolvedValue([]),
        reloadFolders,
        setToastMessage,
      })
    }

    it('deletes the folder on the server and closes its vault-relative notes', async () => {
      const otherTab = new BroadcastChannel('memoria:remote-folders:https://vault.test')
      const told = new Promise((resolve) => { otherTab.onmessage = ({ data }) => resolve(data) })
      const { result } = renderRemote({ kind: 'entity', entry: remoteEntry })

      act(() => result.current.actions.requestDeleteFolder('projects'))
      await act(async () => {
        await result.current.actions.confirmDeleteSelectedFolder()
      })

      expect(sent).toEqual([{ url: 'https://vault.test/v1/folders/delete', body: { path: 'projects' } }])
      expect(mockInvokeFn).not.toHaveBeenCalled()
      expect(result.current.tabs).toEqual([])
      expect(result.current.selection).toEqual({ kind: 'filter', filter: 'all' })
      await expect(told).resolves.toEqual({ kind: 'deleted', path: 'projects' })
      otherTab.close()
    })

    it('shows the server refusal with the desktop message', async () => {
      answer = () => Response.json({ error: { code: 'not_found' } }, { status: 404 })
      const { result } = renderRemote({ kind: 'folder', path: 'projects' })

      act(() => result.current.actions.requestDeleteFolder('projects'))
      await act(async () => {
        await result.current.actions.confirmDeleteSelectedFolder()
      })

      expect(setToastMessage).toHaveBeenCalledWith('Failed to delete folder: Folder does not exist: projects')
      expect(result.current.tabs).toHaveLength(1)
    })

    it('follows a folder another tab deleted or created, without a reload, and ignores anything else', async () => {
      const otherTab = new BroadcastChannel('memoria:remote-folders:https://vault.test')
      const { result } = renderRemote({ kind: 'folder', path: 'projects' })

      otherTab.postMessage({ kind: 'deleted', path: 'projects' })
      await vi.waitFor(() => expect(result.current.tabs).toEqual([]))
      expect(result.current.selection).toEqual({ kind: 'filter', filter: 'all' })
      expect(reloadVault).toHaveBeenCalled()

      reloadFolders.mockClear()
      for (const path of ['', '/etc', '../outside', 'a//b', 'a\\b', 'trailing./b', 'LPT1', 'a/CON.txt', 'quarterly:plan', 7]) otherTab.postMessage({ kind: 'deleted', path })
      otherTab.postMessage({ kind: 'renamed', path: 'ignored' })
      otherTab.postMessage({ kind: 'created', path: 'ideas' })
      await vi.waitFor(() => expect(reloadFolders).toHaveBeenCalledTimes(1))
      expect(sent).toEqual([])
      otherTab.close()
    })
  })
})
