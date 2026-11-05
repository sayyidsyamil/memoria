import { act, renderHook, waitFor } from '@testing-library/react'
import { useState } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { APP_STORAGE_KEYS } from '../constants/appStorage'
import type { SidebarSelection, VaultEntry, ViewFile } from '../types'
import { useActiveNoteLocation } from './useActiveNoteLocation'

const VAULT_PATH = '/Users/mock/demo-vault-v2'
const VAULTS = [{ label: 'demo-vault-v2', path: VAULT_PATH }]
const ENTRIES = ['welcome.md', 'people/ada.md', 'projects/heron.md'].map((path) => ({ path }) as VaultEntry)
const VIEWS = [{ filename: 'active.yml' } as ViewFile]
const INBOX: SidebarSelection = { kind: 'filter', filter: 'inbox' }

interface HarnessOptions {
  enabled?: boolean
  views?: ViewFile[]
}

function useHarness({ enabled = true, views = VIEWS }: HarnessOptions) {
  const [activeNotePath, setActiveNotePath] = useState<string | null>(null)
  const [selection, setSelection] = useState<SidebarSelection>(INBOX)
  const [openNote] = useState(() => vi.fn(async (entry: VaultEntry) => { setActiveNotePath(entry.path) }))
  useActiveNoteLocation({
    activeNotePath,
    enabled,
    entries: ENTRIES,
    isVaultLoading: false,
    openNote,
    selection,
    setSelection,
    vaultPath: VAULT_PATH,
    vaults: VAULTS,
    views,
  })
  return { activeNotePath, openNote, selection, setSelection }
}

function renderAt(url: string, options: HarnessOptions = {}) {
  window.history.replaceState(null, '', url)
  return renderHook(() => useHarness(options))
}

function popTo(url: string) {
  act(() => {
    window.history.replaceState(null, '', url)
    window.dispatchEvent(new PopStateEvent('popstate'))
  })
}

function currentUrl(): string {
  return `${window.location.pathname}${window.location.search}`
}

describe('useActiveNoteLocation', () => {
  beforeEach(() => {
    localStorage.clear()
    vi.stubEnv('VITE_MEMORIA_WEB_BUILD', 'true')
  })

  afterEach(() => {
    vi.unstubAllEnvs()
    vi.restoreAllMocks()
    window.history.replaceState(null, '', '/')
  })

  it('opens the note the URL names, over the note that was open last', async () => {
    localStorage.setItem(APP_STORAGE_KEYS.lastActiveNotePath, 'welcome.md')
    const { result } = renderAt('/?note=people/ada.md')

    await waitFor(() => { expect(result.current.activeNotePath).toBe('people/ada.md') })
    await waitFor(() => { expect(currentUrl()).toBe('/?vault=demo-vault-v2&note=people/ada.md') })
  })

  it('names the restored last note in the URL without adding history', async () => {
    localStorage.setItem(APP_STORAGE_KEYS.lastActiveNotePath, 'welcome.md')
    const pushState = vi.spyOn(window.history, 'pushState')
    const { result } = renderAt('/')

    await waitFor(() => { expect(result.current.activeNotePath).toBe('welcome.md') })
    await waitFor(() => { expect(currentUrl()).toBe('/?vault=demo-vault-v2&note=welcome.md') })
    expect(pushState).not.toHaveBeenCalled()
  })

  it('pushes a history entry per note opened, and back reopens the previous one', async () => {
    const { result } = renderAt('/?note=welcome.md')
    await waitFor(() => { expect(currentUrl()).toBe('/?vault=demo-vault-v2&note=welcome.md') })

    const pushState = vi.spyOn(window.history, 'pushState')
    await act(async () => { await result.current.openNote(ENTRIES[1]) })
    expect(pushState).toHaveBeenCalledTimes(1)
    expect(currentUrl()).toBe('/?vault=demo-vault-v2&note=people/ada.md')

    popTo('/?vault=demo-vault-v2&note=welcome.md')
    await waitFor(() => { expect(result.current.activeNotePath).toBe('welcome.md') })
    expect(pushState).toHaveBeenCalledTimes(1)
    expect(currentUrl()).toBe('/?vault=demo-vault-v2&note=welcome.md')
  })

  it('ignores a note of another vault and keeps the note that was open last', async () => {
    localStorage.setItem(APP_STORAGE_KEYS.lastActiveNotePath, 'welcome.md')
    const { result } = renderAt('/?vault=other&note=people/ada.md')

    await waitFor(() => { expect(result.current.activeNotePath).toBe('welcome.md') })
    popTo('/?vault=other&note=projects/heron.md')
    expect(result.current.openNote).toHaveBeenCalledTimes(1)
  })

  it('selects the saved view the URL names, and back to a URL without it leaves the view', async () => {
    const { result } = renderAt('/?view=active.yml')

    await waitFor(() => { expect(result.current.selection).toEqual({ kind: 'view', filename: 'active.yml', rootPath: undefined }) })
    await waitFor(() => { expect(currentUrl()).toBe('/?vault=demo-vault-v2&view=active.yml') })

    popTo('/?vault=demo-vault-v2')
    expect(result.current.selection).toEqual(INBOX)
    popTo('/?vault=demo-vault-v2&view=active.yml')
    expect(result.current.selection).toEqual({ kind: 'view', filename: 'active.yml', rootPath: undefined })
  })

  it('drops a view the vault does not have', async () => {
    const { result } = renderAt('/?view=missing.yml', { views: [] })

    await waitFor(() => { expect(currentUrl()).toBe('/?vault=demo-vault-v2') })
    expect(result.current.selection).toEqual(INBOX)
  })

  it('pushes a history entry when the user selects a view', async () => {
    const { result } = renderAt('/')
    await waitFor(() => { expect(currentUrl()).toBe('/?vault=demo-vault-v2') })

    act(() => { result.current.setSelection({ kind: 'view', filename: 'active.yml' }) })
    await waitFor(() => { expect(currentUrl()).toBe('/?vault=demo-vault-v2&view=active.yml') })
  })

  it('leaves the URL alone outside the web build', async () => {
    vi.stubEnv('VITE_MEMORIA_WEB_BUILD', '')
    localStorage.setItem(APP_STORAGE_KEYS.lastActiveNotePath, 'welcome.md')
    const { result } = renderAt('/?note=people/ada.md')

    await waitFor(() => { expect(result.current.activeNotePath).toBe('welcome.md') })
    popTo('/?note=projects/heron.md')
    expect(currentUrl()).toBe('/?note=projects/heron.md')
    expect(result.current.activeNotePath).toBe('welcome.md')
  })

  it('neither restores nor routes in a window that does not restore notes', async () => {
    localStorage.setItem(APP_STORAGE_KEYS.lastActiveNotePath, 'welcome.md')
    const { result } = renderAt('/?note=people/ada.md', { enabled: false })

    popTo('/?note=projects/heron.md')
    expect(result.current.openNote).not.toHaveBeenCalled()
    expect(currentUrl()).toBe('/?note=projects/heron.md')
  })
})
